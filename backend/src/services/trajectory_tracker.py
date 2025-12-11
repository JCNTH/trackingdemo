"""
Video processing pipeline for movement analysis.

Implements industry-standard tracking based on:
- VBT Research: https://pmc.ncbi.nlm.nih.gov/articles/PMC7866505/
- OpenCap Architecture: https://github.com/stanfordnmbl/opencap-core
- MediaPipe Pose: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker

================================================================================
COORDINATE SYSTEMS & SPACES
================================================================================

1. IMAGE/PIXEL SPACE
   - Origin: Top-left corner (0, 0)
   - X-axis: → Right (0 to frame_width pixels)
   - Y-axis: ↓ Down (0 to frame_height pixels)
   - Used for: bar_trajectory positions, velocity calculations, bounding boxes
   - Example: 1440x1920 video → x∈[0,1440], y∈[0,1920]

2. NORMALIZED SPACE (0-1)
   - Origin: Top-left corner (0.0, 0.0)
   - X-axis: → Right (0.0 to 1.0)
   - Y-axis: ↓ Down (0.0 to 1.0)
   - Used for: MediaPipe/YOLO pose landmarks, person ROI selection
   - Conversion: pixel_x = normalized_x * frame_width

3. WORLD COORDINATES (MediaPipe only)
   - Origin: Hip center
   - Units: Meters (estimated, not measured - single camera limitation)
   - Used for: 3D pose visualization (pose_world_landmarks)

================================================================================
DATA FLOW
================================================================================

  Video Frame (pixels)
        │
        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  POSE ESTIMATION (MediaPipe/YOLO)                           │
  │  Output: landmarks[i].x, .y → Normalized [0-1]              │
  │          landmarks[i].z → Relative depth (unitless)         │
  │          landmarks[i].visibility → Confidence [0-1]         │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  BAR POSITION ESTIMATION                                    │
  │  Method: Midpoint of left_wrist + right_wrist               │
  │  Output: (x, y) in PIXEL coordinates                        │
  │  Stored: bar_trajectory[frame] = {x, y, timestamp, source}  │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  VELOCITY CALCULATION                                       │
  │  dx = curr.x - prev.x  (pixels)                             │
  │  dy = curr.y - prev.y  (pixels)                             │
  │  dt = (curr.frame - prev.frame) / fps  (seconds)            │
  │                                                             │
  │  vx = dx / dt  (pixels/second)                              │
  │  vy = dy / dt  (pixels/second)                              │
  │  speed = sqrt(vx² + vy²)  (pixels/second)                   │
  │                                                             │
  │  IMPORTANT: Y-axis is inverted in image coordinates!        │
  │  - Negative vy = bar moving UP (concentric phase)           │
  │  - Positive vy = bar moving DOWN (eccentric phase)          │
  │  - vertical_velocity = -vy (positive = upward)              │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  OUTPUT METRICS (velocity_metrics dict)                     │
  │  - peak_concentric_velocity: px/s (max upward speed)        │
  │  - peak_eccentric_velocity: px/s (max downward speed)       │
  │  - vertical_displacement: px (range of Y motion)            │
  │  - path_verticality: 0-1 (1 = perfectly vertical)           │
  │  - estimated_reps: count of full up/down cycles             │
  └─────────────────────────────────────────────────────────────┘

================================================================================
ACCURACY NOTES
================================================================================

Single-camera limitations:
- No depth measurement (Z-axis estimated, not measured)
- Velocity in px/s, not cm/s (needs calibration for real units)
- Camera angle affects measured displacement
- Works best when movement is perpendicular to camera

For real-world units, would need:
- Known reference object (e.g., bar length = 220cm)
- Calculate: pixels_per_cm = bar_pixel_length / 220
- Then: velocity_cms = velocity_pxs / pixels_per_cm

================================================================================
"""
import logging
import tempfile
import time
import math
from pathlib import Path
from collections import defaultdict
from typing import Literal, Optional, List, Dict, Tuple

import cv2
import numpy as np

