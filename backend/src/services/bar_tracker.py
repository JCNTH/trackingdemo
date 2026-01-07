"""Bar tracking using SAM2 video predictor with memory."""

import logging
import tempfile
import shutil
from pathlib import Path
from typing import Dict, Tuple
import numpy as np
import cv2

logger = logging.getLogger(__name__)

_sam2_predictor = None


def get_sam2_video_predictor():
    """Load SAM2 video predictor."""
    global _sam2_predictor
    if _sam2_predictor is None:
        from sam2.build_sam import build_sam2_video_predictor
        import torch
        
        backend_dir = Path(__file__).parent.parent.parent
        checkpoint = backend_dir / "checkpoints" / "sam2_hiera_tiny.pt"
        
        if not checkpoint.exists():
            raise FileNotFoundError(
                f"SAM2 checkpoint not found. Download: curl -L -o {checkpoint} "
                f"https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_tiny.pt"
            )
        
        config = "configs/sam2/sam2_hiera_t.yaml"
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        
        _sam2_predictor = build_sam2_video_predictor(
            config_file=config,
            ckpt_path=str(checkpoint),
            device=device
        )
        
        logger.info(f"SAM2 loaded (device: {device})")
    
    return _sam2_predictor


def process_video_with_click_tracking(
    video_path: str,
    click_point: Tuple[int, int],
    model_name: str = "sam2",
    frame_callback=None,
    preview_callback=None,
    start_frame: int = 0,
    end_frame: int | None = None,
) -> Dict:
    """Process video with SAM2 memory tracking."""
    frames_dir = Path(tempfile.mkdtemp())
    
    try:
        logger.info("Extracting frames...")
        cap = cv2.VideoCapture(video_path)
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # Apply frame range
        actual_start = max(0, start_frame)
        actual_end = min(total_frames, end_frame) if end_frame is not None else total_frames
        
        if actual_start >= actual_end:
            raise ValueError(f"Invalid frame range: {actual_start}-{actual_end}")
        
        logger.info(f"Processing frames {actual_start} to {actual_end} (out of {total_frames})")
        
        # Extract only the specified frame range
        cap.set(cv2.CAP_PROP_POS_FRAMES, actual_start)
        
        frame_idx = 0
        for real_frame_idx in range(actual_start, actual_end):
            ret, frame = cap.read()
            if not ret:
                break
            
            # Save with sequential index (SAM2 expects 0-indexed)
            frame_path = frames_dir / f"{frame_idx:05d}.jpeg"
            cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
            frame_idx += 1
        
        cap.release()
        frames_to_process = frame_idx
        logger.info(f"Extracted {frames_to_process} frames")
        
        predictor = get_sam2_video_predictor()
        
        logger.info("Initializing SAM2...")
        inference_state = predictor.init_state(video_path=str(frames_dir))
        
        points = np.array([[click_point[0], click_point[1]]], dtype=np.float32)
        labels = np.array([1], dtype=np.int32)
        
        predictor.reset_state(inference_state)
        predictor.add_new_points(
            inference_state=inference_state,
            frame_idx=0,
            obj_id=1,
            points=points,
            labels=labels,
        )
        
        logger.info("Propagating masks...")
        trajectory = []
        
        for frame_idx, obj_ids, mask_logits in predictor.propagate_in_video(inference_state):
            # Adjust timestamp for actual video position
            actual_frame_idx = actual_start + frame_idx
            timestamp = actual_frame_idx / fps
            
            if frame_callback and frame_idx % 5 == 0:
                frame_callback(frame_idx, frames_to_process)
            
            mask_data = None
            if mask_logits is not None and len(mask_logits) > 0:
                mask = (mask_logits[0] > 0.0).cpu().numpy()
                if mask.ndim == 3:
                    mask = mask.squeeze()
                
                mask_data = mask
                ys, xs = np.where(mask)
                
                if len(xs) > 0:
                    bbox = [int(np.min(xs)), int(np.min(ys)), int(np.max(xs)), int(np.max(ys))]
                    center = ((bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2)
                    
                    trajectory.append({
                        "frame": actual_frame_idx,
                        "timestamp": timestamp,
                        "bbox": bbox,
                        "center": center,
                        "confidence": 1.0,
                        "method": "sam2_video",
                    })
                    
                    # Generate preview every 10 frames
                    if preview_callback and frame_idx % 10 == 0:
                        frame_path = frames_dir / f"{frame_idx:05d}.jpeg"
                        frame = cv2.imread(str(frame_path))
                        if frame is not None:
                            # Draw mask overlay
                            overlay = frame.copy()
                            overlay[mask > 0] = [0, 255, 0]
                            preview = cv2.addWeighted(overlay, 0.4, frame, 0.6, 0)
                            
                            # Draw bbox
                            cv2.rectangle(preview, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 255, 0), 2)
                            
                            # Draw center
                            cv2.circle(preview, center, 5, (255, 0, 0), -1)
                            
                            # Draw frame number
                            cv2.putText(preview, f"Frame {actual_frame_idx}/{actual_end}", 
                                       (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
                            
                            preview_callback(preview)
                    
                    continue
            
            trajectory.append({
                "frame": actual_frame_idx,
                "timestamp": timestamp,
                "bbox": None,
                "center": None,
                "confidence": 0.0,
                "method": "lost",
            })
            
            if frame_idx % 50 == 0:
                logger.info(f"Processed {frame_idx}/{frames_to_process}")
        
        tracked_frames = sum(1 for t in trajectory if t["center"] is not None)
        
        return {
            "success": True,
            "model_used": "sam2_video",
            "click_point": list(click_point),
            "total_frames": len(trajectory),
            "tracked_frames": tracked_frames,
            "tracking_rate": tracked_frames / len(trajectory) if trajectory else 0,
            "trajectory": trajectory,
            "frame_range": {
                "start": actual_start,
                "end": actual_end,
                "total_video_frames": total_frames,
            },
            "video_info": {
                "width": width,
                "height": height,
                "fps": fps,
                "duration": len(trajectory) / fps,
            },
        }
        
    except ImportError:
        return {
            "success": False,
            "error": "SAM2 not installed. Run: pip install git+https://github.com/facebookresearch/segment-anything-2.git",
        }
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)


def segment_from_click(
    frame: np.ndarray,
    click_point: Tuple[int, int],
    model_name: str = "sam2",
) -> Dict:
    """Preview segmentation on single frame."""
    import torch
    from ultralytics import SAM
    
    h, w = frame.shape[:2]
    
    try:
        model = SAM("sam2_t.pt")
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        
        results = model(
            frame,
            points=[list(click_point)],
            labels=[1],
            verbose=False,
            device=device,
        )
        
        if not results or results[0].masks is None:
            return {"success": False, "error": "No mask generated"}
        
        mask_np = results[0].masks.data[0].cpu().numpy()
        
        if mask_np.shape[0] != h or mask_np.shape[1] != w:
            mask_np = cv2.resize(mask_np.astype(np.float32), (w, h))
        
        binary_mask = (mask_np > 0.5).astype(np.uint8) * 255
        ys, xs = np.nonzero(binary_mask)
        
        if len(xs) == 0:
            return {"success": False, "error": "Empty mask"}
        
        bbox = [int(np.min(xs)), int(np.min(ys)), int(np.max(xs)), int(np.max(ys))]
        center = ((bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2)
        
        return {
            "success": True,
            "mask": binary_mask,
            "bbox": bbox,
            "center": center,
            "area_pixels": int(np.sum(binary_mask > 0)),
            "model_used": "sam2",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_model_info() -> Dict:
    """Get model information."""
    import torch
    
    return {
        "sam2": {
            "name": "SAM2 Video",
            "description": "Meta SAM2 with temporal memory",
            "mps_available": torch.backends.mps.is_available(),
        },
        "default": "sam2",
    }


def reset_models():
    """Reset cached models."""
    global _sam2_predictor
    _sam2_predictor = None
