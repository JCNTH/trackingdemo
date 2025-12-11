# Pose Detection Pipeline Documentation

> A step-by-step guide to how video is processed into movement metrics.

---

## Overview

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│   Video     │ →  │    Pose      │ →  │     Bar     │ →  │   Velocity   │
│   Frame     │    │  Estimation  │    │   Tracking  │    │   Metrics    │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
    (pixels)        (normalized)         (pixels)          (px/s)
```

---

## Step 1: Video Frame Extraction

**Input:** Video file (MP4, MOV, etc.)  
**Output:** Individual frames as BGR numpy arrays

```
Video → OpenCV VideoCapture → frame[height, width, 3]
```

- Frames are in **BGR color format** (OpenCV default)
- Dimensions are in **pixels** (e.g., 1440×1920)
- Frame rate (FPS) is extracted for time calculations

**Code:** `trajectory_tracker.py` → `process_video()`

---

## Step 2: Person Detection (YOLO)

**Input:** BGR frame (pixels)  
**Output:** Bounding boxes for each detected person

```
frame → YOLO v8 → [
    {id: 0, bbox: [x1, y1, x2, y2], confidence: 0.95},
    {id: 1, bbox: [x1, y1, x2, y2], confidence: 0.87},
    ...
]
```

- Bounding boxes are in **pixel coordinates**
- Only class 0 (person) is detected
- Confidence threshold: 0.4 (40%)

**Code:** `yolo_detector.py` → `detect_objects()`

---

## Step 3: Pose Estimation (MediaPipe / YOLO-Pose)

**Input:** BGR frame + person bounding box  
**Output:** 33 body keypoints (landmarks)

```
frame + bbox → MediaPipe Pose → landmarks[33]
```

### Landmark Output Format

Each landmark contains:
```python
{
    "x": 0.45,          # NORMALIZED [0-1] - horizontal position
    "y": 0.62,          # NORMALIZED [0-1] - vertical position  
    "z": -0.12,         # RELATIVE depth (unitless, smaller = closer)
    "visibility": 0.95, # Confidence [0-1]
    "name": "left_wrist"
}
```

### Coordinate System (Normalized Space)

```
    (0,0) ─────────────────── (1,0)
      │                         │
      │      Normalized         │
      │      Space              │
      │      (0-1)              │
      │                         │
    (0,1) ─────────────────── (1,1)
```

- **Origin:** Top-left corner (0, 0)
- **X-axis:** → Right (0.0 to 1.0)
- **Y-axis:** ↓ Down (0.0 to 1.0)
- **Conversion to pixels:** `pixel_x = normalized_x × frame_width`

### The 33 Body Landmarks

```
        0 (nose)
       /  \
      1    4  (eyes)
     /      \
    7        8  (ears)
    
   11 ──────── 12  (shoulders)
    │          │
   13         14  (elbows)
    │          │
   15         16  (wrists) ← USED FOR BAR TRACKING
    
   23 ──────── 24  (hips)
    │          │
   25         26  (knees)
    │          │
   27         28  (ankles)
```

**Key landmarks for exercise tracking:**
- **15, 16:** Wrists (bar position estimation)
- **13, 14:** Elbows (elbow angle calculation)
- **11, 12:** Shoulders (shoulder angle)
- **23, 24:** Hips (hip angle for squats/deadlifts)
- **25, 26:** Knees (knee angle)

**Code:** `pose_estimator.py` → `estimate_pose()`

---

## Step 4: Bar Position Estimation

**Input:** Pose landmarks (normalized)  
**Output:** Bar center position (pixels)

```
landmarks → Wrist Midpoint → (bar_x, bar_y) in pixels
```

### Algorithm: Forearm-Extended Grip Estimation

The bar is held **above the wrists** in the palms. We extend along the forearm direction:

```python
# 1. Get wrist and elbow positions
left_wrist = landmarks[15]   # normalized
right_wrist = landmarks[16]  # normalized
left_elbow = landmarks[13]
right_elbow = landmarks[14]

# 2. Convert to pixel coordinates
left_wrist_px = (left_wrist.x × width, left_wrist.y × height)
right_wrist_px = (right_wrist.x × width, right_wrist.y × height)

