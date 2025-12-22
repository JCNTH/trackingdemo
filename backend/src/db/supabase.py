"""
Supabase database client for video storage and retrieval.

Tables:
  - videos: Uploaded video files and metadata
  - detection_results: Frame-by-frame pose and object detections
  - tracking_sessions: Aggregated trajectory data and metrics
"""

import os
import logging
from typing import Optional

from supabase import create_client, Client

logger = logging.getLogger(__name__)

_supabase_client: Optional[Client] = None


def init_supabase() -> None:
    """Initialize Supabase client on application startup."""
    global _supabase_client
    
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        logger.warning("Supabase credentials not configured. Database operations will fail.")
        return
    
    _supabase_client = create_client(url, key)
    logger.info("Supabase client initialized")


def get_supabase() -> Client:
    """Get Supabase client instance."""
    if _supabase_client is None:
        raise RuntimeError("Supabase client not initialized. Call init_supabase() first.")
    return _supabase_client


async def get_video(video_id: str) -> dict | None:
    """Get video by ID."""
    client = get_supabase()
    result = client.table("videos").select("*").eq("id", video_id).single().execute()
    return result.data


async def update_video_status(
    video_id: str, 
    status: str, 
    error_message: str | None = None,
    **kwargs
) -> dict:
    """
    Update video status and metadata.
    
    Args:
        video_id: UUID of the video
        status: One of 'pending', 'processing', 'completed', 'failed'
        error_message: Optional error message if status is 'failed'
        **kwargs: Additional fields to update (duration, width, height, fps)
    """
    client = get_supabase()
    
    update_data = {"status": status, **kwargs}
    if error_message:
        update_data["error_message"] = error_message
    
    result = client.table("videos").update(update_data).eq("id", video_id).execute()
    return result.data[0] if result.data else None


async def insert_detection_results(video_id: str, results: list[dict]) -> None:
    """
    Batch insert detection results for each processed frame.
    
    Args:
        video_id: UUID of the video
        results: List of frame detection results with:
            - frame_number: int
            - timestamp: float (seconds)
            - objects: list of detected objects with bboxes
            - pose_landmarks: list of 33 pose landmarks (or None)
    """
    client = get_supabase()
    
    # Prepare records
    records = [
        {
            "video_id": video_id,
            "frame_number": r["frame_number"],
            "timestamp": r["timestamp"],
            "objects": r.get("objects", []),
            "pose_landmarks": r.get("pose_landmarks"),
        }
        for r in results
    ]
    
    # Insert in batches to avoid payload limits
    batch_size = 100
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        client.table("detection_results").insert(batch).execute()


async def create_tracking_session(
    video_id: str,
    object_count: int,
    has_pose: bool,
    trajectory_data: dict | None = None
) -> dict:
    """
    Create tracking session record with aggregated trajectory data.
    
    Args:
        video_id: UUID of the video
        object_count: Number of tracked objects (usually 1 for barbell)
        has_pose: Whether pose was detected
        trajectory_data: Dict containing:
            - bar_path: List of {frame, timestamp, x, y} points
            - velocity_metrics: Calculated velocity stats
            - joint_angles: List of angle measurements per frame
            - tracking_stats: Detection source breakdown
    """
    client = get_supabase()
    
    result = client.table("tracking_sessions").insert({
        "video_id": video_id,
        "object_count": object_count,
        "has_pose": has_pose,
        "trajectory_data": trajectory_data,
    }).execute()
    
    return result.data[0] if result.data else None


async def download_video(storage_path: str) -> bytes:
    """
    Download video from Supabase Storage.
    
    Args:
        storage_path: Path within the 'videos' bucket
        
    Returns:
        Raw video bytes
    """
    import httpx
    
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    # Build the storage URL
    download_url = f"{url}/storage/v1/object/videos/{storage_path}"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            download_url,
            headers={
                "Authorization": f"Bearer {key}",
                "apikey": key,
            },
            timeout=60.0
        )
        response.raise_for_status()
        return response.content
