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

Key landmarks:
- **15, 16:** Wrists (bar position)
- **13, 14:** Elbows (angles)
- **11, 12:** Shoulders (angles)

**Z-axis:** MediaPipe estimates depth from a statistical model. Z is relative to hip center, smaller = closer. This is an estimate, not a measurement - single cameras cannot measure depth.

---

## Step 3: Bar Position Estimation

Wrist positions estimate barbell location. Bar is gripped in palms, ~18% past wrist along forearm direction.

**Code:** `barbell_detector.py` lines 161-180

```python
def _estimate_grip_from_forearm(elbow_px, wrist_px):
    forearm_dx = wrist_px[0] - elbow_px[0]
    forearm_dy = wrist_px[1] - elbow_px[1]
    
    # Extend 18% past wrist
    grip_x = wrist_px[0] + int(forearm_dx * 0.18)
    grip_y = wrist_px[1] + int(forearm_dy * 0.18)
    return (grip_x, grip_y)
```

Bar center is the midpoint of both grip positions:

**Code:** `barbell_detector.py` lines 220-230

```python
left_grip = _estimate_grip_from_forearm(left_elbow_px, left_wrist_px)
right_grip = _estimate_grip_from_forearm(right_elbow_px, right_wrist_px)

center_x = (left_grip[0] + right_grip[0]) // 2
center_y = (left_grip[1] + right_grip[1]) // 2
```

Smoothing: Exponential moving average (α=0.5). Jumps >500px are rejected as outliers.

**Code:** `barbell_detector.py` lines 106-109

```python
smooth_x = self.smoothed_position[0] + 0.5 * dx
smooth_y = self.smoothed_position[1] + 0.5 * dy
self.smoothed_position = (smooth_x, smooth_y)
```

---

## Step 4: Velocity Calculation

Velocity = change in position / change in time.

**Code:** `trajectory_tracker.py` lines 174-191

```python
for i in range(1, len(sorted_traj)):
    prev, curr = sorted_traj[i-1], sorted_traj[i]
    
    dt = (curr["frame"] - prev["frame"]) / fps
    dx = curr["x"] - prev["x"]
    dy = curr["y"] - prev["y"]
    
    velocities.append({
        "vx": dx / dt,
        "vy": dy / dt,
        "speed": math.sqrt(dx**2 + dy**2) / dt,
        "vertical_velocity": -dy / dt,  # Invert Y
    })
```

Y-axis increases downward (y=0 at top). When bar moves up, dy is negative. Sign is flipped so positive = upward.

---

## Step 5: Joint Angles

Dot product formula calculates angles from three points.

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

Counts midpoint crossings going upward.

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

**Code:** `trajectory_tracker.py` lines 209-218

```python
{
    "peak_concentric_velocity": max(vertical_vels),
    "peak_eccentric_velocity": abs(min(vertical_vels)),
    "average_speed": sum(speeds) / len(speeds),
    "vertical_displacement": max(y) - min(y),
    "horizontal_deviation": max(x) - min(x),
    "path_verticality": 1.0 - (x_deviation / y_displacement),
    "estimated_reps": rep_count,
}
```

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