# 3. Extend along forearm direction (18% past wrist)
forearm_vector = wrist_px - elbow_px
grip_position = wrist_px + 0.18 × forearm_vector

# 4. Bar center = midpoint of both grips
bar_center = (left_grip + right_grip) / 2
```

### Detection Priority

1. **forearm_extended:** Both wrists + elbows visible (best)
2. **wrist_fallback:** At least one wrist visible
3. **EMA smoothing:** No detection, use recent history

### Smoothing (EMA + Buffer)

```python
# Exponential Moving Average (α = 0.5)
smoothed = α × new_position + (1 - α) × smoothed

# Jump detection (reject outliers)
if distance > 500px:
    reject_and_use_previous()
```

**Code:** `barbell_detector.py` → `detect_barbell()`

---

## Step 5: Trajectory Building

**Input:** Bar positions over all frames  
**Output:** `bar_trajectory[]` array

```python
bar_trajectory = [
    {"x": 720, "y": 450, "frame": 0, "timestamp": 0.000, "source": "forearm_extended"},
    {"x": 721, "y": 445, "frame": 1, "timestamp": 0.033, "source": "forearm_extended"},
    {"x": 722, "y": 438, "frame": 2, "timestamp": 0.067, "source": "forearm_extended"},
    # ... one entry per frame
]
```

- **x, y:** Bar position in **PIXEL coordinates**
- **frame:** Frame number (0-indexed)
- **timestamp:** Time in seconds (frame / fps)
- **source:** Detection method used

**Code:** `trajectory_tracker.py` → `process_video()`

---

## Step 6: Velocity Calculation

**Input:** `bar_trajectory[]` + FPS  
**Output:** Velocity metrics

### Formula

```python
# Position change (pixels)
dx = trajectory[i].x - trajectory[i-1].x
dy = trajectory[i].y - trajectory[i-1].y

# Time change (seconds)
dt = (frame_i - frame_i-1) / fps

# Velocity (pixels/second)
vx = dx / dt
vy = dy / dt

# Speed (magnitude)
speed = sqrt(vx² + vy²)
```

### ⚠️ Y-Axis Inversion

**IMPORTANT:** In image coordinates, Y increases DOWNWARD!

```
    y=0 (top of frame)
      │
      │  ↑ bar moving UP = NEGATIVE dy
      │
      │  ↓ bar moving DOWN = POSITIVE dy
      │
    y=height (bottom of frame)
