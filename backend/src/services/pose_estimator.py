"""
Pose estimation service using MediaPipe and YOLO backends.

================================================================================
COORDINATE SYSTEMS
================================================================================

OUTPUT COORDINATES (landmarks):
  - x, y: NORMALIZED [0-1] relative to frame dimensions
    - (0, 0) = top-left corner
    - (1, 1) = bottom-right corner
    - To convert to pixels: pixel_x = x * frame_width
  
  - z: RELATIVE depth (unitless)
    - Smaller = closer to camera
    - NOT in real-world units (single camera limitation)
    - Use for relative comparisons only
  
  - visibility: Confidence score [0-1]
    - 1.0 = fully visible and confident
    - 0.0 = occluded or low confidence

WORLD LANDMARKS (MediaPipe only):
  - x, y, z: METERS (estimated)
  - Origin: Hip center
  - Coordinate system:
    - X: → Subject's right
    - Y: ↓ Down
    - Z: → Away from camera (depth)
  - Note: Depth is estimated from 2D, not measured

ROI (Region of Interest):
  - Format: (x1, y1, x2, y2) in NORMALIZED [0-1] coordinates
  - Used to crop frame before processing
  - Output landmarks are mapped back to full frame coordinates

================================================================================
LANDMARK INDICES (33 points)
================================================================================

Face:        0-10  (nose, eyes, ears, mouth)
Upper body:  11-22 (shoulders, elbows, wrists, hands)
Lower body:  23-32 (hips, knees, ankles, feet)

Key landmarks for exercise tracking:
  - 11, 12: shoulders
  - 13, 14: elbows
  - 15, 16: wrists (used for bar position estimation)
  - 23, 24: hips
  - 25, 26: knees
  - 27, 28: ankles

================================================================================
"""
import logging
from typing import Optional, Literal
import numpy as np

logger = logging.getLogger(__name__)

# Available pose backends
PoseBackend = Literal["yolo", "mediapipe"]

# Lazy load MediaPipe
_pose_model = None


def get_pose_model():
    """Get or initialize MediaPipe Pose model."""
    global _pose_model
    if _pose_model is None:
        import mediapipe as mp
        _pose_model = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            smooth_landmarks=True,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        logger.info("MediaPipe Pose model loaded")
    return _pose_model


# Landmark names for reference
LANDMARK_NAMES = {
    0: "nose",
    1: "left_eye_inner",
    2: "left_eye",
    3: "left_eye_outer",
    4: "right_eye_inner",
    5: "right_eye",
    6: "right_eye_outer",
    7: "left_ear",
    8: "right_ear",
    9: "mouth_left",
    10: "mouth_right",
    11: "left_shoulder",
    12: "right_shoulder",
    13: "left_elbow",
    14: "right_elbow",
    15: "left_wrist",
    16: "right_wrist",
    17: "left_pinky",
    18: "right_pinky",
    19: "left_index",
    20: "right_index",
    21: "left_thumb",
    22: "right_thumb",
    23: "left_hip",
    24: "right_hip",
    25: "left_knee",
    26: "right_knee",
    27: "left_ankle",
    28: "right_ankle",
    29: "left_heel",
    30: "right_heel",
    31: "left_foot_index",
    32: "right_foot_index",
}


