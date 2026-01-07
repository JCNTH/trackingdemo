"""
================================================================================
POSE SERVICE - Human Pose Estimation using YOLO11-pose
================================================================================

PURPOSE:
    Detect humans and estimate their pose (17 COCO keypoints) in video frames.
    Used for tracking the athlete during bench press analysis.

MODEL: YOLO11s-pose
    - 17 keypoints (COCO format)
    - CPU Speed: ~90ms per frame
    - mAP: 58.9
    - Source: https://docs.ultralytics.com/tasks/pose/

KEYPOINTS (COCO 17-point format):
    0: nose          5: left_shoulder   10: right_wrist
    1: left_eye      6: right_shoulder  11: left_hip
    2: right_eye     7: left_elbow      12: right_hip
    3: left_ear      8: right_elbow     13: left_knee
    4: right_ear     9: left_wrist      14: right_knee
                                        15: left_ankle
                                        16: right_ankle

OUTPUT:
    - pose_landmarks: List of 17 keypoints with {x, y, visibility}
    - x, y: Normalized [0-1] coordinates
    - visibility: Confidence score [0-1]

================================================================================
"""

import logging
from typing import Optional, List, Dict
import numpy as np

logger = logging.getLogger(__name__)

# Lazy load model
_pose_model = None


# =============================================================================
# MODEL LOADING
# =============================================================================

def get_pose_model():
    """Load YOLO11s-pose model (lazy initialization)."""
    global _pose_model
    if _pose_model is None:
        from ultralytics import YOLO
        _pose_model = YOLO("yolo11s-pose.pt")
        logger.info("YOLO11s-pose loaded (~90ms/frame on CPU)")
    return _pose_model


# =============================================================================
# KEYPOINT DEFINITIONS
# =============================================================================

