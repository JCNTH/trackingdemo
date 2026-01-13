'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { VideoPlayer } from '@/components/VideoPlayer'
import { TrajectoryCanvas } from '@/components/TrajectoryCanvas'
import { Monitor, Layers, Columns } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DetectionResult } from '@/types'

// Debug logging for frame sync diagnosis - set to true to enable
const DEBUG_FRAME_SYNC = true
let lastDebugLogTime = 0
const debugLog = (location: string, message: string, data?: Record<string, unknown>, throttleMs = 0) => {
  if (!DEBUG_FRAME_SYNC) return
  const now = performance.now()
  if (throttleMs > 0 && now - lastDebugLogTime < throttleMs) return
  lastDebugLogTime = now
  
  const logEntry = { location, message, data, timestamp: now, time: new Date().toISOString() }
  console.log(`[ProcessedVideoViewer] ${message}`, data || '')
  fetch('http://127.0.0.1:7244/ingest/frame-sync-debug', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(logEntry),
  }).catch(() => {})
}

interface BarPathPoint {
  x: number; y: number; frame: number; timestamp: number; confidence: number; source?: string; speed?: number
}

interface PersonPathPoint {
  x: number; y: number; frame: number; timestamp: number; confidence: number
}

interface ProcessedVideoViewerProps {
  videoUrl: string
  overlayVideoUrl?: string | null  // NEW: Pre-rendered overlay video URL
  width: number
  height: number
  fps: number
  detectionResults?: DetectionResult[]
  barPath?: BarPathPoint[]
  personPath?: PersonPathPoint[]
}

