'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Camera,
  Sparkles,
  Scale
} from 'lucide-react'
import { apiClient } from '@/lib/api'

interface WeightDetectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoId: string
  onDetectionComplete: (weight: number, unit: string) => void
}

type DetectionStep = 'extracting' | 'analyzing' | 'complete' | 'error'

interface DetectionResult {
  success: boolean
  total_weight: number | null
  weight_unit: string
  bar_weight?: number
  plates_left?: Array<{ weight: number; color: string; count: number }>
  plates_right?: Array<{ weight: number; color: string; count: number }>
  confidence?: number
  notes?: string
  error?: string
  frame_analyzed?: number
}

export function WeightDetectionModal({
  open,
  onOpenChange,
  videoId,
  onDetectionComplete,
}: WeightDetectionModalProps) {
  const [step, setStep] = useState<DetectionStep>('extracting')
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [frameImage, setFrameImage] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      runDetection()
    } else {
      // Reset state when modal closes
      setStep('extracting')
      setResult(null)
      setFrameImage(null)
    }
  }, [open, videoId])

  const runDetection = async () => {
    try {
      // Step 1: Extracting frame
      setStep('extracting')
      
      // Small delay to show the extracting state
      await new Promise(resolve => setTimeout(resolve, 800))
      
      // Step 2: Analyzing with Claude Vision
      setStep('analyzing')
      
      const response = await apiClient.detectWeight(videoId)
      
      // Step 3: Complete
      setResult(response)
      setStep(response.success ? 'complete' : 'error')
      
      if (response.success && response.total_weight) {
        onDetectionComplete(response.total_weight, response.weight_unit || 'lbs')
      }
    } catch (error) {
      setStep('error')
      setResult({
        success: false,
        total_weight: null,
        weight_unit: 'lbs',
        error: error instanceof Error ? error.message : 'Detection failed',
      })
    }
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  const handleRetry = () => {
    setStep('extracting')
    setResult(null)
    runDetection()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Weight Detection
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          {/* Progress Steps */}
          <div className="space-y-4">
            {/* Step 1: Extracting Frame */}
            <StepItem
              icon={Camera}
              label="Extracting video frame"
              description="Capturing a clear frame showing the barbell setup"
              status={
                step === 'extracting' ? 'active' :
                step === 'analyzing' || step === 'complete' ? 'complete' : 'pending'
              }
            />

            {/* Step 2: Claude Vision Analysis */}
            <StepItem
              icon={Sparkles}
              label="Analyzing with Claude Vision"
              description="AI is identifying and counting weight plates"
              status={
                step === 'analyzing' ? 'active' :
                step === 'complete' ? 'complete' : 
                step === 'error' ? 'error' : 'pending'
              }
            />
          </div>

          {/* Results */}
          {step === 'complete' && result?.success && (
            <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Detected Weight</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold tabular-nums">
                    {result.total_weight}
                  </span>
                  <span className="text-lg text-muted-foreground">
                    {result.weight_unit}
                  </span>
                </div>
                
                {/* Plate Breakdown */}
                {(result.plates_left?.length || result.plates_right?.length) && (
                  <div className="mt-4 pt-4 border-t border-primary/10">
                    <p className="text-xs text-muted-foreground mb-2">Breakdown</p>
                    <div className="text-xs space-y-1">
                      {result.bar_weight && (
                        <p>Bar: {result.bar_weight} {result.weight_unit}</p>
                      )}
                      {result.plates_left?.map((plate, i) => (
                        <p key={`left-${i}`}>
                          {plate.count}x {plate.weight}{result.weight_unit} {plate.color} (each side)
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {result.confidence && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Confidence: {Math.round(result.confidence * 100)}%
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error State */}
          {step === 'error' && (
            <div className="mt-6 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Detection Failed</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {result?.error || 'Could not detect weight plates. Try a video with a clearer view of the barbell.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {result?.notes && step === 'complete' && (
            <p className="mt-4 text-xs text-muted-foreground text-center">
              {result.notes}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2">
          {step === 'error' && (
            <Button variant="outline" onClick={handleRetry}>
              Try Again
            </Button>
          )}
          <Button 
            onClick={handleClose}
            disabled={step === 'extracting' || step === 'analyzing'}
          >
            {step === 'complete' ? 'Done' : 'Close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StepItem({
  icon: Icon,
  label,
  description,
  status,
}: {
  icon: React.ElementType
  label: string
  description: string
  status: 'pending' | 'active' | 'complete' | 'error'
}) {
  return (
    <div className={`flex items-start gap-3 ${status === 'pending' ? 'opacity-40' : ''}`}>
      <div className={`
        h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0
        ${status === 'active' ? 'bg-primary/10' : ''}
        ${status === 'complete' ? 'bg-primary/10' : ''}
        ${status === 'error' ? 'bg-destructive/10' : ''}
        ${status === 'pending' ? 'bg-muted' : ''}
      `}>
        {status === 'active' ? (
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
        ) : status === 'complete' ? (
          <CheckCircle2 className="h-4 w-4 text-primary" />
        ) : status === 'error' ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 pt-1">
        <p className={`text-sm font-medium ${status === 'active' ? 'text-primary' : ''}`}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}