from services.yolo_detector import detect_objects
from services.pose_estimator import estimate_pose, estimator as pose_estimator
from services.barbell_detector import (
    detect_barbell, 
    reset_barbell_tracking, 
    set_barbell_fps,
)
from db.supabase import (
    download_video,
    update_video_status,
    insert_detection_results,
    create_tracking_session,
)

logger = logging.getLogger(__name__)

# Processing modes
ProcessingMode = Literal["general", "bench_press"]


def calculate_angle(p1: Dict, p2: Dict, p3: Dict) -> Optional[float]:
    """
    Calculate the angle at p2 formed by the vectors p1->p2 and p3->p2.
    
    Args:
        p1, p2, p3: Points with 'x', 'y' keys (normalized 0-1 coordinates)
        
    Returns:
        Angle in degrees, or None if points are invalid
    """
    try:
        # Check visibility
        min_visibility = 0.3
        if any(p.get("visibility", 0) < min_visibility for p in [p1, p2, p3]):
            return None
        
        # Vector from p2 to p1
        v1 = np.array([p1["x"] - p2["x"], p1["y"] - p2["y"]])
        # Vector from p2 to p3
        v2 = np.array([p3["x"] - p2["x"], p3["y"] - p2["y"]])
        
        # Calculate angle using dot product
        cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
        cos_angle = np.clip(cos_angle, -1.0, 1.0)
        angle = np.degrees(np.arccos(cos_angle))
        
        return float(angle)
    except Exception:
        return None


def calculate_joint_angles(pose_landmarks: List[Dict]) -> Dict:
    """
    Calculate key joint angles for bench press form analysis.
    
    Based on MediaPipe Pose landmark indices:
    - 11, 12: shoulders
    - 13, 14: elbows
    - 15, 16: wrists
    
    Args:
        pose_landmarks: List of 33 pose landmarks
        
    Returns:
        Dictionary with joint angles and form metrics
    """
    if not pose_landmarks or len(pose_landmarks) < 17:
        return {}
    
    angles = {}
    
    # Get landmarks
    left_shoulder = pose_landmarks[11]
    right_shoulder = pose_landmarks[12]
    left_elbow = pose_landmarks[13]
    right_elbow = pose_landmarks[14]
    left_wrist = pose_landmarks[15]
    right_wrist = pose_landmarks[16]
    
    # Left elbow angle (shoulder -> elbow -> wrist)
    left_elbow_angle = calculate_angle(left_shoulder, left_elbow, left_wrist)
    if left_elbow_angle is not None:
        angles["left_elbow"] = left_elbow_angle
    
    # Right elbow angle (shoulder -> elbow -> wrist)
    right_elbow_angle = calculate_angle(right_shoulder, right_elbow, right_wrist)
    if right_elbow_angle is not None:
        angles["right_elbow"] = right_elbow_angle
    
    # Elbow symmetry (difference between left and right elbow angles)
    if "left_elbow" in angles and "right_elbow" in angles:
        angles["elbow_asymmetry"] = abs(angles["left_elbow"] - angles["right_elbow"])
        angles["avg_elbow_angle"] = (angles["left_elbow"] + angles["right_elbow"]) / 2
    
    # Shoulder angle (elbow -> shoulder -> hip approximation using shoulder height)
    # For bench press, we want to see ~45-75° elbow angle at bottom position
    
    # Wrist alignment check (are wrists roughly aligned?)
    left_wrist_vis = left_wrist.get("visibility", 0)
    right_wrist_vis = right_wrist.get("visibility", 0)
    if left_wrist_vis > 0.3 and right_wrist_vis > 0.3:
        wrist_y_diff = abs(left_wrist["y"] - right_wrist["y"])
        angles["wrist_alignment"] = 1.0 - min(wrist_y_diff * 10, 1.0)  # 0-1 score
    
    return angles


