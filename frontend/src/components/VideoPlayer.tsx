'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Debug logging for frame sync diagnosis - set to true to enable
const DEBUG_FRAME_SYNC = true
const debugLog = (location: string, message: string, data?: Record<string, unknown>) => {
  if (!DEBUG_FRAME_SYNC) return
  const logEntry = {
    location,
    message,
    data,
    timestamp: performance.now(),
    time: new Date().toISOString(),
  }
  console.log(`[VideoPlayer] ${message}`, data || '')
  // Also send to debug server if available
  fetch('http://127.0.0.1:7244/ingest/frame-sync-debug', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(logEntry),
  }).catch(() => {})
}

interface VideoPlayerProps {
  src: string
  onTimeUpdate?: (currentTime: number) => void
  onLoadedMetadata?: (duration: number, width: number, height: number) => void
}

export function VideoPlayer({ src, onTimeUpdate, onLoadedMetadata }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(true)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let animationFrameId: number | null = null
    let lastLogTime = 0
    let rafCallCount = 0
    
    // Use requestAnimationFrame for smoother time tracking during playback
    // This gives us ~60fps updates instead of the ~4fps from timeupdate event
    const rafLoop = () => {
      if (video && !video.paused) {
        const now = performance.now()
        rafCallCount++
        
        // Log every 500ms during playback to avoid spam
        if (now - lastLogTime > 500) {
          debugLog('VideoPlayer:rafLoop', 'RAF update', {
            currentTime: video.currentTime,
            rafCallsInLastInterval: rafCallCount,
            avgRafInterval: rafCallCount > 0 ? 500 / rafCallCount : 0,
            videoReadyState: video.readyState,
          })
          rafCallCount = 0
          lastLogTime = now
        }
        
        setCurrentTime(video.currentTime)
        onTimeUpdate?.(video.currentTime)
        animationFrameId = requestAnimationFrame(rafLoop)
      }
    }

    const handleTimeUpdate = () => {
      // Fallback for when video is paused or seeking
      if (video.paused) {
        setCurrentTime(video.currentTime)
        onTimeUpdate?.(video.currentTime)
      }
    }

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
      debugLog('VideoPlayer:loadedMetadata', 'Video metadata loaded', {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        // Calculated FPS from duration and estimated frame count not available directly
      })
      onLoadedMetadata?.(video.duration, video.videoWidth, video.videoHeight)
    }

    const handlePlay = () => {
      debugLog('VideoPlayer:play', 'Video started playing', {
        currentTime: video.currentTime,
      })
      setIsPlaying(true)
      lastLogTime = performance.now()
      rafCallCount = 0
      // Start RAF loop for smooth updates
      animationFrameId = requestAnimationFrame(rafLoop)
    }
    
    const handlePause = () => {
      debugLog('VideoPlayer:pause', 'Video paused', {
        currentTime: video.currentTime,
      })
      setIsPlaying(false)
      // Stop RAF loop
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
      // Update time one more time when paused
      setCurrentTime(video.currentTime)
      onTimeUpdate?.(video.currentTime)
    }
    
    const handleEnded = () => {
      debugLog('VideoPlayer:ended', 'Video ended', {
        currentTime: video.currentTime,
        duration: video.duration,
      })
      setIsPlaying(false)
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
    }
    
    const handleSeeking = () => {
      debugLog('VideoPlayer:seeking', 'User seeking', {
        currentTime: video.currentTime,
      })
      // Update immediately when user seeks
      setCurrentTime(video.currentTime)
      onTimeUpdate?.(video.currentTime)
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('seeking', handleSeeking)
    video.addEventListener('seeked', handleSeeking)

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('seeking', handleSeeking)
      video.removeEventListener('seeked', handleSeeking)
    }
  }, [onTimeUpdate, onLoadedMetadata])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play()
    } else {
      video.pause()
    }
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    video.muted = !video.muted
    setIsMuted(video.muted)
  }, [])

  const skip = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video) return

    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds))
  }, [])

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video) return

    const rect = e.currentTarget.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    video.currentTime = percent * video.duration
  }, [])

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      video.requestFullscreen()
    }
  }, [])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div 
      className="relative w-full h-full group"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain bg-black"
        playsInline
        onClick={togglePlay}
      />

      {/* Controls Overlay */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity',
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
        )}
      >
        {/* Progress Bar */}
        <div 
          className="w-full h-1 bg-white/30 rounded-full mb-3 cursor-pointer group/progress"
          onClick={seek}
        >
          <div
            className="h-full bg-primary rounded-full relative"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={() => skip(-10)}
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={() => skip(10)}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <span className="text-white text-sm ml-2">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={toggleMute}
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={toggleFullscreen}
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Play Button Overlay */}
      {!isPlaying && (
        <button
          className="absolute inset-0 flex items-center justify-center bg-black/20"
          onClick={togglePlay}
        >
          <div className="h-16 w-16 rounded-full bg-primary/90 flex items-center justify-center">
            <Play className="h-8 w-8 text-white ml-1" />
          </div>
        </button>
      )}
    </div>
  )
}

