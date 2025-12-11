"""
Video Processing Pipeline for Exercise Tracking

Processes video → extracts pose → tracks bar → calculates velocity metrics.

References:
- MediaPipe Pose: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- VBT Research: https://pmc.ncbi.nlm.nih.gov/articles/PMC7866505/
"""

import logging
import tempfile
import time
import math
from pathlib import Path
from collections import defaultdict
from typing import Literal, Optional, List, Dict

import cv2
import numpy as np

from services.pose_estimator import estimator as pose_estimator
from services.barbell_detector import detect_barbell, reset_barbell_tracking, set_barbell_fps
from db.supabase import download_video, update_video_status, insert_detection_results, create_tracking_session

logger = logging.getLogger(__name__)

ProcessingMode = Literal["general", "bench_press"]


# =============================================================================
# SECTION 1: ANGLE CALCULATION
# =============================================================================
# Calculates joint angles from three landmark points using vector math.
# Used for elbow angle analysis in bench press form checking.

def calculate_angle(p1: Dict, p2: Dict, p3: Dict) -> Optional[float]:
    """
    Calculate angle at p2 formed by vectors p1→p2 and p3→p2.
    
    Uses dot product formula: cos(θ) = (v1 · v2) / (|v1| × |v2|)
    
    Args:
        p1, p2, p3: Landmark dicts with 'x', 'y' keys (normalized 0-1)
    
    Returns:
        Angle in degrees, or None if landmarks have low visibility
    """
    # Skip if any landmark is not visible enough
    if any(p.get("visibility", 0) < 0.3 for p in [p1, p2, p3]):
        return None
    
    # Create vectors from p2 to p1 and p2 to p3
    v1 = np.array([p1["x"] - p2["x"], p1["y"] - p2["y"]])
    v2 = np.array([p3["x"] - p2["x"], p3["y"] - p2["y"]])
    
    # Calculate angle using dot product
    cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    
    return float(np.degrees(np.arccos(cos_angle)))


def calculate_joint_angles(pose_landmarks: List[Dict]) -> Dict:
    """
    Calculate elbow angles from pose landmarks.
    
    MediaPipe landmark indices:
        11, 12 = shoulders
        13, 14 = elbows  
        15, 16 = wrists
    
    Returns dict with:
        - left_elbow, right_elbow: angle in degrees
        - avg_elbow_angle: average of both
        - elbow_asymmetry: difference between sides
    """
    if not pose_landmarks or len(pose_landmarks) < 17:
        return {}
    
    angles = {}
    
    # Elbow angles: shoulder → elbow → wrist
    left = calculate_angle(pose_landmarks[11], pose_landmarks[13], pose_landmarks[15])
    right = calculate_angle(pose_landmarks[12], pose_landmarks[14], pose_landmarks[16])
    
    if left: angles["left_elbow"] = left
    if right: angles["right_elbow"] = right
    
    if left and right:
        angles["avg_elbow_angle"] = (left + right) / 2
        angles["elbow_asymmetry"] = abs(left - right)
    
    return angles


# =============================================================================
# SECTION 2: VELOCITY CALCULATION  
# =============================================================================
# Converts bar trajectory (pixel positions) into velocity metrics.
# Key insight: Y-axis is INVERTED in image coordinates.

