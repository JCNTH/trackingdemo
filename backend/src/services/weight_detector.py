"""
AI-powered weight plate detection using Claude Vision.

Analyzes video frames to detect and count weight plates on barbells.
Returns estimated total weight based on visible plates.
"""
import os
import base64
import json
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Try to import anthropic
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    logger.warning("anthropic package not installed. Weight detection will be disabled.")


class WeightDetector:
    """
    Claude Vision-based weight plate detector.
    
    Analyzes images of barbells to:
    - Count visible weight plates
    - Identify plate sizes by color/markings
    - Calculate total estimated weight
    """
    
    def __init__(self):
        self.api_key = os.getenv('ANTHROPIC_API_KEY') or os.getenv('CLAUDE_API_KEY')
        self.model = "claude-sonnet-4-20250514"  # Latest Claude Sonnet with vision
        self.client = None
        
        if ANTHROPIC_AVAILABLE and self.api_key:
            self.client = anthropic.Anthropic(api_key=self.api_key)
            logger.info("Claude Vision client initialized for weight detection")
        else:
            if not ANTHROPIC_AVAILABLE:
                logger.warning("anthropic package not available")
            if not self.api_key:
                logger.warning("ANTHROPIC_API_KEY not set - weight detection disabled")
    
    def is_available(self) -> bool:
        """Check if weight detection is available."""
        return self.client is not None
    
    def detect_weight_from_frame(
        self,
        frame: np.ndarray,
        equipment_hint: str = "barbell"
    ) -> Dict:
        """
        Detect weight from a single video frame.
        
        Args:
            frame: BGR image as numpy array
            equipment_hint: Type of equipment ("barbell", "dumbbell", etc.)
            
        Returns:
            Dictionary with:
            - success: bool
            - total_weight: float (estimated total weight)
            - weight_unit: str ("lbs" or "kg")
            - bar_weight: float
            - plates: list of detected plates
            - confidence: float (0-1)
            - raw_response: str (for debugging)
        """
        if not self.is_available():
            return {
                "success": False,
                "error": "Claude Vision not available. Set ANTHROPIC_API_KEY.",
                "total_weight": None,
            }
        
        try:
            # Encode frame as JPEG base64
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            image_base64 = base64.b64encode(buffer).decode('utf-8')
            
            # Create prompt for weight detection
            prompt = self._create_weight_detection_prompt(equipment_hint)
            
            # Call Claude Vision API
            start_time = datetime.now()
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": image_base64,
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }]
            )
            
            duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"Claude Vision weight detection completed in {duration:.2f}s")
            
            # Parse response
            response_text = response.content[0].text
            result = self._parse_weight_response(response_text)
            result["duration_seconds"] = duration
            result["model"] = self.model
            
            return result
            
        except Exception as e:
            logger.error(f"Weight detection failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "total_weight": None,
            }
    
    def detect_weight_from_video(
        self,
        video_path: str,
        frame_indices: Optional[List[int]] = None,
        num_samples: int = 3
    ) -> Dict:
        """
        Detect weight from video by analyzing multiple frames.
        
        Args:
            video_path: Path to video file
            frame_indices: Specific frames to analyze (optional)
            num_samples: Number of frames to sample if frame_indices not provided
            
        Returns:
            Best weight detection result from analyzed frames
        """
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            return {
                "success": False,
                "error": f"Could not open video: {video_path}",
                "total_weight": None,
            }
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # Determine which frames to analyze
        if frame_indices is None:
            # Sample frames from the first third of the video (usually setup)
            end_frame = min(total_frames // 3, total_frames - 1)
            if end_frame < num_samples:
                frame_indices = list(range(total_frames))[:num_samples]
            else:
                frame_indices = [
                    int(i * end_frame / num_samples) 
                    for i in range(num_samples)
                ]
        
        results = []
        
        for idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            
            if not ret:
                continue
            
            result = self.detect_weight_from_frame(frame)
            if result.get("success") and result.get("total_weight"):
                results.append(result)
        
        cap.release()
        
        if not results:
            return {
                "success": False,
                "error": "No valid weight detection from any frame",
                "total_weight": None,
                "frames_analyzed": len(frame_indices),
            }
        
        # Return result with highest confidence
        best_result = max(results, key=lambda r: r.get("confidence", 0))
        best_result["frames_analyzed"] = len(frame_indices)
        best_result["successful_detections"] = len(results)
        
        return best_result
    
    def _create_weight_detection_prompt(self, equipment_hint: str) -> str:
        """Create the prompt for Claude Vision."""
        return f"""You are an expert at identifying weight plates on barbells. Analyze this gym image showing a {equipment_hint}.

CRITICAL INSTRUCTIONS:
1. Look carefully at the barbell and count ALL weight plates visible
2. Plates are typically loaded symmetrically (same on both sides)
3. Count EACH individual plate - there are often multiple plates stacked together
4. Look for plates of different sizes stacked on top of each other

PLATE IDENTIFICATION GUIDE:
- 45 lb plates (20kg): LARGEST plates, often black, blue, or red, ~17.7" diameter
- 35 lb plates (15kg): Large, often yellow
- 25 lb plates (10kg): Medium-large, often green  
- 10 lb plates (5kg): Medium, often white or black, noticeably smaller
- 5 lb plates (2.5kg): Small plates
- 2.5 lb plates (1.25kg): Very small plates

COMMON SETUPS FOR REFERENCE:
- 135 lbs = bar (45) + 1x45 per side
- 185 lbs = bar (45) + 1x45 + 1x25 per side OR bar + 1x45 + 2x10 per side
- 225 lbs = bar (45) + 2x45 per side
- 275 lbs = bar (45) + 2x45 + 1x25 per side
- 315 lbs = bar (45) + 3x45 per side

CALCULATION:
Total = bar_weight + (sum of all plates on LEFT side) + (sum of all plates on RIGHT side)

Examine the image carefully. Count each plate you can see. If you can only see one side, assume the other side is identical.

Return ONLY a valid JSON object (no markdown, no explanation):
{{
  "success": true,
  "total_weight": <number - CALCULATE CAREFULLY>,
  "weight_unit": "lbs",
  "bar_weight": 45,
  "confidence": <0.0 to 1.0>,
  "plates_left": [
    {{"weight": <number>, "color": "<color>", "count": <how many of this plate>}}
  ],
  "plates_right": [
    {{"weight": <number>, "color": "<color>", "count": <how many of this plate>}}
  ],
  "calculation": "<show your math: bar + left_plates + right_plates = total>",
  "notes": "<describe what plates you see>"
}}

If you cannot determine the weight, return:
{{
  "success": false,
  "error": "<reason>",
  "total_weight": null,
  "confidence": 0
}}"""
    
    def _parse_weight_response(self, response_text: str) -> Dict:
        """Parse Claude's response into structured data."""
        try:
            # Clean response
            text = response_text.strip()
            
            # Extract JSON from markdown if present
            if "```json" in text:
                start = text.find("```json") + 7
                end = text.find("```", start)
                text = text[start:end].strip()
            elif "```" in text:
                start = text.find("```") + 3
                end = text.find("```", start)
                text = text[start:end].strip()
            
            result = json.loads(text)
            return result
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response: {e}")
            logger.error(f"Response text: {response_text[:500]}")
            return {
                "success": False,
                "error": f"Failed to parse response: {e}",
                "total_weight": None,
                "raw_response": response_text[:500],
            }


# Global instance
_detector: Optional[WeightDetector] = None


def get_weight_detector() -> WeightDetector:
    """Get or create the weight detector instance."""
    global _detector
    if _detector is None:
        _detector = WeightDetector()
    return _detector


def detect_weight(
    frame: np.ndarray,
    equipment_hint: str = "barbell"
) -> Dict:
    """
    Convenience function to detect weight from a frame.
    
    Returns structured data with total_weight, plates, and confidence.
    """
    detector = get_weight_detector()
    return detector.detect_weight_from_frame(frame, equipment_hint)


def detect_weight_from_video(video_path: str) -> Dict:
    """
    Convenience function to detect weight from a video.
    
    Samples multiple frames and returns best result.
    """
    detector = get_weight_detector()
    return detector.detect_weight_from_video(video_path)

