'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

const statusConfig = {
  pending: { icon: Clock, className: 'text-muted-foreground bg-muted', label: 'Pending' },
  processing: { icon: Loader2, className: 'text-amber-600 bg-amber-50 animate-spin', label: 'Processing' },
  completed: { icon: CheckCircle2, className: 'text-emerald-600 bg-emerald-50', label: 'Completed' },
  failed: { icon: AlertCircle, className: 'text-red-600 bg-red-50', label: 'Failed' },
}

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
    <div className="aspect-video bg-black rounded-t-lg overflow-hidden relative group">
      {thumbnailUrl ? (
        <>
          <video
            src={thumbnailUrl}
            className="w-full h-full object-cover"
            muted
            preload="metadata"
            onLoadedMetadata={(e) => {
              // Seek to 1 second for thumbnail
              const video = e.target as HTMLVideoElement
              video.currentTime = 1
            }}
          />
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-white/90 flex items-center justify-center">
              <Play className="h-5 w-5 text-black ml-0.5" />
            </div>
          </div>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-6 h-14 flex items-center justify-between">
          <h1 className="font-semibold text-sm">Exercise Tracker</h1>
          <Button 
            size="sm" 
            onClick={() => setShowUpload(!showUpload)}
            variant={showUpload ? "secondary" : "default"}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            {showUpload ? 'Close' : 'Upload'}
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-6 py-6">
        {/* Upload Section - Collapsible */}
        {showUpload && (
          <Card className="p-4 mb-6">
            <VideoUpload onUploadComplete={() => {
              refetch()
              setShowUpload(false)
            }} />
          </Card>
        )}

        {/* Videos Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground">Videos</h2>
          <span className="text-xs text-muted-foreground">
            {videos?.length || 0} total
          </span>
        </div>

        {/* Videos Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : videos && videos.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map((video) => {
              const StatusIcon = statusConfig[video.status].icon
              return (
                <Link key={video.id} href={`/videos/${video.id}`}>
                  <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer group">
                    <VideoThumbnail video={video} />
                    <div className="p-3">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {video.filename}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-muted-foreground">
                          {new Date(video.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                          video.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                          video.status === 'processing' ? 'bg-amber-50 text-amber-600' :
                          video.status === 'failed' ? 'bg-red-50 text-red-600' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          <StatusIcon className={`h-3 w-3 ${video.status === 'processing' ? 'animate-spin' : ''}`} />
                          <span>{statusConfig[video.status].label}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Play className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">No videos yet</p>
            <p className="text-xs text-muted-foreground mb-4">
              Upload your first exercise video to get started
            </p>
            <Button size="sm" onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4 mr-1.5" />
              Upload Video
            </Button>
          </Card>
        )}
      </div>
    </div>
  )
}