def calculate_velocity_metrics(bar_trajectory: List[Dict], fps: float, frame_height: int) -> Dict:
    """
    Calculate velocity-based training (VBT) metrics from bar path.
    
    COORDINATE SYSTEM:
        - Input: bar positions in PIXEL coordinates (x, y)
        - Y-axis is INVERTED: y=0 is TOP, y=height is BOTTOM
        - Therefore: negative dy = bar moving UP (concentric)
                     positive dy = bar moving DOWN (eccentric)
    
    VELOCITY FORMULA:
        dx = curr.x - prev.x         (pixels)
        dy = curr.y - prev.y         (pixels)  
        dt = frame_diff / fps        (seconds)
        
        velocity = distance / time   (pixels/second)
        vertical_velocity = -dy/dt   (positive = upward)
    
    Returns:
        - peak_concentric_velocity: max upward speed (px/s)
        - peak_eccentric_velocity: max downward speed (px/s)
        - vertical_displacement: total Y range of motion (px)
        - path_verticality: 0-1 score (1 = perfectly vertical)
        - estimated_reps: count of complete lift cycles
    """
    if len(bar_trajectory) < 2:
        return {}
    
    sorted_traj = sorted(bar_trajectory, key=lambda p: p["frame"])
    
    # Calculate frame-to-frame velocities
    velocities = []
    for i in range(1, len(sorted_traj)):
        prev, curr = sorted_traj[i-1], sorted_traj[i]
        
        dt = (curr["frame"] - prev["frame"]) / fps
        if dt <= 0:
            continue
        
        dx = curr["x"] - prev["x"]
        dy = curr["y"] - prev["y"]
        
        velocities.append({
            "frame": curr["frame"],
            "vx": dx / dt,
            "vy": dy / dt,
            "speed": math.sqrt(dx**2 + dy**2) / dt,
            "vertical_velocity": -dy / dt,  # Invert Y for intuitive direction
        })
    
    if not velocities:
        return {}
    
    # Extract metrics
    vertical_vels = [v["vertical_velocity"] for v in velocities]
    speeds = [v["speed"] for v in velocities]
    
    y_positions = [p["y"] for p in sorted_traj]
    x_positions = [p["x"] for p in sorted_traj]
    
    displacement = max(y_positions) - min(y_positions)
    x_deviation = max(x_positions) - min(x_positions)
    
    # Count reps by tracking midpoint crossings (going UP)
    rep_count = _count_reps(y_positions, displacement)
    
    return {
        "peak_concentric_velocity": max(vertical_vels),
        "peak_eccentric_velocity": abs(min(vertical_vels)),
        "average_speed": sum(speeds) / len(speeds),
        "vertical_displacement": displacement,
        "horizontal_deviation": x_deviation,
        "path_verticality": 1.0 - min(x_deviation / (displacement + 1), 1.0),
        "estimated_reps": rep_count,
        "frame_velocities": velocities,
    }


def _count_reps(y_positions: List[float], displacement: float) -> int:
    """Count rep cycles by tracking when bar crosses midpoint going UP."""
    if len(y_positions) < 10 or displacement < 50:
        return 0
    
    mid_y = (min(y_positions) + max(y_positions)) / 2
    was_below = y_positions[0] > mid_y
    rep_count = 0
    
    for y in y_positions[1:]:
        is_below = y > mid_y
        if was_below and not is_below:  # Crossed midpoint going up
            rep_count += 1
        was_below = is_below
    
    return rep_count if rep_count > 0 else (1 if displacement > 100 else 0)


# =============================================================================
# SECTION 3: MAIN PROCESSING PIPELINE
# =============================================================================
# Orchestrates the full video processing workflow:
# 1. Download video from Supabase
# 2. Extract frames with OpenCV
# 3. Run pose estimation (MediaPipe)
# 4. Track bar position (wrist midpoint)
# 5. Calculate metrics and save to database

async def process_video_pipeline(
    video_id: str,
    storage_path: str,
    mode: ProcessingMode = "bench_press",
    selected_person_bbox: Optional[List[float]] = None,
) -> None:
    """
    Main entry point for video processing.
    
    Pipeline:
        Video file → Frame extraction → Pose estimation → Bar tracking → Metrics
    """
    try:
        logger.info(f"Starting processing: video={video_id}, mode={mode}")
        
        # Download video to temp file
        video_data = await download_video(storage_path)
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(video_data)
            tmp_path = tmp.name
        
        try:
            # Process based on mode
            results = process_bench_press(tmp_path, selected_person_bbox=selected_person_bbox)
            
            # Save to database
            await update_video_status(
                video_id, "completed",
                duration=results["duration"],
                width=results["width"],
                height=results["height"],
                fps=results["fps"],
            )
            
            await insert_detection_results(video_id, results["frames"])
            
            trajectory_data = results["trajectories"].copy()
            if results.get("form_analysis"):
                trajectory_data["form_analysis"] = results["form_analysis"]
            
            await create_tracking_session(
                video_id,
                object_count=results["object_count"],
                has_pose=results["has_pose"],
                trajectory_data=trajectory_data,
            )
            
            logger.info(f"Processing completed: video={video_id}")
            
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            
    except Exception as e:
        logger.error(f"Processing failed: video={video_id}, error={e}")
        await update_video_status(video_id, "failed", error_message=str(e))


