// Exercise types supported by the system
export type ExerciseType = 
  | 'bench_press' 
  | 'squat' 
  | 'deadlift' 
  | 'overhead_press' 
  | 'row' 
  | 'other'

export interface Video {
  id: string
  filename: string
  storage_path: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  error_message: string | null
  exercise_type: ExerciseType | null
  detected_weight: number | null
  weight_unit: 'lbs' | 'kg' | null
  created_at: string
  updated_at: string
}

export interface DetectionResult {
  id: string
  video_id: string
  frame_number: number
  timestamp: number
  objects: ObjectDetection[]
  pose_landmarks: PoseLandmark[] | null
  created_at: string
}

export interface ObjectDetection {
  class: string
  confidence: number
  bbox: [number, number, number, number] // [x1, y1, x2, y2]
  track_id?: number
  bar_center?: [number, number] // [x, y] center position for barbell
  source?: string // Tracking source: "both_wrists", "single_wrist", etc.
  speed?: number // Velocity magnitude
}

export interface PoseLandmark {
  x: number
  y: number
  z: number
  visibility: number
}

export interface TrackingSession {
  id: string
  video_id: string
  object_count: number
  has_pose: boolean
  trajectory_data: TrajectoryData | null
  created_at: string
  updated_at: string
}

export interface TrajectoryData {
  objects: ObjectTrajectory[]
  pose: PoseTrajectory | null
}

export interface ObjectTrajectory {
  class: string
  track_id: number
  points: Array<{
    frame: number
    timestamp: number
    x: number
    y: number
  }>
}

export interface PoseTrajectory {
  landmarks: {
    [key: string]: Array<{
      frame: number
      timestamp: number
      x: number
      y: number
    }>
  }
}

// Re-export database types
export type { Database } from './database'

