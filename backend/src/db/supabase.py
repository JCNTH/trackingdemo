import os
import logging
from typing import Optional

from supabase import create_client, Client

logger = logging.getLogger(__name__)

_supabase_client: Optional[Client] = None


def init_supabase() -> None:
    """Initialize Supabase client."""
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
    """Update video status and metadata."""
    client = get_supabase()
    
    update_data = {"status": status, **kwargs}
    if error_message:
        update_data["error_message"] = error_message
    
    result = client.table("videos").update(update_data).eq("id", video_id).execute()
    return result.data[0] if result.data else None


async def insert_detection_results(video_id: str, results: list[dict]) -> None:
    """Batch insert detection results."""
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
    """Create tracking session record."""
    client = get_supabase()
    
    result = client.table("tracking_sessions").insert({
        "video_id": video_id,
        "object_count": object_count,
        "has_pose": has_pose,
        "trajectory_data": trajectory_data,
    }).execute()
    
    return result.data[0] if result.data else None


async def download_video(storage_path: str) -> bytes:
    """Download video from Supabase Storage."""
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


async def update_video_weight(
    video_id: str,
    detected_weight: float,
    weight_unit: str = "lbs"
) -> dict:
    """Update video with detected weight information."""
    client = get_supabase()
    
    result = client.table("videos").update({
        "detected_weight": detected_weight,
        "weight_unit": weight_unit,
    }).eq("id", video_id).execute()
    
    return result.data[0] if result.data else None

