# Capabilities & Limitations

> What this pipeline CAN do, CAN'T do, and what can be built upon.

---

## End Goal: Full Biomechanics Pipeline

**Description:** The ultimate objective is to reconstruct complete biomechanics of human movement, including object tracking, body kinematics, and force estimation.

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

**Description:** These are the capabilities currently implemented and working in the system.

### 1. 2D Pose Estimation

**What it does:** Extracts 33 body keypoints from each video frame using MediaPipe.

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

**Z-axis estimation:** MediaPipe estimates depth using a statistical model trained on human pose datasets. The Z coordinate:
- Is relative to the hip center (origin point)
- Uses approximate meters as units
- Smaller values = closer to camera, larger = farther
- **Important:** This is an ESTIMATE, not a true measurement. Single cameras cannot directly measure depth - they infer it from learned patterns of human proportions and perspective cues.

### 2. 2D Bar Tracking

**What it does:** Estimates barbell position by analyzing wrist landmarks and extending along the forearm direction.

```
✅ Bar position from wrist midpoint
✅ Forearm-extended grip estimation
✅ Smoothing (EMA α=0.5)
✅ Jump rejection for outliers
✅ Multiple fallback methods
```

**How it works:**
1. Detects wrist positions (landmarks 15, 16)
2. Extends 18% past wrist along forearm direction (elbow → wrist)
3. Calculates midpoint of both grip positions
4. Applies exponential moving average smoothing
5. Rejects jumps > 500px as outliers

### 3. 2D Velocity Metrics

**What it does:** Calculates movement speed from frame-to-frame position changes.

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

**Note:** Y-axis is inverted in image coordinates (y=0 at top), so `vertical_velocity = -dy/dt` makes positive values represent upward movement.

### 4. Joint Angle Calculation

**What it does:** Calculates angles at joints using three-point geometry and dot product.

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

**What it does:** Automatically detects complete lift cycles by tracking midpoint crossings.

```
✅ Automatic rep detection
✅ Midpoint crossing algorithm
✅ Works for repetitive movements
```

**Algorithm:** Tracks when bar crosses the midpoint of its vertical range going upward (concentric phase).

### 6. Form Analysis (Rule-Based)

**What it does:** Provides basic form scoring based on bar path quality and joint symmetry.

```
✅ Path verticality scoring
✅ Elbow symmetry scoring
✅ Basic form recommendations
```

**Scoring:** Combines path verticality (>0.7 = good) and elbow asymmetry (<10° = good) into overall form score.

---

## Current Limitations: What We CAN'T Do ❌

**Description:** Fundamental constraints due to single-camera setup and current implementation.

### 1. No True 3D Reconstruction

**Why this limitation exists:** Single cameras capture 2D images, losing depth information.

```
❌ FUNDAMENTAL LIMITATION: Single camera = no depth
```

**Technical explanation:**
- A single 2D image loses the Z-axis (depth) information
- MediaPipe's Z-coordinate is **estimated** using statistical models, not measured
- The Z value is relative to hip depth, not absolute meters
- Estimation accuracy degrades with unusual poses or camera angles

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

**Why this limitation exists:** No calibration reference to convert pixels to physical measurements.

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

**Why this limitation exists:** Current method uses wrist midpoint as proxy, not actual object detection.

```
❌ Cannot estimate geometric center of object
❌ Cannot track object independently of body
```

**Current approach:**
- Uses wrist midpoint as proxy for bar position
- No actual detection of barbell shape/bounds
- No segmentation mask of the object

**What's needed:** Object segmentation (e.g., SAM3) to get actual object boundaries and calculate geometric center.

### 4. No Contact Point Detection

**Why this limitation exists:** No object segmentation or detailed hand pose analysis.

```
❌ Cannot determine where object contacts body
❌ Cannot detect grip position on bar
```

**What's needed:** Object mask + hand keypoints + proximity analysis.

### 5. No Force Estimation

**Why this limitation exists:** Forces require 3D kinematics, body models, and inverse dynamics.

```
❌ No joint torques
❌ No muscle forces
❌ No ground reaction forces
```

**Requirements:**
- Accurate 3D kinematics
- Body segment masses
- Acceleration data
- Inverse dynamics model (Newton-Euler equations)

### 6. No Occlusion Handling

**Why this limitation exists:** No prediction or interpolation when body parts are hidden.

```
❌ Tracking fails when body parts hidden
❌ No prediction during occlusion
```

**Impact:** Tracking quality degrades when hands/wrists are occluded by body or equipment.

### 7. Camera Angle Dependency

**Why this limitation exists:** 2D projection accuracy varies with viewing angle.