```

Therefore:
- **Negative vy** = bar moving UP (concentric phase)
- **Positive vy** = bar moving DOWN (eccentric phase)
- **vertical_velocity = -vy** (to make positive = upward)

**Code:** `trajectory_tracker.py` → `calculate_velocity_metrics()`

---

## Step 7: Output Metrics

**Final output saved to database:**

```python
velocity_metrics = {
    # Velocity
    "peak_concentric_velocity": 340.5,  # px/s (max upward speed)
    "peak_eccentric_velocity": 280.2,   # px/s (max downward speed)
    "average_speed": 156.3,             # px/s (mean across all frames)
    
    # Displacement
    "vertical_displacement": 157.0,     # px (total Y range)
    "horizontal_deviation": 23.4,       # px (total X range, ideally small)
    
    # Quality
    "path_verticality": 0.87,           # 0-1 (1.0 = perfectly vertical)
    "estimated_reps": 5,                # count of up/down cycles
}
```

**Code:** `trajectory_tracker.py` → `calculate_velocity_metrics()`

---

## Coordinate Spaces Summary

| Space | Range | Origin | Used For |
|-------|-------|--------|----------|
| **Pixel** | (0,0) to (W,H) | Top-left | Bar tracking, velocity |
| **Normalized** | (0,0) to (1,1) | Top-left | Pose landmarks |
| **World** | Meters (estimated) | Hip center | 3D visualization (MediaPipe only) |

---

## Full Pipeline Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         VIDEO PROCESSING PIPELINE                          │
└────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐
  │  Video File │
  │  (MP4/MOV)  │
  └──────┬──────┘
         │
         ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 1: Frame Extraction (OpenCV)                          │
  │  Output: BGR frame [H × W × 3] in PIXEL coordinates         │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 2: Person Detection (YOLO v8)                         │
  │  Output: bounding box [x1, y1, x2, y2] in PIXELS            │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 3: Pose Estimation (MediaPipe)                        │
  │  Output: landmarks[33] with x, y in NORMALIZED [0-1]        │
  │          z = relative depth (unitless)                      │
  │          visibility = confidence [0-1]                      │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 4: Bar Position Estimation                            │
  │  Method: forearm_extended (elbow → wrist → grip)            │
  │  Output: (bar_x, bar_y) in PIXEL coordinates                │
  │                                                             │
  │  Conversion: pixel_x = normalized_x × frame_width           │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 5: Smoothing & Filtering                              │
  │  • EMA (α=0.5): smoothed = α×new + (1-α)×smoothed           │
  │  • Jump rejection: if Δ > 500px, reject                     │
  │  • Buffer: 3-frame moving average                           │
  │  Output: smoothed (bar_x, bar_y) in PIXELS                  │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 6: Trajectory Building                                │
  │  Output: bar_trajectory[frame] = {                          │
  │    x: pixels, y: pixels,                                    │
  │    frame: int, timestamp: seconds,                          │
  │    source: "forearm_extended" | "wrist_fallback" | ...      │
  │  }                                                          │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 7: Velocity Calculation                               │
  │                                                             │
  │  dx = x[i] - x[i-1]           (pixels)                      │
  │  dy = y[i] - y[i-1]           (pixels)                      │
  │  dt = (frame[i] - frame[i-1]) / fps    (seconds)            │
  │                                                             │
  │  vx = dx / dt                 (pixels/second)               │
  │  vy = dy / dt                 (pixels/second)               │
  │  speed = √(vx² + vy²)         (pixels/second)               │
  │                                                             │
  │  ⚠️  Y-AXIS INVERTED:                                       │
  │      vy < 0 → bar moving UP (concentric)                    │
  │      vy > 0 → bar moving DOWN (eccentric)                   │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  STEP 8: Output Metrics                                     │
  │                                                             │
  │  {                                                          │
  │    peak_concentric_velocity: px/s,                          │
  │    peak_eccentric_velocity: px/s,                           │
  │    average_speed: px/s,                                     │
  │    vertical_displacement: px,                               │
  │    horizontal_deviation: px,                                │
  │    path_verticality: 0-1,                                   │
  │    estimated_reps: int                                      │
  │  }                                                          │
  └─────────────────────────────────────────────────────────────┘
```

---

## Accuracy Limitations

### Single-Camera Setup

1. **No true depth measurement** - Z-axis is estimated, not measured
2. **Velocity in px/s, not cm/s** - Requires calibration for real-world units
3. **Camera angle affects displacement** - Best when movement is perpendicular to camera
4. **Occlusion causes tracking loss** - Smoothing helps but can't fully compensate

### Converting to Real-World Units

To get velocity in cm/s, you need a reference object:

```python
# Example: Standard Olympic barbell = 220cm
bar_pixel_length = measure_bar_in_frame()  # e.g., 400 pixels
pixels_per_cm = bar_pixel_length / 220     # e.g., 1.82 px/cm

# Convert velocity
velocity_cms = velocity_pxs / pixels_per_cm
```

---

## File Reference

| File | Purpose |
|------|---------|
| `trajectory_tracker.py` | Main pipeline orchestration |
| `pose_estimator.py` | MediaPipe pose detection |
| `yolo_detector.py` | YOLO object detection |
| `yolo_pose_estimator.py` | YOLO-Pose single-pass detection |
| `barbell_detector.py` | Bar position estimation + smoothing |
| `form_analyzer.py` | AI-based form analysis (Claude) |
| `weight_detector.py` | AI-based weight detection (Claude Vision) |

---

## References

- [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- [VBT Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC7866505/)
- [OpenCap Architecture](https://github.com/stanfordnmbl/opencap-core)
- [YOLO v8 Pose](https://docs.ultralytics.com/tasks/pose/)
