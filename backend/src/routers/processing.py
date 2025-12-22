"""
Processing router for video calibration and pose detection.

This router handles the human-in-the-loop workflow:
1. User uploads video
2. Backend extracts first frame and detects all people
3. User selects which person to track
4. Processing continues with only that person
"""

import logging
import base64
import tempfile
from pathlib import Path
from typing import Optional

import cv2
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.supabase import get_video, download_video
from services.pose_estimator import detect_all_people, PoseBackend

logger = logging.getLogger(__name__)

router = APIRouter()


class CalibrateRequest(BaseModel):
    """Request body for calibration endpoint."""
    frame_number: Optional[int] = 0  # Which frame to extract (default: first frame)
    pose_backend: Optional[str] = "yolo"  # "yolo" (more accurate) or "mediapipe" (faster)


@router.post("/calibrate/{video_id}")
async def calibrate_video(video_id: str, request: CalibrateRequest = CalibrateRequest()):
    """
    Extract a frame from the video and detect all people in it.
    
    This is the first step in the human-in-the-loop workflow:
    1. User uploads video
    2. Backend extracts first frame and detects all people
    3. User selects which person to track
    4. Processing continues with only that person
    
    Returns:
        - frame_image: Base64 encoded JPEG of the extracted frame
        - frame_number: Which frame was extracted
        - width/height: Frame dimensions
        - people: List of detected people with bboxes and pose landmarks
    """
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    if not video.get("storage_path"):
        raise HTTPException(status_code=400, detail="Video file not found in storage")
    
    try:
        # Download video to temp file
        video_data = await download_video(video["storage_path"])
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
            tmp_file.write(video_data)
            tmp_path = tmp_file.name
        
        try:
            # Open video and extract frame
            cap = cv2.VideoCapture(tmp_path)
            if not cap.isOpened():
                raise HTTPException(status_code=500, detail="Could not open video file")
            
            # Get video properties
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            
            # Seek to requested frame
            frame_number = min(request.frame_number, total_frames - 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            
            ret, frame = cap.read()
            cap.release()
            
            if not ret:
                raise HTTPException(status_code=500, detail="Could not read frame from video")
            
            # Validate and use pose backend
            backend: PoseBackend = "yolo" if request.pose_backend == "yolo" else "mediapipe"
            
            # Detect all people in this frame
            people = detect_all_people(frame, backend=backend)
            
            # Encode frame as JPEG base64
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            logger.info(f"Calibration for video {video_id}: found {len(people)} people at frame {frame_number} using {backend}")
            
            return {
                "video_id": video_id,
                "frame_number": frame_number,
                "total_frames": total_frames,
                "fps": fps,
                "width": width,
                "height": height,
                "frame_image": frame_base64,
                "people": people,
                "pose_backend": backend,
            }
            
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Calibration failed for video {video_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{video_id}")
async def get_processing_status(video_id: str):
    """Get detailed processing status for a video."""
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    status_info = {
        "video_id": video_id,
        "status": video["status"],
        "filename": video["filename"],
    }
    
    if video["status"] == "completed":
        status_info.update({
            "duration": video.get("duration"),
            "width": video.get("width"),
            "height": video.get("height"),
            "fps": video.get("fps"),
        })
    elif video["status"] == "failed":
        status_info["error_message"] = video.get("error_message")
    
    return status_info


@router.get("/pose-landmarks")
async def get_pose_landmarks():
    """
    Get MediaPipe pose landmark definitions.
    
    Returns the 33 body landmarks used for pose estimation.
    Key landmarks for exercise tracking:
    - 11, 12: shoulders
    - 13, 14: elbows
    - 15, 16: wrists (used for bar position)
    - 23, 24: hips
    - 25, 26: knees
    - 27, 28: ankles
    """
    landmarks = {
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
    
    return {
        "total_landmarks": 33,
        "landmarks": landmarks,
    }
