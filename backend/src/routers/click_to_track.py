"""Click-to-track API for SAM2 video segmentation."""

import logging
import base64
import tempfile
from pathlib import Path
from typing import Tuple, Dict

import cv2
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import io

from db.supabase import get_video, download_video, update_video_status, get_supabase

logger = logging.getLogger(__name__)

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
            
            _processing_progress[video_id] = {"step": "saving", "progress": 95, "detail": "Saving results..."}
            
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
            
            trajectory_data = {
                "video_info": bar_result["video_info"],
                "bar_path": bar_path,
                "person_path": person_path,
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
            
            from db.supabase import get_supabase
            
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
