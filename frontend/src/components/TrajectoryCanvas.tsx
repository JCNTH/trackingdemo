'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import type { DetectionResult, PoseLandmark as ImportedPoseLandmark, ObjectDetection } from '@/types'

// Debug logging for frame sync diagnosis - set to true to enable
const DEBUG_FRAME_SYNC = true
let lastDebugLogTime = 0
const debugLog = (location: string, message: string, data?: Record<string, unknown>, throttleMs = 0) => {
  if (!DEBUG_FRAME_SYNC) return
  const now = performance.now()
  // Throttle to avoid spam during playback
  if (throttleMs > 0 && now - lastDebugLogTime < throttleMs) return
  lastDebugLogTime = now
  
  const logEntry = {
    location,
    message,
    data,
    timestamp: now,
    time: new Date().toISOString(),
  }
  console.log(`[TrajectoryCanvas] ${message}`, data || '')
  // Also send to debug server if available
  fetch('http://127.0.0.1:7244/ingest/frame-sync-debug', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(logEntry),
  }).catch(() => {})
}

interface BarPathPoint {
  x: number
  y: number
  frame: number
  timestamp: number
  confidence: number
  source?: string
  speed?: number
  bbox?: [number, number, number, number]  // [x1, y1, x2, y2]
}

// Use a compatible PoseLandmark type that works with both sources
type PoseLandmark = ImportedPoseLandmark | { x: number; y: number; visibility: number }

interface PersonPathPoint {
  x: number
  y: number
  frame: number
  timestamp: number
  confidence: number
  bbox?: [number, number, number, number]
  pose_landmarks?: PoseLandmark[]  // 17 COCO keypoints
}

interface TrajectoryCanvasProps {
  detectionResults: DetectionResult[]
  width: number  // Video native width
  height: number // Video native height
  currentFrame?: number
  showObjects?: boolean
  showPose?: boolean
  showTrajectories?: boolean
  showBarPath?: boolean
  barPath?: BarPathPoint[]
  personPath?: PersonPathPoint[]
  showPersonPath?: boolean
}

// COCO 17-keypoint format (used by YOLO-pose)
// 0-nose, 1-leye, 2-reye, 3-lear, 4-rear, 5-lshoulder, 6-rshoulder,
// 7-lelbow, 8-relbow, 9-lwrist, 10-rwrist, 11-lhip, 12-rhip, 13-lknee, 14-rknee, 15-lankle, 16-rankle
const POSE_CONNECTIONS = [
  // Upper body
  [5, 6],   // shoulders
  [5, 7],   // left shoulder to left elbow
  [7, 9],   // left elbow to left wrist
  [6, 8],   // right shoulder to right elbow
  [8, 10],  // right elbow to right wrist
  // Torso
  [5, 11],  // left shoulder to left hip
  [6, 12],  // right shoulder to right hip
  [11, 12], // hips
  // Legs
  [11, 13], // left hip to left knee
  [13, 15], // left knee to left ankle
  [12, 14], // right hip to right knee
  [14, 16], // right knee to right ankle
]

// Colors
const BAR_COLOR = '#22c55e'
const POSE_COLOR = '#10b981'
const PERSON_COLOR = '#3b82f6'
const WRIST_COLOR = '#f59e0b'