class PoseEstimator:
    """MediaPipe-based pose estimation."""
    
    def __init__(self):
        self.model = None
    
    def load_model(self):
        """Load model (lazy initialization)."""
        if self.model is None:
            self.model = get_pose_model()
    
    def estimate(
        self, 
        frame: np.ndarray, 
        roi: Optional[tuple[float, float, float, float]] = None
    ) -> Optional[list[dict]]:
        """
        Estimate pose landmarks in a frame.
        
        Args:
            frame: BGR image as numpy array
            roi: Optional region of interest as (x1, y1, x2, y2) in normalized coords [0-1]
                 If provided, only processes that region and maps coords back to full frame.
            
        Returns:
            List of 33 pose landmarks with x, y, z, visibility
            Returns None if no pose detected
        """
        import cv2
        
        self.load_model()
        
        height, width = frame.shape[:2]
        
        # If ROI specified, crop the frame first
        if roi is not None:
            x1 = int(roi[0] * width)
            y1 = int(roi[1] * height)
            x2 = int(roi[2] * width)
            y2 = int(roi[3] * height)
            
            cropped = frame[y1:y2, x1:x2]
            if cropped.size == 0:
                return None
                
            rgb_frame = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)
            results = self.model.process(rgb_frame)
            
            if not results.pose_landmarks:
                return None
            
            # Map cropped coordinates back to full frame
            roi_width = roi[2] - roi[0]
            roi_height = roi[3] - roi[1]
            
            landmarks = []
            for i, landmark in enumerate(results.pose_landmarks.landmark):
                # Convert from cropped coords to full frame coords
                full_x = roi[0] + landmark.x * roi_width
                full_y = roi[1] + landmark.y * roi_height
                
                landmarks.append({
                    "x": full_x,
                    "y": full_y,
                    "z": landmark.z,
                    "visibility": landmark.visibility,
                    "name": LANDMARK_NAMES.get(i, f"landmark_{i}"),
                })
            
            return landmarks
        
        # Standard full-frame processing
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.model.process(rgb_frame)
        
        if not results.pose_landmarks:
            return None
        
        landmarks = []
        for i, landmark in enumerate(results.pose_landmarks.landmark):
            landmarks.append({
                "x": landmark.x,
                "y": landmark.y,
                "z": landmark.z,
                "visibility": landmark.visibility,
                "name": LANDMARK_NAMES.get(i, f"landmark_{i}"),
            })
        
        return landmarks
    
    def get_world_landmarks(self, frame: np.ndarray) -> Optional[list[dict]]:
        """
        Get pose landmarks in world coordinates (meters).
        
        Args:
            frame: BGR image as numpy array
            
        Returns:
            List of 33 pose landmarks in world coordinates
        """
        import cv2
        
        self.load_model()
        
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.model.process(rgb_frame)
        
        if not results.pose_world_landmarks:
            return None
        
        landmarks = []
        for i, landmark in enumerate(results.pose_world_landmarks.landmark):
            landmarks.append({
                "x": landmark.x,
                "y": landmark.y,
                "z": landmark.z,
                "visibility": landmark.visibility,
                "name": LANDMARK_NAMES.get(i, f"landmark_{i}"),
            })
        
        return landmarks


# Global instance for reuse
estimator = PoseEstimator()


def estimate_pose(frame: np.ndarray) -> Optional[list[dict]]:
    """
    Convenience function for pose estimation.
    
    Args:
        frame: BGR image as numpy array
        
    Returns:
        List of pose landmarks or None
    """
    return estimator.estimate(frame)


def detect_all_people(frame: np.ndarray, backend: PoseBackend = "yolo") -> list[dict]:
    """
    Detect all people in frame with pose estimation.
    
    Args:
        frame: BGR image as numpy array
        backend: "yolo" (default, more accurate) or "mediapipe" (faster on low-end CPUs)
        
    Returns:
        List of detected people, each with:
        - id: Unique person ID for this frame
        - bbox: [x1, y1, x2, y2] bounding box in pixels
        - bbox_normalized: [x1, y1, x2, y2] normalized to 0-1
        - confidence: Detection confidence
        - pose: Pose landmarks (or None if pose detection failed)
        - bar_center: Estimated bar center from wrist midpoint (or None)
        - backend: "yolo" or "mediapipe"
    """
    # Use YOLO pose backend (default) - single pass detection + pose
    if backend == "yolo":
        from services.yolo_pose_estimator import detect_all_people_yolo
        logger.info("Using YOLO11s-pose backend")
        return detect_all_people_yolo(frame)
    
    # Fallback to MediaPipe (two-stage: YOLO detection + MediaPipe pose)
    logger.info("Using MediaPipe backend")
    return _detect_all_people_mediapipe(frame)