export function ProcessedVideoViewer({
  videoUrl,
  overlayVideoUrl,  // NEW: Use pre-rendered overlay if available
  width: propWidth,
  height: propHeight,
  fps,
  detectionResults = [],
  barPath,
  personPath,
}: ProcessedVideoViewerProps) {
  // Default to 'overlay' (pre-rendered) if available, otherwise 'canvas'
  const [viewMode, setViewMode] = useState<'original' | 'overlay' | 'canvas' | 'sidebyside'>('canvas')
  const [currentFrame, setCurrentFrame] = useState(0)
  const [actualVideoDimensions, setActualVideoDimensions] = useState<{width: number, height: number} | null>(null)
  const originalVideoRef = useRef<HTMLVideoElement>(null)
  const overlayVideoRef = useRef<HTMLVideoElement>(null)

  // Switch to pre-rendered overlay when it becomes available
  useEffect(() => {
    if (overlayVideoUrl && viewMode === 'canvas') {
      debugLog('ProcessedVideoViewer:overlayAvailable', 'Pre-rendered overlay video available, switching view', { overlayVideoUrl })
      setViewMode('overlay')
    }
  }, [overlayVideoUrl, viewMode])
  
  // Use actual video dimensions if available, otherwise prop dimensions
  const width = actualVideoDimensions?.width || propWidth
  const height = actualVideoDimensions?.height || propHeight

  const handleTimeUpdate = useCallback((currentTime: number) => {
    const calculatedFrame = Math.floor(currentTime * fps)
    
    // Calculate expected frame range from tracking data
    const barFrameRange = barPath && barPath.length > 0 
      ? { min: Math.min(...barPath.map(p => p.frame)), max: Math.max(...barPath.map(p => p.frame)) }
      : null
    
    debugLog('ProcessedVideoViewer:timeUpdate', 'Frame calculation', {
      currentTime: currentTime.toFixed(4),
      fps: fps.toFixed(4),
      calculatedFrame,
      barPathFrameRange: barFrameRange ? `${barFrameRange.min}-${barFrameRange.max}` : 'none',
      frameInRange: barFrameRange ? (calculatedFrame >= barFrameRange.min && calculatedFrame <= barFrameRange.max) : 'N/A',
    }, 300) // Throttle to every 300ms
    
    setCurrentFrame(calculatedFrame)
  }, [fps, barPath])

  // Callback to capture actual video dimensions when video loads
  const handleVideoLoaded = useCallback((duration: number, vw: number, vh: number) => {
    // Calculate estimated total frames and compare with tracking data
    const estimatedTotalFrames = Math.round(duration * fps)
    const barPathLength = barPath?.length || 0
    
    debugLog('ProcessedVideoViewer:videoLoaded', 'Video metadata loaded', {
      duration: duration.toFixed(2),
      videoDims: `${vw}x${vh}`,
      propDims: `${propWidth}x${propHeight}`,
      fps,
      estimatedTotalFrames,
      barPathLength,
      frameCountMatch: barPathLength > 0 ? `${barPathLength}/${estimatedTotalFrames} (${((barPathLength/estimatedTotalFrames)*100).toFixed(1)}%)` : 'no tracking data',
    })
    
    if (vw > 0 && vh > 0 && (vw !== propWidth || vh !== propHeight)) {
      debugLog('ProcessedVideoViewer:dimMismatch', 'Video dimensions differ from props!', {
        actual: `${vw}x${vh}`,
        props: `${propWidth}x${propHeight}`,
      })
      setActualVideoDimensions({ width: vw, height: vh })
    }
  }, [propWidth, propHeight, fps, barPath])

  useEffect(() => {
    if (viewMode === 'sidebyside' && originalVideoRef.current && overlayVideoRef.current) {
      const syncHandler = () => {
        if (overlayVideoRef.current && originalVideoRef.current) {
          overlayVideoRef.current.currentTime = originalVideoRef.current.currentTime
        }
      }
      originalVideoRef.current.addEventListener('timeupdate', syncHandler)
      return () => originalVideoRef.current?.removeEventListener('timeupdate', syncHandler)
    }
  }, [viewMode])

  const hasTrackingData = (barPath && barPath.length > 0) || (personPath && personPath.length > 0) || detectionResults.length > 0

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('original')}
            className={cn(
              "px-2 py-1 rounded flex items-center gap-1 transition-colors",
              viewMode === 'original' ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
            )}
          >
            <Monitor className="h-3 w-3" />
            <span className="hidden sm:inline">Original</span>
          </button>
          
          {/* Pre-rendered overlay (better quality, no sync issues) */}
          {overlayVideoUrl && (
            <button
              onClick={() => setViewMode('overlay')}
              className={cn(
                "px-2 py-1 rounded flex items-center gap-1 transition-colors",
                viewMode === 'overlay' ? "bg-emerald-100 text-emerald-900" : "text-zinc-400 hover:text-zinc-600"
              )}
              title="Pre-rendered overlay (recommended)"
            >
              <Layers className="h-3 w-3" />
              <span className="hidden sm:inline">Overlay</span>
            </button>
          )}
          
          {/* Canvas overlay (real-time, may have sync issues) */}
          {hasTrackingData && (
            <button
              onClick={() => setViewMode('canvas')}
              className={cn(
                "px-2 py-1 rounded flex items-center gap-1 transition-colors",
                viewMode === 'canvas' ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
              )}
              title="Real-time canvas overlay"
            >
              <Layers className="h-3 w-3" />
              <span className="hidden sm:inline">{overlayVideoUrl ? 'Canvas' : 'Overlay'}</span>
            </button>
          )}
          
          <button
            onClick={() => setViewMode('sidebyside')}
            className={cn(
              "px-2 py-1 rounded flex items-center gap-1 transition-colors",
              viewMode === 'sidebyside' ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
            )}
          >
            <Columns className="h-3 w-3" />
            <span className="hidden sm:inline">Compare</span>
          </button>
        </div>
        <div className="flex items-center gap-2 text-zinc-400">
          <span className="font-mono">F{currentFrame}</span>
          {barPath && barPath.length > 0 && <span className="text-emerald-600">{barPath.length} bar</span>}
          {personPath && personPath.length > 0 && <span className="text-blue-600">{personPath.length} person</span>}
        </div>
      </div>

      {/* Video - use aspectRatio on container so video fills it exactly (no letterboxing) */}
      <div className="bg-black rounded overflow-hidden">
        {viewMode === 'original' && (
          <div 
            className="video-container relative mx-auto"
            style={{
              aspectRatio: `${width} / ${height}`,
              maxHeight: '70vh',
              maxWidth: '100%',
            }}
          >
            <VideoPlayer src={videoUrl} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleVideoLoaded} />
          </div>
        )}

        {/* Pre-rendered overlay video (best quality, no sync issues) */}
        {viewMode === 'overlay' && overlayVideoUrl && (
          <div 
            className="video-container relative mx-auto"
            style={{
              aspectRatio: `${width} / ${height}`,
              maxHeight: '70vh',
              maxWidth: '100%',
            }}
          >
            <VideoPlayer src={overlayVideoUrl} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleVideoLoaded} />
            <span className="absolute top-2 right-2 text-[10px] text-emerald-400 bg-black/50 px-1 rounded">
              Pre-rendered
            </span>
          </div>
        )}

        {/* Real-time canvas overlay (fallback or for comparison) */}
        {viewMode === 'canvas' && (
          <div 
            className="video-container relative mx-auto"
            style={{
              aspectRatio: `${width} / ${height}`,
              maxHeight: '70vh',
              maxWidth: '100%',
            }}
          >
            <VideoPlayer src={videoUrl} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleVideoLoaded} />
            {hasTrackingData && (
              <TrajectoryCanvas 
                detectionResults={detectionResults}
                width={width}
                height={height}
                currentFrame={currentFrame}
                showBarPath={true}
                barPath={barPath}
                personPath={personPath}
                showPersonPath={true}
                showObjects={true}
                showPose={true}
              />
            )}
            <span className="absolute top-2 right-2 text-[10px] text-amber-400 bg-black/50 px-1 rounded">
              Real-time
            </span>
          </div>
        )}

        {viewMode === 'sidebyside' && (
          <div className="grid grid-cols-2 gap-1">
            {/* Original */}
            <div 
              className="video-container relative mx-auto bg-black"
              style={{
                aspectRatio: `${width} / ${height}`,
                maxHeight: '50vh',
                maxWidth: '100%',
              }}
            >
              <video
                ref={originalVideoRef}
                src={videoUrl}
                className="w-full h-full"
                controls
                muted
                onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget.currentTime)}
              />
              <span className="absolute top-2 left-2 text-[10px] text-white/70 bg-black/50 px-1 rounded">Original</span>
            </div>
            {/* Pre-rendered overlay or canvas fallback */}
            <div 
              className="video-container relative mx-auto bg-black"
              style={{
                aspectRatio: `${width} / ${height}`,
                maxHeight: '50vh',
                maxWidth: '100%',
              }}
            >
              {overlayVideoUrl ? (
                <video
                  ref={overlayVideoRef}
                  src={overlayVideoUrl}
                  className="w-full h-full"
                  muted
                />
              ) : (
                <>
                  <video
                    ref={overlayVideoRef}
                    src={videoUrl}
                    className="w-full h-full"
                    muted
                  />
                  {hasTrackingData && (
                    <TrajectoryCanvas 
                      detectionResults={detectionResults}
                      width={width}
                      height={height}
                      currentFrame={currentFrame}
                      showBarPath={true}
                      barPath={barPath}
                      personPath={personPath}
                      showPersonPath={true}
                      showObjects={true}
                      showPose={true}
                    />
                  )}
                </>
              )}
              <span className="absolute top-2 left-2 text-[10px] text-emerald-400 bg-black/50 px-1 rounded">
                {overlayVideoUrl ? 'Pre-rendered' : 'Canvas'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Legend - only show for canvas mode since pre-rendered has its own legend baked in */}
      {hasTrackingData && viewMode === 'canvas' && (
        <div className="flex items-center justify-center gap-4 text-[10px] text-zinc-400">
          {barPath && barPath.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />Bar
            </span>
          )}
          {personPath && personPath.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />Person
            </span>
          )}
        </div>
      )}
    </div>
  )
}
