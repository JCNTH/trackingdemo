'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import type { DetectionResult, PoseLandmark, ObjectDetection } from '@/types'

interface BarPathPoint {
  x: number
  y: number
  frame: number
  timestamp: number
  confidence: number
  source?: string
  speed?: number
}

interface TrajectoryCanvasProps {
  detectionResults: DetectionResult[]
  width: number
  height: number
  currentFrame?: number
  showObjects?: boolean
  showPose?: boolean
  showTrajectories?: boolean
  showBarPath?: boolean
  barPath?: BarPathPoint[]
}

// MediaPipe pose landmark connections for upper body
const POSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
]

// Simple color scheme
const POSE_COLOR = 'rgba(16, 185, 129, 0.9)'  // Emerald
const BAR_COLOR = '#f59e0b'  // Amber/Orange
const WRIST_COLOR = '#f59e0b'  // Amber

export function TrajectoryCanvas({
  detectionResults,
  width,
  height,
  currentFrame = 0,
  showObjects = true,
  showPose = true,
  showTrajectories = true,
  showBarPath = true,
  barPath,
}: TrajectoryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  // Scale functions
  const scaleX = useCallback((x: number) => (x / width) * canvasSize.width, [width, canvasSize.width])
  const scaleY = useCallback((y: number) => (y / height) * canvasSize.height, [height, canvasSize.height])

  // Update canvas size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      const canvas = canvasRef.current
      if (!canvas) return

      const parent = canvas.parentElement
      if (!parent) return

      const rect = parent.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      
      setCanvasSize({ width: rect.width, height: rect.height })
      canvas.width = rect.width
      canvas.height = rect.height
    }

    // Initial size
    updateSize()
    
    // Resize observer for more reliable updates
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
  }, [])

  // Main drawing effect
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!detectionResults || detectionResults.length === 0) return

    // Find current frame data - use closest frame if exact match not found
    let currentData = detectionResults.find(r => r.frame_number === currentFrame)
    if (!currentData) {
      // Find closest frame
      let minDiff = Infinity
      for (const r of detectionResults) {
        const diff = Math.abs(r.frame_number - currentFrame)
        if (diff < minDiff) {
          minDiff = diff
          currentData = r
        }
      }
    }
    if (!currentData) currentData = detectionResults[0]
    if (!currentData) return

    // Draw bar path trajectory (full history)
    if (showBarPath && barPath && barPath.length > 1) {
      // Draw path line
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)'
      ctx.lineWidth = 2
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

      // Draw dots at intervals
      for (let i = 0; i < barPath.length; i += 15) {
        const point = barPath[i]
        const x = scaleX(point.x)
        const y = scaleY(point.y)
        
        ctx.beginPath()
        ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(245, 158, 11, 0.7)'
        ctx.fill()
      }
    }

    // Draw recent trajectory (last 30 frames)
    if (showTrajectories) {
      const historyLength = 30
      const startFrame = Math.max(0, currentFrame - historyLength)
      
      const trajectoryPoints: Array<{x: number, y: number}> = []
      
      for (const frame of detectionResults) {
        if (frame.frame_number < startFrame || frame.frame_number > currentFrame) continue
        
        // Get barbell position from objects
        const barbell = frame.objects?.find(o => o.class === 'barbell')
        if (barbell?.bar_center) {
          trajectoryPoints.push({
            x: barbell.bar_center[0],
            y: barbell.bar_center[1]
          })
        }
      }

      if (trajectoryPoints.length > 1) {
        ctx.beginPath()
        ctx.strokeStyle = BAR_COLOR
        ctx.lineWidth = 3
        ctx.lineCap = 'round'

        trajectoryPoints.forEach((point, i) => {
          const x = scaleX(point.x)
          const y = scaleY(point.y)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
    }

    // Draw current pose
    if (showPose && currentData.pose_landmarks) {
      const landmarks = currentData.pose_landmarks as PoseLandmark[]
      if (!landmarks || landmarks.length === 0) return

      // Draw skeleton connections - lower threshold for arms (wrists/elbows)
      ctx.strokeStyle = POSE_COLOR
      ctx.lineWidth = 2

      for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
        const p1 = landmarks[startIdx]
        const p2 = landmarks[endIdx]

        if (!p1 || !p2) continue
        
        // Use lower visibility threshold for arm connections
        const isArmConnection = [13, 14, 15, 16].includes(startIdx) || [13, 14, 15, 16].includes(endIdx)
        const minVis = isArmConnection ? 0.05 : 0.2
        if ((p1.visibility || 0) < minVis || (p2.visibility || 0) < minVis) continue

        const x1 = scaleX(p1.x * width)
        const y1 = scaleY(p1.y * height)
        const x2 = scaleX(p2.x * width)
        const y2 = scaleY(p2.y * height)

        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }

      // Draw joint dots - use much lower threshold for wrists/elbows
      for (let i = 0; i < landmarks.length; i++) {
        const landmark = landmarks[i]
        if (!landmark) continue
        
        // Very low threshold for arm joints, normal for others
        const isArmJoint = [13, 14, 15, 16].includes(i)
        const minVis = isArmJoint ? 0.01 : 0.2
        if ((landmark.visibility || 0) < minVis) continue

        const x = scaleX(landmark.x * width)
        const y = scaleY(landmark.y * height)

        // Highlight wrists
        const isWrist = i === 15 || i === 16
        const radius = isWrist ? 8 : 4
        const color = isWrist ? WRIST_COLOR : '#047857'

        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = isWrist ? 2 : 1
        ctx.stroke()

        // Label wrists
        if (isWrist) {
          ctx.font = 'bold 10px system-ui'
          ctx.fillStyle = WRIST_COLOR
          ctx.fillText(i === 15 ? 'L' : 'R', x + 10, y + 3)
        }
      }
    }

    // Draw current barbell position
    if (showObjects && currentData.objects) {
      const barbell = currentData.objects.find(o => o.class === 'barbell')
      
      if (barbell?.bar_center) {
        const [bx, by] = barbell.bar_center
        const centerX = scaleX(bx)
        const centerY = scaleY(by)
        
        // Draw crosshair
        const size = 20
        
        // Outer ring
        ctx.beginPath()
        ctx.arc(centerX, centerY, 16, 0, Math.PI * 2)
        ctx.strokeStyle = BAR_COLOR
        ctx.lineWidth = 2
        ctx.stroke()
        
        // Crosshair lines
        ctx.strokeStyle = BAR_COLOR
        ctx.lineWidth = 2
        
        ctx.beginPath()
        ctx.moveTo(centerX - size, centerY)
        ctx.lineTo(centerX + size, centerY)
        ctx.stroke()
        
        ctx.beginPath()
        ctx.moveTo(centerX, centerY - size)
        ctx.lineTo(centerX, centerY + size)
        ctx.stroke()
        
        // Center dot
        ctx.beginPath()
        ctx.arc(centerX, centerY, 5, 0, Math.PI * 2)
        ctx.fillStyle = BAR_COLOR
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
        
        // Label
        ctx.font = 'bold 12px system-ui'
        ctx.fillStyle = BAR_COLOR
        ctx.fillText('BAR', centerX + 22, centerY + 4)
      }
    }

    // Draw simple status indicator
    const hasBarbell = currentData.objects?.some(o => o.class === 'barbell' && o.bar_center)
    const hasPose = currentData.pose_landmarks && (currentData.pose_landmarks as PoseLandmark[]).length > 0
    
    // Status badge (simple rectangle, no roundRect)
    const badgeX = 10
    const badgeY = 10
    const badgeWidth = 75
    const badgeHeight = 22

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight)

    // Status dot
    const statusColor = hasBarbell ? '#10b981' : hasPose ? '#f59e0b' : '#ef4444'
    ctx.beginPath()
    ctx.arc(badgeX + 12, badgeY + 11, 4, 0, Math.PI * 2)
    ctx.fillStyle = statusColor
    ctx.fill()

    // Status text
    ctx.font = '11px system-ui'
    ctx.fillStyle = '#fff'
    ctx.fillText(hasBarbell ? 'Tracking' : hasPose ? 'Pose' : 'Lost', badgeX + 22, badgeY + 15)

    // Frame counter
    ctx.font = '10px monospace'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.textAlign = 'right'
    ctx.fillText(`F${currentFrame}`, canvas.width - 10, 20)
    ctx.textAlign = 'left'

  }, [detectionResults, currentFrame, canvasSize, showObjects, showPose, showTrajectories, showBarPath, barPath, scaleX, scaleY, width, height])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  )
}