# =============================================================================
# SECTION 4: FRAME-BY-FRAME PROCESSING
# =============================================================================
# The core processing loop that runs on each video frame.

def process_bench_press(
    video_path: str,
    sample_rate: int = 1,
    selected_person_bbox: Optional[List[float]] = None,
) -> dict:
    """
    Process video frame-by-frame for bench press analysis.
    
    For each frame:
        1. Extract frame (OpenCV)
        2. Run pose estimation (MediaPipe) → 33 landmarks in normalized [0-1] coords
        3. Estimate bar position (wrist midpoint) → pixel coordinates
        4. Calculate joint angles
        5. Store trajectory point
    
    After all frames:
        6. Calculate velocity metrics
        7. Run AI form analysis
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")
    
    # Video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    
    logger.info(f"Video: {width}x{height} @ {fps:.1f}fps, {total_frames} frames")
    
    # Initialize tracking
    set_barbell_fps(fps)
    reset_barbell_tracking()
    
    # Set ROI for pose estimation
    tracking_roi = _get_tracking_roi(selected_person_bbox)
    
    # Storage
    frames_data = []
    bar_trajectory = []
    pose_trajectories = defaultdict(list)
    joint_angles_history = []
    bar_detections = defaultdict(int)
    
    has_pose = False
    frame_number = 0
    start_time = time.time()
    
    # MAIN PROCESSING LOOP
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        if frame_number % sample_rate != 0:
            frame_number += 1
            continue
        
        timestamp = frame_number / fps
        
        # STEP 1: Pose estimation (returns 33 landmarks in normalized coords)
        pose_landmarks = pose_estimator.estimate(frame, roi=tracking_roi)
        
        # STEP 2: Bar detection (converts landmarks to pixel coords, estimates bar position)
        barbell_result = detect_barbell(frame, pose_landmarks)
        source = barbell_result.get("source", "none")
        bar_detections[source] += 1
        
        # STEP 3: Store bar trajectory if detected
        objects = []
        if barbell_result["bar_center"] is not None:
            cx, cy = barbell_result["bar_center"]  # Pixel coordinates
            
            objects.append({
                "class": "barbell",
                "confidence": barbell_result["confidence"],
                "bbox": [cx - 30, cy - 30, cx + 30, cy + 30],
                "bar_center": [cx, cy],
                "source": source,
            })
            
            bar_trajectory.append({
                "frame": frame_number,
                "timestamp": timestamp,
                "x": cx,
                "y": cy,
                "confidence": barbell_result["confidence"],
                "source": source,
            })
        
        # STEP 4: Calculate joint angles
        joint_angles = {}
        if pose_landmarks:
            has_pose = True
            joint_angles = calculate_joint_angles(pose_landmarks)
            if joint_angles:
                joint_angles["frame"] = frame_number
                joint_angles_history.append(joint_angles)
            
            # Store key joint trajectories (convert normalized → pixels)
            for idx, name in [(15, "left_wrist"), (16, "right_wrist")]:
                if idx < len(pose_landmarks):
                    lm = pose_landmarks[idx]
                    pose_trajectories[name].append({
                        "frame": frame_number,
                        "x": lm["x"] * width,  # Normalized → Pixel
                        "y": lm["y"] * height,
                    })
        
        frames_data.append({
            "frame_number": frame_number,
            "timestamp": timestamp,
            "objects": objects,
            "pose_landmarks": pose_landmarks,
            "joint_angles": joint_angles or None,
        })
        
        frame_number += 1
        
        if frame_number % 50 == 0:
            _log_progress(frame_number, total_frames, start_time, bar_detections)
    
    cap.release()
    
    # STEP 5: Calculate velocity metrics from trajectory
    velocity_metrics = calculate_velocity_metrics(bar_trajectory, fps, height)
    
    # Build output
    tracking_stats = _normalize_tracking_stats(bar_detections)
    trajectories = {
        "bar_path": bar_trajectory,
        "velocity_metrics": velocity_metrics,
        "joint_angles": joint_angles_history,
        "tracking_stats": tracking_stats,
        "pose": {"landmarks": dict(pose_trajectories)} if pose_trajectories else None,
    }
    
    # STEP 6: AI form analysis
    form_analysis = _run_form_analysis(
        bar_trajectory, velocity_metrics, joint_angles_history,
        tracking_stats, duration, fps, width, height
    )
    
    _log_final_stats(bar_detections, velocity_metrics, frame_number, start_time)
    
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


# =============================================================================
# SECTION 5: HELPER FUNCTIONS
# =============================================================================

def _get_tracking_roi(selected_person_bbox: Optional[List[float]]) -> tuple:
    """Get region of interest for pose estimation."""
    if selected_person_bbox:
        padding = 0.1
        return (
            max(0, selected_person_bbox[0] - padding),
            max(0, selected_person_bbox[1] - padding),
            min(1, selected_person_bbox[2] + padding),
            min(1, selected_person_bbox[3] + padding),
        )
    return (0.0, 0.25, 1.0, 1.0)  # Default: lower 75% of frame


def _normalize_tracking_stats(bar_detections: Dict) -> Dict:
    """Normalize tracking stats for frontend display."""
    return {
        "both_wrists": sum(bar_detections.get(s, 0) for s in 
            ["forearm_extended", "weighted_wrists", "raw_midpoint"]),
        "single_wrist": sum(bar_detections.get(s, 0) for s in
            ["right_forearm", "left_forearm", "right_estimated", "left_estimated", "right_only", "left_only"]),
        "lost": sum(bar_detections.get(s, 0) for s in ["lost", "no_pose", "none"]),
    }


def _run_form_analysis(bar_trajectory, velocity_metrics, joint_angles, tracking_stats, 
                       duration, fps, width, height) -> Optional[Dict]:
    """Run AI-powered form analysis if data available."""
    if not bar_trajectory or not velocity_metrics:
        return None
    
    try:
        from services.form_analyzer import analyze_bench_press
        return analyze_bench_press(
            trajectory_data={"bar_path": bar_trajectory, "joint_angles": joint_angles},
            velocity_metrics=velocity_metrics,
            joint_angles=joint_angles,
            tracking_stats=tracking_stats,
            video_info={"duration": duration, "fps": fps, "width": width, "height": height},
        )
    except Exception as e:
        logger.warning(f"Form analysis failed: {e}")
        return {"error": str(e), "success": False}


def _log_progress(frame_number: int, total_frames: int, start_time: float, bar_detections: Dict):
    """Log processing progress."""
    elapsed = time.time() - start_time
    fps_actual = frame_number / elapsed if elapsed > 0 else 0
    progress = frame_number / total_frames * 100
    
    total = sum(bar_detections.values())
    detected = total - bar_detections.get("lost", 0) - bar_detections.get("none", 0)
    rate = detected / total * 100 if total > 0 else 0
    
    logger.info(f"[{progress:5.1f}%] Frame {frame_number}/{total_frames} | Bar: {rate:.0f}% | {fps_actual:.1f} fps")


def _log_final_stats(bar_detections: Dict, velocity_metrics: Dict, frame_count: int, start_time: float):
    """Log final processing statistics."""
    total_time = time.time() - start_time
    total = sum(bar_detections.values())
    
    logger.info(f"Complete! {total_time:.1f}s ({frame_count/total_time:.1f} fps)")
    
    for source, count in sorted(bar_detections.items(), key=lambda x: -x[1]):
        pct = count / total * 100 if total > 0 else 0
        logger.info(f"  {source}: {count} ({pct:.1f}%)")
    
    if velocity_metrics:
        logger.info(f"  Peak velocity: {velocity_metrics.get('peak_concentric_velocity', 0):.1f} px/s")
        logger.info(f"  Displacement: {velocity_metrics.get('vertical_displacement', 0):.1f} px")
        logger.info(f"  Reps: {velocity_metrics.get('estimated_reps', 0)}")
