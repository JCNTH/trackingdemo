# What We Can Do, What We Can't, and Where We're Headed

This document breaks down the current capabilities, limitations, and future roadmap for the exercise tracking pipeline.

---

## The Big Picture: Where We Want to Go

Eventually, we want to build a complete biomechanics analysis system. Think of it like OpenCap or OpenSim, but focused on weightlifting. Here's what that would look like:

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

Projects like [OpenCap](https://github.com/stanfordnmbl/opencap-core) from Stanford are already doing this with multiple cameras. We're starting simpler with a single camera setup, but the goal is similar.

---

## What We Can Do Right Now ✅

Here's what's actually working in the current implementation:

### 1. 2D Pose Estimation

We use MediaPipe to extract 33 body keypoints from each frame. It's pretty reliable and runs fast - we can process videos at around 30fps on a decent CPU.

```
✅ 33 body keypoints per frame (MediaPipe)
✅ Normalized coordinates [0-1]
✅ Visibility/confidence scores
✅ Works in real-time (~30fps on CPU)
```

The landmarks we get include:
- Face (0-10): nose, eyes, ears, mouth
- Upper body (11-22): shoulders, elbows, wrists, hands
- Lower body (23-32): hips, knees, ankles, feet

**About the Z coordinate:** MediaPipe gives us a depth estimate, but it's not a real measurement. They trained a statistical model on thousands of human poses, and it guesses depth based on learned patterns of body proportions and perspective cues. The Z value is relative to the hip center (which acts as the origin), with smaller values meaning closer to the camera. It's useful for relative comparisons (like "is the left arm closer than the right?"), but don't trust it for absolute measurements. Single cameras physically cannot measure depth - they can only infer it, and the accuracy isn't great.

### 2. 2D Bar Tracking

Since we can't directly detect the barbell (it's too thin and often occluded), we estimate its position from wrist landmarks. The key insight is that when gripping a bar, your hands are slightly above your wrists - about 18% of the forearm length past the wrist joint.

```
✅ Bar position from wrist midpoint
✅ Forearm-extended grip estimation
✅ Smoothing (EMA α=0.5)
✅ Jump rejection for outliers
✅ Multiple fallback methods
```

How it works:
1. We detect wrist positions (landmarks 15, 16)
2. Extend 18% past the wrist along the forearm direction (from elbow to wrist)
3. Calculate the midpoint of both estimated grip positions
4. Apply exponential moving average smoothing to reduce noise
5. Reject any jumps larger than 500px as outliers (probably detection errors)

This approach works pretty well for bench press, but it's not perfect. If wrists are occluded or the grip is unusual, we fall back to simpler methods.

### 3. 2D Velocity Metrics

We calculate velocity the straightforward way - change in position divided by change in time. Since we're working in pixels, the units are pixels per second.

```
✅ Frame-to-frame velocity (pixels/second)
✅ Peak concentric velocity (upward)
✅ Peak eccentric velocity (downward)
✅ Average speed
```

The formula is just:
```python
dx = x[i] - x[i-1]
dy = y[i] - y[i-1]
dt = frame_diff / fps
velocity = sqrt(dx² + dy²) / dt  # px/s
```

One gotcha: image coordinates have Y increasing downward (y=0 is at the top), so when the bar moves up, dy is negative. We flip the sign (`vertical_velocity = -dy/dt`) so positive values mean upward movement, which is more intuitive.

### 4. Joint Angle Calculation

We calculate joint angles using the dot product formula. Given three points (like shoulder, elbow, wrist), we can find the angle at the middle point.

```
✅ Elbow angles (shoulder→elbow→wrist)
✅ Knee angles (hip→knee→ankle)
✅ Hip angles (shoulder→hip→knee)
✅ Asymmetry detection (left vs right)
```

The math is:
```python
v1 = [p1.x - p2.x, p1.y - p2.y]
v2 = [p3.x - p2.x, p3.y - p2.y]
angle = arccos(v1·v2 / |v1||v2|)
```

This gives us angles in degrees, which is useful for form analysis. We can compare left vs right to detect asymmetry.

### 5. Rep Counting

We detect reps by tracking when the bar crosses the midpoint of its vertical range going upward. It's a simple state machine - we check if the bar was below the midpoint and is now above it.

