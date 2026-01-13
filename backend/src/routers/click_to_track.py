"""Click-to-track API for SAM2 video segmentation."""

import logging
import base64
import tempfile
import json
import time
from pathlib import Path
from typing import Tuple, Dict

import cv2
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import io

from db.supabase import get_video, download_video, update_video_status, get_supabase

logger = logging.getLogger(__name__)

# Debug logging for frame sync diagnosis - set to True to enable detailed logs
DEBUG_FRAME_SYNC = True
DEBUG_LOG_FILE = Path(__file__).parent.parent.parent.parent / ".cursor" / "frame_sync_debug.log"

def debug_log(location: str, message: str, data: dict = None):
    """Log debug information for frame sync diagnosis."""
    if not DEBUG_FRAME_SYNC:
        return
    
    log_entry = {
        "location": location,
        "message": message,
        "data": data or {},
        "timestamp": int(time.time() * 1000),
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    
    # Log to both file and standard logger
    logger.info(f"[DEBUG] {location}: {message} | {json.dumps(data or {})}")
    
    try:
        DEBUG_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_FILE, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
    except Exception:
        pass  # Don't fail on debug logging errors

router = APIRouter(prefix="/click-to-track", tags=["click-to-track"])

# In-memory progress tracking
_processing_progress: Dict[str, Dict] = {}
_preview_frames: Dict[str, str] = {}  # video_id -> base64 preview frame


class ClickPoint(BaseModel):
    x: int
    y: int


class SegmentRequest(BaseModel):
    click_point: ClickPoint
    model: str = "sam2"


class ProcessRequest(BaseModel):
    click_point: ClickPoint
    model: str = "sam2"
    start_frame: int = 0
    end_frame: int | None = None  # None = process until end


@router.get("/models")
async def get_available_models():
    """Get available models."""
    from services.bar_tracker import get_model_info
    return get_model_info()


@router.get("/{video_id}/first-frame")
async def get_first_frame(video_id: str, frame_number: int = 0):
    """Extract first frame for clicking."""
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    if not video.get("storage_path"):
        raise HTTPException(status_code=400, detail="Video file not found")
    
    try:
        video_data = await download_video(video["storage_path"])
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
            tmp_file.write(video_data)
            tmp_path = tmp_file.name
        
        try:
            cap = cv2.VideoCapture(tmp_path)
            if not cap.isOpened():
                raise HTTPException(status_code=500, detail="Could not open video")
            
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            
            frame_num = min(frame_number, total_frames - 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
            
            ret, frame = cap.read()
            cap.release()
            
            if not ret:
                raise HTTPException(status_code=500, detail="Could not read frame")
            
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            return {
                "video_id": video_id,
                "frame_number": frame_num,
                "frame_image": frame_base64,
                "width": width,
                "height": height,
                "total_frames": total_frames,
                "fps": fps,
            }
            
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get frame: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{video_id}/segment")
async def segment_at_click(video_id: str, request: SegmentRequest):
    """Preview segmentation at click point."""
    from services.bar_tracker import segment_from_click
    
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    if not video.get("storage_path"):
        raise HTTPException(status_code=400, detail="Video file not found")
    
    try:
        video_data = await download_video(video["storage_path"])
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
            tmp_file.write(video_data)
            tmp_path = tmp_file.name
        
        try:
            cap = cv2.VideoCapture(tmp_path)
            ret, frame = cap.read()
            cap.release()
            
            if not ret:
                raise HTTPException(status_code=500, detail="Could not read frame")
            
            click_point = (request.click_point.x, request.click_point.y)
            result = segment_from_click(frame, click_point, request.model)
            
            if not result["success"]:
                return {
                    "success": False,
                    "message": result.get("error", "Segmentation failed"),
                    "model_used": request.model,
                }
            
            preview = frame.copy()
            
            if result.get("mask") is not None:
                mask = result["mask"]
                overlay = preview.copy()
                overlay[mask > 0] = [0, 255, 0]
                preview = cv2.addWeighted(overlay, 0.4, preview, 0.6, 0)
            
            if result.get("bbox"):
                x1, y1, x2, y2 = result["bbox"]
                cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 255, 0), 2)
            
            if result.get("center"):
                cx, cy = result["center"]
                cv2.drawMarker(preview, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 20, 3)
            
            cv2.circle(preview, click_point, 8, (255, 0, 0), -1)
            
            _, buffer = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 85])
            mask_preview = base64.b64encode(buffer).decode('utf-8')
            
            return {
                "success": True,
                "bbox": result["bbox"],
                "center": result["center"],
                "area_pixels": result["area_pixels"],
                "mask_preview": mask_preview,
                "model_used": result["model_used"],
            }
            
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Segmentation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{video_id}/process")
async def process_with_click_tracking(
    video_id: str,
    request: ProcessRequest,
    background_tasks: BackgroundTasks
):
    """Process video with SAM2."""
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    await update_video_status(video_id, "processing")
    
    background_tasks.add_task(
        _process_video_background,
        video_id,
        video["storage_path"],
        (request.click_point.x, request.click_point.y),
        request.model,
        request.start_frame,
        request.end_frame,
    )
    
    return {
        "status": "processing",
        "message": f"Processing with {request.model}",
        "model": request.model,
    }