def calculate_velocity_metrics(
    bar_trajectory: List[Dict],
    fps: float,
    frame_height: int,
) -> Dict:
    """
    Calculate velocity-based metrics from bar trajectory.
    
    Based on VBT (Velocity Based Training) research:
    - Peak velocity during concentric phase
    - Average velocity
    - Displacement
    
    Args:
        bar_trajectory: List of bar position points in PIXEL coordinates
                       Each point: {x: float, y: float, frame: int, timestamp: float}
        fps: Video frames per second (for time conversion)
        frame_height: Video frame height (for reference, not currently used for conversion)
        
    Returns:
        Dictionary with velocity metrics:
        - peak_concentric_velocity: float (px/s) - max upward speed
        - peak_eccentric_velocity: float (px/s) - max downward speed  
        - average_speed: float (px/s) - mean speed across all frames
        - vertical_displacement: float (px) - total Y range of motion
        - horizontal_deviation: float (px) - total X range (ideally small)
        - path_verticality: float (0-1) - 1.0 = perfectly vertical path
        - estimated_reps: int - count of complete up/down cycles
    
    Coordinate Notes:
        - All positions are in PIXEL space
        - Y-axis is INVERTED: y=0 is top of frame, y=height is bottom
        - Therefore: negative dy = bar moving UP (concentric)
                     positive dy = bar moving DOWN (eccentric)
        - vertical_velocity = -vy to make positive = upward
    """
    if len(bar_trajectory) < 2:
        return {}
    
    # Sort by frame
    sorted_traj = sorted(bar_trajectory, key=lambda p: p["frame"])
    
    # Calculate frame-to-frame velocities
    velocities = []
    for i in range(1, len(sorted_traj)):
        prev = sorted_traj[i-1]
        curr = sorted_traj[i]
        
        dt = (curr["frame"] - prev["frame"]) / fps
        if dt <= 0:
            continue
            
        # Velocity in pixels per second
        dx = curr["x"] - prev["x"]
        dy = curr["y"] - prev["y"]
        
        vx = dx / dt
        vy = dy / dt
        speed = math.sqrt(vx**2 + vy**2)
        
        velocities.append({
            "frame": curr["frame"],
            "timestamp": curr.get("timestamp", curr["frame"] / fps),
            "vx": vx,
            "vy": vy,
            "speed": speed,
            "vertical_velocity": -vy,  # Negative Y is up in image coords
        })
    
    if not velocities:
        return {}
    
    # Calculate metrics
    speeds = [v["speed"] for v in velocities]
    vertical_velocities = [v["vertical_velocity"] for v in velocities]
    
    # Peak concentric velocity (max upward velocity)
    peak_concentric = max(vertical_velocities) if vertical_velocities else 0
    
    # Peak eccentric velocity (max downward velocity)
    peak_eccentric = abs(min(vertical_velocities)) if vertical_velocities else 0
    
    # Average velocity
    avg_speed = sum(speeds) / len(speeds) if speeds else 0
    
    # Total displacement (vertical)
    y_positions = [p["y"] for p in sorted_traj]
    displacement = max(y_positions) - min(y_positions)
    
    # Estimate rep count based on significant vertical movements
    # A rep = bar goes down to chest, then comes back up to lockout
    rep_count = 0
    if len(sorted_traj) > 10 and displacement > 50:  # Need enough data and movement
        y_positions = [p["y"] for p in sorted_traj]
        
        # Simple approach: count how many times we cross the midpoint going UP
        # (Y decreasing in image coordinates = bar going up)
        min_y = min(y_positions)
        max_y = max(y_positions)
        mid_y = (min_y + max_y) / 2
        
        # Track crossings
        was_below_mid = y_positions[0] > mid_y  # Below mid = bar is down
        
        for y in y_positions[1:]:
            is_below_mid = y > mid_y
            # Crossed from below to above (bar went up past midpoint)
            if was_below_mid and not is_below_mid:
                rep_count += 1
            was_below_mid = is_below_mid
        
        # If we ended up with 0 but there was significant movement, count as 1 partial rep
        if rep_count == 0 and displacement > 100:
            rep_count = 1
    
    # Path deviation from vertical (ideal bench press bar path is mostly vertical)
    x_positions = [p["x"] for p in sorted_traj]
    x_deviation = max(x_positions) - min(x_positions) if x_positions else 0
    path_verticality = 1.0 - min(x_deviation / (displacement + 1), 1.0)  # 0-1 score
    
    return {
        "peak_concentric_velocity": peak_concentric,
        "peak_eccentric_velocity": peak_eccentric,
        "average_speed": avg_speed,
        "vertical_displacement": displacement,
        "horizontal_deviation": x_deviation,
        "path_verticality": path_verticality,
        "estimated_reps": rep_count,
        "frame_velocities": velocities,
    }


