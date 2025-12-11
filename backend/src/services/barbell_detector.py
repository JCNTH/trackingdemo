"""
Robust barbell detection for bench press analysis.

Uses wrist midpoint with intelligent fallbacks. Key insight: MediaPipe
returns landmark positions even when visibility is low - we can still
use these positions with extra smoothing.

================================================================================
COORDINATE SYSTEM
================================================================================

INPUT (from pose_estimator):
  - Landmarks in NORMALIZED [0-1] coordinates
  - Must convert to PIXEL coordinates for tracking

OUTPUT (bar position):
  - (x, y) in PIXEL coordinates
  - Used directly for velocity calculations in trajectory_tracker

DETECTION METHODS (priority order):
  1. forearm_extended: Both wrists visible + forearm angle check
     - Most reliable for bench press
     - bar_position = midpoint(left_wrist, right_wrist)
  
  2. wrist_fallback: At least one wrist visible
     - Uses single visible wrist or average
     - Less reliable but maintains tracking
  
  3. EMA smoothing: No current detection
     - Uses exponential moving average of recent positions
     - Prevents trajectory gaps during brief occlusions

================================================================================
SMOOTHING & FILTERING
================================================================================

EMA (Exponential Moving Average):
  - alpha = 0.5 (responsive to movement)
  - smoothed = alpha * new + (1 - alpha) * smoothed
  
Jump Detection:
  - max_jump_pixels = 500
  - Rejects sudden position jumps (likely detection errors)
  - Falls back to last known position if jump too large

Buffer:
  - Stores last 3 positions for averaging
  - Reduces noise while maintaining responsiveness

================================================================================
"""
import logging
import math
from typing import Optional, Tuple, List, Dict
from collections import deque

import numpy as np

logger = logging.getLogger(__name__)


class RobustBarTracker:
    """
    Robust bar position tracker with heavy smoothing and long persistence.
    """
    
    def __init__(self, buffer_size: int = 3, max_jump_pixels: int = 500):
        self.alpha = 0.5  # More responsive - follows bar movement closely
        self.buffer_size = buffer_size
        self.max_jump_pixels = max_jump_pixels  # Allow very large movements (bar can travel 300+ px in bench press)
        
        self.position_buffer: deque = deque(maxlen=buffer_size)
        self.smoothed_position: Optional[Tuple[float, float]] = None
        self.last_output: Optional[Tuple[int, int]] = None
        self.velocity: Tuple[float, float] = (0, 0)
        self.frames_without_update = 0
        self.max_persistence_frames = 15  # ~0.5 second at 30fps
        
    def update(self, raw_position: Optional[Tuple[int, int]], confidence: float = 0.5) -> Optional[Tuple[int, int]]:
        """Update tracker with new raw position."""
        if raw_position is None:
            self.frames_without_update += 1
            if self.last_output and self.frames_without_update <= self.max_persistence_frames:
                return self.last_output
            return None
        
        raw_x, raw_y = float(raw_position[0]), float(raw_position[1])
        self.frames_without_update = 0
        
        if self.smoothed_position is None:
            self.smoothed_position = (raw_x, raw_y)
            self.position_buffer.append((raw_x, raw_y))
            self.last_output = raw_position
            return raw_position
        
        # Outlier rejection
        dx = raw_x - self.smoothed_position[0]
        dy = raw_y - self.smoothed_position[1]
        distance = math.sqrt(dx * dx + dy * dy)
        
        if distance > self.max_jump_pixels:
            if self.last_output:
                return self.last_output
            return None
        
        # Exponential moving average
        smooth_x = self.smoothed_position[0] + self.alpha * dx
        smooth_y = self.smoothed_position[1] + self.alpha * dy
        self.smoothed_position = (smooth_x, smooth_y)
        
        self.position_buffer.append((smooth_x, smooth_y))
        
        # Moving average from buffer
        avg_x = sum(p[0] for p in self.position_buffer) / len(self.position_buffer)
        avg_y = sum(p[1] for p in self.position_buffer) / len(self.position_buffer)
        
        if self.last_output:
            self.velocity = (avg_x - self.last_output[0], avg_y - self.last_output[1])
        
        self.last_output = (int(avg_x), int(avg_y))
        return self.last_output
    
    def get_speed(self) -> float:
        return math.sqrt(self.velocity[0]**2 + self.velocity[1]**2)
    
    def get_velocity(self) -> Tuple[float, float]:
        return self.velocity
    
    def reset(self):
        self.position_buffer.clear()
        self.smoothed_position = None
        self.last_output = None
        self.velocity = (0, 0)
        self.frames_without_update = 0


