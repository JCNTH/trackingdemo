# Exercise Tracker - Backend Pipeline

Video-based exercise tracking system that analyzes movement form using pose estimation. We process videos frame-by-frame to track bar path, calculate velocities, and measure joint angles.

All core logic is in `backend/src/services/trajectory_tracker.py`.

---

## How It Works

The pipeline extracts frames from video, runs pose estimation to find body keypoints, estimates bar position from wrist positions, then calculates velocities and angles from the trajectory.

```
Video → Pose Estimation → Bar Tracking → Velocity → Metrics
         (MediaPipe)      (wrist midpoint)  (dx/dt)
```

---

## Step 1: Reading the Video

We use OpenCV to read frames from the video file and extract basic properties like frame rate and dimensions.

**Code:** `trajectory_tracker.py` lines 347-358

```python
cap = cv2.VideoCapture(video_path)

# Extract video properties
fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total_frames / fps if fps > 0 else 0
```

---

## Step 2: Finding Body Keypoints

We use MediaPipe pose estimation to extract 33 body landmarks from each frame: shoulders, elbows, wrists, etc.

**Code:** `trajectory_tracker.py` line 392, calls `pose_estimator.py`

```python
# Returns 33 landmarks in NORMALIZED [0-1] coordinates
pose_landmarks = pose_estimator.estimate(frame, roi=tracking_roi)

# Each landmark contains:
# {
#     "x": 0.45,          # horizontal position [0-1]
#     "y": 0.62,          # vertical position [0-1]
#     "z": -0.12,         # relative depth (estimated)
#     "visibility": 0.95  # confidence score
# }
```

Important landmarks:
- **15, 16:** Left and right wrists (used to find bar position)
- **13, 14:** Elbows (for angle calculations)
- **11, 12:** Shoulders (for angle calculations)

**Z-axis estimation:** MediaPipe provides a depth estimate based on a statistical model trained on human pose data. The Z value is relative to the hip center, with smaller values meaning closer to the camera. This is an estimate, not a measurement - single cameras cannot directly measure depth.

---

## Step 3: Estimating Bar Position

We use wrist positions to estimate barbell location. The bar is gripped in the palms, which are slightly above the wrists. We extend 18% past the wrist along the forearm direction to estimate grip position.

**Code:** `barbell_detector.py` lines 161-180

```python
def _estimate_grip_from_forearm(
    self,
    elbow_px: Tuple[int, int],
    wrist_px: Tuple[int, int],
) -> Tuple[int, int]:
    """
    Estimate hand grip position by extending along forearm direction.
    The bar is gripped ~15-20% of forearm length past the wrist.
    """
    # Calculate forearm vector (elbow → wrist)
    forearm_dx = wrist_px[0] - elbow_px[0]
    forearm_dy = wrist_px[1] - elbow_px[1]
    
    # Extend past wrist by extension factor (18%)
    grip_x = wrist_px[0] + int(forearm_dx * self.FOREARM_EXTENSION_FACTOR)
    grip_y = wrist_px[1] + int(forearm_dy * self.FOREARM_EXTENSION_FACTOR)
    
    return (grip_x, grip_y)
```

We calculate the midpoint of both grip positions to get the bar center:

**Code:** `barbell_detector.py` lines 220-230

```python
# Best case: Both forearms visible
left_grip = self._estimate_grip_from_forearm(left_elbow_px, left_wrist_px)
right_grip = self._estimate_grip_from_forearm(right_elbow_px, right_wrist_px)

# Bar position is midpoint of estimated grip positions
center_x = (left_grip[0] + right_grip[0]) // 2
center_y = (left_grip[1] + right_grip[1]) // 2
```

We smooth the position using exponential moving average and reject jumps larger than 500 pixels (likely detection errors).

**Code:** `barbell_detector.py` lines 106-109

```python
# Exponential moving average (α = 0.5)
smooth_x = self.smoothed_position[0] + self.alpha * dx
smooth_y = self.smoothed_position[1] + self.alpha * dy
self.smoothed_position = (smooth_x, smooth_y)
```

---

## Step 4: Calculating Velocity

We calculate velocity from frame-to-frame position changes: velocity = change in position / change in time.

**Code:** `trajectory_tracker.py` lines 174-191