```
✅ Automatic rep detection
✅ Midpoint crossing algorithm
✅ Works for repetitive movements
```

This works reasonably well for exercises with clear up/down cycles, but it can get confused if the movement is irregular or if there are pauses.

### 6. Form Analysis (Rule-Based)

We have a basic form scoring system that looks at bar path quality and joint symmetry. It's pretty simple - we check if the bar path is vertical enough and if the elbows are symmetric.

```
✅ Path verticality scoring
✅ Elbow symmetry scoring
✅ Basic form recommendations
```

The scoring is rule-based (not ML), so it's transparent but limited. A good bar path has verticality > 0.7, and good symmetry means elbow asymmetry < 10°.

---

## What We Can't Do (Yet) ❌

Here are the limitations we're working with:

### 1. No True 3D Reconstruction

This is the big one. Single cameras capture 2D images, and depth information is lost in that projection. It's like trying to figure out how far away something is from a single photo - you can make educated guesses based on size and perspective, but you can't actually measure it.

```
❌ FUNDAMENTAL LIMITATION: Single camera = no depth
```

**Why this happens:**
- A single 2D image loses the Z-axis (depth) information
- MediaPipe's Z-coordinate is **estimated** using statistical models, not measured
- The Z value is relative to hip depth, not absolute meters
- Estimation accuracy degrades with unusual poses or camera angles

**What this means:**
- We can't calculate true 3D position of objects
- We can't get real-world velocities (m/s) without calibration
- Movement parallel to the camera is invisible

Think of it like this: if someone moves the bar directly toward or away from the camera, we can't see that movement. We only see movement perpendicular to the camera.

### 2. No Real-World Units

Everything is in pixels right now. To convert to real-world units (like meters per second), we'd need a calibration reference - something of known size in the frame.

```
❌ All measurements in PIXELS, not cm/m
```

**Current output:** 340 px/s  
**What we need:** 0.85 m/s

To fix this, we'd need to:
```python
# Detect a reference object of known size
bar_length_pixels = 400
bar_length_cm = 220  # Olympic bar is 220cm
scale = bar_length_cm / bar_length_pixels  # cm/px

velocity_cms = velocity_pxs * scale
```

This is actually pretty doable - we just haven't implemented it yet.

### 3. No Center of Mass Estimation

Right now, we're using wrist midpoint as a proxy for bar position. But we're not actually detecting the barbell itself - we're just guessing where it is based on hand positions.

```
❌ Cannot estimate geometric center of object
❌ Cannot track object independently of body
```

**What we're doing:** Using wrist midpoint as proxy  
**What we need:** Actual object segmentation to get real boundaries and calculate geometric center

This is where SAM3 (Segment Anything Model) would come in handy. We have the model in the repo (`sam3/`), but haven't integrated it yet.

### 4. No Contact Point Detection

We can't tell where exactly the bar contacts the body or where the hands grip it. We'd need object segmentation plus detailed hand pose analysis.

```
❌ Cannot determine where object contacts body
❌ Cannot detect grip position on bar
```

This would require overlaying object masks with hand keypoints and finding intersection regions.

### 5. No Force Estimation

Forces require a lot more than we have right now. You need accurate 3D kinematics, body segment masses, acceleration data, and inverse dynamics models.

```
❌ No joint torques
❌ No muscle forces
❌ No ground reaction forces
```

This is the long-term goal. Tools like OpenSim can do this, but they need:
- Accurate 3D kinematics (we only have 2D)
- Body segment masses (from anthropometric models)
- Acceleration data (second derivative of position)
- Inverse dynamics (Newton-Euler equations)

### 6. No Occlusion Handling

When body parts get hidden (like when the bar blocks the wrists), tracking fails. We don't have any prediction or interpolation.

```
❌ Tracking fails when body parts hidden
❌ No prediction during occlusion
```

This is a common problem in computer vision. Some approaches use Kalman filters or LSTM networks to predict during occlusion, but we haven't implemented that.

### 7. Camera Angle Dependency

The accuracy varies a lot depending on camera position. We get the best results when the camera is perpendicular to the movement plane (side view).

