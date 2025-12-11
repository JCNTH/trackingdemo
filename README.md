# Exercise Tracker MVP

Video-based exercise tracking with YOLO object detection and MediaPipe pose estimation. Upload exercise videos, process them to extract 2D trajectories, and visualize movement patterns.

## Tech Stack

- **Frontend:** Next.js 15, Tailwind CSS, React Query, Radix UI
- **Backend:** FastAPI, YOLO v8, MediaPipe, OpenCV
- **Database:** Supabase (PostgreSQL + Storage)

## Project Structure

```
modelhealthdemo/
├── frontend/           # Next.js app
│   ├── src/
│   │   ├── app/       # Pages and layouts
│   │   ├── components/# UI components
│   │   ├── lib/       # Utilities and API client
│   │   └── types/     # TypeScript types
│   └── package.json
├── backend/           # FastAPI app
│   ├── src/
│   │   ├── routers/   # API endpoints
│   │   ├── services/  # YOLO, MediaPipe, tracking
│   │   └── db/        # Supabase client
│   ├── environment.yml # Conda environment
│   └── requirements.txt
└── supabase/          # Database config
```

## Setup

### 1. Frontend Setup

```bash
cd frontend
npm install
```

Create `.env.local` with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://vcsxvrueuwyyhxygfois.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

Start the development server:

```bash
npm run dev
```

### 2. Backend Setup (Conda)

```bash
cd backend
conda env create -f environment.yml
conda activate exercise-tracker
```

Create `.env` with your Supabase credentials:

```env
SUPABASE_URL=https://vcsxvrueuwyyhxygfois.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Start the FastAPI server:

```bash
python run.py --reload
```

Or without auto-reload:
```bash
python run.py
```

**Alternative (pip/venv):**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Database Schema

The database schema has been automatically created via Supabase MCP. Tables:

- `videos` - Video metadata and processing status
- `detection_results` - Per-frame object and pose detections
- `tracking_sessions` - Aggregated trajectory data

Storage bucket `videos` has been created for video uploads.

## Features

- **Video Upload:** Drag-and-drop or click to upload MP4 videos
- **Object Detection:** YOLO v8 detects objects (people, sports equipment)
- **Pose Estimation:** MediaPipe extracts 33 body landmarks per frame
- **Trajectory Visualization:** Canvas overlay shows movement paths
- **Data Export:** Download tracking data as JSON or CSV

## API Endpoints

### Videos
- `GET /api/videos/{id}` - Get video details
- `GET /api/videos/{id}/status` - Get processing status
- `POST /api/videos/{id}/process` - Start video processing
- `GET /api/videos/{id}/detections` - Get detection results
- `GET /api/videos/{id}/export` - Export tracking data

### Processing
- `GET /api/processing/status/{id}` - Detailed processing status
- `GET /api/processing/supported-objects` - List detectable objects
- `GET /api/processing/pose-landmarks` - Pose landmark definitions

## Development

### Running Both Services

Terminal 1 (Frontend):
```bash
cd frontend && npm run dev
```

Terminal 2 (Backend):
```bash
cd backend && python run.py --reload
```

The frontend proxies `/api/py/*` requests to the backend at `http://localhost:8000`.

## License

MIT

