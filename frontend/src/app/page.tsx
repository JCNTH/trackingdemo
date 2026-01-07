'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { VideoUpload } from '@/components/VideoUpload'
import { 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Upload,
  Play
} from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import type { Video } from '@/types'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

function VideoThumbnail({ video }: { video: Video }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)

  useEffect(() => {
    async function getVideoUrl() {
      if (video.storage_path) {
        const { data } = supabase.storage
          .from('videos')
          .getPublicUrl(video.storage_path)
        setThumbnailUrl(data.publicUrl)
      }
    }
    getVideoUrl()
  }, [video.storage_path])

  return (
    <div className="aspect-video bg-zinc-900 rounded overflow-hidden relative group">
      {thumbnailUrl ? (
        <>
          <video
            src={thumbnailUrl}
            className="w-full h-full object-cover"
            muted
            preload="metadata"
            onLoadedMetadata={(e) => {
              const vid = e.target as HTMLVideoElement
              vid.currentTime = 1
            }}
          />
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Play className="h-8 w-8 text-white/90" />
          </div>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: Video['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  if (status === 'processing') return <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
  return <Clock className="h-3.5 w-3.5 text-zinc-400" />
}

export default function HomePage() {
  const [showUpload, setShowUpload] = useState(false)

  const { data: videos, isLoading, refetch } = useQuery({
    queryKey: ['videos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (error) throw error
      return data as Video[]
    },
  })

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-zinc-100">
        <div className="max-w-[1600px] mx-auto px-6 h-12 flex items-center justify-between">
          <span className="font-medium text-zinc-900">Exercise Tracker</span>
          <Button 
            variant="ghost"
            size="sm" 
            onClick={() => setShowUpload(!showUpload)}
            className="h-7 px-2 text-xs"
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            {showUpload ? 'Close' : 'Upload'}
          </Button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-4">
        {/* Upload Section */}
        {showUpload && (
          <div className="mb-6 p-4 bg-zinc-50 rounded">
            <VideoUpload onUploadComplete={() => {
              refetch()
              setShowUpload(false)
            }} />
          </div>
        )}

        {/* Videos */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
          </div>
        ) : videos && videos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {videos.map((video) => (
              <Link key={video.id} href={`/videos/${video.id}`} className="group">
                <VideoThumbnail video={video} />
                <div className="mt-1.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-900 truncate group-hover:text-emerald-600 transition-colors">
                      {video.filename}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {new Date(video.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <StatusIcon status={video.status} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-sm text-zinc-400 mb-3">No videos yet</p>
            <Button 
              variant="outline"
              size="sm" 
              onClick={() => setShowUpload(true)}
              className="h-8"
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Upload Video
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
