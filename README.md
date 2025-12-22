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
- Range: x, y ∈ [0, 1]
- Used for: pose landmarks

**Pixel coordinates:** Image space
- Origin: top-left (0, 0)
- Range: x ∈ [0, width], y ∈ [0, height]
- Used for: bar tracking, velocity calculations
- **Note:** Y increases downward (y=0 at top)

**Conversion:** `pixel_x = normalized_x × frame_width`

---

## Step 1: Frame Extraction

OpenCV reads frames and extracts video properties.

**Code:** `trajectory_tracker.py` lines 347-358

```python
cap = cv2.VideoCapture(video_path)

fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total_frames / fps if fps > 0 else 0
```

**Output:** Frame dimensions in pixels (e.g., 1920×1080)

---

## Step 2: Pose Estimation

MediaPipe extracts 33 body landmarks per frame. Output is normalized coordinates [0-1].

**Code:** `trajectory_tracker.py` line 392, calls `pose_estimator.py`

```python
pose_landmarks = pose_estimator.estimate(frame, roi=tracking_roi)

# Each landmark: {x, y, z, visibility}
# x, y: normalized [0-1]
# z: relative depth (estimated)
# visibility: confidence [0-1]
```

**Output:** Landmarks in normalized [0-1] coordinates

**Example:**
```python
landmark = {
    "x": 0.45,      # 45% from left edge
    "y": 0.62,      # 62% from top edge
    "z": -0.12,     # estimated depth
    "visibility": 0.95
}
```

Key landmarks:
- **15, 16:** Wrists (bar position)
- **13, 14:** Elbows (angles)
- **11, 12:** Shoulders (angles)

**Z-axis:** MediaPipe estimates depth from a statistical model. Z is relative to hip center, smaller = closer. This is an estimate, not a measurement - single cameras cannot measure depth.

---

## Step 3: Bar Position Estimation

### Step 3a: Convert Normalized → Pixel Coordinates

Landmarks are converted from normalized [0-1] to pixel coordinates.

**Code:** `barbell_detector.py` lines 207-210

```python
# Convert normalized [0-1] to pixel coordinates
left_wrist_px = (int(left_wrist["x"] * frame_width), int(left_wrist["y"] * frame_height))
right_wrist_px = (int(right_wrist["x"] * frame_width), int(right_wrist["y"] * frame_height))
left_elbow_px = (int(left_elbow["x"] * frame_width), int(left_elbow["y"] * frame_height))
right_elbow_px = (int(right_elbow["x"] * frame_width), int(right_elbow["y"] * frame_height))
```

**Example:** If frame is 1920×1080 and wrist is at (0.45, 0.62):
- `pixel_x = 0.45 × 1920 = 864 pixels`
- `pixel_y = 0.62 × 1080 = 670 pixels`

### Step 3b: Estimate Grip Position

Bar is gripped ~18% past wrist along forearm direction.

**Code:** `barbell_detector.py` lines 161-180

```python
def _estimate_grip_from_forearm(elbow_px, wrist_px):
    # Forearm vector (elbow → wrist)
    forearm_dx = wrist_px[0] - elbow_px[0]  # pixels
    forearm_dy = wrist_px[1] - elbow_px[1]  # pixels
    
    # Extend 18% past wrist
    grip_x = wrist_px[0] + int(forearm_dx * 0.18)  # pixels
    grip_y = wrist_px[1] + int(forearm_dy * 0.18)  # pixels
    return (grip_x, grip_y)
```

**Output:** Grip positions in pixel coordinates

### Step 3c: Calculate Bar Center

Bar center is midpoint of both grip positions.

**Code:** `barbell_detector.py` lines 220-230

```python
left_grip = _estimate_grip_from_forearm(left_elbow_px, left_wrist_px)
right_grip = _estimate_grip_from_forearm(right_elbow_px, right_wrist_px)

center_x = (left_grip[0] + right_grip[0]) // 2  # pixels
center_y = (left_grip[1] + right_grip[1]) // 2  # pixels
```

**Output:** Bar center `(center_x, center_y)` in pixel coordinates

### Step 3d: Smoothing

Exponential moving average smooths position. Jumps >500px are rejected.

**Code:** `barbell_detector.py` lines 106-109

```python
dx = new_x - smoothed_x  # pixels
dy = new_y - smoothed_y  # pixels
smooth_x = smoothed_x + 0.5 * dx  # pixels
smooth_y = smoothed_y + 0.5 * dy  # pixels
```

**Output:** Smoothed bar position in pixel coordinates

---

## Step 4: Velocity Calculation

### Step 4a: Position Change (Pixels)

Calculate change in position between consecutive frames.

**Code:** `trajectory_tracker.py` lines 176-177

```python
dx = curr["x"] - prev["x"]  # pixels
dy = curr["y"] - prev["y"]  # pixels
```

**Example:** If bar moves from (864, 670) to (865, 665):
- `dx = 865 - 864 = 1 pixel`
- `dy = 665 - 670 = -5 pixels` (negative = moving up)

