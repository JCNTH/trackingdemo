# Exercise Tracker

A video-based exercise tracking app that uses computer vision to analyze movement form. Upload a video of your lift, and get insights on bar path, velocity, and joint angles.

## What It Does

- **Upload exercise videos** - supports bench press, squat, deadlift, overhead press
- **Track bar path** - estimates bar position from wrist landmarks
- **Calculate velocity** - measures movement speed in pixels/second  
- **Analyze form** - rule-based feedback on elbow angles, bar path verticality, etc.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15, Tailwind CSS, shadcn/ui |
| Backend | FastAPI, Python 3.10+ |
| CV | MediaPipe Pose, YOLO v8/v11 |
| Database | Supabase (PostgreSQL + Storage) |

## How It Works

The pipeline extracts 33 body keypoints per frame using MediaPipe, then tracks the bar position by calculating the midpoint between wrist landmarks. See [`backend/PIPELINE.md`](backend/PIPELINE.md) for the full technical breakdown.

```
Video → Pose Estimation → Bar Tracking → Velocity Calculation → Metrics
         (MediaPipe)        (wrist midpoint)   (dx/dt)
```

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
│   └── PIPELINE.md         # Technical documentation
```

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

| Metric | Description |
|--------|-------------|
| `peak_concentric_velocity` | Max upward speed (px/s) |
| `peak_eccentric_velocity` | Max downward speed (px/s) |
| `vertical_displacement` | Total range of motion (px) |
| `path_verticality` | 0-1 score (1 = perfectly vertical) |
| `estimated_reps` | Count of lift cycles |
| `elbow_asymmetry` | Difference between left/right elbow angles |

## Limitations

- Single camera setup means no true depth measurement
- Velocity is in pixels/second (not cm/s) without calibration
- Works best when camera is perpendicular to movement plane

## References

- [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- [Velocity Based Training Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC7866505/)
- [OpenCap](https://github.com/stanfordnmbl/opencap-core) - inspiration for architecture

## License

MIT
