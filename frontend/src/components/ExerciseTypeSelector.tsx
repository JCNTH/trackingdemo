'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2 } from 'lucide-react'

// Exercise types with metadata for tracking
export const EXERCISE_TYPES = {
  bench_press: {
    id: 'bench_press',
    name: 'Bench Press',
    description: 'Horizontal pushing movement',
    category: 'push',
    keyAngles: ['elbow', 'shoulder'],
  },
  squat: {
    id: 'squat',
    name: 'Squat',
    description: 'Lower body compound movement',
    category: 'legs',
    keyAngles: ['knee', 'hip', 'ankle'],
  },
  deadlift: {
    id: 'deadlift',
    name: 'Deadlift',
    description: 'Hip hinge movement',
    category: 'pull',
    keyAngles: ['hip', 'knee', 'back'],
  },
  overhead_press: {
    id: 'overhead_press',
    name: 'Overhead Press',
    description: 'Vertical pushing movement',
    category: 'push',
    keyAngles: ['shoulder', 'elbow'],
  },
  row: {
    id: 'row',
    name: 'Barbell Row',
    description: 'Horizontal pulling movement',
    category: 'pull',
    keyAngles: ['elbow', 'back', 'hip'],
  },
  other: {
    id: 'other',
    name: 'Other Exercise',
    description: 'General movement tracking',
    category: 'general',
    keyAngles: [],
  },
} as const

export type ExerciseType = keyof typeof EXERCISE_TYPES

interface ExerciseTypeSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (exerciseType: ExerciseType) => void
}

export function ExerciseTypeSelector({
  open,
  onOpenChange,
  onSelect,
}: ExerciseTypeSelectorProps) {
  const [selectedType, setSelectedType] = useState<ExerciseType | null>(null)

  const handleSelect = () => {
    if (selectedType) {
      onSelect(selectedType)
      onOpenChange(false)
      // Reset for next time
      setSelectedType(null)
    }
  }

  const handleCancel = () => {
    setSelectedType(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Select Exercise Type</DialogTitle>
          <DialogDescription>
            Choose the exercise you're uploading. This determines which joint angles we'll track.
          </DialogDescription>
        </DialogHeader>

        {/* Exercise Type List */}
        <div className="space-y-2 py-4">
          {Object.values(EXERCISE_TYPES).map((exercise) => {
            const isSelected = selectedType === exercise.id

            return (
              <button
                key={exercise.id}
                onClick={() => setSelectedType(exercise.id as ExerciseType)}
                className={`
                  w-full text-left px-4 py-3 rounded-lg border transition-all duration-150
                  ${isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }
                `}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{exercise.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {exercise.description}
                      {exercise.keyAngles.length > 0 && (
                        <span className="ml-1">
                          · Tracks: {exercise.keyAngles.join(', ')}
                        </span>
                      )}
                    </p>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedType}>
            Continue to Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

