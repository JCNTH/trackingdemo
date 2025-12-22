# Exercise Tracker - Backend Pipeline

Video-based exercise tracking using pose estimation to calculate bar path, velocity, and joint angles.

## Pipeline Overview

```
Video → Pose Estimation → Bar Tracking → Velocity → Metrics
         (MediaPipe)      (wrist midpoint)  (dx/dt)
```

---

## Step 1: Pose Estimation

Extract 33 body keypoints using MediaPipe.

```python
# pose_estimator.py
rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
results = pose_model.process(rgb_frame)

# Output: normalized coordinates [0-1]
landmark = {
    "x": 0.45,      # horizontal position
    "y": 0.62,      # vertical position
    "z": -0.12,     # relative depth (estimated)
    "visibility": 0.95
}
```

**Key landmarks:** 15, 16 = wrists | 13, 14 = elbows | 11, 12 = shoulders

---

## Step 2: Bar Position Estimation

Estimate bar center from wrist midpoint with forearm extension.

```python
# barbell_detector.py
# Extend 18% past wrist along forearm direction
forearm_vector = wrist_px - elbow_px
grip_position = wrist_px + 0.18 * forearm_vector

# Bar center = midpoint of both grips
bar_center = (left_grip + right_grip) / 2
```

**Smoothing:** EMA with α=0.5, reject jumps > 500px

---

## Step 3: Velocity Calculation

Calculate frame-to-frame velocity. **Y-axis is inverted** (y=0 at top).

```python
# trajectory_tracker.py
dx = curr.x - prev.x
dy = curr.y - prev.y
dt = frame_diff / fps

vx = dx / dt  # px/s
vy = dy / dt  # px/s
vertical_velocity = -vy  # positive = upward
```

---

## Step 4: Joint Angles

Calculate angles using dot product.

```python
# trajectory_tracker.py
v1 = [p1.x - p2.x, p1.y - p2.y]
v2 = [p3.x - p2.x, p3.y - p2.y]

cos_angle = dot(v1, v2) / (|v1| * |v2|)
angle = arccos(cos_angle) * (180/π)
```

**Elbow angle:** shoulder → elbow → wrist (landmarks 11→13→15)

---

## Step 5: Output Metrics

```python
{
    "peak_concentric_velocity": 340.5,  # px/s (max upward)
    "peak_eccentric_velocity": 280.2,   # px/s (max downward)
    "vertical_displacement": 157.0,     # px
    "path_verticality": 0.87,           # 0-1 (1 = vertical)
    "estimated_reps": 5,
    "elbow_asymmetry": 8.3              # degrees
}
```

---

## Limitations (Single Camera)

| Issue | Impact |
|-------|--------|
| No depth | Z-axis estimated, not measured |
| Pixel units | No real-world m/s without calibration |
| Camera angle | Best perpendicular to movement |
| Occlusion | Tracking lost when body parts hidden |

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
python run.py  # Starts on port 8000
```

## References

- [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- [VBT Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC7866505/)
