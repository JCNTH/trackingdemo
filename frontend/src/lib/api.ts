/**
 * API Client for Exercise Tracker Backend
 * 
 * Handles all communication with the FastAPI backend for:
 * - Video calibration (person detection, pose estimation)
 * - Video processing (trajectory tracking)
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

  // ===========================================================================
  // Click-to-Track API
  // ===========================================================================

  /**
   * Segmentation model options for click-to-track.
   * - fastsam: Fastest (~95ms), YOLO-based
   * - sam2: Most accurate (~280ms with MPS), Meta's SAM2
   */
  static readonly SEGMENTATION_MODELS = ['fastsam', 'sam2'] as const

  /**
   * Get available segmentation models with performance info.
   */
  async getAvailableModels() {
    return this.request<{
      fastsam: {
        name: string
        description: string
        size_mb: number
        speed_ms: number
        accuracy: string
        recommended_for: string
      }
      sam2: {
        name: string
        description: string
        size_mb: number
        speed_ms: number
        accuracy: string
        recommended_for: string
        mps_available: boolean
      }
      default: string
      mps_available: boolean
    }>('/click-to-track/models')
  }

  /**
   * Get the first frame of a video for click-to-track selection.
   */
  async getFirstFrame(videoId: string, frameNumber: number = 0) {
    return this.request<{
      video_id: string
      frame_number: number
      frame_image: string  // Base64 encoded JPEG
      width: number
      height: number
      total_frames: number
      fps: number
    }>(`/click-to-track/${videoId}/first-frame?frame_number=${frameNumber}`)
  }

  /**
   * Segment an object at the clicked point.
   * Model options: 'fastsam' (fastest), 'sam2' (accurate)
   */
  async segmentAtClick(
    videoId: string, 
    clickPoint: { x: number; y: number },
    model: 'fastsam' | 'sam2' = 'fastsam'
  ) {
    return this.request<{
      success: boolean
      bbox?: [number, number, number, number]  // [x1, y1, x2, y2]
      center?: [number, number]                // [x, y]
      center_of_mass?: [number, number]        // Alias for center
      area_pixels?: number
      mask_preview?: string  // Base64 encoded preview image
      model_used?: string
      message?: string
    }>(`/click-to-track/${videoId}/segment`, {
      method: 'POST',
      body: JSON.stringify({ click_point: clickPoint, model }),
    })
  }

  /**
   * Process video with click-to-track segmentation.
   * Model options: 'fastsam' (fastest), 'sam2' (accurate)
   * 
   * @param startFrame - First frame to process (0-indexed, default: 0)
   * @param endFrame - Last frame to process (optional, default: process until end)
   */
  async processWithClickToTrack(
    videoId: string, 
    clickPoint: { x: number; y: number },
    model: 'fastsam' | 'sam2' = 'fastsam',
    startFrame?: number,
    endFrame?: number
  ) {
    const body: {
      click_point: { x: number; y: number }
      model: string
      start_frame?: number
      end_frame?: number
    } = {
      click_point: clickPoint,
      model,
    }
    
    if (startFrame !== undefined) body.start_frame = startFrame
    if (endFrame !== undefined) body.end_frame = endFrame
    
    return this.request<{
      status: string
      message: string
      model: string
    }>(`/click-to-track/${videoId}/process`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Get processing progress for a video.
   */
  async getProcessingProgress(videoId: string) {
    return this.request<{
      video_id: string
      status: string
      step: string
      progress: number
      detail: string
    }>(`/click-to-track/${videoId}/progress`)
  }

  /**
   * Get information about the click-to-track feature.
   */
  async getClickToTrackInfo() {
    return this.request<{
      name: string
      description: string
      workflow: string[]
      models: Record<string, {
        name: string
        description: string
        size_mb: number
        speed_ms: number
        accuracy: string
        recommended_for: string
      }>
      benchmarks: Record<string, string>
    }>('/click-to-track/info')
  }
}

export type SegmentationModel = typeof ApiClient.SEGMENTATION_MODELS[number]

export const apiClient = new ApiClient()
