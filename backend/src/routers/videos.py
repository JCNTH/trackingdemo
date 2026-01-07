"""
================================================================================
VIDEOS ROUTER - Video Data Endpoints
================================================================================

Simple CRUD and data retrieval for videos.
Processing is handled by click_to_track.py router.

================================================================================
"""

import logging
from fastapi import APIRouter, HTTPException

from db.supabase import get_supabase, get_video

logger = logging.getLogger(__name__)

router = APIRouter()


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
    """Export detection and tracking data."""
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
        raise HTTPException(status_code=400, detail="Unsupported export format. Use 'json'.")