async def process_video_pipeline(
    video_id: str, 
    storage_path: str,
    mode: ProcessingMode = "bench_press",
    selected_person_bbox: Optional[List[float]] = None,
) -> None:
    """
    Main video processing pipeline.
    
    1. Download video from Supabase Storage
    2. Process each frame with appropriate detector
    3. Store detection results
    4. Build trajectory data
    5. Update video status
    
    Args:
        video_id: Database video ID
        storage_path: Supabase storage path
        mode: Processing mode - "general" for all objects, "bench_press" for barbell only
        selected_person_bbox: Optional [x1, y1, x2, y2] normalized bbox of user-selected person
    """
    try:
        if selected_person_bbox:
            logger.info(f"Starting processing for video {video_id} (mode: {mode}, selected person: {selected_person_bbox})")
        else:
            logger.info(f"Starting processing for video {video_id} (mode: {mode})")
        
        # Download video to temp file
        video_data = await download_video(storage_path)
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
            tmp_file.write(video_data)
            tmp_path = tmp_file.name
        
        try:
            # Process video based on mode
            if mode == "bench_press":
                results = process_bench_press(tmp_path, selected_person_bbox=selected_person_bbox)
            else:
                results = process_video_file(tmp_path)
            
            # Update video metadata
            await update_video_status(
                video_id,
                "completed",
                duration=results["duration"],
                width=results["width"],
                height=results["height"],
                fps=results["fps"],
            )
            
            # Store detection results
            await insert_detection_results(video_id, results["frames"])
            
            # Merge form_analysis into trajectory_data for storage
            trajectory_data_with_analysis = results["trajectories"].copy()
            if results.get("form_analysis"):
                trajectory_data_with_analysis["form_analysis"] = results["form_analysis"]
            
            # Create tracking session with velocity metrics
            await create_tracking_session(
                video_id,
                object_count=results["object_count"],
                has_pose=results["has_pose"],
                trajectory_data=trajectory_data_with_analysis,
            )
            
            logger.info(f"Processing completed for video {video_id}")
            
        finally:
            # Cleanup temp file
            Path(tmp_path).unlink(missing_ok=True)
            
    except Exception as e:
        logger.error(f"Processing failed for video {video_id}: {e}")
        await update_video_status(video_id, "failed", error_message=str(e))


