"""
YOLO11s-pose based pose estimation service.

This provides an alternative to MediaPipe with better accuracy for:
- Occlusion handling
- Fast movements
- Multi-person detection

Model: YOLO11s-pose (58.9 mAP, ~90ms CPU inference)
Source: https://docs.ultralytics.com/tasks/pose/
"""

import logging
from typing import Optional
import numpy as np

logger = logging.getLogger(__name__)

# Lazy load YOLO pose model
_yolo_pose_model = None


def get_yolo_pose_model():
    """Get or initialize YOLO11s pose model."""
    global _yolo_pose_model
    if _yolo_pose_model is None:
        from ultralytics import YOLO
        # Model auto-downloads on first use
        _yolo_pose_model = YOLO("yolo11s-pose.pt")
        logger.info("YOLO11s-pose model loaded")
    return _yolo_pose_model


# YOLO COCO keypoint names (17 keypoints)
YOLO_KEYPOINT_NAMES = {
    0: "nose",
    1: "left_eye",
    2: "right_eye",
    3: "left_ear",
    4: "right_ear",
    5: "left_shoulder",
    6: "right_shoulder",
    7: "left_elbow",
    8: "right_elbow",
    9: "left_wrist",
    10: "right_wrist",
    11: "left_hip",
    12: "right_hip",
    13: "left_knee",
    14: "right_knee",
    15: "left_ankle",
    16: "right_ankle",
}

# Mapping from YOLO keypoints to MediaPipe-compatible indices
# This allows the frontend to work with either backend
YOLO_TO_MEDIAPIPE_MAP = {
    0: 0,    # nose -> nose
    1: 2,    # left_eye -> left_eye
    2: 5,    # right_eye -> right_eye
    3: 7,    # left_ear -> left_ear
    4: 8,    # right_ear -> right_ear
    5: 11,   # left_shoulder -> left_shoulder
    6: 12,   # right_shoulder -> right_shoulder
    7: 13,   # left_elbow -> left_elbow
    8: 14,   # right_elbow -> right_elbow
    9: 15,   # left_wrist -> left_wrist
    10: 16,  # right_wrist -> right_wrist
    11: 23,  # left_hip -> left_hip
    12: 24,  # right_hip -> right_hip
    13: 25,  # left_knee -> left_knee
    14: 26,  # right_knee -> right_knee
    15: 27,  # left_ankle -> left_ankle
    16: 28,  # right_ankle -> right_ankle
}


class YOLOPoseEstimator:
    """YOLO11s-based pose estimation with native multi-person support."""
    
    def __init__(self, confidence_threshold: float = 0.5):
        self.confidence_threshold = confidence_threshold
        self.model = None
    
    def load_model(self):
        """Load model (lazy initialization)."""
        if self.model is None:
            self.model = get_yolo_pose_model()
    
    def detect_all_people(self, frame: np.ndarray) -> list[dict]:
        """
        Detect all people in frame with pose landmarks using YOLO11s-pose.
        
        This is a single-pass detection that finds all people AND their poses,
        which is more efficient than MediaPipe's two-stage approach.
        
        Args:
            frame: BGR image as numpy array
            
        Returns:
            List of detected people, each with:
            - id: Unique person ID for this frame
            - bbox: [x1, y1, x2, y2] bounding box in pixels
            - bbox_normalized: [x1, y1, x2, y2] normalized to 0-1
            - confidence: Detection confidence
            - pose: Pose landmarks (17 keypoints mapped to MediaPipe format)
            - bar_center: Estimated bar center from wrist midpoint (or None)
        """
        self.load_model()
        
        height, width = frame.shape[:2]
        
        # Run YOLO pose estimation
        results = self.model(frame, verbose=False)[0]
        
        people = []
        
        # Check if any detections
        if results.keypoints is None or len(results.keypoints) == 0:
            return people
        
        # Process each detected person
        for idx, (box, keypoints) in enumerate(zip(results.boxes, results.keypoints)):
            confidence = float(box.conf[0])
            
            # Filter low confidence detections
            if confidence < self.confidence_threshold:
                continue
            
            # Get bounding box
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            
            # Normalize bbox to 0-1
            bbox_normalized = [
                x1 / width,
                y1 / height,
                x2 / width,
                y2 / height,
            ]
            
            # Process keypoints
            kpts = keypoints.data[0].cpu().numpy()  # Shape: (17, 3) - x, y, confidence
            
            pose_landmarks = []
            for kpt_idx in range(len(kpts)):
                kpt_x, kpt_y, kpt_conf = kpts[kpt_idx]
                
                # Normalize coordinates to 0-1
                norm_x = kpt_x / width
                norm_y = kpt_y / height
                
                pose_landmarks.append({
                    "x": float(norm_x),
                    "y": float(norm_y),
                    "z": 0.0,  # YOLO doesn't provide z-depth
                    "visibility": float(kpt_conf),
                    "name": YOLO_KEYPOINT_NAMES.get(kpt_idx, f"keypoint_{kpt_idx}"),
                    "mediapipe_index": YOLO_TO_MEDIAPIPE_MAP.get(kpt_idx),
                })
            
            # Calculate bar center from wrist midpoint
            bar_center = None
            left_wrist = pose_landmarks[9]   # YOLO index 9 = left_wrist
            right_wrist = pose_landmarks[10]  # YOLO index 10 = right_wrist
            
            # Only calculate if both wrists are visible enough
            if left_wrist["visibility"] > 0.3 and right_wrist["visibility"] > 0.3:
                bar_center = {
                    "x": (left_wrist["x"] + right_wrist["x"]) / 2,
                    "y": (left_wrist["y"] + right_wrist["y"]) / 2,
                    "confidence": min(left_wrist["visibility"], right_wrist["visibility"]),
                }
            
            people.append({
                "id": idx,
                "bbox": [x1, y1, x2, y2],
                "bbox_normalized": bbox_normalized,
                "confidence": confidence,
                "pose": pose_landmarks,
                "bar_center": bar_center,
                "backend": "yolo",
            })
        
        # Sort by bounding box area (largest first)
        people.sort(
            key=lambda p: (p["bbox"][2] - p["bbox"][0]) * (p["bbox"][3] - p["bbox"][1]),
            reverse=True
        )
        
        # Re-assign IDs after sorting
        for i, person in enumerate(people):
            person["id"] = i
        
        return people
    
    def estimate_pose(self, frame: np.ndarray) -> Optional[list[dict]]:
        """
        Estimate pose landmarks for the primary person in frame.
        
        Args:
            frame: BGR image as numpy array
            
        Returns:
            List of 17 pose landmarks or None if no person detected
        """
        people = self.detect_all_people(frame)
        
        if not people:
            return None
        
        # Return pose of the largest/most prominent person
        return people[0]["pose"]


# Global instance for reuse
yolo_estimator = YOLOPoseEstimator()


def detect_all_people_yolo(frame: np.ndarray) -> list[dict]:
    """
    Convenience function for YOLO-based multi-person detection.
    
    Args:
        frame: BGR image as numpy array
        
    Returns:
        List of detected people with poses
    """
    return yolo_estimator.detect_all_people(frame)


def estimate_pose_yolo(frame: np.ndarray) -> Optional[list[dict]]:
    """
    Convenience function for YOLO pose estimation.
    
    Args:
        frame: BGR image as numpy array
        
    Returns:
        List of pose landmarks or None
    """
    return yolo_estimator.estimate_pose(frame)

