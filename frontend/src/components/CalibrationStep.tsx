'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PersonSelector } from '@/components/PersonSelector'
import { 
  Loader2, AlertCircle, RefreshCw, Target, 
  ChevronRight, CheckCircle2, Scale
} from 'lucide-react'
import { apiClient, type DetectedPerson, type CalibrationResponse, type PoseBackend, type WeightDetectionResult } from '@/lib/api'

interface CalibrationStepProps {
  videoId: string
  onComplete: (selectedPersonBbox?: [number, number, number, number]) => void
  onCancel: () => void
}

type CalibrationState = 'loading' | 'select_person' | 'confirm_bar' | 'ready'

export function CalibrationStep({
  videoId,
  onComplete,
  onCancel,
}: CalibrationStepProps) {
  const [state, setState] = useState<CalibrationState>('loading')
  const [selectedPerson, setSelectedPerson] = useState<DetectedPerson | null>(null)
  const [frameNumber, setFrameNumber] = useState(0)
  const [poseBackend, setPoseBackend] = useState<PoseBackend>('yolo')

  // Fetch calibration data
  const {
    data: calibrationData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['calibration', videoId, frameNumber, poseBackend],
    queryFn: () => apiClient.calibrateVideo(videoId, frameNumber, poseBackend),
    retry: false,
    refetchOnWindowFocus: false,
  })
  
  const handleBackendChange = (backend: PoseBackend) => {
    setPoseBackend(backend)
    setState('loading')
  }

  // When calibration data loads, determine next state
  if (calibrationData && state === 'loading') {
    if (calibrationData.people.length === 0) {
      // No people detected - might want to try different frame
      setState('select_person')
    } else if (calibrationData.people.length === 1) {
      // Only one person - auto-select but still show confirmation
      setSelectedPerson(calibrationData.people[0])
      setState('confirm_bar')
    } else {
      // Multiple people - need selection
      setState('select_person')
    }
  }

  const handlePersonSelected = (person: DetectedPerson) => {
    setSelectedPerson(person)
    setState('confirm_bar')
  }

  const handleSkipSelection = () => {
    // Process without selection (use default ROI)
    onComplete(undefined)
  }

  const handleConfirmBar = () => {
    if (selectedPerson) {
      // Pass the normalized bbox of the selected person
      onComplete(selectedPerson.bbox_normalized as [number, number, number, number])
    } else {
      onComplete(undefined)
    }
  }

  const handleTryDifferentFrame = () => {
    // Try a frame 1 second into the video
    const newFrame = Math.min(
      frameNumber + Math.floor(calibrationData?.fps || 30),
      (calibrationData?.total_frames || 100) - 1
    )
    setFrameNumber(newFrame)
    setState('loading')
    refetch()
  }

  const handleBackToSelection = () => {
    setSelectedPerson(null)
    setState('select_person')
  }

  if (isLoading || state === 'loading') {
    return (
      <Card className="p-8">
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <div className="p-4 rounded-full bg-primary/10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <div className="text-center">
            <p className="font-medium">Analyzing Video</p>
            <p className="text-sm text-muted-foreground mt-1">
              Detecting people, poses, and weight...
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-8">
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <div className="p-4 rounded-full bg-destructive/10">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <div className="text-center">
            <p className="font-medium text-destructive">Analysis Failed</p>
            <p className="text-sm text-muted-foreground mt-1">
              {error.message}
            </p>
          </div>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  if (!calibrationData) {
    return null
  }

  // State: Select Person
  if (state === 'select_person') {
    return (
      <div className="space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-sm font-bold">
            1
          </div>
          <div className="flex-1 h-1 bg-muted rounded-full">
            <div className="w-1/2 h-full bg-primary/30 rounded-full" />
          </div>
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-foreground text-sm font-bold">
            2
          </div>
        </div>

        {/* Pose Backend Selector - Compact inline toggle */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Pose Model</span>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 p-0.5 bg-muted rounded-md">
              <button
                onClick={() => handleBackendChange('yolo')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${
                  poseBackend === 'yolo'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                YOLO
              </button>
              <button
                onClick={() => handleBackendChange('mediapipe')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${
                  poseBackend === 'mediapipe'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                MediaPipe
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {calibrationData?.people.length || 0} detected
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main content - Person Selector */}
          <div className="lg:col-span-2">
            <PersonSelector
              calibrationData={calibrationData}
              onSelectPerson={handlePersonSelected}
              onSkip={handleSkipSelection}
            />

            {calibrationData.people.length === 0 && (
              <Button 
                variant="outline" 
                onClick={handleTryDifferentFrame}
                className="w-full mt-4"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Different Frame
              </Button>
            )}
          </div>

          {/* Detection Log Panel */}
          <Card className="p-4 bg-muted/30 h-fit">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Detection Log
            </h4>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Backend</span>
                <span className="text-foreground">{calibrationData.pose_backend?.toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Frame</span>
                <span className="text-foreground">{calibrationData.frame_number} / {calibrationData.total_frames}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Resolution</span>
                <span className="text-foreground">{calibrationData.width}x{calibrationData.height}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">FPS</span>
                <span className="text-foreground">{calibrationData.fps.toFixed(1)}</span>
              </div>
              <div className="border-t border-border my-2" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">People</span>
                <span className={calibrationData.people.length > 0 ? 'text-green-600' : 'text-amber-600'}>
                  {calibrationData.people.length} found
                </span>
              </div>
              {calibrationData.people.map((person, i) => (
                <div key={person.id} className="pl-2 text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Person {i + 1}</span>
                    <span>{(person.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between pl-2">
                    <span>Pose</span>
                    <span className={person.pose ? 'text-green-600' : 'text-amber-600'}>
                      {person.pose ? `${person.pose.length} pts` : 'none'}
                    </span>
                  </div>
                  <div className="flex justify-between pl-2">
                    <span>Bar</span>
                    <span className={person.bar_center ? 'text-green-600' : 'text-muted-foreground'}>
                      {person.bar_center ? 'detected' : 'none'}
                    </span>
                  </div>
                </div>
              ))}
              {/* Weight Detection */}
              <div className="border-t border-border my-2" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Weight</span>
                {calibrationData.weight_detection?.success && calibrationData.weight_detection.total_weight ? (
                  <span className="text-green-600">
                    {calibrationData.weight_detection.total_weight} {calibrationData.weight_detection.weight_unit || 'lbs'}
                  </span>
                ) : (
                  <span className="text-amber-600">detecting...</span>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  // State: Confirm Bar Position
  if (state === 'confirm_bar' && selectedPerson) {
    const hasBarDetection = selectedPerson.bar_center !== null

    return (
      <div className="space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-sm font-bold">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="flex-1 h-1 bg-primary rounded-full" />
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-sm font-bold">
            2
          </div>
        </div>

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Target className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">Verify Bar Tracking</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Review the bar detection before processing
            </p>
          </div>
        </div>

        {/* Status Card */}
        <Card className="p-5">
          {hasBarDetection ? (
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-full bg-primary/10">
                <CheckCircle2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-primary">Bar Position Detected</p>
                <p className="text-sm text-muted-foreground mt-1">
                  The orange crosshair shows the estimated bar center (midpoint between wrists).
                  This will be tracked throughout the video.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-full bg-amber-500/10">
                <AlertCircle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="font-medium text-amber-600">Bar Not Visible</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Wrists aren't clearly visible in this frame. Bar tracking will work 
                  on frames where both wrists are visible.
                </p>
              </div>
            </div>
          )}
        </Card>

        {/* Visual Preview with Bar Position */}
        {calibrationData?.frame_image && (
          <Card className="overflow-hidden">
            <div className="relative max-h-[400px] flex items-center justify-center bg-black/5">
              <img
                src={`data:image/jpeg;base64,${calibrationData.frame_image}`}
                alt="Frame preview"
                className="max-h-[400px] w-auto object-contain"
              />
              {/* Overlay canvas for drawing crosshair */}
              <canvas
                ref={(canvas) => {
                  if (!canvas || !selectedPerson) return
                  const ctx = canvas.getContext('2d')
                  if (!ctx) return
                  
                  const img = canvas.previousElementSibling as HTMLImageElement
                  if (!img.complete) {
                    img.onload = () => drawOverlay()
                    return
                  }
                  drawOverlay()
                  
                  function drawOverlay() {
                    // Use displayed dimensions, not natural
                    const displayWidth = img.clientWidth
                    const displayHeight = img.clientHeight
                    
                    canvas.width = displayWidth
                    canvas.height = displayHeight
                    canvas.style.width = `${displayWidth}px`
                    canvas.style.height = `${displayHeight}px`
                    
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                    
                    // Draw selected person bbox
                    const bbox = selectedPerson!.bbox_normalized
                    const x1 = bbox[0] * canvas.width
                    const y1 = bbox[1] * canvas.height
                    const x2 = bbox[2] * canvas.width
                    const y2 = bbox[3] * canvas.height
                    
                    ctx.strokeStyle = '#10b981'
                    ctx.lineWidth = 2
                    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
                    
                    // Draw bar position crosshair if available
                    if (selectedPerson!.bar_center) {
                      const barX = selectedPerson!.bar_center.x * canvas.width
                      const barY = selectedPerson!.bar_center.y * canvas.height
                      const size = 15
                      
                      // Orange crosshair
                      ctx.strokeStyle = '#f97316'
                      ctx.lineWidth = 3
                      ctx.lineCap = 'round'
                      
                      // Horizontal line
                      ctx.beginPath()
                      ctx.moveTo(barX - size, barY)
                      ctx.lineTo(barX + size, barY)
                      ctx.stroke()
                      
                      // Vertical line
                      ctx.beginPath()
                      ctx.moveTo(barX, barY - size)
                      ctx.lineTo(barX, barY + size)
                      ctx.stroke()
                      
                      // Center dot
                      ctx.fillStyle = '#f97316'
                      ctx.beginPath()
                      ctx.arc(barX, barY, 4, 0, Math.PI * 2)
                      ctx.fill()
                      
                      // Label
                      ctx.font = 'bold 12px system-ui'
                      ctx.fillStyle = '#f97316'
                      ctx.fillText('BAR', barX + size + 6, barY + 4)
                    }
                  }
                }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              />
            </div>
          </Card>
        )}

        {/* Weight Detection Result */}
        {calibrationData.weight_detection && (
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Scale className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                {calibrationData.weight_detection.success && calibrationData.weight_detection.total_weight ? (
                  <>
                    <p className="text-xs text-muted-foreground">Detected Weight</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold tabular-nums">
                        {calibrationData.weight_detection.total_weight}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {calibrationData.weight_detection.weight_unit || 'lbs'}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-muted-foreground">Weight Not Detected</p>
                    <p className="text-xs text-muted-foreground">
                      {calibrationData.weight_detection.error || 'Could not identify weight plates'}
                    </p>
                  </>
                )}
              </div>
              {calibrationData.weight_detection.confidence && (
                <span className="text-xs text-muted-foreground">
                  {Math.round(calibrationData.weight_detection.confidence * 100)}% confident
                </span>
              )}
            </div>
          </Card>
        )}

        {/* Selected Person Summary */}
        <Card className="p-4 bg-muted/50">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-bold">
              {selectedPerson.id + 1}
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">Person {selectedPerson.id + 1}</p>
              <p className="text-xs text-muted-foreground">
                Confidence: {(selectedPerson.confidence * 100).toFixed(0)}%
              </p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
        </Card>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={handleBackToSelection} className="px-6">
            Back
          </Button>
          <Button onClick={handleConfirmBar} className="flex-1" size="lg">
            <ChevronRight className="h-4 w-4 mr-2" />
            Start Processing
          </Button>
        </div>
      </div>
    )
  }

  return null
}