export function TrajectoryCanvas({
  detectionResults,
  width: videoWidth,
  height: videoHeight,
  currentFrame = 0,
  showObjects = true,
  showPose = true,
  showTrajectories = true,
  showBarPath = true,
  barPath,
  personPath,
  showPersonPath = true,
}: TrajectoryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [videoRect, setVideoRect] = useState({ x: 0, y: 0, width: 0, height: 0 })

  // Calculate where the video sits within the container (accounting for object-contain letterboxing)
  const calculateVideoRect = useCallback((containerWidth: number, containerHeight: number) => {
    if (videoWidth === 0 || videoHeight === 0) {
      return { x: 0, y: 0, width: containerWidth, height: containerHeight }
    }
    
    const videoAspect = videoWidth / videoHeight
    const containerAspect = containerWidth / containerHeight
    
    let actualWidth: number, actualHeight: number, offsetX: number, offsetY: number
    
    if (videoAspect > containerAspect) {
      // Video is wider than container - letterbox top/bottom
      actualWidth = containerWidth
      actualHeight = containerWidth / videoAspect
      offsetX = 0
      offsetY = (containerHeight - actualHeight) / 2
    } else {
      // Video is taller than container - letterbox left/right
      actualHeight = containerHeight
      actualWidth = containerHeight * videoAspect
      offsetX = (containerWidth - actualWidth) / 2
      offsetY = 0
    }
    
    return { x: offsetX, y: offsetY, width: actualWidth, height: actualHeight }
  }, [videoWidth, videoHeight])

  // Scale video coordinates to canvas coordinates
  const scaleX = useCallback((x: number) => {
    return videoRect.x + (x / videoWidth) * videoRect.width
  }, [videoWidth, videoRect])
  
  const scaleY = useCallback((y: number) => {
    return videoRect.y + (y / videoHeight) * videoRect.height
  }, [videoHeight, videoRect])

  // Update canvas size
  useEffect(() => {
    const updateSize = () => {
      const canvas = canvasRef.current
      if (!canvas) return

      const parent = canvas.parentElement
      if (!parent) return

      const rect = parent.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      
      const calculatedRect = calculateVideoRect(rect.width, rect.height)
      debugLog('TrajectoryCanvas:resize', 'Canvas size update', {
        containerW: rect.width,
        containerH: rect.height,
        videoNativeW: videoWidth,
        videoNativeH: videoHeight,
        calculatedVideoRect: calculatedRect,
      }, 1000) // Throttle resize logs to every 1s
      setCanvasSize({ width: rect.width, height: rect.height })
      setVideoRect(calculatedRect)
      canvas.width = rect.width
      canvas.height = rect.height
    }

    updateSize()
    
    const resizeObserver = new ResizeObserver(updateSize)
    const parent = canvasRef.current?.parentElement
    if (parent) {
      resizeObserver.observe(parent)
    }

    window.addEventListener('resize', updateSize)
    return () => {
      window.removeEventListener('resize', updateSize)
      resizeObserver.disconnect()
    }
  }, [calculateVideoRect])

  // Main drawing
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const hasBarPathData = showBarPath && barPath && barPath.length > 0
    const hasPersonPathData = showPersonPath && personPath && personPath.length > 0
    const hasDetectionData = detectionResults && detectionResults.length > 0

    if (!hasBarPathData && !hasPersonPathData && !hasDetectionData) return

    // Frame offset to compensate for browser video decode-to-display delay
    // video.currentTime reports decoded time, but display is ~1-2 frames behind
    // Subtracting 1 frame makes the overlay match the displayed video better
    const FRAME_DISPLAY_OFFSET = 1
    const adjustedFrame = Math.max(0, currentFrame - FRAME_DISPLAY_OFFSET)
    
    // Calculate frame range info for debugging
    const barFrameMin = barPath && barPath.length > 0 ? Math.min(...barPath.map(p => p.frame)) : null
    const barFrameMax = barPath && barPath.length > 0 ? Math.max(...barPath.map(p => p.frame)) : null
    
    // Find current detection data using adjusted frame
    let currentData: DetectionResult | undefined = undefined
    if (hasDetectionData) {
      currentData = detectionResults.find(r => r.frame_number === adjustedFrame)
      if (!currentData) {
        let minDiff = Infinity
        for (const r of detectionResults) {
          const diff = Math.abs(r.frame_number - adjustedFrame)
          if (diff < minDiff) {
            minDiff = diff
            currentData = r
          }
        }
      }
      if (!currentData) currentData = detectionResults[0]
    }

    // Debug logging with throttle during playback (every 300ms)
    debugLog('TrajectoryCanvas:draw', 'Drawing frame', {
      currentFrame,
      adjustedFrame,
      barPathLength: barPath?.length || 0,
      personPathLength: personPath?.length || 0,
      barFrameRange: (barFrameMin !== null && barFrameMax !== null) ? `${barFrameMin}-${barFrameMax}` : 'none',
      frameInRange: (barFrameMin !== null && barFrameMax !== null) ? (adjustedFrame >= barFrameMin && adjustedFrame <= barFrameMax) : false,
      videoNativeDims: `${videoWidth}x${videoHeight}`,
      canvasDims: `${canvasSize.width}x${canvasSize.height}`,
    }, 300)

    // ========== DRAW BAR PATH ==========
    if (showBarPath && barPath && barPath.length > 1) {
      // Trail line
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      let started = false
      for (const point of barPath) {
        const x = scaleX(point.x)
        const y = scaleY(point.y)
        
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()

      // Current bar position - use adjustedFrame and find closest frame if exact match not found
      // This handles sparse tracking data where not every frame has tracking
      let currentBarPoint = barPath.find(p => p.frame === adjustedFrame)
      const exactMatch = !!currentBarPoint
      let frameDiff = 0
      
      if (!currentBarPoint) {
        // Find the closest frame to adjustedFrame
        let minDiff = Infinity
        for (const p of barPath) {
          const diff = Math.abs(p.frame - adjustedFrame)
          if (diff < minDiff) {
            minDiff = diff
            currentBarPoint = p
            frameDiff = diff
          }
        }
      }
      
      // Log bar point matching - important for diagnosing lag
      debugLog('TrajectoryCanvas:barMatch', 'Bar point match', {
        requestedFrame: adjustedFrame,
        matchedFrame: currentBarPoint?.frame,
        exactMatch,
        frameDiff,
        barPosition: currentBarPoint ? { x: currentBarPoint.x, y: currentBarPoint.y } : null,
        hasBox: !!currentBarPoint?.bbox,
      }, 300)
      if (currentBarPoint) {
        const bx = scaleX(currentBarPoint.x)
        const by = scaleY(currentBarPoint.y)
        
        // Draw bar indicator with diagonal line showing bar angle
        if (currentBarPoint.bbox) {
          const [x1, y1, x2, y2] = currentBarPoint.bbox
          const sx1 = scaleX(x1)
          const sy1 = scaleY(y1)
          const sx2 = scaleX(x2)
          const sy2 = scaleY(y2)
          
          // Draw diagonal line from bottom-left to top-right (shows bar angle)
          ctx.beginPath()
          ctx.moveTo(sx1, sy2)  // bottom-left
          ctx.lineTo(sx2, sy1)  // top-right
          ctx.strokeStyle = BAR_COLOR
          ctx.lineWidth = 4
          ctx.lineCap = 'round'
          ctx.stroke()
          
          // Draw glow effect around the line
          ctx.beginPath()
          ctx.moveTo(sx1, sy2)
          ctx.lineTo(sx2, sy1)
          ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)'
          ctx.lineWidth = 12
          ctx.stroke()
          
          // Center dot
          ctx.beginPath()
          ctx.arc(bx, by, 8, 0, Math.PI * 2)
          ctx.fillStyle = BAR_COLOR
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.stroke()
        } else {
          // Fallback to circle if no bbox
          const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, 30)
          gradient.addColorStop(0, 'rgba(34, 197, 94, 0.5)')
          gradient.addColorStop(0.5, 'rgba(34, 197, 94, 0.2)')
          gradient.addColorStop(1, 'rgba(34, 197, 94, 0)')
          ctx.beginPath()
          ctx.arc(bx, by, 30, 0, Math.PI * 2)
          ctx.fillStyle = gradient
          ctx.fill()
          
          ctx.beginPath()
          ctx.arc(bx, by, 18, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(34, 197, 94, 0.3)'
          ctx.fill()
          ctx.strokeStyle = BAR_COLOR
          ctx.lineWidth = 3
          ctx.stroke()
          
          ctx.beginPath()
          ctx.moveTo(bx - 10, by)
          ctx.lineTo(bx + 10, by)
          ctx.moveTo(bx, by - 10)
          ctx.lineTo(bx, by + 10)
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
    }

    // ========== DRAW POSE SKELETON ==========
    // First check detection results, then check personPath for pose_landmarks
    // Only use exact frame matches to avoid jitter from jumping between frames
    let currentPersonPoint = personPath?.find(p => p.frame === adjustedFrame)
    
    // If no exact match, try one frame before/after to handle sparse data
    if (!currentPersonPoint && personPath && personPath.length > 0) {
      currentPersonPoint = personPath.find(p => p.frame === adjustedFrame + 1) 
        || personPath.find(p => p.frame === adjustedFrame - 1)
    }
    
    const poseLandmarks = currentData?.pose_landmarks || currentPersonPoint?.pose_landmarks
    
    if (showPose && poseLandmarks) {
      const landmarks = poseLandmarks as PoseLandmark[]
      if (landmarks && landmarks.length > 0) {
        // Draw skeleton with slightly thicker lines for stability
        ctx.strokeStyle = POSE_COLOR
        ctx.lineWidth = 3
        ctx.lineCap = 'round'

        for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
          const p1 = landmarks[startIdx]
          const p2 = landmarks[endIdx]
          if (!p1 || !p2) continue
          // Increase visibility threshold to reduce low-confidence jitter
          if ((p1.visibility || 0) < 0.5 || (p2.visibility || 0) < 0.5) continue

          const x1 = scaleX(p1.x * videoWidth)
          const y1 = scaleY(p1.y * videoHeight)
          const x2 = scaleX(p2.x * videoWidth)
          const y2 = scaleY(p2.y * videoHeight)

          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }

        // Joint points (COCO indices)
        // 5,6-shoulders, 7,8-elbows, 9,10-wrists, 11,12-hips, 13,14-knees, 15,16-ankles
        const jointIndices = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
        for (const idx of jointIndices) {
          const landmark = landmarks[idx]
          // Higher visibility threshold to reduce jitter
          if (!landmark || (landmark.visibility || 0) < 0.5) continue

          const x = scaleX(landmark.x * videoWidth)
          const y = scaleY(landmark.y * videoHeight)

          let color = POSE_COLOR
          if (idx === 9 || idx === 10) color = WRIST_COLOR  // wrists
          else if (idx === 5 || idx === 6) color = '#f97316'  // shoulders
          else if (idx === 11 || idx === 12) color = '#3b82f6'  // hips

          ctx.beginPath()
          ctx.arc(x, y, idx === 9 || idx === 10 ? 8 : 6, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.stroke()
        }

        // Wrist rings (COCO: 9=left wrist, 10=right wrist)
        for (const idx of [9, 10]) {
          const landmark = landmarks[idx]
          // Higher visibility threshold to reduce jitter
          if (!landmark || (landmark.visibility || 0) < 0.5) continue

          const x = scaleX(landmark.x * videoWidth)
          const y = scaleY(landmark.y * videoHeight)

          ctx.beginPath()
          ctx.arc(x, y, 10, 0, Math.PI * 2)
          ctx.strokeStyle = WRIST_COLOR
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
    }

    // Person center path removed - skeleton handles person visualization

    // ========== DRAW BARBELL FROM DETECTION (legacy) ==========
    if (showObjects && currentData?.objects && !hasBarPathData) {
      const barbell = currentData.objects.find((o: ObjectDetection) => o.class === 'barbell')
      
      if (barbell?.bar_center) {
        const [bx, by] = barbell.bar_center
        const centerX = scaleX(bx)
        const centerY = scaleY(by)
        
        ctx.beginPath()
        ctx.arc(centerX, centerY, 15, 0, Math.PI * 2)
        ctx.strokeStyle = BAR_COLOR
        ctx.lineWidth = 3
        ctx.stroke()
        
        ctx.beginPath()
        ctx.arc(centerX, centerY, 5, 0, Math.PI * 2)
        ctx.fillStyle = BAR_COLOR
        ctx.fill()
      }
    }

    // ========== STATUS BADGE ==========
    const badgeX = videoRect.x + 8
    const badgeY = videoRect.y + 8
    const hasPoseData = (poseLandmarks && (poseLandmarks as PoseLandmark[]).length > 0) || hasPersonPathData

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.beginPath()
    ctx.roundRect(badgeX, badgeY, 80, 44, 4)
    ctx.fill()

    ctx.font = '11px system-ui'
    
    ctx.beginPath()
    ctx.arc(badgeX + 10, badgeY + 12, 5, 0, Math.PI * 2)
    ctx.fillStyle = hasBarPathData ? BAR_COLOR : '#666'
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText('Bar', badgeX + 20, badgeY + 16)
    
    ctx.beginPath()
    ctx.arc(badgeX + 10, badgeY + 30, 5, 0, Math.PI * 2)
    ctx.fillStyle = hasPoseData ? POSE_COLOR : (hasPersonPathData ? PERSON_COLOR : '#666')
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText('Person', badgeX + 20, badgeY + 34)

    // Frame counter
    ctx.font = '12px monospace'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.textAlign = 'right'
    ctx.fillText(`F${currentFrame}`, videoRect.x + videoRect.width - 10, videoRect.y + 22)
    ctx.textAlign = 'left'

  }, [detectionResults, currentFrame, canvasSize, showObjects, showPose, showTrajectories, showBarPath, barPath, personPath, showPersonPath, scaleX, scaleY, videoWidth, videoHeight, videoRect])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  )
}