class RobustBarbellDetector:
    """
    Robust barbell detector using forearm-extended grip position.
    
    Key insight: The bar is held ABOVE the wrists in the palms, not at the wrists.
    We extend along the forearm direction (elbow → wrist) to estimate actual grip.
    
    The extension factor is ~15-20% of forearm length, which corresponds to
    roughly 5-8cm above the wrist where hands grip the bar.
    """
    
    # Bar grip is typically 15-20% of forearm length past the wrist
    FOREARM_EXTENSION_FACTOR = 0.18
    
    def __init__(self):
        self.tracker = RobustBarTracker(buffer_size=3, max_jump_pixels=500)
        self.frames_tracked = 0
        self.frames_with_detection = 0
        
        # Store offsets for estimation
        self.left_wrist_offset: Optional[Tuple[float, float]] = None
        self.right_wrist_offset: Optional[Tuple[float, float]] = None
        self.elbow_offset: Optional[Tuple[float, float]] = None
        
    def _estimate_grip_from_forearm(
        self,
        elbow_px: Tuple[int, int],
        wrist_px: Tuple[int, int],
    ) -> Tuple[int, int]:
        """
        Estimate hand grip position by extending along forearm direction.
        
        The bar is gripped ~15-20% of forearm length past the wrist.
        This places the tracking point at the palm/bar rather than the wrist.
        """
        # Calculate forearm vector (elbow → wrist)
        forearm_dx = wrist_px[0] - elbow_px[0]
        forearm_dy = wrist_px[1] - elbow_px[1]
        
        # Extend past wrist by extension factor
        grip_x = wrist_px[0] + int(forearm_dx * self.FOREARM_EXTENSION_FACTOR)
        grip_y = wrist_px[1] + int(forearm_dy * self.FOREARM_EXTENSION_FACTOR)
        
        return (grip_x, grip_y)
        
    def detect(
        self,
        pose_landmarks: Optional[List[Dict]],
        frame_width: int,
        frame_height: int,
    ) -> Dict:
        """Detect barbell position using forearm-extended grip estimation."""
        self.frames_tracked += 1
        
        if not pose_landmarks or len(pose_landmarks) < 17:
            return self._apply_tracking(None, 0.0, "no_pose")
        
        # Get landmarks
        left_wrist = pose_landmarks[15]
        right_wrist = pose_landmarks[16]
        left_elbow = pose_landmarks[13]
        right_elbow = pose_landmarks[14]
        
        # Get visibility values
        left_wrist_vis = left_wrist.get("visibility", 0)
        right_wrist_vis = right_wrist.get("visibility", 0)
        left_elbow_vis = left_elbow.get("visibility", 0)
        right_elbow_vis = right_elbow.get("visibility", 0)
        
        # Convert to pixel coordinates - ALWAYS get coordinates
        left_wrist_px = (int(left_wrist["x"] * frame_width), int(left_wrist["y"] * frame_height))
        right_wrist_px = (int(right_wrist["x"] * frame_width), int(right_wrist["y"] * frame_height))
        left_elbow_px = (int(left_elbow["x"] * frame_width), int(left_elbow["y"] * frame_height))
        right_elbow_px = (int(right_elbow["x"] * frame_width), int(right_elbow["y"] * frame_height))
        
        raw_center = None
        confidence = 0.0
        source = "none"
        
        # Check if we have good elbow+wrist data for forearm-based estimation
        have_left_forearm = left_wrist_vis > 0.01 and left_elbow_vis > 0.01
        have_right_forearm = right_wrist_vis > 0.01 and right_elbow_vis > 0.01
        
        if have_left_forearm and have_right_forearm:
            # Best case: Both forearms visible - use forearm-extended grip estimation
            left_grip = self._estimate_grip_from_forearm(left_elbow_px, left_wrist_px)
            right_grip = self._estimate_grip_from_forearm(right_elbow_px, right_wrist_px)
            
            # Bar position is midpoint of estimated grip positions
            center_x = (left_grip[0] + right_grip[0]) // 2
            center_y = (left_grip[1] + right_grip[1]) // 2
            raw_center = (center_x, center_y)
            confidence = min(left_wrist_vis, right_wrist_vis, left_elbow_vis, right_elbow_vis)
            source = "forearm_extended"
            
            # Store offsets for fallback
            midpoint_x = (left_wrist_px[0] + right_wrist_px[0]) // 2
            midpoint_y = (left_wrist_px[1] + right_wrist_px[1]) // 2
            self.left_wrist_offset = (center_x - left_wrist_px[0], center_y - left_wrist_px[1])
            self.right_wrist_offset = (center_x - right_wrist_px[0], center_y - right_wrist_px[1])
            
            # Update elbow offset
            elbow_mid_x = (left_elbow_px[0] + right_elbow_px[0]) // 2
            elbow_mid_y = (left_elbow_px[1] + right_elbow_px[1]) // 2
            self.elbow_offset = (center_x - elbow_mid_x, center_y - elbow_mid_y)
            
        elif have_right_forearm:
            # Only right forearm visible
            right_grip = self._estimate_grip_from_forearm(right_elbow_px, right_wrist_px)
            if self.left_wrist_offset:
                # Estimate left grip from stored offset
                center_x = right_grip[0]  # Use right grip, offset will be applied by tracker
                center_y = right_grip[1]
            else:
                center_x, center_y = right_grip
            raw_center = (center_x, center_y)
            confidence = min(right_wrist_vis, right_elbow_vis) * 0.85
            source = "right_forearm"
            
        elif have_left_forearm:
            # Only left forearm visible
            left_grip = self._estimate_grip_from_forearm(left_elbow_px, left_wrist_px)
            if self.right_wrist_offset:
                center_x = left_grip[0]
                center_y = left_grip[1]
            else:
                center_x, center_y = left_grip
            raw_center = (center_x, center_y)
            confidence = min(left_wrist_vis, left_elbow_vis) * 0.85
            source = "left_forearm"
            
        elif left_wrist_vis > 0.01 and right_wrist_vis > 0.01:
            # Fallback: Both wrists visible but not elbows - use wrist midpoint with offset
            center_x = (left_wrist_px[0] + right_wrist_px[0]) // 2
            center_y = (left_wrist_px[1] + right_wrist_px[1]) // 2
            raw_center = (center_x, center_y)
            confidence = min(left_wrist_vis, right_wrist_vis) * 0.7
            source = "weighted_wrists"
                
        elif right_wrist_vis > 0.01 and self.right_wrist_offset:
            # Only right wrist - estimate using stored offset
            center_x = right_wrist_px[0] + int(self.right_wrist_offset[0])
            center_y = right_wrist_px[1] + int(self.right_wrist_offset[1])
            raw_center = (center_x, center_y)
            confidence = right_wrist_vis * 0.6
            source = "right_estimated"
                
        elif left_wrist_vis > 0.01 and self.left_wrist_offset:
            # Only left wrist - estimate using stored offset
            center_x = left_wrist_px[0] + int(self.left_wrist_offset[0])
            center_y = left_wrist_px[1] + int(self.left_wrist_offset[1])
            raw_center = (center_x, center_y)
            confidence = left_wrist_vis * 0.6
            source = "left_estimated"
                
        elif right_wrist_vis > 0.01:
            # Only right wrist, no offset - use directly
            raw_center = right_wrist_px
            confidence = right_wrist_vis * 0.5
            source = "right_only"
                
        elif left_wrist_vis > 0.01:
            # Only left wrist, no offset - use directly
            raw_center = left_wrist_px
            confidence = left_wrist_vis * 0.5
            source = "left_only"
        
        # Fallback to elbows with stored offset
        if raw_center is None:
            elbow_total = left_elbow_vis + right_elbow_vis
            if elbow_total > 0.01 and self.elbow_offset:
                if left_elbow_vis > 0.01 and right_elbow_vis > 0.01:
                    elbow_mid_x = (left_elbow_px[0] + right_elbow_px[0]) // 2
                    elbow_mid_y = (left_elbow_px[1] + right_elbow_px[1]) // 2
                    center_x = elbow_mid_x + int(self.elbow_offset[0])
                    center_y = elbow_mid_y + int(self.elbow_offset[1])
                    raw_center = (center_x, center_y)
                    confidence = min(left_elbow_vis, right_elbow_vis) * 0.5
                    source = "elbows_estimated"
        
        # LAST RESORT: Use raw midpoint even with 0 visibility
        if raw_center is None:
            center_x = (left_wrist_px[0] + right_wrist_px[0]) // 2
            center_y = (left_wrist_px[1] + right_wrist_px[1]) // 2
            raw_center = (center_x, center_y)
            confidence = 0.3
            source = "raw_midpoint"
        
        return self._apply_tracking(raw_center, confidence, source)
    
    def _apply_tracking(self, raw_center: Optional[Tuple[int, int]], confidence: float, source: str) -> Dict:
        """Apply smoothing and return result."""
        smoothed = self.tracker.update(raw_center, confidence)
        
        if smoothed:
            self.frames_with_detection += 1
            actual_source = source if raw_center else "persisted"
        else:
            actual_source = "lost"
        
        return {
            "bar_center": smoothed,
            "confidence": confidence if raw_center else 0.3,
            "source": actual_source,
            "speed": self.tracker.get_speed(),
            "velocity": self.tracker.get_velocity(),
        }
    
    def get_stats(self) -> Dict:
        detection_rate = self.frames_with_detection / max(self.frames_tracked, 1)
        return {
            "frames_tracked": self.frames_tracked,
            "frames_with_detection": self.frames_with_detection,
            "detection_rate": detection_rate,
        }
    
    def reset(self):
        self.tracker.reset()
        self.frames_tracked = 0
        self.frames_with_detection = 0
        self.left_wrist_offset = None
        self.right_wrist_offset = None
        self.elbow_offset = None


# Global instance
_detector: Optional[RobustBarbellDetector] = None


def get_barbell_detector() -> RobustBarbellDetector:
    global _detector
    if _detector is None:
        _detector = RobustBarbellDetector()
    return _detector


def detect_barbell(
    frame: np.ndarray,
    pose_landmarks: Optional[List[Dict]] = None,
) -> Dict:
    height, width = frame.shape[:2]
    detector = get_barbell_detector()
    return detector.detect(pose_landmarks, width, height)


def reset_barbell_tracking():
    global _detector
    if _detector:
        _detector.reset()


def set_barbell_fps(fps: float):
    global _detector
    _detector = RobustBarbellDetector()
