import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from db.supabase import get_supabase, get_video, update_video_status
from services.trajectory_tracker import process_video_pipeline

logger = logging.getLogger(__name__)

router = APIRouter()


class ProcessRequest(BaseModel):
    """Optional request body for processing endpoint."""
    selected_person_bbox: Optional[list[float]] = None  # [x1, y1, x2, y2] normalized


@router.get("/{video_id}")
async def get_video_details(video_id: str):
    """Get video details by ID."""
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@router.get("/{video_id}/status")
async def get_video_status(video_id: str):
    """Get video processing status."""
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    return {
        "status": video["status"],
        "error_message": video.get("error_message"),
    }


@router.post("/{video_id}/process")
async def start_video_processing(
    video_id: str, 
    background_tasks: BackgroundTasks,
    request: Optional[ProcessRequest] = None,
):
    """
    Start video processing in background.
    
    If selected_person_bbox is provided, only that person will be tracked.
    This is used after the calibration step where the user selects which
    person to track.
    """
    video = await get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    if video["status"] == "processing":
        raise HTTPException(status_code=400, detail="Video is already being processed")
    
    # Update status to processing
    await update_video_status(video_id, "processing")
    
    # Get selected person bbox if provided
    selected_bbox = None
    if request and request.selected_person_bbox:
        selected_bbox = request.selected_person_bbox
        logger.info(f"Processing video {video_id} with selected person bbox: {selected_bbox}")
    
    # Start background processing
    background_tasks.add_task(
        process_video_pipeline, 
        video_id, 
        video["storage_path"],
        selected_person_bbox=selected_bbox,
    )
    
    return {"success": True, "message": "Processing started"}


@router.get("/{video_id}/detections")
async def get_video_detections(video_id: str):
    """Get detection results for a video."""
    client = get_supabase()
    
    result = client.table("detection_results").select("*").eq(
        "video_id", video_id
    ).order("frame_number").execute()
    
    return {"frames": result.data}


@router.get("/{video_id}/tracking")
async def get_tracking_session(video_id: str):
    """Get tracking session for a video."""
    client = get_supabase()
    
    result = client.table("tracking_sessions").select("*").eq(
        "video_id", video_id
    ).single().execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Tracking session not found")
    
    return result.data


@router.get("/{video_id}/export")
async def export_video_data(video_id: str, format: str = "json"):
    """Export detection data."""
    client = get_supabase()
    
    # Get detection results
    detections = client.table("detection_results").select("*").eq(
        "video_id", video_id
    ).order("frame_number").execute()
    
    # Get tracking session
    tracking = client.table("tracking_sessions").select("*").eq(
        "video_id", video_id
    ).single().execute()
    
    if format == "json":
        return {
            "video_id": video_id,
            "frames": detections.data,
            "tracking": tracking.data,
        }
    else:
        raise HTTPException(status_code=400, detail="Unsupported export format")

