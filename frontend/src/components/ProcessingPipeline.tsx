'use client'

/**
 * ProcessingPipeline Component
 * 
 * Shows step-by-step AI processing progress similar to DeepGaitLab.
 * Displays each step of the tracking pipeline:
 * 1. Object Selection (SAM2) - User clicks to select barbell
 * 2. Person Detection (YOLO) - AI detects the person
 * 3. Frame-by-frame Tracking - Template matching + pose estimation
 * 4. Analysis Complete - Results ready
 */

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { 
  CheckCircle2, Circle, Loader2, 
  Target, Users, Play, BarChart3,
  ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProcessingStep {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  progress?: number
  result?: string
}

interface ProcessingPipelineProps {
  videoId: string
  isProcessing: boolean
  processingStarted: boolean
  trackingData?: {
    click_to_track?: {
      enabled: boolean
      click_point: [number, number]
      total_frames: number
      tracked_frames: number
      tracking_rate: number
    }
    person_tracking?: {
      enabled: boolean
      detected_frames: number
      detection_rate: number
    }
    tracking_stats?: {
      sam2_initial?: number
      template_tracking?: number
      lost?: number
    }
  }
}

export function ProcessingPipeline({ 
  videoId, 
  isProcessing, 
  processingStarted,
  trackingData 
}: ProcessingPipelineProps) {
  const [steps, setSteps] = useState<ProcessingStep[]>([
    {
      id: 'selection',
      title: 'Object Selection',
      description: 'SAM2 segments the barbell from your click point',
      icon: <Target className="h-4 w-4" />,
      status: 'pending',
    },
    {
      id: 'person',
      title: 'Person Detection',
      description: 'YOLO detects and segments the person in frame',
      icon: <Users className="h-4 w-4" />,
      status: 'pending',
    },
    {
      id: 'tracking',
      title: 'Frame-by-frame Tracking',
      description: 'Template matching tracks objects through all frames',
      icon: <Play className="h-4 w-4" />,
      status: 'pending',
      progress: 0,
    },
    {
      id: 'analysis',
      title: 'Movement Analysis',
      description: 'Calculate bar path, velocity, and form metrics',
      icon: <BarChart3 className="h-4 w-4" />,
      status: 'pending',
    },
  ])

  // Update steps based on processing state
  useEffect(() => {
    if (isProcessing) {
      // Simulate step progression during processing
      setSteps(prev => prev.map((step, index) => {
        if (index === 0) return { ...step, status: 'completed', result: 'Object segmented' }
        if (index === 1) return { ...step, status: 'completed', result: 'Person detected' }
        if (index === 2) return { ...step, status: 'in_progress', progress: 50 }
        return step
      }))
    }
  }, [isProcessing])

  // Update when tracking data arrives (processing complete)
  useEffect(() => {
    if (trackingData?.click_to_track?.enabled) {
      const trackingRate = (trackingData.click_to_track.tracking_rate * 100).toFixed(0)
      const personRate = trackingData.person_tracking 
        ? (trackingData.person_tracking.detection_rate * 100).toFixed(0)
        : null
      
      setSteps(prev => prev.map((step, index) => {
        if (index === 0) return { 
          ...step, 
          status: 'completed', 
          result: `Click: (${trackingData.click_to_track!.click_point[0]}, ${trackingData.click_to_track!.click_point[1]})` 
        }
        if (index === 1) return { 
          ...step, 
          status: 'completed', 
          result: personRate ? `${personRate}% detection rate` : 'Person detected' 
        }
        if (index === 2) return { 
          ...step, 
          status: 'completed', 
          progress: 100, 
          result: `${trackingRate}% frames tracked` 
        }
        if (index === 3) return { 
          ...step, 
          status: 'completed', 
          result: 'Metrics calculated' 
        }
        return step
      }))
    }
  }, [trackingData])

  const getStepIcon = (step: ProcessingStep) => {
    if (step.status === 'completed') {
      return <CheckCircle2 className="h-5 w-5 text-green-500" />
    }
    if (step.status === 'in_progress') {
      return <Loader2 className="h-5 w-5 text-primary animate-spin" />
    }
    if (step.status === 'error') {
      return <Circle className="h-5 w-5 text-red-500" />
    }
    return <Circle className="h-5 w-5 text-muted-foreground" />
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 pb-2 border-b">
        <Play className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium">Processing Pipeline</span>
      </div>

      <div className="space-y-0.5">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-2 py-1">
            {/* Step indicator */}
            <div className="flex-shrink-0">
              {getStepIcon(step)}
            </div>

            {/* Step content - compact */}
            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
              <span className={cn(
                "text-xs truncate",
                step.status === 'completed' ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.title}
              </span>
              {step.status === 'completed' && step.result && (
                <span className="text-[10px] text-green-600 font-medium truncate">
                  {step.result}
                </span>
              )}
              {step.status === 'in_progress' && step.progress !== undefined && (
                <span className="text-[10px] text-primary font-medium">
                  {step.progress}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Processing footer */}
      {isProcessing && (
        <div className="pt-2 border-t">
          <Progress value={steps.find(s => s.status === 'in_progress')?.progress || 0} className="h-1" />
          <p className="text-[10px] text-center text-muted-foreground mt-1">
            ~30-60 seconds
          </p>
        </div>
      )}
    </Card>
  )
}

