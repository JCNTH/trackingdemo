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

### 3. Person Segmentation ✅ (IMPLEMENTED)

YOLO11n-seg provides person segmentation with center of mass calculation.

```
✅ Person segmentation (binary mask)
✅ Center of mass (geometric centroid)
✅ Bounding box and confidence
```

**Model:** YOLO11n-seg (5.9 MB, ~30ms/frame on CPU)
**Source:** https://docs.ultralytics.com/tasks/segment/

**Current capabilities:**
- Binary segmentation mask of athlete's body
- Geometric center of mass from mask
- Per-frame body tracking

**Remaining limitation:** 
COCO dataset doesn't include "barbell" class, so we still use wrist-based estimation for bar position. Future work: fine-tune on weightlifting data.

### 4. Click-to-Track Segmentation 🆕 (IMPLEMENTED)

User can click on any object (e.g., barbell) in the first frame and track it throughout the video.

```
✅ Click-based object selection
✅ SAM2 initial segmentation
✅ Template-based tracking
```

**Approach:** Hybrid (SAM2 + lightweight tracking)
- Frame 1: SAM2 segments clicked object (~26 seconds on CPU)
- Frames 2-N: Template tracking propagates position (~30ms/frame)

**Source:** https://docs.ultralytics.com/models/sam-2/

**Why hybrid?**
SAM2 is extremely accurate but slow on CPU:
| Model      | CPU Speed     |
|------------|---------------|
| SAM2-tiny  | 25,997 ms     |
| YOLO11n-seg| 30 ms         |

A 30-second video (900 frames):
- Pure SAM2: 900 × 26s = **6.5 hours**
- Hybrid: 26s + (899 × 0.03s) = **53 seconds**

**Current capabilities:**
- Click anywhere on barbell in frame 1
- Get precise initial segmentation
- Track bounding box through video
- Calculate center of mass per frame

**Limitations:**
- Template tracking can lose object during fast motion or occlusion
- No automatic re-detection when tracking is lost
- SAM2 first frame takes ~26 seconds on CPU

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

**~~SAM3 Integration~~** → **SAM2 Click-to-Track:** ✅ IMPLEMENTED
- Click on any object (barbell) in first frame
- Track throughout video using hybrid approach
- Source: `click_to_track_service.py`

**Calibration:** Detect reference object to convert pixels to real-world units.

**GPU Acceleration:** Enable full SAM2 video mode for real-time tracking (requires GPU).

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
**Priority 2:** ✅ Person segmentation (YOLO11n-seg) - IMPLEMENTED  
**Priority 3:** ✅ Click-to-track barbell segmentation (SAM2 hybrid) - IMPLEMENTED  
**Priority 4:** Frontend UI for click-to-track (let user select object)  
**Priority 5:** Multi-camera or depth camera (true 3D)  
**Priority 6:** Inverse dynamics (joint forces)  
**Priority 7:** GPU acceleration for full SAM2 video mode
