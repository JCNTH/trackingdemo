# Capabilities & Limitations

Current capabilities, limitations, and roadmap.

---

## End Goal

Complete biomechanics analysis system:
- Object center of mass tracking (3D position, velocity)
- Contact point detection
- Full body kinematics
- Joint torques (inverse dynamics)
- Muscle forces (musculoskeletal modeling)

Similar to OpenCap (Stanford) or OpenSim, but focused on weightlifting.

---

## Current Capabilities ✅

### 1. 2D Pose Estimation

MediaPipe extracts 33 body keypoints per frame. Runs at ~30fps on CPU.

```
✅ 33 body keypoints
✅ Normalized coordinates [0-1]
✅ Visibility/confidence scores
```

Landmarks: Face (0-10), Upper body (11-22), Lower body (23-32)

**Z-axis:** MediaPipe estimates depth from a statistical model trained on human poses. Z is relative to hip center, smaller = closer. This is an estimate, not a measurement. Single cameras cannot measure depth directly.

### 2. 2D Bar Tracking

Wrist positions estimate barbell location. Bar is gripped ~18% past wrist along forearm direction.

```
✅ Wrist midpoint estimation
✅ Forearm-extended grip (18%)
✅ EMA smoothing (α=0.5)
✅ Jump rejection (>500px)
```

Process:
1. Detect wrists (landmarks 15, 16)
2. Extend 18% past wrist along forearm
3. Midpoint of both grips = bar center
4. Smooth with EMA
5. Reject jumps >500px

Works well for bench press. Falls back to simpler methods if wrists are occluded.

### 3. 2D Velocity Metrics

Velocity = change in position / change in time. Units: pixels/second.

```
✅ Frame-to-frame velocity
✅ Peak concentric (upward)
✅ Peak eccentric (downward)
✅ Average speed
```

Formula:
```python
dx = x[i] - x[i-1]
dy = y[i] - y[i-1]
dt = frame_diff / fps
velocity = sqrt(dx² + dy²) / dt
```

Y-axis increases downward. When bar moves up, dy is negative. Sign flipped (`vertical_velocity = -dy/dt`) so positive = upward.

### 4. Joint Angles

Dot product formula calculates angles from three points.

```
✅ Elbow angles (shoulder→elbow→wrist)
✅ Knee angles (hip→knee→ankle)
✅ Hip angles
✅ Left/right asymmetry
```

Formula:
```python
v1 = [p1.x - p2.x, p1.y - p2.y]
v2 = [p3.x - p2.x, p3.y - p2.y]
angle = arccos(v1·v2 / |v1||v2|)
```

### 5. Rep Counting

Tracks midpoint crossings going upward.

```
✅ Automatic rep detection
✅ Midpoint crossing algorithm
```

Works for repetitive movements. Fails if movement is irregular or includes pauses.

### 6. Form Analysis

Rule-based scoring on bar path and joint symmetry.

```
✅ Path verticality scoring
✅ Elbow symmetry scoring
✅ Basic recommendations
```

Good bar path: verticality > 0.7. Good symmetry: elbow asymmetry < 10°.

---

## Limitations ❌

### 1. No True 3D Reconstruction

Single cameras capture 2D images. Depth information is lost.

```
❌ Single camera = no depth measurement
```

**Why:** 2D projection loses Z-axis. MediaPipe Z is estimated from statistical models, not measured.

**Impact:**
- No true 3D object positions
- No real-world velocities (m/s) without calibration
- Movement parallel to camera is invisible

**Why overcome:** True 3D is required for:
- Accurate joint torque calculations (inverse dynamics needs 3D kinematics)
- Muscle force estimation (musculoskeletal models require 3D joint angles)
- Complete biomechanics analysis (cannot calculate forces from 2D alone)
- Movement analysis from any angle (current setup only works perpendicular to camera)

### 2. No Real-World Units

All measurements in pixels, not cm/m.

```
❌ Pixels only, no calibration
```

**Current:** 340 px/s  
**Needed:** 0.85 m/s

**Solution:** Detect reference object (e.g., barbell = 220cm) to establish scale.

**Why overcome:** Real-world units enable:
- Comparison across videos (different cameras, distances, resolutions)
- Matching research standards (velocity-based training uses m/s, not px/s)
- Actionable feedback (athletes need "0.85 m/s" not "340 px/s")
- Integration with biomechanics tools (OpenSim, force plates use real units)

