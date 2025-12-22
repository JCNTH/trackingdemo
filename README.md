# Exercise Tracker

A video-based exercise tracking app that uses computer vision to analyze movement form. Upload a video of your lift, and get insights on bar path, velocity, and joint angles.

## End Goal

```
Center of mass of object → 3D position & velocity → Contact with body
                                    ↓
              Reconstruct kinematics and forces of human body
              (joint angles, joint torques, muscle forces)
```

## Current Capabilities

| Feature | Status | Notes |
|---------|--------|-------|
| 2D Pose Estimation | ✅ Working | 33 keypoints via MediaPipe |
| Bar Tracking | ✅ Working | Wrist midpoint estimation |
| 2D Velocity | ✅ Working | Pixels/second |
| Joint Angles | ✅ Working | Dot product formula |
| Rep Counting | ✅ Working | Midpoint crossing |
| 3D Reconstruction | ❌ Not Yet | Requires multi-camera or depth |
| Real-World Units | ❌ Not Yet | Requires calibration |
| Force Estimation | ❌ Not Yet | Requires 3D + dynamics |

**See [`backend/CAPABILITIES.md`](backend/CAPABILITIES.md) for full details on limitations and roadmap.**

## What It Does

- **Upload exercise videos** - supports bench press, squat, deadlift, overhead press
- **Track bar path** - estimates bar position from wrist landmarks
- **Calculate velocity** - measures movement speed in pixels/second  
- **Analyze form** - rule-based feedback on elbow angles, bar path verticality

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15, Tailwind CSS, shadcn/ui |
| Backend | FastAPI, Python 3.10+ |
| CV | MediaPipe Pose, YOLO v8/v11 |
| Database | Supabase (PostgreSQL + Storage) |

## How It Works

The pipeline extracts 33 body keypoints per frame using MediaPipe, then tracks the bar position by calculating the midpoint between wrist landmarks.

```
Video → Pose Estimation → Bar Tracking → Velocity Calculation → Metrics
         (MediaPipe)        (wrist midpoint)   (dx/dt)
```

**Full technical documentation:** [`backend/PIPELINE.md`](backend/PIPELINE.md)

## Key Limitations (Single Camera)

| Limitation | Impact | Solution |
|------------|--------|----------|
| **No true depth** | Can't measure Z-axis | Multi-camera or depth sensor |
| **Pixel units only** | No real-world m/s | Calibration with known object |
| **No object segmentation** | Can't find true center of mass | SAM3 integration |
| **No force estimation** | Can't calculate joint torques | 3D + inverse dynamics |
| **Camera angle dependent** | Best perpendicular to movement | Multi-view setup |

## Backend Services

| File | Purpose |
|------|---------|
| `trajectory_tracker.py` | Main pipeline orchestration |
| `pose_estimator.py` | MediaPipe pose detection (33 keypoints) |
| `barbell_detector.py` | Bar position estimation + smoothing |
| `form_analyzer.py` | Rule-based form analysis |
| `yolo_detector.py` | YOLO object detection |
| `yolo_pose_estimator.py` | YOLO-Pose single-pass detection |

## Metrics Calculated

| Metric | Formula | Unit |
|--------|---------|------|
| `peak_concentric_velocity` | max(-dy/dt) | px/s |
| `peak_eccentric_velocity` | max(dy/dt) | px/s |
| `vertical_displacement` | max(y) - min(y) | px |
| `path_verticality` | 1 - (Δx / Δy) | 0-1 |
| `estimated_reps` | midpoint crossings | count |
| `elbow_angle` | arccos(v1·v2 / \|v1\|\|v2\|) | degrees |

## Setup

### Prerequisites

- Node.js 18+
- Python 3.10+ with Conda (recommended) or pip
- Supabase account

### 1. Clone and install

```bash
git clone https://github.com/JCNTH/trackingdemo.git
cd trackingdemo
```

### 2. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Backend

```bash
cd backend
conda env create -f environment.yml
conda activate exercise-tracker
```

Create `backend/.env`:
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 4. Run

```bash
# Terminal 1 - Frontend
cd frontend && npm run dev

# Terminal 2 - Backend  
cd backend && python run.py
```

Open http://localhost:3000

## Project Structure

```
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js pages
│   │   ├── components/     # React components
│   │   └── lib/            # API client, utilities
│   
├── backend/
│   ├── src/
│   │   ├── routers/        # FastAPI endpoints
│   │   ├── services/       # CV pipeline (pose, tracking)
│   │   └── db/             # Supabase client
│   ├── PIPELINE.md         # Technical documentation
│   └── CAPABILITIES.md     # Limitations & roadmap
│
├── sam3/                   # SAM3 model (for future segmentation)
```

## Future Roadmap

```
Current State                    Near-Term                      Long-Term
─────────────────────────────────────────────────────────────────────────────
2D Pose + Bar Tracking    →    Object Segmentation (SAM3)  →  3D Reconstruction
         ↓                              ↓                            ↓
Pixel Velocities          →    Calibration (real units)    →  Inverse Dynamics
         ↓                              ↓                            ↓
Joint Angles              →    Contact Point Detection     →  Muscle Force Est.
```

## References

- [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- [Velocity Based Training Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC7866505/)
- [OpenCap](https://github.com/stanfordnmbl/opencap-core) - inspiration for architecture
- [OpenSim](https://opensim.stanford.edu/) - musculoskeletal modeling

## License

MIT