def _detect_all_people_mediapipe(frame: np.ndarray) -> list[dict]:
    """
    MediaPipe-based detection (legacy two-stage approach).
    
    Uses YOLO for person detection, then MediaPipe for pose on each person.
    """
    from services.yolo_detector import detector as yolo_detector
    
    height, width = frame.shape[:2]
    
    # Load YOLO model if needed
    yolo_detector.load_model()
    
    # Detect all objects, filter to people only (class_id=0)
    results = yolo_detector.model(frame, verbose=False, classes=[0])[0]
    
    people = []
    person_id = 0
    
    for box in results.boxes:
        confidence = float(box.conf[0])
        
        # Filter low confidence detections
        if confidence < 0.4:
            continue
        
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        
        # Normalize bbox to 0-1
        bbox_normalized = [
            x1 / width,
            y1 / height,
            x2 / width,
            y2 / height,
        ]
        
        # Expand ROI slightly for better pose detection
        padding = 0.05
        roi = (
            max(0, bbox_normalized[0] - padding),
            max(0, bbox_normalized[1] - padding),
            min(1, bbox_normalized[2] + padding),
            min(1, bbox_normalized[3] + padding),
        )
        
        # Run pose estimation on this person's region
        pose_landmarks = estimator.estimate(frame, roi=roi)
        
        # Calculate bar center from wrist midpoint if pose detected
        bar_center = None
        if pose_landmarks and len(pose_landmarks) >= 17:
            left_wrist = pose_landmarks[15]
            right_wrist = pose_landmarks[16]
            
            # Only calculate if both wrists are visible enough
            if left_wrist["visibility"] > 0.3 and right_wrist["visibility"] > 0.3:
                bar_center = {
                    "x": (left_wrist["x"] + right_wrist["x"]) / 2,
                    "y": (left_wrist["y"] + right_wrist["y"]) / 2,
                    "confidence": min(left_wrist["visibility"], right_wrist["visibility"]),
                }
        
        people.append({
            "id": person_id,
            "bbox": [x1, y1, x2, y2],
            "bbox_normalized": bbox_normalized,
            "confidence": confidence,
            "pose": pose_landmarks,
            "bar_center": bar_center,
            "backend": "mediapipe",
        })
        
        person_id += 1
    
    # Sort by bounding box area (largest first - usually the main subject)
    people.sort(key=lambda p: (p["bbox"][2] - p["bbox"][0]) * (p["bbox"][3] - p["bbox"][1]), reverse=True)
    
    # Re-assign IDs after sorting
    for i, person in enumerate(people):
        person["id"] = i
    
    return people


def estimate_pose_for_person(
    frame: np.ndarray,
    person_bbox: list[float],
) -> Optional[list[dict]]:
    """
    Estimate pose for a specific person given their bounding box.
    
    Args:
        frame: BGR image as numpy array
        person_bbox: [x1, y1, x2, y2] normalized bounding box (0-1)
        
    Returns:
        List of pose landmarks or None
    """
    # Add padding to the bbox for better pose detection
    padding = 0.05
    roi = (
        max(0, person_bbox[0] - padding),
        max(0, person_bbox[1] - padding),
        min(1, person_bbox[2] + padding),
        min(1, person_bbox[3] + padding),
    )
    
    return estimator.estimate(frame, roi=roi)


def calculate_angle(p1: dict, p2: dict, p3: dict) -> float:
    """
    Calculate angle at p2 between p1-p2-p3.
    
    Args:
        p1, p2, p3: Landmark dictionaries with x, y, z
        
    Returns:
        Angle in degrees
    """
    v1 = np.array([p1["x"] - p2["x"], p1["y"] - p2["y"], p1["z"] - p2["z"]])
    v2 = np.array([p3["x"] - p2["x"], p3["y"] - p2["y"], p3["z"] - p2["z"]])
    
    cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-8)
    angle = np.arccos(np.clip(cos_angle, -1.0, 1.0))
    
    return np.degrees(angle)


def get_joint_angles(landmarks: list[dict]) -> dict:
    """
    Calculate common joint angles from pose landmarks.
    
    Args:
        landmarks: List of 33 pose landmarks
        
    Returns:
        Dictionary of joint angles in degrees
    """
    if not landmarks or len(landmarks) < 33:
        return {}
    
    angles = {}
    
    # Left elbow angle
    angles["left_elbow"] = calculate_angle(
        landmarks[11], landmarks[13], landmarks[15]
    )
    
    # Right elbow angle
    angles["right_elbow"] = calculate_angle(
        landmarks[12], landmarks[14], landmarks[16]
    )
    
    # Left knee angle
    angles["left_knee"] = calculate_angle(
        landmarks[23], landmarks[25], landmarks[27]
    )
    
    # Right knee angle
    angles["right_knee"] = calculate_angle(
        landmarks[24], landmarks[26], landmarks[28]
    )
    
    # Left shoulder angle
    angles["left_shoulder"] = calculate_angle(
        landmarks[13], landmarks[11], landmarks[23]
    )
    
    # Right shoulder angle
    angles["right_shoulder"] = calculate_angle(
        landmarks[14], landmarks[12], landmarks[24]
    )
    
    # Left hip angle
    angles["left_hip"] = calculate_angle(
        landmarks[11], landmarks[23], landmarks[25]
    )
    
    # Right hip angle
    angles["right_hip"] = calculate_angle(
        landmarks[12], landmarks[24], landmarks[26]
    )
    
    return angles

