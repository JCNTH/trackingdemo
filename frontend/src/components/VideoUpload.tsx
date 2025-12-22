/**
 * VideoUpload Component
 * 
 * Two-step upload flow:
 * 1. Drag-and-drop or browse for video file
 * 2. Confirm and upload to Supabase Storage
 */
'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, FileVideo, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { type ExerciseType } from '@/types'

interface VideoUploadProps {
  onUploadComplete?: () => void
}

export function VideoUpload({ onUploadComplete }: VideoUploadProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const exerciseType: ExerciseType = 'bench_press' // Always bench press

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

  const handleUpload = () => {
    if (file) {
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

      uploadMutation.mutate({ file, exerciseType }, {
        onSettled: () => {
          clearInterval(interval)
          setUploadProgress(100)
        },
      })
    }
  }

  const clearFile = () => {
    setFile(null)
    setUploadProgress(0)
  }

  return (
    <div className="space-y-3">
      {!file ? (
        /* Step 1: Upload Video */
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
            MP4, MOV, AVI supported · Bench Press tracking
          </p>
        </div>
      ) : (
        /* Step 2: Confirm & Upload */
        <div className="border rounded-lg p-3">

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
