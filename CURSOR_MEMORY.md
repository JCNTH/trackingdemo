# CURSOR_MEMORY - Model Health Demo

> **Purpose**: This file captures lessons, patterns, and architectural decisions for the modelhealthdemo project to guide future coding sessions.

---

## 📋 Project Overview

**Name**: Exercise Tracker MVP (Model Health Demo)  
**Type**: Video-based exercise/movement analysis platform  
**Purpose**: Upload exercise videos, process them with computer vision to extract 2D trajectories, visualize movement patterns, and provide AI-powered form analysis.

### Related Projects (Styling/Pattern References)
- **new-medicly-1**: CMU Hacks 2025 winner - AI-powered physical therapy analysis platform (same domain)
- **auctor-dev**: Enterprise SaaS product with polished UI components and design system

---

## 🛠 Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 15 | React framework (App Router) |
| React | 18+ | UI library |
| TypeScript | 5+ | Type safety |
| Tailwind CSS | 3.x | Utility-first styling |
| Radix UI | - | Accessible primitives (via shadcn/ui) |
| React Query | 5.x | Data fetching, caching |
| Lucide React | - | Icons |
| Sonner | - | Toast notifications |

### Backend
| Technology | Purpose |
|------------|---------|
| FastAPI | Python web framework |
| YOLO v8 | Object detection (barbell, people) |
| MediaPipe | Pose estimation (33 body landmarks) |
| OpenCV | Video/image processing |
| Anthropic Claude | AI form analysis (Haiku model) |

### Database & Storage
| Service | Purpose |
|---------|---------|
| Supabase | PostgreSQL database + file storage |
| Bucket: `videos` | Video file storage |

### Database Schema (Supabase PostgreSQL)

#### `videos` table - Main video metadata
```sql
id              uuid        -- PK, auto-generated
filename        text        -- Original filename
storage_path    text        -- Supabase storage path
status          enum        -- pending, processing, completed, failed
duration        float       -- Video duration (seconds)
width           int         -- Width in pixels
height          int         -- Height in pixels  
fps             float       -- Frames per second
error_message   text        -- Error details if failed
exercise_type   text        -- NEW: bench_press, squat, deadlift, overhead_press, row, other
detected_weight numeric     -- NEW: AI-detected weight (e.g., 225)
weight_unit     text        -- NEW: 'lbs' (default) or 'kg'
created_at      timestamptz -- Upload timestamp
updated_at      timestamptz -- Last modified
```

#### `detection_results` table - Per-frame detection data
```sql
id              uuid        -- PK
video_id        uuid        -- FK → videos.id
frame_number    int         -- Frame index
timestamp       float       -- Time in video
objects         jsonb       -- YOLO detected objects
pose_landmarks  jsonb       -- MediaPipe 33 landmarks
created_at      timestamptz
```

#### `tracking_sessions` table - Aggregated tracking data
```sql
id              uuid        -- PK
video_id        uuid        -- FK → videos.id
object_count    int         -- Objects detected
has_pose        bool        -- Whether pose was found
trajectory_data jsonb       -- Bar path, velocity, joint angles
created_at      timestamptz
updated_at      timestamptz
```

#### Migrations Applied
1. `20251204190018_create_exercise_tracker_schema` - Original schema
2. `add_exercise_type_and_weight_columns` - Added exercise_type, detected_weight, weight_unit

---

## 🎨 UI/UX Design System

### Color Theme: Emerald Green
The project uses an emerald/health-focused color palette:

```css
/* Primary - Dark Emerald */
--primary: 164 43% 26%;        /* #047857 */

/* Emerald Scale */
--color-emerald-50: 167 45% 96%;
--color-emerald-500: 164 39% 41%;
--color-emerald-600: 164 42% 33%;
--color-emerald-700: 164 43% 26%;

/* Surfaces */
--background: 0 0% 98%;         /* #FAFAFA */
--card: 0 0% 100%;              /* White cards */
--muted: 165 20% 96%;           /* Soft green-gray */

/* Status Colors */
--success: Emerald
--warning: Amber (#f59e0b)
--destructive: Red
```

### Design Principles (Following Industry Best Practices)
1. **Minimalist & Clean**: Reduce cognitive load, focus on data
2. **Semantic Colors**: Green=success, Amber=warning/processing, Red=error
3. **Accessible**: High contrast, clear typography
4. **Healthcare-Appropriate**: Calming emerald tones convey trust
5. **Dark Mode Support**: Implemented with CSS variables

