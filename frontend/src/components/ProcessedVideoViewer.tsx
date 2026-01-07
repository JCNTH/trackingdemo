'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { VideoPlayer } from '@/components/VideoPlayer'
import { TrajectoryCanvas } from '@/components/TrajectoryCanvas'
import { Monitor, Layers, Columns } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DetectionResult } from '@/types'

interface BarPathPoint {
  x: number; y: number; frame: number; timestamp: number; confidence: number; source?: string; speed?: number
}

interface PersonPathPoint {
  x: number; y: number; frame: number; timestamp: number; confidence: number
}

interface ProcessedVideoViewerProps {
  videoUrl: string
  width: number
  height: number
  fps: number
  detectionResults?: DetectionResult[]
  barPath?: BarPathPoint[]
  personPath?: PersonPathPoint[]
}

export function ProcessedVideoViewer({
  videoUrl,
  width: propWidth,
  height: propHeight,
  fps,
  detectionResults = [],
  barPath,
  personPath,
}: ProcessedVideoViewerProps) {
  const [viewMode, setViewMode] = useState<'original' | 'overlay' | 'sidebyside'>('overlay')
  const [currentFrame, setCurrentFrame] = useState(0)
  const [actualVideoDimensions, setActualVideoDimensions] = useState<{width: number, height: number} | null>(null)
  const originalVideoRef = useRef<HTMLVideoElement>(null)
  const overlayVideoRef = useRef<HTMLVideoElement>(null)
  
  // Use actual video dimensions if available, otherwise prop dimensions
  const width = actualVideoDimensions?.width || propWidth
  const height = actualVideoDimensions?.height || propHeight

  const handleTimeUpdate = useCallback((currentTime: number) => {
    setCurrentFrame(Math.floor(currentTime * fps))
  }, [fps])

  // Callback to capture actual video dimensions when video loads
  const handleVideoLoaded = useCallback((duration: number, vw: number, vh: number) => {
    if (vw > 0 && vh > 0 && (vw !== propWidth || vh !== propHeight)) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/20a92eef-16ab-4de5-b181-01e406a7ee4c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ProcessedVideoViewer.tsx:handleVideoLoaded',message:'Actual video dimensions from element',data:{actualWidth:vw,actualHeight:vh,propWidth,propHeight},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      setActualVideoDimensions({ width: vw, height: vh })
    }
  }, [propWidth, propHeight])

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
          {[
            { mode: 'original' as const, icon: Monitor, label: 'Original' },
            { mode: 'overlay' as const, icon: Layers, label: 'Overlay' },
            { mode: 'sidebyside' as const, icon: Columns, label: 'Compare' },
          ].map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-2 py-1 rounded flex items-center gap-1 transition-colors",
                viewMode === mode ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
              )}
            >
              <Icon className="h-3 w-3" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
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

        {viewMode === 'overlay' && (
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
            {/* With overlay */}
            <div 
              className="video-container relative mx-auto bg-black"
              style={{
                aspectRatio: `${width} / ${height}`,
                maxHeight: '50vh',
                maxWidth: '100%',
              }}
            >
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
              <span className="absolute top-2 left-2 text-[10px] text-emerald-400 bg-black/50 px-1 rounded">Tracking</span>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      {hasTrackingData && viewMode !== 'original' && (
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
