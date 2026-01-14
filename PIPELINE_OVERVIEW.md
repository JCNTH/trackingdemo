# Exercise Tracking Pipeline - Technical Overview

A video-based system for tracking weightlifting exercises, specifically bench press, using computer vision and deep learning.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js)                             │
│  Upload Video → Click on Bar → View Progress → View Overlay Results         │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTP/REST API
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (FastAPI)                              │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │   SAM2 Video    │    │   YOLO11-pose   │    │  Overlay Gen    │         │
│  │  (Bar Tracking) │    │ (Pose Estimate) │    │   (OpenCV)      │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            STORAGE (Supabase)                               │
│  Videos Bucket  │  Tracking Sessions Table  │  Overlay Videos Bucket       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline Stages

### Stage 1: Video Upload & Frame Extraction

**User Action**: Upload video through web interface

**Backend Process**:
```python
cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)           # e.g., 30 fps
width = cap.get(cv2.CAP_PROP_FRAME_WIDTH) # e.g., 1920
height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) # e.g., 1080
total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) # e.g., 300
```

**Output**: Video metadata stored, first frame extracted for user to click on bar.

---

### Stage 2: Click-to-Track Initialization

**User Action**: Click on the barbell in the first frame

**What Happens**:
1. Frontend captures click coordinates (x, y) in pixels
2. Backend receives click point relative to video dimensions
3. Point is used to initialize SAM2 segmentation

**Why This Matters**: Unlike automatic detection, click-to-track ensures the system tracks the correct object (barbell) from the start, avoiding false positives.

---

### Stage 3: SAM2 Video Segmentation

**Model**: Meta's Segment Anything Model 2 (SAM2)
- **Architecture**: Hierarchical Vision Transformer (Hiera)
- **Checkpoint**: `sam2_hiera_tiny.pt` (~39MB)
- **Device**: Apple Silicon MPS or CPU

**How SAM2 Works**:

```
Frame 0: User Click → Initial Mask
    ↓
Frame 1: SAM2 Memory → Propagate Mask
    ↓
Frame 2: SAM2 Memory → Propagate Mask
    ↓
   ... (continues for all frames)
```

**Key Insight - Temporal Memory**:
SAM2 doesn't process each frame independently. It maintains a **memory bank** of previous frames, allowing it to:
1. Track objects through occlusions
2. Handle temporary disappearances
3. Maintain object identity across the video

**Backend Code**:
```python
# Initialize predictor with video frames
inference_state = predictor.init_state(video_path=frames_dir)

# Add initial click point as positive prompt
predictor.add_new_points(
    inference_state=inference_state,
    frame_idx=0,
    obj_id=1,
    points=np.array([[click_x, click_y]]),
    labels=np.array([1])  # 1 = foreground
)

# Propagate through video - this is where the magic happens
for frame_idx, obj_ids, mask_logits in predictor.propagate_in_video(inference_state):
    mask = (mask_logits[0] > 0.0).cpu().numpy()
    # Extract bounding box and center from mask
    ys, xs = np.where(mask)
    bbox = [min(xs), min(ys), max(xs), max(ys)]
    center = ((bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2)
```

**Output Per Frame**:
```json
{
  "frame": 45,
  "timestamp": 1.5,
  "bbox": [120, 340, 580, 390],
  "center": [350, 365],
  "confidence": 1.0,
  "method": "sam2_video"
}
```

**Processing Speed**: ~6 seconds per frame on M1 Mac (CPU/MPS)

---

### Stage 4: Human Pose Estimation

**Model**: YOLO11s-pose (Ultralytics)
- **Keypoints**: 17 COCO format
- **Speed**: ~90ms/frame on CPU
- **mAP**: 58.9

**COCO 17 Keypoints**:
```
 0: nose           5: left_shoulder   10: right_wrist
 1: left_eye       6: right_shoulder  11: left_hip
 2: right_eye      7: left_elbow      12: right_hip
 3: left_ear       8: right_elbow     13: left_knee
 4: right_ear      9: left_wrist      14: right_knee
                                      15: left_ankle
                                      16: right_ankle
```

**Backend Code**:
```python
from ultralytics import YOLO
model = YOLO("yolo11s-pose.pt")

results = model(frame, verbose=False)[0]

# Extract keypoints (normalized 0-1 coordinates)
for idx, kp in enumerate(kpts_data):
    x, y, visibility = kp[0], kp[1], kp[2]
    landmarks.append({
        "x": x / width,      # Normalized [0-1]
        "y": y / height,     # Normalized [0-1]
        "visibility": visibility,  # Confidence [0-1]
        "name": KEYPOINT_NAMES[idx]
    })
```

**Person Tracking Between Frames**:
Uses IoU (Intersection over Union) to track the same person across frames:
```python
def calculate_iou(box1, box2):
    # Find overlap area / union area
    intersection = overlap_area(box1, box2)
    union = area(box1) + area(box2) - intersection
    return intersection / union
```

---

### Stage 5: Temporal Smoothing (One Euro Filter)

**Problem**: Raw pose keypoints can be jittery frame-to-frame.

**Solution**: One Euro Filter - an adaptive low-pass filter that:
- Smooths slow movements heavily (reduces noise)
- Passes through fast movements quickly (preserves responsiveness)

**Algorithm**:
```python
class OneEuroFilter:
    def __call__(self, value):
        # Calculate rate of change
        dx = (value - self.last_value) * fps
        smoothed_dx = low_pass_filter(dx)
        
        # Adaptive cutoff: faster motion = less smoothing
        cutoff = min_cutoff + beta * abs(smoothed_dx)
        
        return low_pass_filter(value, cutoff)
```