### Step 4b: Time Change (Seconds)

Calculate time difference between frames.

**Code:** `trajectory_tracker.py` line 172

```python
dt = (curr["frame"] - prev["frame"]) / fps  # seconds
```

**Example:** If fps = 30:
- `dt = 1 / 30 = 0.033 seconds`

### Step 4c: Velocity (Pixels/Second)

Velocity = change in position / change in time.

**Code:** `trajectory_tracker.py` lines 181-184

```python
vx = dx / dt  # pixels/second
vy = dy / dt  # pixels/second
speed = math.sqrt(dx**2 + dy**2) / dt  # pixels/second
vertical_velocity = -dy / dt  # pixels/second (positive = upward)
```

**Example:** With dx=1, dy=-5, dt=0.033:
- `vx = 1 / 0.033 = 30 px/s`
- `vy = -5 / 0.033 = -152 px/s`
- `vertical_velocity = -(-5) / 0.033 = 152 px/s` (positive = upward)

**Important:** 
- Velocity is in **pixels/second**, NOT cm/s or m/s
- No conversion to real-world units occurs
- Y-axis is inverted: negative dy = upward movement

---

## Step 5: Joint Angles

Angles calculated from three points using dot product. Input is normalized coordinates [0-1].

**Code:** `trajectory_tracker.py` lines 69-94

```python
def calculate_angle(p1, p2, p3):
    # Vectors in normalized space
    v1 = np.array([p1["x"] - p2["x"], p1["y"] - p2["y"]])
    v2 = np.array([p3["x"] - p2["x"], p3["y"] - p2["y"]])
    
    # Dot product formula
    cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
    angle = np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0)))
    return angle  # degrees
```

**Input:** Normalized coordinates [0-1]  
**Output:** Angle in degrees

Elbow angle: shoulder → elbow → wrist

**Code:** `trajectory_tracker.py` lines 114-116

```python
left = calculate_angle(pose_landmarks[11], pose_landmarks[13], pose_landmarks[15])
right = calculate_angle(pose_landmarks[12], pose_landmarks[14], pose_landmarks[16])
```

---

## Step 6: Rep Counting

Counts midpoint crossings going upward. Uses pixel Y coordinates.

**Code:** `trajectory_tracker.py` lines 221-243

```python
def _count_reps(y_positions, displacement):
    mid_y = (min(y_positions) + max(y_positions)) / 2  # pixels
    was_below = y_positions[0] > mid_y
    rep_count = 0
    
    for y in y_positions[1:]:
        is_below = y > mid_y
        if was_below and not is_below:  # Crossed midpoint going up
            rep_count += 1
        was_below = is_below
    
    return rep_count
```

**Input:** Y positions in pixels  
**Output:** Rep count (integer)

---

## Step 7: Output Metrics

All metrics are in pixel units or derived from pixel calculations.

**Code:** `trajectory_tracker.py` lines 203-211

```python
{
    "peak_concentric_velocity": max(vertical_vels),      # px/s
    "peak_eccentric_velocity": abs(min(vertical_vels)), # px/s
    "average_speed": sum(speeds) / len(speeds),         # px/s
    "vertical_displacement": max(y) - min(y),            # px
    "horizontal_deviation": max(x) - min(x),             # px
    "path_verticality": 1.0 - (x_deviation / y_displacement),  # 0-1
    "estimated_reps": rep_count,                          # count
}
```

**Units:**
- Velocities: **pixels/second** (NOT cm/s or m/s)
- Displacements: **pixels** (NOT cm or m)
- Angles: **degrees**
- Path verticality: **dimensionless** (0-1)

**No conversion to real-world units:** All measurements remain in pixel space.

---

## Coordinate Conversion Summary

| Step | Input Format | Conversion | Output Format |
|------|--------------|------------|---------------|
| Pose Estimation | Frame (BGR) | MediaPipe processing | Normalized [0-1] |
| Bar Position | Normalized [0-1] | `× frame_width/height` | Pixel coordinates |
| Velocity | Pixel coordinates | `dx/dt, dy/dt` | Pixels/second |
| Joint Angles | Normalized [0-1] | Dot product (no conversion) | Degrees |
| Metrics | Pixel/second | Aggregation | Pixel/second |

---

## Limitations

| Issue | Impact | Why Overcome |
|-------|--------|--------------|
| **No true depth** | Z-axis estimated, not measured | Required for 3D biomechanics, accurate joint torques, and muscle force calculations |
| **Pixel units** | No real-world m/s without calibration | Needed to compare velocities across videos, match research standards (VBT uses m/s), and provide actionable feedback |
| **Camera angle** | Best perpendicular to movement | Limits deployment flexibility; multi-angle support enables analysis from any viewing position |
| **Occlusion** | Tracking lost when wrists hidden | Breaks analysis during critical movement phases; needed for continuous biomechanics tracking |

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