### 3. No Center of Mass Estimation

Wrist midpoint is used as proxy. No actual object detection.

```
❌ No object segmentation
❌ No geometric center calculation
```

**Current:** Wrist midpoint proxy  
**Needed:** Object segmentation (SAM3) for actual boundaries

**Why overcome:** True center of mass enables:
- Accurate object tracking independent of body pose
- Proper physics calculations (forces act on center of mass, not wrist)
- Analysis of object dynamics (rotation, moment of inertia)
- Contact point detection (where object touches body)

### 4. No Contact Point Detection

Cannot determine where object contacts body.

```
❌ No grip position detection
❌ No contact point analysis
```

**Needed:** Object mask + hand keypoints + overlap analysis

**Why overcome:** Contact points are needed for:
- Accurate force calculations (forces act at contact points)
- Grip width analysis (affects muscle activation patterns)
- Hand position feedback (critical for form correction)
- Complete biomechanics model (contact forces are inputs to inverse dynamics)

### 5. No Force Estimation

Forces require 3D kinematics, body models, and inverse dynamics.

```
❌ No joint torques
❌ No muscle forces
❌ No ground reaction forces
```

**Requirements:**
- Accurate 3D kinematics
- Body segment masses
- Acceleration data
- Inverse dynamics (Newton-Euler)

**Why overcome:** Force estimation is the end goal:
- Joint torques reveal loading patterns and injury risk
- Muscle forces show which muscles are working (training optimization)
- Ground reaction forces quantify external loading
- Enables complete biomechanics analysis (kinematics → dynamics → forces)

### 6. No Occlusion Handling

Tracking fails when body parts are hidden.

```
❌ No prediction during occlusion
❌ No interpolation
```

**Solution:** Kalman filters or LSTM networks (not implemented)

**Why overcome:** Continuous tracking is essential:
- Complete movement analysis (cannot miss critical phases)
- Accurate velocity calculations (gaps create errors)
- Reliable biomechanics (forces need continuous kinematics)
- Real-world usability (occlusion is common in gym settings)

### 7. Camera Angle Dependency

Accuracy varies with camera position.

```
❌ Best when perpendicular to movement
❌ Poor when parallel to movement
```

**Best:** Side view (perpendicular to sagittal plane)  
**Worst:** Parallel to bar movement

**Why overcome:** Flexible camera placement enables:
- Real-world deployment (users cannot always position camera perfectly)
- Multi-angle analysis (different views reveal different aspects)
- Robust system (works regardless of setup constraints)
- Professional applications (gyms need flexible installation)

---

## Roadmap 🔧

### Near-Term

**Multi-Camera 3D:** Add second camera, use triangulation for true 3D coordinates.

**Depth Camera:** RGB-D camera (RealSense, Kinect) for direct depth measurement.

**SAM3 Integration:** Object segmentation for actual boundaries and center of mass.

**Calibration:** Detect reference object to convert pixels to real-world units.

### Medium-Term

**3D Velocity/Acceleration:** Once 3D positions available, calculate full 3D motion.

**Inverse Kinematics:** Solve for joint angles from 3D pose using kinematic constraints.

**Contact Detection:** Overlay object masks with hand keypoints to find contact points.

### Long-Term

**Inverse Dynamics:** Calculate joint torques from kinematics (Newton-Euler equations).

**Musculoskeletal Modeling:** Estimate muscle forces from joint torques (OpenSim, AnyBody).

**Ground Reaction Forces:** Measure or estimate forces at contact points.

---

## Accuracy Comparison

| Metric | Current (2D) | Depth Camera | Multi-Camera |
|--------|--------------|--------------|--------------|
| Position | ±5-10 px | ±1-2 cm | ±0.5-1 cm |
| Velocity | px/s only | cm/s (approx) | cm/s (accurate) |
| Depth | ❌ estimated | ✅ measured | ✅ triangulated |
| Joint angles | ±5-10° | ±3-5° | ±1-3° |
| Real-world | ❌ | ✅ | ✅ |

---

## Next Steps

**Priority 1:** Calibration system (real-world units)  
**Priority 2:** SAM3 integration (object segmentation)  
**Priority 3:** Multi-camera or depth camera (true 3D)  
**Priority 4:** Inverse dynamics (joint forces)