async def _process_video_background(
    video_id: str,
    storage_path: str,
    click_point: Tuple[int, int],
    model_name: str,
    start_frame: int = 0,
    end_frame: int | None = None,
):
    """Background task for processing."""
    from services.bar_tracker import process_video_with_click_tracking
    from services.pose_service import detect_pose
    
    try:
        _processing_progress[video_id] = {"step": "downloading", "progress": 0, "detail": "Downloading video..."}
        
        logger.info(f"Downloading video {video_id}...")
        video_data = await download_video(storage_path)
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
            tmp_file.write(video_data)
            tmp_path = tmp_file.name
        
        try:
            _processing_progress[video_id] = {"step": "tracking", "progress": 10, "detail": "Running SAM2..."}
            logger.info(f"Processing {video_id} with SAM2")
            
            def progress_callback(frame_num, total_frames):
                progress = 10 + int(40 * frame_num / total_frames)
                _processing_progress[video_id] = {
                    "step": "tracking",
                    "progress": progress,
                    "detail": f"SAM2 tracking: {frame_num}/{total_frames} frames"
                }
            
            def preview_callback(preview_frame):
                import base64
                # Encode preview frame as base64 JPEG
                _, buffer = cv2.imencode('.jpg', preview_frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                preview_base64 = base64.b64encode(buffer).decode('utf-8')
                _preview_frames[video_id] = preview_base64
            
            bar_result = process_video_with_click_tracking(
                tmp_path, 
                click_point, 
                model_name,
                frame_callback=progress_callback,
                preview_callback=preview_callback,
                start_frame=start_frame,
                end_frame=end_frame,
            )
            
            if not bar_result["success"]:
                error_msg = bar_result.get("error", "Tracking failed")
                logger.error(f"Bar tracking failed: {error_msg}")
                await update_video_status(video_id, "failed", error_msg)
                return
            
            logger.info(f"Bar: {bar_result['tracked_frames']}/{bar_result['total_frames']}")
            
            _processing_progress[video_id] = {"step": "pose", "progress": 50, "detail": "Running pose estimation..."}
            logger.info("Running pose estimation...")
            cap = cv2.VideoCapture(tmp_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            # Use same frame range as bar tracking
            frame_range = bar_result.get("frame_range", {})
            actual_start = frame_range.get("start", start_frame)
            actual_end = frame_range.get("end", end_frame or total_frames)
            
            person_trajectory = []
            last_person_bbox = None
            
            # Seek to start frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, actual_start)
            
            for frame_number in range(actual_start, actual_end):
                ret, frame = cap.read()
                if not ret:
                    break
                
                pose_result = detect_pose(frame, target_bbox=last_person_bbox)
                
                if pose_result["detected"]:
                    last_person_bbox = pose_result["bbox"]
                    person_trajectory.append({
                        "frame": frame_number,
                        "timestamp": frame_number / fps,
                        "detected": True,
                        "bbox": pose_result["bbox"],
                        "pose_landmarks": pose_result["pose_landmarks"],
                        "confidence": pose_result["confidence"],
                    })
                else:
                    person_trajectory.append({
                        "frame": frame_number,
                        "timestamp": frame_number / fps,
                        "detected": False,
                    })
                
                if (frame_number - actual_start) % 20 == 0:
                    frames_processed = frame_number - actual_start
                    frames_total = actual_end - actual_start
                    progress = 50 + int(40 * frames_processed / frames_total)
                    _processing_progress[video_id] = {
                        "step": "pose",
                        "progress": progress,
                        "detail": f"Pose: {frame_number}/{actual_end} frames"
                    }
            
            cap.release()
            
            logger.info(f"Pose: {sum(1 for p in person_trajectory if p.get('detected'))}/{len(person_trajectory)}")
            
            _processing_progress[video_id] = {"step": "saving", "progress": 90, "detail": "Building results..."}
            
            bar_path = []
            for point in bar_result["trajectory"]:
                if point["center"]:
                    bar_path.append({
                        "frame": point["frame"],
                        "timestamp": point["timestamp"],
                        "x": point["center"][0],
                        "y": point["center"][1],
                        "bbox": point.get("bbox"),
                        "confidence": point["confidence"],
                        "source": point["method"],
                    })
            
            person_path = []
            for point in person_trajectory:
                if point.get("detected") and point.get("bbox"):
                    bbox = point["bbox"]
                    person_path.append({
                        "frame": point["frame"],
                        "timestamp": point["timestamp"],
                        "x": int((bbox[0] + bbox[2]) / 2),
                        "y": int((bbox[1] + bbox[3]) / 2),
                        "bbox": bbox,
                        "pose_landmarks": point.get("pose_landmarks"),
                        "confidence": point["confidence"],
                    })
            
            # Generate overlay video during processing
            _processing_progress[video_id] = {"step": "rendering", "progress": 92, "detail": "Rendering overlay video..."}
            logger.info("Generating overlay video...")
            
            overlay_storage_path = None
            try:
                overlay_output = tempfile.mktemp(suffix=".mp4")
                _generate_overlay_video(tmp_path, overlay_output, bar_path, person_path)
                
                # Upload overlay video to Supabase storage
                overlay_filename = f"overlays/{video_id}_overlay.mp4"
                with open(overlay_output, "rb") as f:
                    overlay_data = f.read()
                
                from db.supabase import get_supabase
                supabase = get_supabase()
                
                # Upload to storage (remove existing if any, then upload fresh)
                try:
                    supabase.storage.from_("videos").remove([overlay_filename])
                except Exception:
                    pass  # File might not exist, that's fine
                supabase.storage.from_("videos").upload(
                    overlay_filename,
                    overlay_data,
                    file_options={"content-type": "video/mp4"}
                )
                overlay_storage_path = overlay_filename
                logger.info(f"Overlay video uploaded: {overlay_storage_path}")
                
                Path(overlay_output).unlink(missing_ok=True)
            except Exception as e:
                logger.warning(f"Failed to generate overlay video: {e}")
                # Continue without overlay - original video will be used
            
            _processing_progress[video_id] = {"step": "saving", "progress": 98, "detail": "Saving results..."}
            
            trajectory_data = {
                "video_info": bar_result["video_info"],
                "bar_path": bar_path,
                "person_path": person_path,
                "overlay_video_path": overlay_storage_path,  # NEW: Store overlay video path
                "click_to_track": {
                    "enabled": True,
                    "model": model_name,
                    "click_point": bar_result["click_point"],
                    "total_frames": bar_result["total_frames"],
                    "tracked_frames": bar_result["tracked_frames"],
                    "tracking_rate": bar_result["tracking_rate"],
                },
                "person_tracking": {
                    "enabled": True,
                    "detected_frames": len(person_path),
                    "detection_rate": len(person_path) / bar_result["total_frames"] if bar_result["total_frames"] > 0 else 0,
                },
            }
            
            supabase = get_supabase()
            supabase.table("tracking_sessions").upsert({
                "video_id": video_id,
                "trajectory_data": trajectory_data,
            }).execute()
            
            await update_video_status(video_id, "completed")
            
            _processing_progress[video_id] = {"step": "completed", "progress": 100, "detail": "Processing complete!"}
            logger.info(f"Completed: {bar_result['tracked_frames']}/{bar_result['total_frames']}")
            
        finally:
            Path(tmp_path).unlink(missing_ok=True)
            
    except Exception as e:
        logger.error(f"Processing failed: {e}")
        _processing_progress[video_id] = {"step": "failed", "progress": 0, "detail": str(e)}
        await update_video_status(video_id, "failed", str(e))
    finally:
        # Clean up progress and preview after 5 minutes
        import asyncio
        await asyncio.sleep(300)
        _processing_progress.pop(video_id, None)
        _preview_frames.pop(video_id, None)


@router.get("/{video_id}/progress")
async def get_processing_progress(video_id: str):
    """Get processing progress."""
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    progress_info = _processing_progress.get(video_id, {})
    preview_frame = _preview_frames.get(video_id)
    
    return {
        "video_id": video_id,
        "status": video.get("status", "unknown"),
        "step": progress_info.get("step", ""),
        "progress": progress_info.get("progress", 0),
        "detail": progress_info.get("detail", ""),
        "preview_frame": preview_frame,  # Base64 encoded preview
    }


@router.get("/{video_id}/download")
async def download_processed_video(video_id: str):
    """Generate and download processed video with tracking overlays."""
    logger.info(f"Download request for video {video_id}")
    
    video = await get_video(video_id)
    if not video:
        logger.error(f"Video {video_id} not found")
        raise HTTPException(status_code=404, detail="Video not found")
    
    logger.info(f"Video status: {video.get('status')}")
    
    if video.get("status") != "completed":
        raise HTTPException(status_code=400, detail=f"Video processing not completed (status: {video.get('status')})")
    
    try:
        # Get tracking data
        supabase = get_supabase()
        result = supabase.table("tracking_sessions").select("*").eq("video_id", video_id).execute()
        
        logger.info(f"Tracking sessions found: {len(result.data) if result.data else 0}")
        
        if not result.data or len(result.data) == 0:
            logger.error(f"No tracking data found for video {video_id}")
            raise HTTPException(status_code=404, detail="No tracking data found. Please process the video first.")
        
        tracking_data = result.data[0]["trajectory_data"]
        bar_path = tracking_data.get("bar_path", [])
        person_path = tracking_data.get("person_path", [])
        
        logger.info(f"Bar path points: {len(bar_path)}, Person path points: {len(person_path)}")
        
        if not bar_path and not person_path:
            raise HTTPException(status_code=400, detail="No tracking data available. Please reprocess the video.")
        
        # Download original video
        video_data = await download_video(video["storage_path"])
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_input:
            tmp_input.write(video_data)
            input_path = tmp_input.name
        
        output_path = tempfile.mktemp(suffix=".mp4")
        
        try:
            # Generate processed video
            logger.info(f"Generating overlay video from {input_path} to {output_path}")
            logger.info(f"Input file exists: {Path(input_path).exists()}, size: {Path(input_path).stat().st_size if Path(input_path).exists() else 'N/A'}")
            _generate_overlay_video(input_path, output_path, bar_path, person_path)
            logger.info(f"Overlay video generated successfully")
            
            # Read processed video
            with open(output_path, "rb") as f:
                video_bytes = f.read()
            
            # Clean up
            Path(input_path).unlink(missing_ok=True)
            Path(output_path).unlink(missing_ok=True)
            
            # Return as streaming response
            return StreamingResponse(
                io.BytesIO(video_bytes),
                media_type="video/mp4",
                headers={
                    "Content-Disposition": f'attachment; filename="processed_{video["filename"]}"'
                }
            )
            
        except Exception as e:
            Path(input_path).unlink(missing_ok=True)
            Path(output_path).unlink(missing_ok=True)
            raise
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"Failed to generate video: {type(e).__name__}: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")


def _generate_overlay_video(input_path: str, output_path: str, bar_path: list, person_path: list):
    """Generate video with comprehensive tracking overlays.
    
    Frame matching is simple: SAM2 stores the actual video frame index in trajectory data.
    We read the video frame-by-frame and look up tracking data using that same frame index.
    No complex frame matching needed - they should line up exactly.
    """
    import numpy as np
    import subprocess
    
    # COCO pose connections
    POSE_CONNECTIONS = [
        (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),  # Arms
        (5, 11), (6, 12), (11, 12),  # Torso
        (11, 13), (13, 15), (12, 14), (14, 16),  # Legs
    ]
    
    # =================================================================
    # One Euro Filter for temporal smoothing of pose landmarks
    # This reduces jitter while keeping responsiveness to fast movements
    # =================================================================
    class LowPassFilter:
        def __init__(self, alpha: float):
            self.alpha = alpha
            self.s = None
        
        def __call__(self, value: float) -> float:
            if self.s is None:
                self.s = value
            else:
                self.s = self.alpha * value + (1 - self.alpha) * self.s
            return self.s
        
        def reset(self):
            self.s = None
    
    class OneEuroFilter:
        def __init__(self, min_cutoff: float = 1.0, beta: float = 0.0, d_cutoff: float = 1.0):
            self.min_cutoff = min_cutoff
            self.beta = beta
            self.d_cutoff = d_cutoff
            self.x_filter = LowPassFilter(self._alpha(min_cutoff))
            self.dx_filter = LowPassFilter(self._alpha(d_cutoff))
            self.last_value = None
        
        def _alpha(self, cutoff: float) -> float:
            te = 1.0 / 30.0  # Assume ~30fps
            tau = 1.0 / (2 * np.pi * cutoff)
            return 1.0 / (1.0 + tau / te)
        
        def __call__(self, value: float) -> float:
            if self.last_value is None:
                self.last_value = value
                return value
            
            # Compute derivative
            dx = (value - self.last_value) * 30.0  # fps estimate
            edx = self.dx_filter(dx)
            
            # Adaptive cutoff based on speed of change
            cutoff = self.min_cutoff + self.beta * abs(edx)
            self.x_filter.alpha = self._alpha(cutoff)
            
            self.last_value = value
            return self.x_filter(value)
        
        def reset(self):
            self.x_filter.reset()
            self.dx_filter.reset()
            self.last_value = None
    
    # Pre-process person_path to apply temporal smoothing to pose landmarks
    # This significantly reduces jitter while preserving real movement
    logger.info("Applying temporal smoothing to pose landmarks...")
    smoothed_person_dict = {}
    
    # Create filters for each keypoint (x, y)
    # Lower min_cutoff = more smoothing, higher beta = more responsive to fast motion
    num_keypoints = 17  # COCO has 17 keypoints
    # Wrists (9, 10) get slightly more responsive filters since they move more
    x_filters = []
    y_filters = []
    for i in range(num_keypoints):
        if i in [9, 10]:  # Wrists - slightly more responsive
            x_filters.append(OneEuroFilter(min_cutoff=0.5, beta=0.7))
            y_filters.append(OneEuroFilter(min_cutoff=0.5, beta=0.7))
        elif i in [7, 8]:  # Elbows - medium smoothing
            x_filters.append(OneEuroFilter(min_cutoff=0.4, beta=0.5))
            y_filters.append(OneEuroFilter(min_cutoff=0.4, beta=0.5))
        else:  # Torso/legs - more stable, more smoothing
            x_filters.append(OneEuroFilter(min_cutoff=0.3, beta=0.3))
            y_filters.append(OneEuroFilter(min_cutoff=0.3, beta=0.3))
    
    # Keep track of last valid positions for each keypoint
    last_valid_positions = [None] * num_keypoints
    
    # Process frames in order to build up filter state
    sorted_person_frames = sorted(person_path, key=lambda p: p["frame"])
    for person in sorted_person_frames:
        frame_idx = person["frame"]
        smoothed_person = dict(person)  # Copy original
        
        if "pose_landmarks" in person and person["pose_landmarks"]:
            landmarks = person["pose_landmarks"]
            smoothed_landmarks = []
            
            for i, lm in enumerate(landmarks):
                if lm is None:
                    # Use last valid position if available
                    if last_valid_positions[i]:
                        smoothed_landmarks.append(last_valid_positions[i])
                    else:
                        smoothed_landmarks.append(None)
                    continue
                    
                if isinstance(lm, dict):
                    vis = lm.get("visibility", 0)
                    if vis < 0.2:  # Very low visibility - use last known position
                        if last_valid_positions[i]:
                            smoothed_landmarks.append(last_valid_positions[i])
                        else:
                            smoothed_landmarks.append(lm)
                        # Don't reset filters - keep the state for when visibility returns
                    elif vis < 0.4:  # Low visibility - apply extra smoothing (blend with last)
                        smoothed_x = x_filters[i](lm["x"])
                        smoothed_y = y_filters[i](lm["y"])
                        # Blend with last valid position for stability
                        if last_valid_positions[i]:
                            blend = 0.7  # 70% new smoothed, 30% last valid
                            smoothed_x = smoothed_x * blend + last_valid_positions[i]["x"] * (1 - blend)
                            smoothed_y = smoothed_y * blend + last_valid_positions[i]["y"] * (1 - blend)
                        smoothed_lm = {
                            "x": smoothed_x,
                            "y": smoothed_y,
                            "visibility": vis,
                            "name": lm.get("name", f"kp_{i}"),
                        }
                        smoothed_landmarks.append(smoothed_lm)
                        last_valid_positions[i] = smoothed_lm
                    else:  # Good visibility - normal smoothing
                        smoothed_x = x_filters[i](lm["x"])
                        smoothed_y = y_filters[i](lm["y"])
                        smoothed_lm = {
                            "x": smoothed_x,
                            "y": smoothed_y,
                            "visibility": vis,
                            "name": lm.get("name", f"kp_{i}"),
                        }
                        smoothed_landmarks.append(smoothed_lm)
                        last_valid_positions[i] = smoothed_lm
                else:
                    smoothed_landmarks.append(lm)
            
            smoothed_person["pose_landmarks"] = smoothed_landmarks
        
        smoothed_person_dict[frame_idx] = smoothed_person
    
    logger.info(f"Smoothed {len(smoothed_person_dict)} person frames")
    
    logger.info(f"Opening video for overlay: {input_path}")
    cap = cv2.VideoCapture(input_path)
    
    if not cap.isOpened():
        raise ValueError(f"Could not open input video: {input_path}")
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    logger.info(f"Input video: {width}x{height} @ {fps:.2f} FPS, {total_frames} frames")
    
    # Debug log for frame sync diagnosis
    debug_log("overlay:video_props", "Video properties for overlay generation", {
        "fps": fps,
        "total_frames": total_frames,
        "width": width,
        "height": height,
        "duration_seconds": total_frames / fps if fps > 0 else 0,
    })
    
    # Use a temporary raw output, then convert with ffmpeg for better compatibility
    temp_output = output_path + ".temp.mp4"
    
    # Try different codecs for better compatibility
    codecs_to_try = [
        ('avc1', 'H264'),
        ('mp4v', 'MPEG-4'),
        ('XVID', 'XVID'),
    ]
    
    out = None
    for fourcc_str, codec_name in codecs_to_try:
        fourcc = cv2.VideoWriter_fourcc(*fourcc_str)
        out = cv2.VideoWriter(temp_output, fourcc, fps, (width, height))
        if out.isOpened():
            logger.info(f"Using codec: {codec_name} ({fourcc_str})")
            break
        out.release()
        out = None
    
    if out is None or not out.isOpened():
        cap.release()
        raise ValueError("Could not initialize video writer with any codec")
    
    # Create lookup dicts for fast access (keyed by actual frame number)
    # SAM2 stores the real video frame index in each trajectory point
    # So bar_dict[frame_idx] gives us the tracking data for video frame #frame_idx
    bar_dict = {p["frame"]: p for p in bar_path}
    # Note: We use smoothed_person_dict (created above) instead of raw person_dict
    person_dict = smoothed_person_dict  # Use temporally smoothed landmarks
    
    logger.info(f"Bar frames: {sorted(bar_dict.keys())[:5]}...{sorted(bar_dict.keys())[-3:] if len(bar_dict) > 5 else ''}")
    logger.info(f"Person frames: {sorted(person_dict.keys())[:5]}...{sorted(person_dict.keys())[-3:] if len(person_dict) > 5 else ''}")
    
    # Get the frame range that was tracked
    tracked_frames = sorted(bar_dict.keys()) if bar_dict else []
    tracking_start_frame = tracked_frames[0] if tracked_frames else 0
    
    logger.info(f"Tracking data: {len(bar_dict)} bar points, {len(person_dict)} person points")
    logger.info(f"Tracked frame range: {min(tracked_frames) if tracked_frames else 'N/A'} to {max(tracked_frames) if tracked_frames else 'N/A'}")
    
    # Debug log for frame sync diagnosis
    debug_log("overlay:tracking_data", "Tracking data frame indices", {
        "bar_frame_count": len(bar_dict),
        "person_frame_count": len(person_dict),
        "video_total_frames": total_frames,
        "tracking_start": min(tracked_frames) if tracked_frames else None,
        "tracking_end": max(tracked_frames) if tracked_frames else None,
        "first_5_bar_frames": sorted(bar_dict.keys())[:5] if bar_dict else [],
        "last_5_bar_frames": sorted(bar_dict.keys())[-5:] if bar_dict else [],
        "coverage_percent": (len(bar_dict) / total_frames * 100) if total_frames > 0 else 0,
    })
    
    # Build ordered list of bar centers with their frame numbers
    bar_centers_by_frame = {p["frame"]: (int(p["x"]), int(p["y"])) for p in bar_path if "x" in p and "y" in p}
    
    frame_idx = 0
    frames_written = 0
    
    # Calculate velocity for motion visualization (based on consecutive tracked frames)
    velocities = {}
    prev_frame = None
    for frame_num in tracked_frames:
        if frame_num in bar_centers_by_frame:
            if prev_frame is not None and prev_frame in bar_centers_by_frame:
                dy = bar_centers_by_frame[frame_num][1] - bar_centers_by_frame[prev_frame][1]
                velocities[frame_num] = dy
            prev_frame = frame_num
    
    # For MOV/variable frame rate videos, we may need to handle frame timing differently
    # Log first few frame matches to debug sync issues
    debug_frame_matches = []
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        overlay = frame.copy()
        
        # Debug: Log frame matches for first 10 frames
        if frame_idx < 10:
            has_bar = frame_idx in bar_dict
            has_person = frame_idx in person_dict
            debug_frame_matches.append(f"F{frame_idx}: bar={has_bar}, person={has_person}")
            
            bar_data_at_frame = bar_dict.get(frame_idx)
            bar_center = (bar_data_at_frame.get("x"), bar_data_at_frame.get("y")) if bar_data_at_frame else None
            debug_log("overlay:frame_match", f"Frame {frame_idx} tracking data lookup", {
                "video_frame_idx": frame_idx,
                "has_bar_data": has_bar,
                "bar_center": bar_center,
                "has_person_data": has_person,
            })
        
        # === BAR TRACKING OVERLAYS ===
        
        # Draw current bar position (diagonal line only, no trajectory path)
        if frame_idx in bar_dict:
            bar = bar_dict[frame_idx]
            if "bbox" in bar and bar["bbox"]:
                bbox = bar["bbox"]
                
                # Draw thick diagonal line across the bar (shows bar angle/position)
                cv2.line(overlay, (bbox[0], bbox[3]), (bbox[2], bbox[1]), (0, 255, 0), 6)
                
                # Draw center point (small dot)
                center = (int(bar.get("x", 0)), int(bar.get("y", 0)))
                cv2.circle(overlay, center, 4, (0, 255, 0), -1)
        
        # === POSE ESTIMATION OVERLAYS ===
        
        if frame_idx in person_dict:
            person = person_dict[frame_idx]
            if "pose_landmarks" in person and person["pose_landmarks"]:
                landmarks = person["pose_landmarks"]
                
                # Helper to get pixel coords from landmark (handles both dict and list formats)
                def get_landmark_px(lm):
                    if lm is None:
                        return None
                    # Dict format: {'x': 0.5, 'y': 0.5, 'visibility': 0.9}
                    if isinstance(lm, dict):
                        if lm.get("visibility", 0) < 0.3:
                            return None
                        # x, y are normalized (0-1), convert to pixels
                        return (int(lm["x"] * width), int(lm["y"] * height))
                    # List/tuple format: [x, y] or [x, y, visibility]
                    elif isinstance(lm, (list, tuple)) and len(lm) >= 2:
                        if len(lm) >= 3 and lm[2] < 0.3:
                            return None
                        return (int(lm[0] * width), int(lm[1] * height))
                    return None
                
                # Draw connections (skeleton)
                for connection in POSE_CONNECTIONS:
                    idx1, idx2 = connection
                    if idx1 < len(landmarks) and idx2 < len(landmarks):
                        pt1 = get_landmark_px(landmarks[idx1])
                        pt2 = get_landmark_px(landmarks[idx2])
                        if pt1 and pt2:
                            cv2.line(overlay, pt1, pt2, (255, 100, 255), 3)
                
                # Draw joints with glow
                for i, landmark in enumerate(landmarks):
                    pt = get_landmark_px(landmark)
                    if pt:
                        cv2.circle(overlay, pt, 6, (255, 100, 255), -1)
                        cv2.circle(overlay, pt, 8, (255, 200, 255), 2)
                
                # Highlight wrists (important for bench press)
                if len(landmarks) > 10:
                    for wrist_idx in [9, 10]:  # Left and right wrist
                        pt = get_landmark_px(landmarks[wrist_idx])
                        if pt:
                            cv2.circle(overlay, pt, 10, (0, 255, 255), 2)
        
        # === INFO PANEL ===
        
        # Semi-transparent black background for info
        info_panel = overlay.copy()
        cv2.rectangle(info_panel, (0, 0), (300, 120), (0, 0, 0), -1)
        cv2.addWeighted(info_panel, 0.6, overlay, 0.4, 0, overlay)
        
        # Frame counter
        cv2.putText(overlay, f"Frame: {frame_idx}/{total_frames}", 
                   (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
        # Timestamp
        timestamp = frame_idx / fps
        cv2.putText(overlay, f"Time: {timestamp:.2f}s", 
                   (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
        # Tracking status
        bar_status = "Barbell: TRACKED" if frame_idx in bar_dict else "Barbell: LOST"
        bar_color = (0, 255, 0) if frame_idx in bar_dict else (0, 0, 255)
        cv2.putText(overlay, bar_status, 
                   (10, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.5, bar_color, 2)
        
        person_status = "Person: DETECTED" if frame_idx in person_dict else "Person: NOT DETECTED"
        person_color = (255, 100, 255) if frame_idx in person_dict else (100, 100, 100)
        cv2.putText(overlay, person_status, 
                   (10, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.5, person_color, 2)
        
        # Model watermark
        cv2.putText(overlay, "SAM2 + YOLO11-pose", 
                   (10, height - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)
        
        # Write frame - OpenCV VideoWriter.write() doesn't raise exceptions on failure
        out.write(overlay)
        frame_idx += 1
        frames_written += 1
        
        # Log progress every 50 frames
        if frame_idx % 50 == 0:
            logger.info(f"Overlay progress: {frame_idx}/{total_frames} frames written")
    
    cap.release()
    out.release()
    
    # Verify output file was created
    if not Path(temp_output).exists():
        raise ValueError(f"Video writer failed - output file not created at {temp_output}")
    
    output_size = Path(temp_output).stat().st_size
    logger.info(f"Raw output file size: {output_size} bytes")
    
    # Log debug info
    if debug_frame_matches:
        logger.info(f"Frame sync debug: {', '.join(debug_frame_matches)}")
    
    # Debug log for frame sync diagnosis
    debug_log("overlay:complete", "Overlay generation complete", {
        "frames_written": frames_written,
        "expected_total_frames": total_frames,
        "tracking_range": f"{min(tracked_frames) if tracked_frames else 'N/A'}-{max(tracked_frames) if tracked_frames else 'N/A'}",
        "fps_used": fps,
        "output_file_size_bytes": output_size,
        "frame_match_summary": debug_frame_matches[:10] if debug_frame_matches else [],
    })
    
    if frames_written == 0:
        Path(temp_output).unlink(missing_ok=True)
        raise ValueError("No frames were written to output video")
    
    logger.info(f"Generated overlay video: {frame_idx} frames")
    
    # Re-encode with ffmpeg for better browser compatibility (if available)
    try:
        import shutil
        if shutil.which('ffmpeg'):
            logger.info("Re-encoding with ffmpeg for browser compatibility...")
            result = subprocess.run([
                'ffmpeg', '-y', '-i', temp_output,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
                '-pix_fmt', 'yuv420p',  # Required for browser compatibility
                '-movflags', '+faststart',  # Enable streaming
                output_path
            ], capture_output=True, text=True, timeout=300)
            
            if result.returncode == 0:
                Path(temp_output).unlink(missing_ok=True)
                logger.info("FFmpeg re-encoding successful")
            else:
                logger.warning(f"FFmpeg failed: {result.stderr[:200]}, using original")
                Path(temp_output).rename(output_path)
        else:
            # ffmpeg not available, use the cv2 output directly
            Path(temp_output).rename(output_path)
    except Exception as e:
        logger.warning(f"FFmpeg error: {e}, using original")
        if Path(temp_output).exists():
            Path(temp_output).rename(output_path)