### Component Patterns (shadcn/ui)
```tsx
// Use these component imports consistently:
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
```

### Typography
- Base font size: 14px
- Font family: System fonts (-apple-system, BlinkMacSystemFont, etc.)
- Letter spacing: -0.01em
- Line height: 1.6

### Border Radius
```css
--radius: 0.625rem;  /* Slightly rounded, modern feel */
```

---

## 📁 Project Structure

```
modelhealthdemo/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Home - video gallery
│   │   │   ├── layout.tsx            # Root layout
│   │   │   ├── globals.css           # Design tokens
│   │   │   ├── videos/[id]/page.tsx  # Video detail/analysis
│   │   │   └── api/videos/route.ts   # API route
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn primitives
│   │   │   ├── VideoPlayer.tsx       # Video playback
│   │   │   ├── VideoUpload.tsx       # Upload widget
│   │   │   ├── TrajectoryCanvas.tsx  # Canvas overlay for tracking
│   │   │   ├── MovementMetrics.tsx   # Analysis display
│   │   │   ├── CalibrationStep.tsx   # Person selection
│   │   │   └── DataExport.tsx        # JSON/CSV export
│   │   ├── lib/
│   │   │   ├── api.ts                # API client
│   │   │   ├── utils.ts              # cn() helper
│   │   │   └── supabase/client.ts    # Supabase client
│   │   └── types/
│   │       ├── index.ts              # TypeScript types
│   │       └── database.ts           # DB types
│   └── tailwind.config.js
├── backend/
│   ├── src/
│   │   ├── main.py                   # FastAPI app
│   │   ├── routers/
│   │   │   ├── videos.py             # Video CRUD
│   │   │   └── processing.py         # Processing endpoints
│   │   ├── services/
│   │   │   ├── yolo_detector.py      # YOLO v8 detection
│   │   │   ├── pose_estimator.py     # MediaPipe pose
│   │   │   ├── yolo_pose_estimator.py # YOLO11s-pose
│   │   │   ├── trajectory_tracker.py # Bar path tracking
│   │   │   └── form_analyzer.py      # Claude AI analysis
│   │   └── db/supabase.py            # Supabase client
│   ├── environment.yml               # Conda env
│   └── requirements.txt
└── supabase/config.toml
```

---

## 🆕 New Features Added (Dec 2025)

### Exercise Type Selection (Pre-Upload Flow)
Pattern borrowed from **auctor-dev** `OrgTypePickerModal`:

```tsx
// ExerciseTypeSelector.tsx - Card-based selection modal
<button
  onClick={() => setSelectedType(exercise.id)}
  className={`
    w-full text-left p-4 rounded-lg border transition-all
    ${isSelected
      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
      : 'border-border hover:border-primary/50'
    }
  `}
>
  <div className="flex items-center gap-2">
    <Icon className="h-5 w-5" />
    <span className="font-medium">{exercise.name}</span>
    {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
  </div>
</button>
```

**Supported Exercise Types:**
- `bench_press` - Bar path + elbow angles
- `squat` - Knee, hip, ankle angles
- `deadlift` - Hip hinge, back alignment
- `overhead_press` - Shoulder flexion, bar path
- `row` - Back angle, elbow position
- `other` - General pose tracking

### Claude Vision Weight Detection
Uses Claude Sonnet 4 to analyze frames and detect weight plates:

```python
# Backend endpoint: POST /api/processing/detect-weight/{video_id}
# Returns: total_weight, weight_unit, plates_left, plates_right, confidence
# Model: claude-sonnet-4-20250514
```

**Frontend Usage:**
```tsx
const result = await apiClient.detectWeight(videoId)
// result.total_weight = 225
// result.weight_unit = 'lbs'
// result.plates_left = [{ weight: 45, color: 'blue', count: 2 }]
```

### 2D Bar Path Visualization (Side View)
Visualizes the bar trajectory as a 2D chart, similar to professional apps like Metric VBT, BarSense, and GymAware:

```tsx
// BarPathChart.tsx - SVG-based visualization
<BarPathChart 
  barPath={trajectoryData?.bar_path || []}
  width={280}
  height={380}
  showVelocity={true}  // Color points by velocity
/>
```

