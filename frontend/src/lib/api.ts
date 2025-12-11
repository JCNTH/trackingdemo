/**
 * API Client for Exercise Tracker Backend
 * 
 * Handles all communication with the FastAPI backend for:
 * - Video calibration (person detection, pose estimation)
 * - Video processing (trajectory tracking)
 * - Weight detection (Claude Vision)
 * - Data export
 */

const API_BASE = '/api/py'

// ============================================================================
// Types
// ============================================================================
export interface DetectedPerson {
  id: number
  bbox: [number, number, number, number]  // [x1, y1, x2, y2] in pixels
  bbox_normalized: [number, number, number, number]  // [x1, y1, x2, y2] 0-1
  confidence: number
  pose: Array<{
    x: number
    y: number
    z: number
    visibility: number
    name: string
  }> | null
  bar_center: {
    x: number
    y: number
    confidence: number
  } | null
}

export type PoseBackend = 'yolo' | 'mediapipe'

export interface WeightDetectionResult {
  success: boolean
  total_weight?: number
  weight_unit?: string
  bar_weight?: number
  plates_left?: Array<{ weight: number; color: string; count: number }>
  plates_right?: Array<{ weight: number; color: string; count: number }>
  confidence?: number
  notes?: string
  error?: string
}

export interface CalibrationResponse {
  video_id: string
  frame_number: number
  total_frames: number
  fps: number
  width: number
  height: number
  frame_image: string  // base64 encoded JPEG
  people: DetectedPerson[]
  pose_backend: PoseBackend
  weight_detection?: WeightDetectionResult
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE}${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async healthCheck() {
    return this.request<{ status: string }>('/health')
  }

  /**
   * Calibrate video - extract first frame and detect all people.
   * This is the first step in the human-in-the-loop workflow.
   */
  async calibrateVideo(
    videoId: string, 
    frameNumber: number = 0,
    poseBackend: PoseBackend = 'yolo'
  ): Promise<CalibrationResponse> {
    return this.request<CalibrationResponse>(
      `/processing/calibrate/${videoId}`,
      { 
        method: 'POST',
        body: JSON.stringify({ 
          frame_number: frameNumber,
          pose_backend: poseBackend,
        }),
      }
    )
  }

  /**
   * Process video with optional selected person.
   * If selectedPersonBbox is provided, only that person will be tracked.
   */
  async processVideo(videoId: string, selectedPersonBbox?: [number, number, number, number]) {
    const body = selectedPersonBbox 
      ? { selected_person_bbox: selectedPersonBbox }
      : undefined

    return this.request<{ success: boolean; message: string }>(
      `/videos/${videoId}/process`,
      { 
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      }
    )
  }

  async getProcessingStatus(videoId: string) {
    return this.request<{
      status: 'pending' | 'processing' | 'completed' | 'failed'
      progress?: number
      message?: string
    }>(`/videos/${videoId}/status`)
  }

  async getDetectionResults(videoId: string) {
    return this.request<{
      frames: Array<{
        frame_number: number
        objects: Array<{
          class: string
          confidence: number
          bbox: [number, number, number, number]
        }>
        pose_landmarks?: Array<{
          x: number
          y: number
          z: number
          visibility: number
        }>
      }>
    }>(`/videos/${videoId}/detections`)
  }

  async exportData(videoId: string, format: 'json' | 'csv') {
    const response = await fetch(`${API_BASE}/videos/${videoId}/export?format=${format}`)
    
    if (!response.ok) {
      throw new Error('Export failed')
    }

    return response.blob()
  }

  /**
   * Detect weight plates from video using Claude Vision.
   * Analyzes a frame to identify and count weight plates.
   */
  async detectWeight(videoId: string, frameNumber?: number) {
    return this.request<{
      video_id: string
      frame_analyzed: number
      success: boolean
      total_weight: number | null
      weight_unit: 'lbs' | 'kg'
      bar_weight: number
      confidence: number
      plates_left: Array<{ weight: number; color: string; count: number }>
      plates_right: Array<{ weight: number; color: string; count: number }>
      notes?: string
      error?: string
    }>(
      `/processing/detect-weight/${videoId}`,
      {
        method: 'POST',
        body: JSON.stringify({ frame_number: frameNumber }),
      }
    )
  }

  /**
   * Check if weight detection is available.
   */
  async getWeightDetectionStatus() {
    return this.request<{
      available: boolean
      model: string | null
      note: string | null
    }>('/processing/weight-detection-status')
  }
}

export const apiClient = new ApiClient()