def process_video_file(video_path: str, sample_rate: int = 1) -> dict:
    """
    Process a video file and extract detection data.
    
    Args:
        video_path: Path to video file
        sample_rate: Process every Nth frame (1 = all frames)
        
    Returns:
        Dictionary with video metadata, frame results, and trajectories
    """
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    
    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    
    logger.info(f"Processing video: {width}x{height} @ {fps}fps, {total_frames} frames")
    
    frames_data = []
    object_trajectories = defaultdict(list)
    pose_trajectories = defaultdict(list)
    has_pose = False
    unique_objects = set()
    
    frame_number = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Sample frames
        if frame_number % sample_rate != 0:
            frame_number += 1
            continue
        
        timestamp = frame_number / fps if fps > 0 else 0
        
        # Detect objects
        objects = detect_objects(frame, track=True)
        
        # Track unique objects
        for obj in objects:
            if obj["track_id"] is not None:
                unique_objects.add((obj["class"], obj["track_id"]))
                
                # Store trajectory point
                center_x = (obj["bbox"][0] + obj["bbox"][2]) / 2
                center_y = (obj["bbox"][1] + obj["bbox"][3]) / 2
                key = f"{obj['class']}_{obj['track_id']}"
                object_trajectories[key].append({
                    "frame": frame_number,
                    "timestamp": timestamp,
                    "x": center_x,
                    "y": center_y,
                })
        
        # Estimate pose
        pose_landmarks = estimate_pose(frame)
        if pose_landmarks:
            has_pose = True
            
            # Store trajectory for key joints
            key_joints = {
                15: "left_wrist",
                16: "right_wrist",
                19: "left_index",
                20: "right_index",
                27: "left_ankle",
                28: "right_ankle",
            }
            
            for idx, name in key_joints.items():
                if idx < len(pose_landmarks):
                    lm = pose_landmarks[idx]
                    pose_trajectories[name].append({
                        "frame": frame_number,
                        "timestamp": timestamp,
                        "x": lm["x"] * width,
                        "y": lm["y"] * height,
                    })
        
        # Store frame data
        frames_data.append({
            "frame_number": frame_number,
            "timestamp": timestamp,
            "objects": objects,
            "pose_landmarks": pose_landmarks,
        })
        
        frame_number += 1
        
        # Log progress
        if frame_number % 100 == 0:
            logger.info(f"Processed {frame_number}/{total_frames} frames")
    
    cap.release()
    
    # Build trajectory data
    trajectories = {
        "objects": [
            {
                "class": key.split("_")[0],
                "track_id": int(key.split("_")[1]),
                "points": points,
            }
            for key, points in object_trajectories.items()
        ],
        "pose": {
            "landmarks": dict(pose_trajectories),
        } if pose_trajectories else None,
    }
    
    return {
        "duration": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "total_frames": total_frames,
        "processed_frames": len(frames_data),
        "object_count": len(unique_objects),
        "has_pose": has_pose,
        "frames": frames_data,
        "trajectories": trajectories,
    }