**Features:**
- X-axis: Horizontal displacement (toward head vs feet)
- Y-axis: Vertical position (height)
- Color-coded velocity: Blue (slow) → Green (mid) → Orange (fast)
- Markers for START, END, and BOTTOM of lift
- Dashed reference line showing ideal J-curve
- Stats: horizontal range, vertical range, point count

**Reference Apps:**
- [Metric VBT](https://www.metric.coach/) - iOS bar path tracking
- [BarSense](https://blog.barsense.com/) - Bar path analysis
- [WL Analysis](https://apps.apple.com/us/app/wl-analysis/id1541855037) - Weightlifting analysis
- [GymAware](https://gymaware.com/) - Professional VBT system

---

## 📐 Coordinate Spaces & Units (Backend)

The backend uses several coordinate systems for different purposes:

### 1. Image/Pixel Space
```
Origin: Top-left corner (0, 0)
X-axis: → Right (0 to width)
Y-axis: ↓ Down (0 to height)
Units: Pixels

Example for 1440x1920 video:
- Top-left: (0, 0)
- Bottom-right: (1440, 1920)
- Center: (720, 960)
```

**Used in:**
- `bbox` coordinates from YOLO detection
- Bar trajectory `x`, `y` positions
- Velocity calculations (pixels/second)

### 2. Normalized Space (0-1)
```
Origin: Top-left corner (0, 0)
X-axis: → Right (0.0 to 1.0)
Y-axis: ↓ Down (0.0 to 1.0)
Units: Fraction of frame dimensions

Conversion:
- pixel_x = normalized_x * frame_width
- pixel_y = normalized_y * frame_height
```

**Used in:**
- MediaPipe pose landmarks (`x`, `y`)
- Person selection bbox (`bbox_normalized`)
- ROI (Region of Interest) for pose estimation
- YOLO pose keypoints

### 3. World Coordinates (MediaPipe)
```
Origin: Hip center
X-axis: → Right (subject's right)
Y-axis: ↓ Down
Z-axis: → Forward (away from camera)
Units: Meters (approximate)

Note: Derived from single camera, so depth (Z) is estimated,
not measured. Use for relative comparisons only.
```

**Used in:**
- `pose_world_landmarks` from MediaPipe
- 3D pose visualization (if implemented)

### 4. Output Space (Velocity Metrics)
```
Current: Pixels per second
- peak_concentric_velocity: px/s (upward movement)
- peak_eccentric_velocity: px/s (downward movement)
- average_speed: px/s
- vertical_displacement: px
- horizontal_deviation: px
```

**Frontend Conversion (approximate):**
```typescript
// MovementMetrics.tsx converts px/s to cm/s
// Assumes ~20 pixels per cm (based on typical video setup)
const PIXELS_PER_CM = 20
const velocityCmPerSec = peakVelocityPx / PIXELS_PER_CM
```

### Coordinate Flow Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                        VIDEO FRAME                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Pixel Space                             │  │
│  │            (0,0) ────────────────→ (width,0)             │  │
│  │              │                                            │  │
│  │              │    ┌─────────────────┐                    │  │
│  │              │    │  Person Bbox    │                    │  │
│  │              │    │  (normalized)   │                    │  │
│  │              │    │  x1,y1,x2,y2    │                    │  │
│  │              ↓    │   [0-1]         │                    │  │
│  │         (0,height)└─────────────────┘                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     POSE ESTIMATION                             │
├─────────────────────────────────────────────────────────────────┤
│  MediaPipe/YOLO outputs:                                        │
│  - landmarks[i].x, .y  → Normalized [0-1]                      │
│  - landmarks[i].z      → Depth (relative, unitless)            │
│  - visibility          → Confidence [0-1]                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BAR POSITION                                 │
├─────────────────────────────────────────────────────────────────┤
│  bar_center = midpoint(left_wrist, right_wrist)                │
│  Stored in PIXEL coordinates for velocity calculation           │
│                                                                 │
│  bar_trajectory[i] = {                                          │
│    frame: int,                                                  │
│    timestamp: float (seconds),                                  │
│    x: float (pixels),                                           │
│    y: float (pixels),                                           │
│    confidence: float [0-1],                                     │
│    source: "forearm_extended" | "wrist_fallback" | etc          │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   VELOCITY CALCULATION                          │
├─────────────────────────────────────────────────────────────────┤
│  dx = curr.x - prev.x  (pixels)                                │
│  dy = curr.y - prev.y  (pixels)                                │
│  dt = (curr.frame - prev.frame) / fps  (seconds)               │
│                                                                 │
│  vx = dx / dt  (pixels/second)                                 │
│  vy = dy / dt  (pixels/second)                                 │
│  speed = sqrt(vx² + vy²)  (pixels/second)                      │
│                                                                 │
│  Note: Y-axis inverted (negative vy = upward movement)         │
│  vertical_velocity = -vy                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FRONTEND DISPLAY                              │
├─────────────────────────────────────────────────────────────────┤
│  MovementMetrics.tsx converts:                                  │
│  - velocity: px/s → cm/s (÷ PIXELS_PER_CM)                     │
│  - displacement: px → cm (÷ PIXELS_PER_CM)                     │
│  - angles: radians → degrees (* 180/π)                         │
│                                                                 │
│  BarPathChart.tsx uses normalized pixel coords for display     │
└─────────────────────────────────────────────────────────────────┘
```

### Accuracy Considerations

| Measurement | Source | Accuracy | Notes |
|-------------|--------|----------|-------|
| Joint angles | 2D pose | ±5-10° | Affected by camera angle |
| Velocity (relative) | Frame diff | Good | Useful for trends |
| Velocity (absolute) | Uncalibrated | ±10-20% | Needs calibration |
| Displacement | 2D projection | ±10% | Only in camera plane |
| Rep counting | Y-position crossings | Good | Works well for vertical movements |

### Future: Calibration for Real Units
```python
# To get accurate cm/s velocity:
# 1. Detect bar endpoints in frame
# 2. User provides known bar length (220cm Olympic)
# 3. Calculate pixels_per_cm = bar_pixel_length / 220
# 4. velocity_cms = velocity_pxs / pixels_per_cm
```

---

## 🔄 Key Patterns & Lessons

### 1. Video Processing Pipeline
```
Upload → Store in Supabase → Process frames → 
YOLO detection + MediaPipe pose → 
Track bar path → Store results → 
AI form analysis (Claude)
```

### 2. Status States
Use consistent status patterns across the app:
```tsx
const statusConfig = {
  pending: { icon: Clock, className: 'text-muted-foreground bg-muted' },
  processing: { icon: Loader2, className: 'text-amber-600 bg-amber-50 animate-spin' },
  completed: { icon: CheckCircle2, className: 'text-emerald-600 bg-emerald-50' },
  failed: { icon: AlertCircle, className: 'text-red-600 bg-red-50' },
}
```

### 3. Canvas Overlay Pattern
For real-time visualization over video:
```tsx
<div className="video-container relative">
  <VideoPlayer src={url} />
  <TrajectoryCanvas 
    className="absolute inset-0 pointer-events-none"
    // ... detection data
  />
</div>
```

### 4. React Query Polling & Cache Invalidation
For processing status updates with automatic data refresh:
```tsx
// Track previous status to detect completion
const prevStatusRef = useRef<string | undefined>(undefined)

const { data: video } = useQuery({
  queryKey: ['video', id],
  refetchInterval: (query) => {
    return query.state.data?.status === 'processing' ? 2000 : false
  },
})

// Invalidate dependent queries when processing completes
useEffect(() => {
  const currentStatus = video?.status
  const prevStatus = prevStatusRef.current
  
  if (prevStatus === 'processing' && currentStatus === 'completed') {
    toast.success('Video processing complete!')
    queryClient.invalidateQueries({ queryKey: ['detection-results', id] })
    queryClient.invalidateQueries({ queryKey: ['tracking-session', id] })
  }
  
  prevStatusRef.current = currentStatus
}, [video?.status, id, queryClient])
```

**Why this pattern?** React Query's `enabled` flag doesn't automatically refetch when it changes from `false` to `true`. We must explicitly invalidate dependent queries when the parent state changes.

### 5. Responsive Grid for Video Layouts
```tsx
// Adapt to portrait vs landscape videos
<div className={`grid gap-6 ${
  video.height > video.width 
    ? 'lg:grid-cols-2'     // Portrait: 50/50
    : 'lg:grid-cols-3'     // Landscape: 2/3 + 1/3
}`}>
```

### 6. AI Form Analysis Integration
The `form_analyzer.py` uses Claude 3.5 Haiku for cost-effective analysis:
- Sends structured movement data (velocities, angles, path)
- Returns JSON with scores, issues, recommendations
- Falls back to rule-based analysis if API unavailable

---

## 🚀 API Endpoints

### Videos Router (`/api/videos`)
- `GET /{id}` - Get video details
- `GET /{id}/status` - Processing status
- `POST /{id}/process` - Start processing
- `GET /{id}/detections` - Detection results
- `GET /{id}/export` - Export data

### Processing Router (`/api/processing`)
- `GET /status/{id}` - Detailed status
- `GET /supported-objects` - Detectable objects
- `GET /pose-landmarks` - Landmark definitions

---

## 🔧 Development Setup

### Frontend
```bash
cd frontend
npm install
# Create .env.local with Supabase credentials
npm run dev  # http://localhost:3000
```

### Backend
```bash
cd backend
conda env create -f environment.yml
conda activate exercise-tracker
# Create .env with SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
python run.py --reload  # http://localhost:8000
```

---

## 📚 Reference Links

### Design Systems & UI
- [shadcn/ui Components](https://ui.shadcn.com/docs/components) - Component library
- [Tailwind CSS](https://tailwindcss.com/docs) - Utility classes
- [Lucide Icons](https://lucide.dev/icons/) - Icon set

### Healthcare UI Best Practices (2024-2025)
- Minimalist, intuitive design reduces cognitive load
- Emerald/green tones convey health, trust, calmness
- High accessibility with adjustable sizes, contrast
- AI personalization for user engagement
- Clear data visualization for health metrics
- Source: [Healthcare App UI Design Trends](https://graphicfolks.com/blog/healthcare-app-ui-design-trends/)

### Technical
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- [YOLO v8](https://docs.ultralytics.com/)
- [Supabase Docs](https://supabase.com/docs)

---

## 🏋️ Exercise Support Expansion

### Currently Supported
- ✅ **Bench Press** - Full pipeline with bar path, elbow angles, AI coaching

### Easy to Add (Pose Estimation Works Well)

| Exercise | Key Landmarks | Key Angles | Complexity |
|----------|---------------|------------|------------|
| **Squat** | Hip, Knee, Ankle | Knee: ~66°, Hip: ~58°, Ankle: ~55° at bottom | ⭐ Easy |
| **Deadlift** | Hip, Knee, Ankle, Shoulder | Hip: ~69°, Knee: ~126° at start | ⭐ Easy |
| **Overhead Press** | Shoulder, Elbow, Wrist | Elbow extension, shoulder flexion | ⭐ Easy |
| **Pull-up** | Shoulder, Elbow, Wrist | Elbow flexion, lat engagement | ⭐⭐ Medium |
| **Lunge** | Hip, Knee, Ankle (both legs) | Front/back knee angles | ⭐⭐ Medium |
| **Romanian Deadlift** | Hip, Knee, Shoulder | Hip hinge angle, back alignment | ⭐ Easy |

### Exercise-Specific Angle Calculations

```python
# Squat angles (already have calculate_angle function)
def calculate_squat_angles(pose_landmarks: List[Dict]) -> Dict:
    """
    Key angles for squat analysis.
    
    Ideal ranges (at bottom position):
    - Knee angle: 60-90° (parallel to below parallel)
    - Hip angle: 50-70° (hip crease below knee)
    - Ankle angle: 50-65° (dorsiflexion)
    """
    # Get landmarks
    hip = pose_landmarks[24]       # RIGHT_HIP
    knee = pose_landmarks[26]      # RIGHT_KNEE
    ankle = pose_landmarks[28]     # RIGHT_ANKLE
    shoulder = pose_landmarks[12]  # RIGHT_SHOULDER
    
    return {
        "knee_angle": calculate_angle(hip, knee, ankle),  # Main depth indicator
        "hip_angle": calculate_angle(shoulder, hip, knee),  # Torso position
        # Ankle angle needs vertical reference point
    }

# Deadlift angles
def calculate_deadlift_angles(pose_landmarks: List[Dict]) -> Dict:
    """
    Key angles for conventional deadlift.
    
    Form checks:
    - Back should stay neutral (shoulder-hip-knee alignment)
    - Knees shouldn't shoot forward
    - Bar path should be vertical
    """
    return {
        "hip_angle": calculate_angle(shoulder, hip, knee),
        "knee_angle": calculate_angle(hip, knee, ankle),
        "back_angle": calculate_angle(nose, shoulder, hip),  # Spine neutrality
    }
```

### Reference Links (Exercise Tracking)
- [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) - Official docs
- [Squat Detection with MediaPipe](https://github.com/mansikataria/SquatDetection) - GitHub example
- [Squats Angle Detection](https://github.com/Pradnya1208/Squats-angle-detection-using-OpenCV-and-mediapipe_v1) - Python implementation
- [VBT Barbell Tracker](https://github.com/kostecky/VBT-Barbell-Tracker) - Velocity-based training
- [Powerlifting Kinematics Research](https://journals.lww.com/nsca-jscr/fulltext/2009/12000/kinematic_analysis_of_the_powerlifting_style_squat.21.aspx) - Joint angle standards

---

## 📸 AI Weight Plate Detection (Future Feature)

### Approach: GPT-4 Vision / Claude Vision for OCR

Weight plates can be detected from video snapshots using multimodal AI:

```python
# Concept: Extract keyframe, send to vision model
async def detect_weight_from_snapshot(frame: np.ndarray) -> dict:
    """
    Use GPT-4 Vision or Claude to read weight plates.
    
    Steps:
    1. Extract clear frame showing barbell
    2. Encode as base64 JPEG
    3. Send to vision API with prompt
    4. Parse response for weight values
    """
    import anthropic
    
    # Encode frame
    _, buffer = cv2.imencode('.jpg', frame)
    image_base64 = base64.b64encode(buffer).decode('utf-8')
    
    client = anthropic.Anthropic()
    
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": image_base64,
                    }
                },
                {
                    "type": "text",
                    "text": """Analyze this gym image. Identify and count all visible weight plates on the barbell.
                    
For each side of the barbell, list:
1. Number and color of each plate size
2. Estimated weight per plate (45lb, 35lb, 25lb, 10lb, 5lb, 2.5lb)
3. Total weight calculation (including 45lb bar)

Return JSON: {"bar_weight": 45, "left_plates": [...], "right_plates": [...], "total_weight": X}"""
                }
            ]
        }]
    )
    
    return parse_weight_response(response.content[0].text)
