'use client'

import { useState, useRef, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Loader2, MousePointer2, CheckCircle2, RefreshCw, AlertCircle, Zap } from 'lucide-react'
import { apiClient, SegmentationModel } from '@/lib/api'

interface ObjectClickSelectorProps {
  videoId: string
  frameImage: string
  frameWidth: number
  frameHeight: number
  onSegmentConfirmed: (clickPoint: { x: number; y: number }, model: SegmentationModel) => void
  onCancel: () => void
}

interface ClickPoint {
  x: number
  y: number
  displayX: number
  displayY: number
}

const MODELS: { id: SegmentationModel; name: string; speed: string; note?: string }[] = [
  { id: 'sam2', name: 'SAM2', speed: '280ms', note: 'recommended' },
  { id: 'fastsam', name: 'FastSAM', speed: '95ms', note: 'COCO objects only' },
]

export function ObjectClickSelector({
  videoId,
  frameImage,
  frameWidth,
  frameHeight,
  onSegmentConfirmed,
  onCancel,
}: ObjectClickSelectorProps) {
  // SAM2 is default - works with any object, FastSAM requires COCO detection
  const [selectedModel, setSelectedModel] = useState<SegmentationModel>('sam2')
  const [clickPoint, setClickPoint] = useState<ClickPoint | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  // Calculate aspect ratio
  const aspectRatio = frameWidth / frameHeight
  const isPortrait = aspectRatio < 1

  // Fetch available models info (for MPS badge display)
  const modelsQuery = useQuery({
    queryKey: ['segmentation-models'],
    queryFn: () => apiClient.getAvailableModels(),
    staleTime: 60000,
  })

  const segmentMutation = useMutation({
    mutationFn: async (point: { x: number; y: number }) => {
      return apiClient.segmentAtClick(videoId, point, selectedModel)
    },
  })

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current) return
    const rect = imageRef.current.getBoundingClientRect()
    const displayX = e.clientX - rect.left
    const displayY = e.clientY - rect.top
    const x = Math.round(displayX * (frameWidth / rect.width))
    const y = Math.round(displayY * (frameHeight / rect.height))
    console.log(`Click: display(${displayX.toFixed(0)}, ${displayY.toFixed(0)}) -> frame(${x}, ${y})`)
    setClickPoint({ x, y, displayX, displayY })
    segmentMutation.mutate({ x, y })
  }, [frameWidth, frameHeight, segmentMutation])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current) return
    const rect = imageRef.current.getBoundingClientRect()
    setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  // Container style based on aspect ratio
  const containerStyle: React.CSSProperties = isPortrait
    ? { maxWidth: '400px', margin: '0 auto' }  // Limit width for portrait videos
    : {}

  // Model selection + initial click state
  if (!clickPoint) {
    return (
      <div className="space-y-3">
        {/* Header row with model selection */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            <MousePointer2 className="h-4 w-4 text-emerald-500" />
            <span className="font-medium text-zinc-300">Click on the barbell</span>
          </div>
          
          <div className="flex items-center gap-1">
            {MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className={`
                  px-2 py-1 text-xs rounded transition-all
                  ${selectedModel === model.id
                    ? 'bg-emerald-500/20 text-emerald-400 font-medium'
                    : 'text-zinc-500 hover:text-zinc-300'
                  }
                `}
                title={model.note}
              >
                {model.name}
                {model.note === 'recommended' && selectedModel === model.id && (
                  <span className="ml-1 text-[8px] opacity-60">✓</span>
                )}
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs h-7 ml-2">
              Cancel
            </Button>
          </div>
        </div>

        {modelsQuery.data?.mps_available && selectedModel === 'sam2' && (
          <div className="text-[10px] text-emerald-500/70 flex items-center gap-1">
            <Zap className="h-3 w-3" />
            Mac GPU accelerated
          </div>
        )}

        {/* Frame image - adaptive container */}
        <div style={containerStyle}>
          <div 
            ref={containerRef}
            className="relative cursor-crosshair rounded overflow-hidden bg-black"
            style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <img
              ref={imageRef}
              src={`data:image/jpeg;base64,${frameImage}`}
              alt="Click to select"
              className="absolute inset-0 w-full h-full object-cover"
              onClick={handleImageClick}
              onMouseMove={handleMouseMove}
              draggable={false}
            />
            {isHovering && (
              <div 
                className="absolute pointer-events-none"
                style={{ left: hoverPos.x, top: hoverPos.y, transform: 'translate(-50%, -50%)' }}
              >
                <div className="w-6 h-6 border-2 border-emerald-400 rounded-full" />
                <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-emerald-400 rounded-full -translate-x-1/2 -translate-y-1/2" />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>{frameWidth}×{frameHeight} • {MODELS.find(m => m.id === selectedModel)?.name}</span>
          <span>Bar + Person tracking</span>
        </div>
      </div>
    )
  }

  // Loading state
  if (segmentMutation.isPending) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
          <span className="text-zinc-300">Segmenting with {MODELS.find(m => m.id === selectedModel)?.name}...</span>
        </div>
        <div style={containerStyle}>
          <div 
            className="relative rounded overflow-hidden bg-black opacity-50"
            style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
          >
            <img
              src={`data:image/jpeg;base64,${frameImage}`}
              alt="Processing"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div
              className="absolute w-4 h-4 rounded-full bg-emerald-500/50 border-2 border-emerald-400 animate-pulse"
              style={{ left: clickPoint.displayX - 8, top: clickPoint.displayY - 8 }}
            />
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (segmentMutation.isError) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" />
          <span>Failed: {segmentMutation.error?.message || 'Could not segment'}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => { setClickPoint(null); segmentMutation.reset() }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Retry
          </Button>
        </div>
      </div>
    )
  }

  // Success state
  if (segmentMutation.isSuccess) {
    const result = segmentMutation.data

    if (!result.success) {
      const errorMsg = result.message || `No object found at (${clickPoint.x}, ${clickPoint.y})`
      const isFastSamError = errorMsg.includes('FastSAM')
      
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-amber-500">
            <AlertCircle className="h-4 w-4" />
            <span>{isFastSamError ? 'FastSAM detection failed' : errorMsg}</span>
          </div>
          <div className="text-[10px] text-zinc-500">
            {isFastSamError 
              ? 'FastSAM requires COCO objects. Switch to SAM2 for barbells.'
              : 'Try clicking directly on the barbell.'}
          </div>
          <div style={containerStyle}>
            <div 
              className="relative rounded overflow-hidden bg-black"
              style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
            >
              <img
                src={`data:image/jpeg;base64,${frameImage}`}
                alt="Frame"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-red-500 border-2 border-white"
                style={{ 
                  left: `${(clickPoint.x / frameWidth) * 100}%`, 
                  top: `${(clickPoint.y / frameHeight) * 100}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              />
            </div>
          </div>
          <Button size="sm" onClick={() => { setClickPoint(null); segmentMutation.reset() }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Try again
          </Button>
        </div>
      )
    }

    const center = result.center || result.center_of_mass

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="font-medium text-zinc-300">Object detected</span>
            <span className="text-[10px] text-zinc-500">({result.model_used || selectedModel})</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setClickPoint(null); segmentMutation.reset() }} className="text-xs h-7">
            <RefreshCw className="h-3 w-3 mr-1" />Retry
          </Button>
        </div>

        <div style={containerStyle}>
          <div 
            className="rounded overflow-hidden bg-black"
            style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
          >
            <img
              src={result.mask_preview ? `data:image/jpeg;base64,${result.mask_preview}` : `data:image/jpeg;base64,${frameImage}`}
              alt="Segmentation"
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Center: ({center?.[0]}, {center?.[1]})</span>
          <span>Area: {result.area_pixels?.toLocaleString()} px</span>
        </div>

        <Button className="w-full" onClick={() => onSegmentConfirmed({ x: clickPoint.x, y: clickPoint.y }, selectedModel)}>
          Start Tracking
        </Button>
      </div>
    )
  }

  return null
}
