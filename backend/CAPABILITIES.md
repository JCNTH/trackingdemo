# Capabilities & Limitations

> What this pipeline CAN do, CAN'T do, and what can be built upon.

---

## End Goal: Full Biomechanics Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ULTIMATE GOAL                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Object Tracking                                                         │
│     • Center of mass of object (barbell, dumbbell)                          │
│     • 3D position and velocity                                              │
│     • Contact points with body                                              │
│                                                                             │
│  2. Body Kinematics                                                         │
│     • Full body pose reconstruction                                         │
│     • Joint angles over time                                                │
│     • Segment velocities and accelerations                                  │
│                                                                             │
│  3. Dynamics & Forces                                                       │
│     • Joint torques (inverse dynamics)                                      │
│     • Muscle forces (musculoskeletal modeling)                              │
│     • Ground reaction forces                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current Pipeline: What We CAN Do ✅

### 1. 2D Pose Estimation
```
✅ 33 body keypoints per frame (MediaPipe)
✅ Normalized coordinates [0-1]
✅ Visibility/confidence scores
✅ Works in real-time (~30fps on CPU)
```

**Landmarks available:**
- Face (0-10): nose, eyes, ears, mouth
- Upper body (11-22): shoulders, elbows, wrists, hands
- Lower body (23-32): hips, knees, ankles, feet

### 2. 2D Bar Tracking
```
✅ Bar position from wrist midpoint
✅ Forearm-extended grip estimation
✅ Smoothing (EMA α=0.5)
✅ Jump rejection for outliers
✅ Multiple fallback methods
```

### 3. 2D Velocity Metrics
```
✅ Frame-to-frame velocity (pixels/second)
✅ Peak concentric velocity (upward)
✅ Peak eccentric velocity (downward)
✅ Average speed
```

**Formula:**
```python
dx = x[i] - x[i-1]
dy = y[i] - y[i-1]
dt = frame_diff / fps
velocity = sqrt(dx² + dy²) / dt  # px/s
```

### 4. Joint Angle Calculation
```
✅ Elbow angles (shoulder→elbow→wrist)
✅ Knee angles (hip→knee→ankle)
✅ Hip angles (shoulder→hip→knee)
✅ Asymmetry detection (left vs right)
```

**Formula (dot product):**
```python
v1 = [p1.x - p2.x, p1.y - p2.y]
v2 = [p3.x - p2.x, p3.y - p2.y]
angle = arccos(v1·v2 / |v1||v2|)
```

### 5. Rep Counting
```
✅ Automatic rep detection
✅ Midpoint crossing algorithm
✅ Works for repetitive movements
```

### 6. Form Analysis (Rule-Based)
```
✅ Path verticality scoring
✅ Elbow symmetry scoring
✅ Basic form recommendations
```

---

## Current Limitations: What We CAN'T Do ❌

### 1. No True 3D Reconstruction

```
❌ FUNDAMENTAL LIMITATION: Single camera = no depth
```

**Why?**
- A single 2D image loses the Z-axis (depth) information
- MediaPipe's Z-coordinate is **estimated**, not measured
- The Z value is relative to hip depth, not absolute meters

**Impact:**
- Cannot calculate true 3D position of objects
- Cannot get real-world velocities (m/s)
- Movement parallel to camera is invisible

```
Camera View:
     ┌──────────────────┐
     │   Can see X, Y   │
     │   Cannot see Z   │◄─── Depth is lost
     │   (into screen)  │
     └──────────────────┘
```

### 2. No Real-World Units

```
❌ All measurements in PIXELS, not cm/m
```

**Current output:** 340 px/s  
**What we need:** 0.85 m/s

**To convert, need calibration:**
```python
# Would need reference object of known size
bar_length_pixels = 400
bar_length_cm = 220  # Olympic bar
scale = bar_length_cm / bar_length_pixels  # cm/px

velocity_cms = velocity_pxs * scale
```

### 3. No Center of Mass Estimation

```
❌ Cannot estimate geometric center of object
❌ Cannot track object independently of body
```

**Why?**
- Current method uses wrist midpoint as proxy
- No actual detection of barbell shape/bounds
- No segmentation mask of the object

### 4. No Contact Point Detection

```
❌ Cannot determine where object contacts body
❌ Cannot detect grip position on bar
```

### 5. No Force Estimation

```
❌ No joint torques
❌ No muscle forces
❌ No ground reaction forces
```

**Why?**
- Forces require:
  - Accurate 3D kinematics
  - Body segment masses
  - Acceleration data
  - Inverse dynamics model

### 6. No Occlusion Handling

```
❌ Tracking fails when body parts hidden
❌ No prediction during occlusion
```

### 7. Camera Angle Dependency

```
❌ Accuracy varies with camera position
❌ Best only when perpendicular to movement plane
```