```python
# Calculate frame-to-frame velocities
for i in range(1, len(sorted_traj)):
    prev, curr = sorted_traj[i-1], sorted_traj[i]
    
    dt = (curr["frame"] - prev["frame"]) / fps
    if dt <= 0:
        continue
    
    dx = curr["x"] - prev["x"]
    dy = curr["y"] - prev["y"]
    
    velocities.append({
        "frame": curr["frame"],
        "vx": dx / dt,
        "vy": dy / dt,
        "speed": math.sqrt(dx**2 + dy**2) / dt,
        "vertical_velocity": -dy / dt,  # Invert Y for intuitive direction
    })
```

In image coordinates, Y increases downward (y=0 at top). When the bar moves up, dy is negative. We flip the sign so positive velocities represent upward movement.

---

## Step 5: Joint Angles

We calculate joint angles using the dot product formula. Given three points (shoulder, elbow, wrist), we find the angle at the middle point.

**Code:** `trajectory_tracker.py` lines 69-94

```python
def calculate_angle(p1: Dict, p2: Dict, p3: Dict) -> Optional[float]:
    """
    Calculate the angle at p2 formed by vectors p1→p2 and p3→p2.
    Uses the dot product formula: cos(θ) = (v1 · v2) / (|v1| × |v2|)
    """
    # Skip if any landmark is not visible enough
    if any(p.get("visibility", 0) < 0.3 for p in [p1, p2, p3]):
        return None
    
    # Create vectors from p2 to p1 and p2 to p3
    v1 = np.array([p1["x"] - p2["x"], p1["y"] - p2["y"])
    v2 = np.array([p3["x"] - p2["x"], p3["y"] - p2["y"])
    
    # Calculate angle using dot product
    cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    
    return float(np.degrees(np.arccos(cos_angle)))
```

For elbow angles, we use shoulder → elbow → wrist:

**Code:** `trajectory_tracker.py` lines 114-116

```python
# Elbow angles: shoulder → elbow → wrist
left = calculate_angle(pose_landmarks[11], pose_landmarks[13], pose_landmarks[15])
right = calculate_angle(pose_landmarks[12], pose_landmarks[14], pose_landmarks[16])
```

---

## Step 6: Counting Reps

We detect reps by tracking when the bar crosses the midpoint of its vertical range going upward. We check if the bar was below the midpoint and is now above it.

**Code:** `trajectory_tracker.py` lines 221-243

```python
def _count_reps(y_positions: List[float], displacement: float) -> int:
    """
    Count rep cycles by tracking when bar crosses midpoint going UP.
    
    Since Y is inverted (0=top, max=bottom):
    - "Below midpoint" means y > mid_y (bar is lower)
    - Crossing UP means going from y > mid_y to y < mid_y
    """
    if len(y_positions) < 10 or displacement < 50:
        return 0
    
    mid_y = (min(y_positions) + max(y_positions)) / 2
    was_below = y_positions[0] > mid_y
    rep_count = 0
    
    for y in y_positions[1:]:
        is_below = y > mid_y
        if was_below and not is_below:  # Crossed midpoint going up
            rep_count += 1
        was_below = is_below
    
    return rep_count if rep_count > 0 else (1 if displacement > 100 else 0)
```

---

## Step 7: Final Metrics

We aggregate all results into summary metrics:

**Code:** `trajectory_tracker.py` lines 209-218

```python
return {
    "peak_concentric_velocity": max(vertical_vels),
    "peak_eccentric_velocity": abs(min(vertical_vels)),
    "average_speed": sum(speeds) / len(speeds),
    "vertical_displacement": displacement,
    "horizontal_deviation": x_deviation,
    "path_verticality": 1.0 - min(x_deviation / (displacement + 1), 1.0),
    "estimated_reps": rep_count,
    "frame_velocities": velocities,
}
```

---

## Limitations

Single camera setup has fundamental limitations:

| Issue | Impact |
|-------|--------|
| **No true depth** | Z-axis is estimated, not measured |
| **Pixel units only** | Cannot get real-world m/s without calibration |
| **Camera angle matters** | Works best when camera is perpendicular to movement |
| **Occlusion breaks tracking** | If wrists are hidden, we lose the bar |

See `backend/CAPABILITIES.md` for detailed limitations and roadmap.

---

## Project Structure

```
backend/src/services/
├── trajectory_tracker.py   # Main pipeline (all steps)
├── pose_estimator.py       # MediaPipe 33 keypoints
├── barbell_detector.py     # Bar position + smoothing
└── form_analyzer.py        # Rule-based scoring
```

---

## Running

```bash
cd backend
python run.py  # Starts on port 8000
```
