'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, FileVideo, X, Loader2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { ExerciseTypeSelector, EXERCISE_TYPES, type ExerciseType } from './ExerciseTypeSelector'

interface VideoUploadProps {
  onUploadComplete?: () => void
}

export function VideoUpload({ onUploadComplete }: VideoUploadProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [showExerciseSelector, setShowExerciseSelector] = useState(false)
  const [selectedExerciseType, setSelectedExerciseType] = useState<ExerciseType | null>(null)

  const uploadMutation = useMutation({
    mutationFn: async ({ file, exerciseType }: { file: File; exerciseType: ExerciseType }) => {
      const timestamp = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const storagePath = `uploads/${timestamp}_${safeName}`

      const { error: uploadError } = await supabase.storage
        .from('videos')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) throw uploadError

      const { data: video, error: dbError } = await supabase
        .from('videos')
        .insert({
          filename: file.name,
          storage_path: storagePath,
          status: 'pending',
          exercise_type: exerciseType, // Store exercise type
        })
        .select()
        .single()

      if (dbError) throw dbError
      return video
    },
    onSuccess: (video) => {
      toast.success('Video uploaded successfully')
      onUploadComplete?.()
      router.push(`/videos/${video.id}`)
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`)
      setFile(null)
      setUploadProgress(0)
    },
  })

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      setFile(droppedFile)
    } else {
      toast.error('Please drop a valid video file')
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
    }
  }, [])

  const handleExerciseTypeSelect = (exerciseType: ExerciseType) => {
    setSelectedExerciseType(exerciseType)
  }

  const handleUpload = () => {
    if (file && selectedExerciseType) {
      setUploadProgress(0)
      const interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(interval)
            return 90
          }
          return prev + 10
        })
      }, 200)

      uploadMutation.mutate({ file, exerciseType: selectedExerciseType }, {
        onSettled: () => {
          clearInterval(interval)
          setUploadProgress(100)
        },
      })
    }
  }

  const clearFile = () => {
    setFile(null)
    setSelectedExerciseType(null)
    setUploadProgress(0)
  }

  const selectedExercise = selectedExerciseType ? EXERCISE_TYPES[selectedExerciseType] : null

  return (
    <div className="space-y-3">
      {/* Exercise Type Selector Modal */}
      <ExerciseTypeSelector
        open={showExerciseSelector}
        onOpenChange={setShowExerciseSelector}
        onSelect={handleExerciseTypeSelect}
      />

      {/* Step 1: Select Exercise Type */}
      {!selectedExerciseType ? (
        <button
          onClick={() => setShowExerciseSelector(true)}
          className={cn(
            'w-full border border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
            'border-border hover:border-primary/50 hover:bg-primary/5 group'
          )}
        >
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3 group-hover:bg-primary/20 transition-colors">
            <Upload className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            Upload Exercise Video
          </p>
          <p className="text-xs text-muted-foreground">
            Select exercise type to get started
          </p>
          <div className="flex items-center justify-center gap-1 mt-3 text-primary text-xs font-medium">
            Choose Exercise Type
            <ChevronRight className="h-3 w-3" />
          </div>
        </button>
      ) : !file ? (
        /* Step 2: Upload Video */
        <div className="space-y-3">
          {/* Selected Exercise Badge */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-primary/5 border border-primary/20">
            <div>
              <p className="text-sm font-medium">{selectedExercise?.name}</p>
              <p className="text-xs text-muted-foreground">
                Tracking: {selectedExercise?.keyAngles.join(', ') || 'general'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelectedExerciseType(null)}
            >
              Change
            </Button>
          </div>

          {/* Drop Zone */}
          <div
            className={cn(
              'border border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            )}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => document.getElementById('video-input')?.click()}
          >
            <input
              id="video-input"
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Drop a video here, or <span className="text-primary">browse</span>
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              MP4, MOV, AVI supported
            </p>
          </div>
        </div>
      ) : (
        /* Step 3: Confirm & Upload */
        <div className="border rounded-lg p-3">
          {/* Selected Exercise Badge (compact) */}
          <div className="px-2 py-1.5 rounded-md bg-primary/5 mb-3">
            <span className="text-xs font-medium">{selectedExercise?.name}</span>
            <span className="text-xs text-muted-foreground ml-1">
              · {selectedExercise?.keyAngles.join(', ') || 'general'}
            </span>
          </div>

          <div className="flex items-center gap-2.5 mb-3">
            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <FileVideo className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
            {!uploadMutation.isPending && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={clearFile}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {uploadMutation.isPending && (
            <div className="mb-3">
              <Progress value={uploadProgress} className="h-1" />
              <p className="text-xs text-muted-foreground text-center mt-1.5">
                Uploading... {uploadProgress}%
              </p>
            </div>
          )}

          <Button
            className="w-full h-8"
            size="sm"
            onClick={handleUpload}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-1.5" />
                Upload Video
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