```
❌ Accuracy varies with camera position
❌ Best only when perpendicular to movement plane
```

**Worst case:** Camera parallel to bar movement (can't see vertical motion)  
**Best case:** Camera perpendicular to sagittal plane (side view)

This is why multi-camera setups (like OpenCap uses) are so much better - they can handle movement from any angle.

---

## What We're Planning to Add 🔧

Here's the roadmap for extending the pipeline:

### Near-Term (Doable Soon)

These are features we can add without major architectural changes:

#### 1. Multi-Camera 3D Reconstruction

Add a second camera and use triangulation to get true 3D coordinates. This is what OpenCap does.

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

#### 2. Depth Camera Integration

Use an RGB-D camera (like Intel RealSense or Kinect) to get direct depth measurements. Single camera setup, but with real depth data.

```
Difficulty: LOW-MEDIUM
Requires: RGB-D camera

Benefits:
  ✅ Direct depth per pixel
  ✅ Single camera setup
  ✅ Point cloud of scene
```

#### 3. Object Segmentation (SAM3)

We already have SAM3 in the repo. We just need to integrate it to get actual object boundaries.

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

#### 4. Calibration for Real-World Units

Add a calibration step where we detect a reference object (like the barbell) and use its known size to establish scale.

```
Difficulty: LOW
Requires: Reference object in frame (bar length, plate diameter)

Implementation:
  1. Detect barbell endpoints
  2. Measure pixel distance
  3. Apply known real-world length
  4. Calculate pixels-per-cm scale factor
```

### Medium-Term (Bigger Changes)

These require more significant work:

#### 5. Velocity & Acceleration in 3D

Once we have 3D positions, we can calculate full 3D motion.

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

Use kinematic constraints to solve for joint angles from 3D pose.

```
Requires: Accurate 3D pose

Pipeline:
  2D Keypoints ─► Lifting to 3D ─► IK Solver ─► Joint Angles

Libraries: OpenSim, Biomechanics Toolkit
```

#### 7. Contact Detection

Overlay object masks with hand keypoints to find where contact happens.

```
Requires: Object segmentation + pose

Algorithm:
  1. Get object mask (SAM3)
  2. Get hand keypoints
  3. Check overlap/proximity
  4. Identify contact points
```

### Long-Term (Full Biomechanics)

This is the end goal - complete biomechanics analysis:

#### 8. Inverse Dynamics

Calculate joint torques from kinematics using Newton-Euler equations.

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

Estimate muscle forces from joint torques. This is what OpenSim does.

```
Requires: Inverse dynamics + muscle model

Tools: OpenSim, AnyBody

Pipeline:
  Joint Torques ─► Muscle Optimization ─► Muscle Forces

Solves: τ = Σ(r_i × F_muscle_i)
```

#### 10. Ground Reaction Force Estimation

Measure or estimate forces at contact points (feet/hands).

```
Options:
  A. Force plate (gold standard)
  B. ML estimation from video
  C. Inverse dynamics + known accelerations
```

---

## Expected Accuracy Improvements

Here's what we'd expect with different setups:

| Metric | Current (2D) | With Depth Camera | With Multi-Camera |
|--------|--------------|-------------------|-------------------|
| Position | ±5-10 px | ±1-2 cm | ±0.5-1 cm |
| Velocity | px/s only | cm/s (approx) | cm/s (accurate) |
| Depth | ❌ estimated | ✅ measured | ✅ triangulated |
| Joint angles | ±5-10° | ±3-5° | ±1-3° |
| Real-world | ❌ | ✅ | ✅ |

Multi-camera setups (like OpenCap) are the gold standard, but depth cameras are a good middle ground.

---

## Next Steps

**For the demo:**
1. Show what we can do - 2D tracking works pretty well
2. Be honest about limitations - single camera has constraints
3. Show the roadmap - here's how we get to full biomechanics

**For development:**
```
Priority 1: Calibration system (get real-world units)
Priority 2: SAM3 integration (object segmentation)
Priority 3: Multi-camera or depth camera (true 3D)
Priority 4: Inverse dynamics (joint forces)
```

The path forward is pretty clear - we're following in the footsteps of projects like OpenCap and OpenSim, just starting from a simpler single-camera foundation.