def process_bench_press(
    video_path: str, 
    sample_rate: int = 1,
    selected_person_bbox: Optional[List[float]] = None,
) -> dict:
    """
    Process a bench press video with advanced bar tracking and form analysis.
    
    Features:
    - Kalman filter-based bar tracking with multi-source fallback
    - Joint angle calculation for form analysis
    - Velocity metrics for VBT-style feedback
    - Gap interpolation for smooth trajectories
    
    Args:
        video_path: Path to video file
        sample_rate: Process every Nth frame
        selected_person_bbox: Optional [x1, y1, x2, y2] normalized bbox of user-selected person
        
    Returns:
        Dictionary with video metadata, frame results, bar path trajectory, and metrics
    """
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    
    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    
    logger.info(f"Processing bench press video: {width}x{height} @ {fps:.1f}fps, {total_frames} frames")
    logger.info(f"  Video duration: {duration:.1f}s")
    
    # Initialize barbell detector with correct FPS for Kalman filter
    set_barbell_fps(fps)
    reset_barbell_tracking()
    
    # Determine ROI for pose estimation
    if selected_person_bbox:
        padding = 0.1
        tracking_roi = (
            max(0, selected_person_bbox[0] - padding),
            max(0, selected_person_bbox[1] - padding),
            min(1, selected_person_bbox[2] + padding),
            min(1, selected_person_bbox[3] + padding),
        )
        logger.info(f"  Using USER-SELECTED person bbox: x={tracking_roi[0]:.2f}-{tracking_roi[2]:.2f}, y={tracking_roi[1]:.2f}-{tracking_roi[3]:.2f}")
    else:
        tracking_roi = (0.0, 0.25, 1.0, 1.0)
        logger.info(f"  Using DEFAULT ROI (lower 75%): y={tracking_roi[1]:.0%} to {tracking_roi[3]:.0%}")
    
    frames_data = []
    bar_trajectory = []
    pose_trajectories = defaultdict(list)
    joint_angles_history = []
    has_pose = False
    
    # Tracking statistics - count all sources
    bar_detections = defaultdict(int)
    pose_detections = 0
    
    start_time = time.time()
    last_log_time = start_time
    frame_number = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Sample frames
        if frame_number % sample_rate != 0:
            frame_number += 1
            continue
        
        timestamp = frame_number / fps if fps > 0 else 0
        
        # Estimate pose with ROI
        pose_landmarks = pose_estimator.estimate(frame, roi=tracking_roi)
        
        # Detect barbell using advanced tracker
        barbell_result = detect_barbell(frame, pose_landmarks)
        
        # Track detection source statistics
        source = barbell_result.get("source", "none")
        bar_detections[source] += 1
        
        # Convert barbell detection to object format
        objects = []
        if barbell_result["bar_center"] is not None:
            cx, cy = barbell_result["bar_center"]
            box_size = 30
            objects.append({
                "class": "barbell",
                "class_id": -1,
                "confidence": barbell_result["confidence"],
                "bbox": [cx - box_size, cy - box_size, cx + box_size, cy + box_size],
                "track_id": 1,
                "bar_center": [cx, cy],
                "source": source,
                "velocity": barbell_result.get("velocity"),
                "speed": barbell_result.get("speed"),
            })
            
            # Store bar path trajectory
            bar_trajectory.append({
                "frame": frame_number,
                "timestamp": timestamp,
                "x": cx,
                "y": cy,
                "confidence": barbell_result["confidence"],
                "source": source,
                "vx": barbell_result.get("velocity", (0, 0))[0],
                "vy": barbell_result.get("velocity", (0, 0))[1],
                "speed": barbell_result.get("speed", 0),
            })
        
        # Calculate and store joint angles
        joint_angles = {}
        if pose_landmarks:
            has_pose = True
            pose_detections += 1
            
            # Calculate joint angles
            joint_angles = calculate_joint_angles(pose_landmarks)
            if joint_angles:
                joint_angles["frame"] = frame_number
                joint_angles["timestamp"] = timestamp
                joint_angles_history.append(joint_angles)
            
            # Track key joints for bench press form
            key_joints = {
                11: "left_shoulder",
                12: "right_shoulder",
                13: "left_elbow",
                14: "right_elbow",
                15: "left_wrist",
                16: "right_wrist",
            }
            
            for idx, name in key_joints.items():
                if idx < len(pose_landmarks):
                    lm = pose_landmarks[idx]
                    pose_trajectories[name].append({
                        "frame": frame_number,
                        "timestamp": timestamp,
                        "x": lm["x"] * width,
                        "y": lm["y"] * height,
                        "visibility": lm.get("visibility", 0),
                    })
        
        # Store frame data
        frames_data.append({
            "frame_number": frame_number,
            "timestamp": timestamp,
            "objects": objects,
            "pose_landmarks": pose_landmarks,
            "joint_angles": joint_angles if joint_angles else None,
        })
        
        frame_number += 1
        
        # Log progress every 2 seconds or every 50 frames
        current_time = time.time()
        if frame_number % 50 == 0 or (current_time - last_log_time) >= 2.0:
            elapsed = current_time - start_time
            progress = frame_number / total_frames
            fps_actual = frame_number / elapsed if elapsed > 0 else 0
            eta = (total_frames - frame_number) / fps_actual if fps_actual > 0 else 0
            
            total_bar = sum(bar_detections.values())
            bar_rate = (total_bar - bar_detections["lost"]) / total_bar * 100 if total_bar > 0 else 0
            
            logger.info(
                f"  [{progress*100:5.1f}%] Frame {frame_number}/{total_frames} | "
                f"Bar: {bar_rate:.0f}% | Pose: {pose_detections} | "
                f"Speed: {fps_actual:.1f} fps | ETA: {eta:.0f}s"
            )
            last_log_time = current_time
    
    cap.release()
    
    # Calculate velocity metrics
    velocity_metrics = calculate_velocity_metrics(bar_trajectory, fps, height)
    
    # Final statistics
    total_time = time.time() - start_time
    total_bar = sum(bar_detections.values())
    
    # Calculate tracking summary
    logger.info(f"  [100.0%] Processing complete!")
    logger.info(f"  Total time: {total_time:.1f}s ({total_frames/total_time:.1f} fps)")
    logger.info(f"  Bar tracking breakdown:")
    for source, count in sorted(bar_detections.items(), key=lambda x: -x[1]):
        pct = count / total_bar * 100 if total_bar > 0 else 0
        logger.info(f"    - {source}: {count}/{total_bar} ({pct:.1f}%)")
    logger.info(f"  Pose detections: {pose_detections}/{frame_number} ({pose_detections/frame_number*100:.1f}%)")
    
    if velocity_metrics:
        logger.info(f"  Velocity metrics:")
        logger.info(f"    - Peak concentric: {velocity_metrics.get('peak_concentric_velocity', 0):.1f} px/s")
        logger.info(f"    - Vertical displacement: {velocity_metrics.get('vertical_displacement', 0):.1f} px")
        logger.info(f"    - Path verticality: {velocity_metrics.get('path_verticality', 0)*100:.1f}%")
        logger.info(f"    - Estimated reps: {velocity_metrics.get('estimated_reps', 0)}")
    
    # Normalize tracking stats for frontend
    # Map backend source names to frontend categories
    normalized_stats = {
        "both_wrists": (
            bar_detections.get("forearm_extended", 0) +  # Best: forearm-based estimation
            bar_detections.get("weighted_wrists", 0) + 
            bar_detections.get("raw_midpoint", 0)
        ),
        "single_wrist": (
            bar_detections.get("right_forearm", 0) +
            bar_detections.get("left_forearm", 0) +
            bar_detections.get("right_estimated", 0) + 
            bar_detections.get("left_estimated", 0) +
            bar_detections.get("right_only", 0) +
            bar_detections.get("left_only", 0)
        ),
        "kalman_prediction": bar_detections.get("elbows_estimated", 0),  # Fallback estimation
        "lost": bar_detections.get("lost", 0) + bar_detections.get("no_pose", 0) + bar_detections.get("none", 0),
    }
    
    # Build trajectory data
    trajectories = {
        "objects": [
            {
                "class": "barbell",
                "track_id": 1,
                "points": bar_trajectory,
            }
        ] if bar_trajectory else [],
        "pose": {
            "landmarks": dict(pose_trajectories),
        } if pose_trajectories else None,
        "bar_path": bar_trajectory,
        "velocity_metrics": velocity_metrics,
        "joint_angles": joint_angles_history,
        "tracking_stats": normalized_stats,
    }
    
    # Run AI form analysis if data is available
    form_analysis = None
    if bar_trajectory and velocity_metrics:
        try:
            from services.form_analyzer import analyze_bench_press
            video_info = {
                "duration": duration,
                "fps": fps,
                "width": width,
                "height": height,
            }
            form_analysis = analyze_bench_press(
                trajectory_data=trajectories,
                velocity_metrics=velocity_metrics,
                joint_angles=joint_angles_history,
                tracking_stats=normalized_stats,
                video_info=video_info,
            )
            if form_analysis.get("success"):
                logger.info(f"  Form analysis: {form_analysis.get('analysis', {}).get('form_quality', 'unknown')} quality")
        except Exception as e:
            logger.warning(f"Form analysis failed: {e}")
            form_analysis = {"error": str(e), "success": False}
    
    return {
        "duration": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "total_frames": total_frames,
        "processed_frames": len(frames_data),
        "object_count": 1 if bar_trajectory else 0,
        "has_pose": has_pose,
        "frames": frames_data,
        "trajectories": trajectories,
        "form_analysis": form_analysis,
    }


def extract_keyframes(video_path: str, num_frames: int = 5) -> List[np.ndarray]:
    """
    Extract evenly-spaced keyframes from video.
    
    Args:
        video_path: Path to video file
        num_frames: Number of keyframes to extract
        
    Returns:
        List of BGR frames as numpy arrays
    """
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    if total_frames < num_frames:
        indices = list(range(total_frames))
    else:
        indices = [int(i * total_frames / num_frames) for i in range(num_frames)]
    
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if ret:
            frames.append(frame)
    
    cap.release()
    return frames