**Per-Keypoint Tuning**:
| Body Part | min_cutoff | beta | Behavior |
|-----------|------------|------|----------|
| Wrists (9,10) | 0.5 | 0.7 | More responsive (fast bar movement) |
| Elbows (7,8) | 0.4 | 0.5 | Balanced |
| Torso/Legs | 0.3 | 0.3 | Heavy smoothing (stable reference) |

---

### Stage 6: Overlay Video Generation

**Why Pre-render?**: Real-time canvas overlays have browser sync issues. Pre-rendering bakes the overlay into the video.

**Process**:
```python
while True:
    ret, frame = cap.read()
    if not ret:
        break
    
    overlay = frame.copy()
    
    # Look up tracking data by frame index (direct lookup, no interpolation)
    if frame_idx in bar_dict:
        bar = bar_dict[frame_idx]
        # Draw diagonal line showing bar angle
        cv2.line(overlay, (bbox[0], bbox[3]), (bbox[2], bbox[1]), (0, 255, 0), 6)
    
    if frame_idx in person_dict:
        # Draw skeleton connections
        for connection in POSE_CONNECTIONS:
            pt1 = get_landmark_pixel(landmarks[connection[0]])
            pt2 = get_landmark_pixel(landmarks[connection[1]])
            cv2.line(overlay, pt1, pt2, (255, 100, 255), 3)
    
    out.write(overlay)
```

**FFmpeg Re-encoding** (for browser compatibility):
```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -preset fast -crf 23 \
  -pix_fmt yuv420p \      # Required for Safari/Chrome
  -movflags +faststart \  # Enable streaming
  output.mp4
```

---

## Data Flow Diagram

```
┌──────────────┐    click (x,y)    ┌──────────────────┐
│   User       │ ─────────────────▶│  Backend API     │
│   Frontend   │                   │  /click-to-track │
└──────────────┘                   └────────┬─────────┘
                                            │
                        ┌───────────────────┼───────────────────┐
                        ▼                   ▼                   ▼
              ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
              │    SAM2         │ │   YOLO11-pose   │ │   One Euro      │
              │   (bar mask)    │ │ (17 keypoints)  │ │   Filter        │
              └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
                       │                   │                   │
                       │                   └───────────────────┘
                       │                            │
                       ▼                            ▼
              ┌─────────────────┐          ┌─────────────────┐
              │   bar_path[]    │          │  person_path[]  │
              │ frame, x, y,    │          │ frame, pose_    │
              │ bbox, conf      │          │ landmarks       │
              └────────┬────────┘          └────────┬────────┘
                       │                            │
                       └────────────┬───────────────┘
                                    ▼
                          ┌─────────────────┐
                          │  Overlay Video  │
                          │  Generation     │
                          │  (OpenCV)       │
                          └────────┬────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │  Supabase       │
                          │  Storage        │
                          │  (videos/       │
                          │   overlays/)    │
                          └─────────────────┘
```

---

## Coordinate Systems

| Stage | Coordinate System | Range | Origin |
|-------|-------------------|-------|--------|
| SAM2 Output | Pixel | 0 to width/height | Top-left |
| YOLO Pose | Normalized | 0 to 1 | Top-left |
| Frontend Display | CSS pixels | Responsive | Top-left |

**Conversion (Normalized → Pixel)**:
```python
pixel_x = normalized_x * frame_width
pixel_y = normalized_y * frame_height
```

---

## Why Frame Indexing Works

**The Question**: "If SAM2 segments frame-by-frame, why did we have sync issues?"

**Answer**: SAM2 segmentation IS perfectly synchronized - each trajectory point stores its actual video frame index:

```python
trajectory.append({
    "frame": actual_frame_idx,  # e.g., 45
    "timestamp": 1.5,           # 45/30fps = 1.5s
    "center": [350, 365],
    ...
})
```

**The Real Problem Was Display Sync**:
1. Browser `timeupdate` event fires only ~4x/second (not every frame)
2. Browser has decode-to-display latency (~1-2 frames)
3. Canvas drawing happens in JavaScript, separate from video playback

**Solutions Implemented**:
1. **Pre-rendered overlay** - tracking baked into video frames = perfect sync
2. **requestAnimationFrame** - 60fps time updates for canvas fallback
3. **Frame offset compensation** - `FRAME_DISPLAY_OFFSET = 1` for browser latency

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/src/services/bar_tracker.py` | SAM2 video segmentation |
| `backend/src/services/pose_service.py` | YOLO11 pose estimation |
| `backend/src/routers/click_to_track.py` | API endpoints, overlay generation |
| `frontend/src/components/ProcessedVideoViewer.tsx` | Video display, view modes |
| `frontend/src/components/TrajectoryCanvas.tsx` | Real-time canvas overlay |

---

## Performance Characteristics

| Operation | Time | Hardware |
|-----------|------|----------|
| SAM2 per frame | ~6 sec | M1 Mac (MPS) |
| YOLO pose per frame | ~90 ms | CPU |
| Overlay render per frame | ~10 ms | CPU |
| Total for 300-frame video | ~30 min | M1 Mac |

---

## Summary

1. **User clicks** on barbell → provides SAM2 with initial prompt
2. **SAM2 propagates** mask through video using temporal memory
3. **YOLO11** detects human pose (17 keypoints) per frame
4. **One Euro Filter** smooths pose keypoints temporally
5. **OpenCV** renders overlay with tracking visualizations
6. **FFmpeg** re-encodes for browser compatibility
7. **Frontend** displays pre-rendered overlay (or canvas fallback)