```

### Weight Detection Considerations
- **Plate Colors**: Standard colors (45lb=blue, 35lb=yellow, 25lb=green, 10lb=white, 5lb=red)
- **Visibility**: Need clear side angle of barbell
- **Accuracy**: AI may struggle with stacked/occluded plates
- **Fallback**: Manual input option for users

### Reference Links (Weight Detection)
- [GPT-4 Vision OCR Capabilities](https://www.transformgym.app/) - Fitness app using vision AI
- [StandardVision.ai Iron Plates](https://www.standardvision.ai/classifications/iron-plates) - Equipment recognition
- [VVSearch Gym Equipment Identifier](https://vvsearch.com/tool/gym-equipment-names-and-tips) - AI equipment recognition

---

## ⚠️ Known Issues & TODOs

### Current Limitations
- [ ] Single person tracking only (multi-person selection via calibration)
- [ ] Portrait video aspect ratio handling could be improved
- [ ] No authentication/user management yet
- [ ] AI analysis requires ANTHROPIC_API_KEY

### Future Enhancements
- [ ] Real-time streaming analysis
- [ ] Multiple exercise types beyond bench press
- [ ] Progress tracking over time
- [ ] Mobile-responsive improvements
- [ ] 3D pose visualization (like new-medicly-1's BioDigital integration)
- [ ] AI weight plate detection from snapshots
- [ ] Exercise type auto-detection

---

## 💡 Tips for Future Sessions

1. **Check database schema**: For schema questions, reference `types/database.ts` or `types/index.ts`

2. **Component styling**: Follow shadcn/ui patterns, use `cn()` utility for class merging

3. **Color consistency**: Use semantic colors from design tokens, not hardcoded values

4. **Loading states**: Always use `Loader2` with `animate-spin` for consistency

5. **Error handling**: Display errors in Cards with destructive styling and retry buttons

6. **Reference medicly**: For advanced features, check new-medicly-1's implementation (especially AI analysis, calendar views, session management)

7. **Reference auctor-dev**: For enterprise patterns, check auctor-dev's component library and design system:
   - `OrgTypePickerModal` - Card-based type selection with search
   - `UploadModal` - Two-column layout with file list
   - `CreationModal` - Complex form with sections

8. **Exercise Type Selection**: Always show the ExerciseTypeSelector before upload - this improves tracking accuracy

9. **Weight Detection**: Use Claude Vision (`claude-3-5-sonnet`) for weight plate detection - works best on clear side-angle shots

---

*Last updated: December 11, 2025*

