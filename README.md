# Exercise Tracker - Backend Pipeline

Video-based exercise tracking using pose estimation to track bar path, calculate velocities, and measure joint angles.

Core logic: `backend/src/services/trajectory_tracker.py`

---

## Pipeline

```
Video → Pose Estimation → Bar Tracking → Velocity → Metrics
         (MediaPipe)      (wrist midpoint)  (dx/dt)
```

---

## Coordinate Systems

**Normalized [0-1]:** MediaPipe output
- Origin: top-left (0, 0)
- Conversion: `pixel_x = normalized_x × frame_width`

**Pixel coordinates:** Image space
- Origin: top-left (0, 0)
- Y increases downward (y=0 at top)
- Used for: bar tracking, velocity calculations

---

## Step 1: Frame Extraction

Extract video properties.

**Code:** `trajectory_tracker.py` lines 347-358

```python
cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
```

---

## Step 2: Pose Estimation

MediaPipe extracts 33 body landmarks. Output: normalized [0-1] coordinates.

**Code:** `trajectory_tracker.py` line 392

```python
pose_landmarks = pose_estimator.estimate(frame, roi=tracking_roi)
# Each landmark: {x, y, z, visibility}
# x, y: normalized [0-1]
# z: relative depth (estimated)
```

Key landmarks: 15,16 = wrists | 13,14 = elbows | 11,12 = shoulders

**Z-axis:** Estimated from statistical model, relative to hip center. Not a true measurement.

---

## Step 3: Bar Position Estimation

### 3a: Normalized → Pixel Conversion

**Code:** `barbell_detector.py` lines 207-210

```python
left_wrist_px = (int(left_wrist["x"] * frame_width), int(left_wrist["y"] * frame_height))
right_wrist_px = (int(right_wrist["x"] * frame_width), int(right_wrist["y"] * frame_height))
```

### 3b: Estimate Grip Position

Extend 18% past wrist along forearm direction.

**Code:** `barbell_detector.py` lines 161-180

```python
def _estimate_grip_from_forearm(elbow_px, wrist_px):
    forearm_dx = wrist_px[0] - elbow_px[0]
    forearm_dy = wrist_px[1] - elbow_px[1]
    grip_x = wrist_px[0] + int(forearm_dx * 0.18)
    grip_y = wrist_px[1] + int(forearm_dy * 0.18)
    return (grip_x, grip_y)
```

### 3c: Bar Center

**Code:** `barbell_detector.py` lines 226-227

```python
center_x = (left_grip[0] + right_grip[0]) // 2
center_y = (left_grip[1] + right_grip[1]) // 2
```

### 3d: Smoothing

EMA (α=0.5). Reject jumps >500px.

**Code:** `barbell_detector.py` lines 106-109

```python
smooth_x = smoothed_x + 0.5 * (new_x - smoothed_x)
smooth_y = smoothed_y + 0.5 * (new_y - smoothed_y)
```

---

## Step 4: Velocity Calculation

### 4a: Position Change

**Code:** `trajectory_tracker.py` lines 176-177

```python
dx = curr["x"] - prev["x"]  # pixels
dy = curr["y"] - prev["y"]  # pixels
```

### 4b: Time Change

**Code:** `trajectory_tracker.py` line 172

```python
dt = (curr["frame"] - prev["frame"]) / fps  # seconds
```

### 4c: Velocity

**Code:** `trajectory_tracker.py` lines 181-184

```python
vx = dx / dt  # pixels/second
vy = dy / dt  # pixels/second
speed = math.sqrt(dx**2 + dy**2) / dt
vertical_velocity = -dy / dt  # positive = upward
```

**Units:** Pixels/second (NOT cm/s or m/s). No conversion to real-world units.

---

## Step 5: Joint Angles

Dot product formula. Input: normalized [0-1], Output: degrees.

**Code:** `trajectory_tracker.py` lines 69-94

```python
def calculate_angle(p1, p2, p3):
    v1 = np.array([p1["x"] - p2["x"], p1["y"] - p2["y"]])
    v2 = np.array([p3["x"] - p2["x"], p3["y"] - p2["y"]])
    cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
    return np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0)))
```

Elbow angle: shoulder → elbow → wrist

**Code:** `trajectory_tracker.py` lines 114-116

```python
left = calculate_angle(pose_landmarks[11], pose_landmarks[13], pose_landmarks[15])
right = calculate_angle(pose_landmarks[12], pose_landmarks[14], pose_landmarks[16])
```

---

## Step 6: Rep Counting

Tracks midpoint crossings going upward.

**Code:** `trajectory_tracker.py` lines 221-243

```python
def _count_reps(y_positions, displacement):
    mid_y = (min(y_positions) + max(y_positions)) / 2
    was_below = y_positions[0] > mid_y
    rep_count = 0
    
    for y in y_positions[1:]:
        is_below = y > mid_y
        if was_below and not is_below:  # Crossed midpoint going up
            rep_count += 1
        was_below = is_below
    return rep_count
```

---

## Step 7: Output Metrics

**Code:** `trajectory_tracker.py` lines 203-211

```python
{
    "peak_concentric_velocity": max(vertical_vels),      # px/s
    "peak_eccentric_velocity": abs(min(vertical_vels)), # px/s
    "average_speed": sum(speeds) / len(speeds),         # px/s
    "vertical_displacement": max(y) - min(y),            # px
    "horizontal_deviation": max(x) - min(x),             # px
    "path_verticality": 1.0 - (x_deviation / y_displacement),
    "estimated_reps": rep_count,
}
```

**Units:** Velocities and displacements in pixels. Angles in degrees. No real-world unit conversion.

---

## Coordinate Conversion Summary

| Step | Input | Conversion | Output |
|------|-------|------------|--------|
| Pose Estimation | Frame (BGR) | MediaPipe | Normalized [0-1] |
| Bar Position | Normalized [0-1] | `× frame_width/height` | Pixel coordinates |
| Velocity | Pixel coordinates | `dx/dt, dy/dt` | Pixels/second |
| Joint Angles | Normalized [0-1] | Dot product | Degrees |

---

## Limitations

| Issue | Impact | Why Overcome |
|-------|--------|--------------|
| **No true depth** | Z-axis estimated, not measured | Required for 3D biomechanics, joint torques, muscle forces |
| **Pixel units** | No real-world m/s without calibration | Compare across videos, match research standards (VBT uses m/s) |
| **Camera angle** | Best perpendicular to movement | Enable flexible deployment, multi-angle analysis |
| **Occlusion** | Tracking lost when wrists hidden | Complete movement analysis, continuous biomechanics |

See `backend/CAPABILITIES.md` for details.

---

## Files

```
backend/src/services/
├── trajectory_tracker.py   # Main pipeline
├── pose_estimator.py       # MediaPipe 33 keypoints
├── barbell_detector.py     # Bar position + smoothing
└── form_analyzer.py        # Rule-based scoring
```

---

## Run

```bash
cd backend
python run.py  # Port 8000
```