```
❌ Accuracy varies with camera position
❌ Best only when perpendicular to movement plane
```

**Worst case:** Camera parallel to bar movement (can't see vertical motion)  
**Best case:** Camera perpendicular to sagittal plane (side view)

---

## What Can Be Built Upon 🔧

**Description:** Roadmap for extending the current pipeline toward full biomechanics analysis.

### Near-Term Additions (Current Architecture)

**Description:** Features that can be added without major architectural changes.

#### 1. Multi-Camera 3D Reconstruction

**What it adds:** True 3D coordinates through triangulation.

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

**How it works:** Triangulate corresponding points from multiple views to recover depth.

#### 2. Depth Camera Integration (RealSense, Kinect)

**What it adds:** Direct depth measurement per pixel.

```
Difficulty: LOW-MEDIUM
Requires: RGB-D camera

Benefits:
  ✅ Direct depth per pixel
  ✅ Single camera setup
  ✅ Point cloud of scene
```

**How it works:** RGB-D cameras use structured light or time-of-flight to measure depth directly.

#### 3. Object Segmentation (SAM3)

**What it adds:** Actual object boundaries and geometric center calculation.

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

**Current SAM3 exists in:** `/Users/julianng-thow-hing/Desktop/modelhealthdemo/sam3/`

#### 4. Calibration for Real-World Units

**What it adds:** Conversion from pixels to physical measurements.

```
Difficulty: LOW
Requires: Reference object in frame (bar length, plate diameter)

Implementation:
  1. Detect barbell endpoints
  2. Measure pixel distance
  3. Apply known real-world length
  4. Calculate pixels-per-cm scale factor
```

**How it works:** Use known object dimensions (e.g., Olympic bar = 220cm) to establish scale.

### Medium-Term Additions (Architecture Extension)

**Description:** Features requiring significant architectural changes or new libraries.

#### 5. Velocity & Acceleration in 3D

**What it adds:** Full 3D motion analysis.

```
Requires: 3D reconstruction first

v = d(position)/dt
a = d(velocity)/dt

Then:
  - Linear velocity of segments
  - Angular velocity of joints
  - Centripetal acceleration
```

**How it works:** Once 3D positions are available, calculate derivatives for velocity and acceleration.

#### 6. Inverse Kinematics

**What it adds:** Accurate joint angles from 3D pose.

```
Requires: Accurate 3D pose

Pipeline:
  2D Keypoints ─► Lifting to 3D ─► IK Solver ─► Joint Angles

Libraries: OpenSim, Biomechanics Toolkit
```

**How it works:** Use kinematic constraints and optimization to solve for joint angles.

#### 7. Contact Detection

**What it adds:** Identification of where objects contact the body.

```
Requires: Object segmentation + pose

Algorithm:
  1. Get object mask (SAM3)
  2. Get hand keypoints
  3. Check overlap/proximity
  4. Identify contact points
```

**How it works:** Overlay object mask with hand landmarks to find intersection regions.

### Long-Term Additions (Full Biomechanics)

**Description:** Complete biomechanics pipeline requiring specialized modeling tools.

#### 8. Inverse Dynamics

**What it adds:** Joint torques from kinematics.

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

**How it works:** Apply Newton-Euler equations recursively through the kinematic chain.

#### 9. Musculoskeletal Modeling

**What it adds:** Muscle force estimation from joint torques.

```
Requires: Inverse dynamics + muscle model

Tools: OpenSim, AnyBody

Pipeline:
  Joint Torques ─► Muscle Optimization ─► Muscle Forces

Solves: τ = Σ(r_i × F_muscle_i)
```

**How it works:** Optimize muscle activations to match required joint torques.

#### 10. Ground Reaction Force Estimation

**What it adds:** External forces acting on the body.

```
Options:
  A. Force plate (gold standard)
  B. ML estimation from video
  C. Inverse dynamics + known accelerations
```

**How it works:** Measure or estimate forces at contact points (feet/hands).

---

## Accuracy Comparison

**Description:** Expected accuracy improvements with different hardware setups.

| Metric | Current (2D) | With Depth Camera | With Multi-Camera |
|--------|--------------|-------------------|-------------------|
| Position | ±5-10 px | ±1-2 cm | ±0.5-1 cm |
| Velocity | px/s only | cm/s (approx) | cm/s (accurate) |
| Depth | ❌ estimated | ✅ measured | ✅ triangulated |
| Joint angles | ±5-10° | ±3-5° | ±1-3° |
| Real-world | ❌ | ✅ | ✅ |

---

## Recommended Next Steps

**Description:** Prioritized development roadmap.

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
