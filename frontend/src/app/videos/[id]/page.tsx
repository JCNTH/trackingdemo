'use client'

import { use, useState, useCallback, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VideoPlayer } from '@/components/VideoPlayer'
import { TrajectoryCanvas } from '@/components/TrajectoryCanvas'
import { DataExport } from '@/components/DataExport'
import { CalibrationStep } from '@/components/CalibrationStep'
import { MovementMetrics } from '@/components/MovementMetrics'
import { BarPathChart } from '@/components/BarPathChart'
import { 
  ArrowLeft, Play, Loader2, 
  CheckCircle2, AlertCircle, Clock, RefreshCw, Settings2,
  Activity
} from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { apiClient } from '@/lib/api'
import type { Video, DetectionResult, TrackingSession } from '@/types'

export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const queryClient = useQueryClient()
  const [currentFrame, setCurrentFrame] = useState(0)
  const [showCalibration, setShowCalibration] = useState(false)
  
  // Track previous status to detect when processing completes
  const prevStatusRef = useRef<string | undefined>(undefined)

  const { data: video, isLoading: videoLoading } = useQuery({
    queryKey: ['video', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('id', id)
        .single()
      
      if (error) throw error
      return data as Video
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'processing' ? 2000 : false
    },
  })

  // Invalidate dependent queries when video processing completes
  useEffect(() => {
    const currentStatus = video?.status
    const prevStatus = prevStatusRef.current
    
    // If status changed from 'processing' to 'completed', invalidate results
    if (prevStatus === 'processing' && currentStatus === 'completed') {
      toast.success('Video processing complete!')
      queryClient.invalidateQueries({ queryKey: ['detection-results', id] })
      queryClient.invalidateQueries({ queryKey: ['tracking-session', id] })
    }
    
    prevStatusRef.current = currentStatus
  }, [video?.status, id, queryClient])

  const { data: detectionResults } = useQuery({
    queryKey: ['detection-results', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('detection_results')
        .select('*')
        .eq('video_id', id)
        .order('frame_number', { ascending: true })
      
      if (error) throw error
      return data as unknown as DetectionResult[]
    },
    enabled: video?.status === 'completed',
  })

  const { data: trackingSession } = useQuery({
    queryKey: ['tracking-session', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tracking_sessions')
        .select('*')
        .eq('video_id', id)
        .single()
      
      if (error && error.code !== 'PGRST116') throw error
      return data as TrackingSession | null
    },
    enabled: video?.status === 'completed',
  })

  // Extract trajectory data from tracking session
  const trajectoryData = useMemo(() => {
    if (!trackingSession?.trajectory_data) return null
    
    const data = trackingSession.trajectory_data as {
      bar_path?: Array<{
        x: number
        y: number
        frame: number
        timestamp: number
        confidence: number
        source?: string
        speed?: number
        vx?: number
        vy?: number
      }>
      velocity_metrics?: {
        peak_concentric_velocity?: number
        peak_eccentric_velocity?: number
        average_speed?: number
        vertical_displacement?: number
        horizontal_deviation?: number
        path_verticality?: number
        estimated_reps?: number
      }
      joint_angles?: Array<{
        frame: number
        timestamp: number
        left_elbow?: number
        right_elbow?: number
        avg_elbow_angle?: number
        elbow_asymmetry?: number
        wrist_alignment?: number
      }>
      tracking_stats?: {
        both_wrists: number
        single_wrist: number
        kalman_prediction: number
        lost: number
      }
      form_analysis?: {
        success: boolean
        analysis?: {
          overall_score?: number
          form_quality?: 'good' | 'fair' | 'poor'
          summary?: string
          bar_path_analysis?: {
            quality?: string
            issues?: string[]
            recommendations?: string[]
          }
          elbow_analysis?: {
            symmetry?: string
            angle_quality?: string
            issues?: string[]
          }
          tempo_analysis?: {
            eccentric_control?: string
            concentric_power?: string
            consistency?: string
          }
          safety_concerns?: string[]
          strengths?: string[]
          improvements?: Array<{
            area: string
            priority: 'high' | 'medium' | 'low'
            suggestion: string
          }>
          coaching_cues?: string[]
        }
        error?: string
        model?: string
        duration_seconds?: number
      }
    }
    
    return data
  }, [trackingSession])

  const processVideo = useMutation({
    mutationFn: async (selectedPersonBbox?: [number, number, number, number]) => {
      const response = await apiClient.processVideo(id, selectedPersonBbox)
      return response
    },
    onSuccess: () => {
      toast.success('Video processing started')
      setShowCalibration(false)
      queryClient.invalidateQueries({ queryKey: ['video', id] })
    },
    onError: (error) => {
      toast.error(`Processing failed: ${error.message}`)
    },
  })

  const handleCalibrationComplete = (selectedPersonBbox?: [number, number, number, number]) => {
    processVideo.mutate(selectedPersonBbox)
  }

  const getVideoUrl = () => {
    if (!video?.storage_path) return null
    const { data } = supabase.storage
      .from('videos')
      .getPublicUrl(video.storage_path)
    return data.publicUrl
  }

  const videoUrl = getVideoUrl()

  const handleTimeUpdate = useCallback((currentTime: number) => {
    if (!video?.fps) return
    const frame = Math.floor(currentTime * video.fps)
    setCurrentFrame(frame)
  }, [video?.fps])

  if (videoLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!video) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-6 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm font-medium mb-3">Video not found</p>
          <Link href="/">
            <Button variant="outline" size="sm">Back to Videos</Button>
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-6 h-14 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <span className="font-medium text-sm truncate flex-1 min-w-0">{video.filename}</span>
          <StatusBadge status={video.status} />
        </div>
      </header>

      <div className="container mx-auto px-6 py-6">
        {/* Responsive grid - stacks on portrait videos */}
        <div className={`grid gap-6 ${
          video.width && video.height && video.height > video.width 
            ? 'lg:grid-cols-2' // Portrait video: 50/50 split
            : 'lg:grid-cols-3' // Landscape: 2/3 + 1/3
        }`}>
          {/* Video Player */}
          <div className={`space-y-4 ${
            video.width && video.height && video.height > video.width 
              ? '' // Portrait: single column
              : 'lg:col-span-2' // Landscape: span 2
          }`}>
            <Card className="overflow-hidden bg-black">
              {videoUrl ? (
                <div 
                  className="video-container relative mx-auto"
                  style={{
                    aspectRatio: video.width && video.height 
                      ? `${video.width} / ${video.height}` 
                      : '16 / 9',
                    maxHeight: '75vh',
                    maxWidth: '100%',
                  }}
                >
                  <VideoPlayer 
                    src={videoUrl} 
                    onTimeUpdate={handleTimeUpdate}
                  />
                  {detectionResults && detectionResults.length > 0 && (
                    <TrajectoryCanvas 
                      detectionResults={detectionResults}
                      width={video.width || 1280}
                      height={video.height || 720}
                      currentFrame={currentFrame}
                      showBarPath={true}
                      barPath={trajectoryData?.bar_path}
                    />
                  )}
                </div>
              ) : (
                <div className="aspect-video bg-muted flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">Video not available</p>
                </div>
              )}
            </Card>

            {/* Processing Controls */}
            {video.status === 'pending' && !showCalibration && (
              <Card className="p-5">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-lg bg-primary/10">
                      <Play className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Ready to Process</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Select person to track, then run detection
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button 
                      variant="outline"
                      onClick={() => setShowCalibration(true)}
                    >
                      <Settings2 className="h-4 w-4 mr-2" />
                      Setup & Track
                    </Button>
                    <Button 
                      variant="secondary"
                      onClick={() => processVideo.mutate(undefined)}
                      disabled={processVideo.isPending}
                    >
                      {processVideo.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Quick Start
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Calibration Step */}
            {video.status === 'pending' && showCalibration && (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6 pb-4 border-b">
                  <div>
                    <h2 className="font-semibold text-lg">Setup Tracking</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Configure person selection and bar tracking
                    </p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowCalibration(false)}
                  >
                    Cancel
                  </Button>
                </div>
                <CalibrationStep
                  videoId={id}
                  onComplete={handleCalibrationComplete}
                  onCancel={() => setShowCalibration(false)}
                />
              </Card>
            )}

            {video.status === 'processing' && (
              <Card className="p-5">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-lg bg-primary/10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Processing Video</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Running Kalman-filtered bar tracking + pose analysis...
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {video.status === 'failed' && (
              <Card className="p-5 border-destructive/30">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-lg bg-destructive/10">
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    </div>
                    <div>
                      <p className="font-medium text-destructive">Processing Failed</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {video.error_message || 'An error occurred during processing'}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="outline"
                    onClick={() => processVideo.mutate(undefined)}
                    disabled={processVideo.isPending}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Video Info */}
            <Card className="p-4">
              <h3 className="text-sm font-medium mb-3">Details</h3>
              <dl className="space-y-2 text-sm">
                <InfoRow label="Duration" value={video.duration ? `${video.duration.toFixed(1)}s` : '-'} />
                <InfoRow label="Resolution" value={video.width && video.height ? `${video.width}×${video.height}` : '-'} />
                <InfoRow label="FPS" value={video.fps?.toFixed(1) || '-'} />
                <InfoRow label="Uploaded" value={new Date(video.created_at).toLocaleDateString()} />
                {video.exercise_type && (
                  <InfoRow 
                    label="Exercise" 
                    value={video.exercise_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} 
                  />
                )}
              </dl>
            </Card>

            {/* Results Tabs */}
            {video.status === 'completed' && (
              <Tabs defaultValue="analysis" className="w-full">
                <TabsList className="w-full h-9">
                  <TabsTrigger value="analysis" className="flex-1 text-xs">
                    <Activity className="h-3 w-3 mr-1" />
                    Analysis
                  </TabsTrigger>
                  <TabsTrigger value="path" className="flex-1 text-xs">Bar Path</TabsTrigger>
                  <TabsTrigger value="stats" className="flex-1 text-xs">Stats</TabsTrigger>
                  <TabsTrigger value="export" className="flex-1 text-xs">Export</TabsTrigger>
                </TabsList>
                
                <TabsContent value="analysis" className="mt-3">
                  <MovementMetrics
                    barPath={trajectoryData?.bar_path}
                    velocityMetrics={trajectoryData?.velocity_metrics}
                    jointAngles={trajectoryData?.joint_angles}
                    trackingStats={trajectoryData?.tracking_stats}
                    formAnalysis={trajectoryData?.form_analysis}
                  />
                </TabsContent>

                <TabsContent value="path" className="mt-3">
                  <div className="space-y-4">
                    <BarPathChart 
                      barPath={trajectoryData?.bar_path || []}
                      width={280}
                      height={380}
                      showVelocity={true}
                    />
                    <Card className="p-4">
                      <h4 className="text-sm font-medium mb-2">Understanding the Bar Path</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        The ideal bench press bar path forms a slight <strong>J-curve</strong>. 
                        The bar starts over your shoulders, descends to your lower chest while 
                        drifting slightly toward your feet, then presses back up and toward 
                        your shoulders. This diagonal path optimizes muscle leverage and 
                        protects your shoulder joints.
                      </p>
                      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Verticality:</span>{' '}
                          <span className="font-medium">
                            {trajectoryData?.velocity_metrics?.path_verticality?.toFixed(0) || '-'}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">H-Deviation:</span>{' '}
                          <span className="font-medium">
                            {trajectoryData?.velocity_metrics?.horizontal_deviation?.toFixed(0) || '-'} px
                          </span>
                        </div>
                      </div>
                    </Card>
                  </div>
                </TabsContent>
                
                <TabsContent value="stats" className="mt-3">
                  <Card className="p-4 space-y-4">
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Detection Stats</h4>
                      <dl className="space-y-2 text-sm">
                        <InfoRow label="Total Frames" value={detectionResults?.length?.toString() || '0'} />
                        <InfoRow 
                          label="Bar Detected" 
                          value={(() => {
                            if (!detectionResults?.length) return '-'
                            const barFrames = detectionResults.filter(r => 
                              r.objects?.some(o => o.class === 'barbell')
                            ).length
                            const pct = ((barFrames / detectionResults.length) * 100).toFixed(0)
                            return `${barFrames}/${detectionResults.length} (${pct}%)`
                          })()} 
                        />
                        <InfoRow 
                          label="Pose Detected" 
                          value={(() => {
                            if (!detectionResults?.length) return '-'
                            const poseFrames = detectionResults.filter(r => r.pose_landmarks).length
                            const pct = ((poseFrames / detectionResults.length) * 100).toFixed(0)
                            return `${poseFrames}/${detectionResults.length} (${pct}%)`
                          })()} 
                        />
                      </dl>
                    </div>

                    {/* Tracking Source Breakdown */}
                    {trajectoryData?.tracking_stats && (
                      <div className="pt-3 border-t">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">Tracking Sources</h4>
                        {(() => {
                          const stats = trajectoryData.tracking_stats
                          const total = stats.both_wrists + stats.single_wrist + stats.kalman_prediction + stats.lost
                          
                          return (
                            <div className="space-y-2">
                              <QualityBar label="Both wrists" count={stats.both_wrists} total={total} color="bg-green-500" />
                              <QualityBar label="Single wrist" count={stats.single_wrist} total={total} color="bg-amber-500" />
                              <QualityBar label="Elbow fallback" count={stats.kalman_prediction} total={total} color="bg-purple-500" />
                              <QualityBar label="Lost" count={stats.lost} total={total} color="bg-red-500" />
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        EMA smoothing with fallback estimation when wrists are occluded.
                      </p>
                    </div>
                  </Card>
                </TabsContent>
                
                <TabsContent value="export" className="mt-3">
                  <DataExport 
                    videoId={id} 
                    detectionResults={detectionResults}
                    trackingSession={trackingSession}
                  />
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: Video['status'] }) {
  const config = {
    pending: { icon: Clock, className: 'text-muted-foreground bg-muted' },
    processing: { icon: Loader2, className: 'text-warning bg-warning/10' },
    completed: { icon: CheckCircle2, className: 'text-primary bg-primary/10' },
    failed: { icon: AlertCircle, className: 'text-destructive bg-destructive/10' },
  }

  const { icon: Icon, className } = config[status]

  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${className}`}>
      <Icon className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      <span className="capitalize">{status}</span>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function QualityBar({ label, count, total, color }: { 
  label: string
  count: number
  total: number
  color: string 
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-muted-foreground">{pct.toFixed(0)}%</span>
    </div>
  )
}