KEYPOINT_NAMES = {
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

# Skeleton connections for drawing
POSE_CONNECTIONS = [
    (0, 1), (0, 2),           # Nose to eyes
    (1, 3), (2, 4),           # Eyes to ears
    (5, 6),                   # Shoulders
    (5, 7), (7, 9),           # Left arm
    (6, 8), (8, 10),          # Right arm
    (5, 11), (6, 12),         # Torso
    (11, 12),                 # Hips
    (11, 13), (13, 15),       # Left leg
    (12, 14), (14, 16),       # Right leg
]


# =============================================================================
# POSE ESTIMATION
# =============================================================================

def calculate_iou(box1: List[float], box2: List[float]) -> float:
    """Calculate IoU between two bounding boxes [x1, y1, x2, y2]."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0


def detect_pose(
    frame: np.ndarray,
    target_bbox: Optional[List[float]] = None,
    confidence_threshold: float = 0.3,
) -> Dict:
    """
    Detect person and extract pose landmarks.
    
    Args:
        frame: BGR image [H, W, 3]
        target_bbox: If provided, track the person with highest IoU to this bbox
        confidence_threshold: Minimum detection confidence
        
    Returns:
        Dict with:
        - detected: bool
        - bbox: [x1, y1, x2, y2] in pixels
        - pose_landmarks: List of 17 keypoints
        - confidence: Detection confidence
    """
    model = get_pose_model()
    height, width = frame.shape[:2]
    
    results = model(frame, verbose=False)[0]
    
    result = {
        "detected": False,
        "bbox": None,
        "pose_landmarks": None,
        "confidence": 0.0,
    }
    
    if results.boxes is None or len(results.boxes) == 0:
        return result
    
    # Find best person (by IoU if tracking, else by area)
    best_score = 0
    best_idx = -1
    
    for i, box_data in enumerate(results.boxes):
        class_id = int(box_data.cls[0])
        confidence = float(box_data.conf[0])
        
        # Only process persons (class 0)
        if class_id != 0 or confidence < confidence_threshold:
            continue
        
        bbox = box_data.xyxy[0].tolist()
        
        if target_bbox is not None:
            score = calculate_iou(bbox, target_bbox)
            if score < 0.1:  # Minimum IoU threshold
                continue
        else:
            score = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])  # Area
        
        if score > best_score:
            best_score = score
            best_idx = i
    
    if best_idx < 0:
        return result
    
    # Extract pose for best person
    box_data = results.boxes[best_idx]
    bbox = box_data.xyxy[0].tolist()
    confidence = float(box_data.conf[0])
    
    pose_landmarks = None
    if results.keypoints is not None and best_idx < len(results.keypoints):
        kpts = results.keypoints[best_idx]
        if kpts.data is not None and len(kpts.data) > 0:
            kpts_data = kpts.data[0].cpu().numpy()
            pose_landmarks = []
            for idx, kp in enumerate(kpts_data):
                x, y, kp_conf = float(kp[0]), float(kp[1]), float(kp[2])
                pose_landmarks.append({
                    "x": x / width,
                    "y": y / height,
                    "visibility": kp_conf,
                    "name": KEYPOINT_NAMES.get(idx, f"kp_{idx}"),
                })
    
    return {
        "detected": True,
        "bbox": bbox,
        "pose_landmarks": pose_landmarks,
        "confidence": confidence,
    }


def detect_all_people(frame: np.ndarray, confidence_threshold: float = 0.3) -> List[Dict]:
    """
    Detect all people in frame with poses.
    
    Args:
        frame: BGR image
        confidence_threshold: Minimum confidence
        
    Returns:
        List of detected people sorted by size (largest first)
    """
    model = get_pose_model()
    height, width = frame.shape[:2]
    
    results = model(frame, verbose=False)[0]
    
    people = []
    
    if results.boxes is None or results.keypoints is None:
        return people
    
    for idx, (box_data, kpts) in enumerate(zip(results.boxes, results.keypoints)):
        class_id = int(box_data.cls[0])
        confidence = float(box_data.conf[0])
        
        if class_id != 0 or confidence < confidence_threshold:
            continue
        
        bbox = box_data.xyxy[0].tolist()
        
        # Extract keypoints
        pose_landmarks = []
        if kpts.data is not None and len(kpts.data) > 0:
            kpts_data = kpts.data[0].cpu().numpy()
            for kp_idx, kp in enumerate(kpts_data):
                x, y, kp_conf = float(kp[0]), float(kp[1]), float(kp[2])
                pose_landmarks.append({
                    "x": x / width,
                    "y": y / height,
                    "visibility": kp_conf,
                    "name": KEYPOINT_NAMES.get(kp_idx, f"kp_{kp_idx}"),
                })
        
        people.append({
            "id": idx,
            "bbox": bbox,
            "bbox_normalized": [
                bbox[0] / width, bbox[1] / height,
                bbox[2] / width, bbox[3] / height,
            ],
            "pose_landmarks": pose_landmarks,
            "confidence": confidence,
        })
    
    # Sort by area (largest first)
    people.sort(
        key=lambda p: (p["bbox"][2] - p["bbox"][0]) * (p["bbox"][3] - p["bbox"][1]),
        reverse=True
    )
    
    # Re-assign IDs
    for i, person in enumerate(people):
        person["id"] = i
    
    return people


def get_wrist_positions(pose_landmarks: List[Dict]) -> Dict:
    """
    Get wrist positions from pose landmarks.
    
    Useful for estimating bar position in bench press.
    
    Returns:
        Dict with left_wrist, right_wrist, midpoint (all normalized coords)
    """
    if not pose_landmarks or len(pose_landmarks) < 17:
        return {"left_wrist": None, "right_wrist": None, "midpoint": None}
    
    left = pose_landmarks[9]   # left_wrist
    right = pose_landmarks[10]  # right_wrist
    
    result = {
        "left_wrist": {"x": left["x"], "y": left["y"], "visibility": left["visibility"]},
        "right_wrist": {"x": right["x"], "y": right["y"], "visibility": right["visibility"]},
        "midpoint": None,
    }
    
    # Calculate midpoint if both wrists visible
    if left["visibility"] > 0.3 and right["visibility"] > 0.3:
        result["midpoint"] = {
            "x": (left["x"] + right["x"]) / 2,
            "y": (left["y"] + right["y"]) / 2,
            "confidence": min(left["visibility"], right["visibility"]),
        }
    
    return result


def reset_model():
    """Reset model for memory management."""
    global _pose_model
    _pose_model = None
    logger.info("Pose model reset")

