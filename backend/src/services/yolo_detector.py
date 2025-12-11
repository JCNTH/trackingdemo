import logging
from typing import Optional
import numpy as np

logger = logging.getLogger(__name__)

# Lazy load YOLO to avoid startup cost
_yolo_model = None


def get_yolo_model():
    """Get or initialize YOLO model."""
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        _yolo_model = YOLO("yolov8n.pt")  # Nano model for speed
        logger.info("YOLO model loaded")
    return _yolo_model


# Classes of interest for exercise tracking
EXERCISE_CLASSES = {
    0: "person",
    32: "sports ball",
    38: "tennis racket",
    39: "bottle",
    56: "chair",
    57: "couch",
    60: "dining table",
    63: "laptop",
    67: "cell phone",
}


class YOLODetector:
    """YOLO-based object detection for exercise equipment."""
    
    def __init__(self, confidence_threshold: float = 0.5):
        self.confidence_threshold = confidence_threshold
        self.model = None
    
    def load_model(self):
        """Load model (lazy initialization)."""
        if self.model is None:
            self.model = get_yolo_model()
    
    def detect(self, frame: np.ndarray) -> list[dict]:
        """
        Detect objects in a frame.
        
        Args:
            frame: BGR image as numpy array
            
        Returns:
            List of detections with class, confidence, and bounding box
        """
        self.load_model()
        
        results = self.model(frame, verbose=False)[0]
        
        detections = []
        for box in results.boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            
            # Filter by confidence
            if confidence < self.confidence_threshold:
                continue
            
            # Get bounding box
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            
            # Get class name
            class_name = results.names[class_id]
            
            detections.append({
                "class": class_name,
                "class_id": class_id,
                "confidence": confidence,
                "bbox": [x1, y1, x2, y2],
                "track_id": int(box.id[0]) if box.id is not None else None,
            })
        
        return detections
    
    def detect_with_tracking(self, frame: np.ndarray) -> list[dict]:
        """
        Detect and track objects across frames.
        
        Args:
            frame: BGR image as numpy array
            
        Returns:
            List of detections with tracking IDs
        """
        self.load_model()
        
        results = self.model.track(frame, persist=True, verbose=False)[0]
        
        detections = []
        for box in results.boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            
            if confidence < self.confidence_threshold:
                continue
            
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            class_name = results.names[class_id]
            
            track_id = None
            if box.id is not None:
                track_id = int(box.id[0])
            
            detections.append({
                "class": class_name,
                "class_id": class_id,
                "confidence": confidence,
                "bbox": [x1, y1, x2, y2],
                "track_id": track_id,
            })
        
        return detections


# Global instance for reuse
detector = YOLODetector()


def detect_objects(frame: np.ndarray, track: bool = True) -> list[dict]:
    """
    Convenience function for object detection.
    
    Args:
        frame: BGR image as numpy array
        track: Whether to use tracking (persists across frames)
        
    Returns:
        List of detected objects
    """
    if track:
        return detector.detect_with_tracking(frame)
    return detector.detect(frame)