**Worst case:** Camera parallel to bar movement  
**Best case:** Camera perpendicular to sagittal plane

---

## What Can Be Built Upon 🔧

### Near-Term Additions (Current Architecture)

#### 1. Multi-Camera 3D Reconstruction
```
Difficulty: MEDIUM
Requires: 2+ synchronized cameras, calibration

Pipeline:
  Camera 1 ─┬─► Triangulation ─► 3D Points
  Camera 2 ─┘

Benefits:
  ✅ True 3D coordinates
  ✅ Real depth measurement
  ✅ Velocity in m/s
```

#### 2. Depth Camera Integration (RealSense, Kinect)
```
Difficulty: LOW-MEDIUM
Requires: RGB-D camera

Benefits:
  ✅ Direct depth per pixel
  ✅ Single camera setup
  ✅ Point cloud of scene
```

#### 3. Object Segmentation (SAM3)
```
Difficulty: MEDIUM
Requires: SAM3 model integration

Pipeline:
  Frame ─► SAM3 ─► Segmentation Mask ─► Object Bounds ─► Center of Mass

Benefits:
  ✅ Actual object boundaries
  ✅ Geometric center calculation
  ✅ Object tracking independent of pose
```

Current SAM3 exists in: `/Users/julianng-thow-hing/Desktop/modelhealthdemo/sam3/`

#### 4. Calibration for Real-World Units
```
Difficulty: LOW
Requires: Reference object in frame (bar length, plate diameter)

Implementation:
  1. Detect barbell endpoints
  2. Measure pixel distance
  3. Apply known real-world length
  4. Calculate pixels-per-cm scale factor
```

### Medium-Term Additions (Architecture Extension)

#### 5. Velocity & Acceleration in 3D
```
Requires: 3D reconstruction first

v = d(position)/dt
a = d(velocity)/dt

Then:
  - Linear velocity of segments
  - Angular velocity of joints
  - Centripetal acceleration
```

#### 6. Inverse Kinematics
```
Requires: Accurate 3D pose

Pipeline:
  2D Keypoints ─► Lifting to 3D ─► IK Solver ─► Joint Angles

Libraries: OpenSim, Biomechanics Toolkit
```

#### 7. Contact Detection
```
Requires: Object segmentation + pose

Algorithm:
  1. Get object mask (SAM3)
  2. Get hand keypoints
  3. Check overlap/proximity
  4. Identify contact points
```

### Long-Term Additions (Full Biomechanics)

#### 8. Inverse Dynamics
```
Requires: 3D kinematics + body model + GRF

Pipeline:
  Kinematics ─► Newton-Euler ─► Joint Torques

τ = I·α + r × F

Where:
  τ = joint torque
  I = moment of inertia
  α = angular acceleration
  F = external forces
```

#### 9. Musculoskeletal Modeling
```
Requires: Inverse dynamics + muscle model

Tools: OpenSim, AnyBody

Pipeline:
  Joint Torques ─► Muscle Optimization ─► Muscle Forces

Solves: τ = Σ(r_i × F_muscle_i)
```

#### 10. Ground Reaction Force Estimation
```
Options:
  A. Force plate (gold standard)
  B. ML estimation from video
  C. Inverse dynamics + known accelerations
```

---

## Accuracy Comparison

| Metric | Current (2D) | With Depth Camera | With Multi-Camera |
|--------|--------------|-------------------|-------------------|
| Position | ±5-10 px | ±1-2 cm | ±0.5-1 cm |
| Velocity | px/s only | cm/s (approx) | cm/s (accurate) |
| Depth | ❌ estimated | ✅ measured | ✅ triangulated |
| Joint angles | ±5-10° | ±3-5° | ±1-3° |
| Real-world | ❌ | ✅ | ✅ |

---

## Recommended Next Steps

### For Professor Demo
1. **Show current capabilities** - 2D tracking works well
2. **Acknowledge limitations** - Be clear about single-camera constraints
3. **Present roadmap** - Show path to full 3D biomechanics

### For Development
```
Priority 1: Calibration system (get real-world units)
Priority 2: SAM3 integration (object segmentation)
Priority 3: Multi-camera or depth camera (true 3D)
Priority 4: Inverse dynamics (joint forces)
```

---

## References

- [OpenSim](https://opensim.stanford.edu/) - Musculoskeletal modeling
- [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) - Current pose estimation
- [OpenCap](https://github.com/stanfordnmbl/opencap-core) - Video-based biomechanics
- [SAM3](https://github.com/facebookresearch/sam3) - Segment Anything Model
- [Biomechanics Toolkit](https://github.com/Biomechanical-ToolKit/BTKCore) - Motion analysis
- [VBT Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC7866505/) - Velocity-based training science

