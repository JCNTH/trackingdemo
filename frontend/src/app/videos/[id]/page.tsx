'use client'

import { use, useState, useCallback, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VideoPlayer } from '@/components/VideoPlayer'
import { TrajectoryCanvas } from '@/components/TrajectoryCanvas'
import { DataExport } from '@/components/DataExport'
import { CalibrationStep } from '@/components/CalibrationStep'
import { MovementMetrics } from '@/components/MovementMetrics'
import { BarPathChart } from '@/components/BarPathChart'
import { ProcessedVideoViewer } from '@/components/ProcessedVideoViewer'
import { 
  ArrowLeft, Play, Loader2, 
  CheckCircle2, AlertCircle, Clock, RefreshCw, Settings2
} from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { apiClient } from '@/lib/api'
import type { Video, DetectionResult, TrackingSession } from '@/types'

// Processing progress component
function ProcessingProgress({ videoId }: { videoId: string }) {
  const { data: progress } = useQuery({
    queryKey: ['processing-progress', videoId],
    queryFn: () => apiClient.getProcessingProgress(videoId),
    refetchInterval: 1000, // Poll every second
    enabled: true,
  })

  const stepLabels: Record<string, string> = {
    downloading: 'Downloading video',
    bar_tracking: 'Tracking barbell',
    pose_estimation: 'Detecting pose',
    finalizing: 'Saving results',
  }

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
        <span className="text-sm font-medium text-zinc-700">
          {progress?.step ? stepLabels[progress.step] || progress.step : 'Processing...'}
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
        <div 
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progress?.progress || 0}%` }}
        />
      </div>
      
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>{progress?.detail || 'Initializing...'}</span>
        <span>{progress?.progress || 0}%</span>
      </div>
    </div>
  )
}

export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const queryClient = useQueryClient()
  const [currentFrame, setCurrentFrame] = useState(0)
  const [showCalibration, setShowCalibration] = useState(false)
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

  useEffect(() => {
    const currentStatus = video?.status
    const prevStatus = prevStatusRef.current
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

  // #region agent log
  if (video) {
    fetch('http://127.0.0.1:7244/ingest/20a92eef-16ab-4de5-b181-01e406a7ee4c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:videoDimensions',message:'Video dimensions from DB',data:{dbWidth:video.width,dbHeight:video.height,usedWidth:video.width||1280,usedHeight:video.height||720,videoId:video.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
  }
  // #endregion

  const trajectoryData = useMemo(() => {
    if (!trackingSession?.trajectory_data) return null
    // #region agent log
    const td = trackingSession.trajectory_data as any;
    fetch('http://127.0.0.1:7244/ingest/20a92eef-16ab-4de5-b181-01e406a7ee4c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:trajectoryData',message:'Trajectory data from backend',data:{hasBarPath:!!td?.bar_path,barPathLen:td?.bar_path?.length||0,firstBarPathPoint:td?.bar_path?.[0],barPathKeys:td?.bar_path?.[0]?Object.keys(td.bar_path[0]):[],videoInfoFromTracking:td?.video_info},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B,E'})}).catch(()=>{});
    // #endregion
    return trackingSession.trajectory_data as {
      video_info?: { width: number; height: number; fps: number; duration: number }
      bar_path?: Array<{ x: number; y: number; frame: number; timestamp: number; confidence: number; source?: string; speed?: number; bbox?: [number, number, number, number] }>
      person_path?: Array<{ x: number; y: number; frame: number; timestamp: number; confidence: number; bbox?: [number, number, number, number]; pose_landmarks?: Array<{ x: number; y: number; visibility: number }> }>
      click_to_track?: { enabled: boolean; click_point: [number, number]; total_frames: number; tracked_frames: number; tracking_rate: number }
      person_tracking?: { enabled: boolean; detected_frames: number; detection_rate: number }
      velocity_metrics?: { peak_concentric_velocity?: number; peak_eccentric_velocity?: number; average_speed?: number; vertical_displacement?: number; horizontal_deviation?: number; path_verticality?: number; estimated_reps?: number }
      joint_angles?: Array<{ frame: number; timestamp: number; left_elbow?: number; right_elbow?: number; avg_elbow_angle?: number }>
      tracking_stats?: { both_wrists?: number; single_wrist?: number; kalman_prediction?: number; lost?: number; sam2_initial?: number; template_tracking?: number }
      form_analysis?: { success: boolean; analysis?: { overall_score?: number; form_quality?: string; summary?: string } }
    }
  }, [trackingSession])

  // Use video dimensions from tracking data (accurate) or fall back to database
  const videoWidth = trajectoryData?.video_info?.width || video?.width || 1280
  const videoHeight = trajectoryData?.video_info?.height || video?.height || 720
  const videoFps = trajectoryData?.video_info?.fps || video?.fps || 30

  const processVideo = useMutation({
    mutationFn: async (selectedPersonBbox?: [number, number, number, number]) => {
      return await apiClient.processVideo(id, selectedPersonBbox)
    },
    onSuccess: () => {
      toast.success('Processing started')
      setShowCalibration(false)
      queryClient.invalidateQueries({ queryKey: ['video', id] })
    },
    onError: (error) => toast.error(`Failed: ${error.message}`),
  })

  const processClickToTrack = useMutation({
    mutationFn: async ({ clickPoint, model }: { clickPoint: { x: number; y: number }; model: string }) => {
      return await apiClient.processWithClickToTrack(id, clickPoint, model as 'fastsam' | 'sam2')
    },
    onSuccess: () => {
      toast.success('Processing started')
      setShowCalibration(false)
      queryClient.invalidateQueries({ queryKey: ['video', id] })
    },
    onError: (error) => toast.error(`Failed: ${error.message}`),
  })

  const getVideoUrl = () => {
    if (!video?.storage_path) return null
    const { data } = supabase.storage.from('videos').getPublicUrl(video.storage_path)
    return data.publicUrl
  }
  const videoUrl = getVideoUrl()

  const handleTimeUpdate = useCallback((currentTime: number) => {
    if (!video?.fps) return
    setCurrentFrame(Math.floor(currentTime * video.fps))
  }, [video?.fps])

  if (videoLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
      </div>
    )
  }

  if (!video) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-zinc-500 mb-3">Video not found</p>
          <Link href="/"><Button variant="ghost" size="sm">Back</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-zinc-100">
        <div className="max-w-[1600px] mx-auto px-6 h-12 flex items-center gap-3">
          <Link href="/"><ArrowLeft className="h-4 w-4 text-zinc-400 hover:text-zinc-600" /></Link>
          <span className="text-sm text-zinc-900 truncate flex-1">{video.filename}</span>
          <StatusBadge status={video.status} />
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-4">
        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-4">
            {/* Video */}
            {!showCalibration && (
              video.status === 'completed' && videoUrl ? (
                <ProcessedVideoViewer
                  videoUrl={videoUrl}
                  width={videoWidth}
                  height={videoHeight}
                  fps={videoFps}
                  detectionResults={detectionResults || []}
                  barPath={trajectoryData?.bar_path}
                  personPath={trajectoryData?.person_path}
                />
              ) : videoUrl ? (
                <div className="bg-black rounded overflow-hidden">
                  <div 
                    className="relative mx-auto"
                    style={{
                      aspectRatio: `${videoWidth}/${videoHeight}`,
                      maxHeight: '65vh',
                    }}
                  >
                    <VideoPlayer src={videoUrl} onTimeUpdate={handleTimeUpdate} />
                    {((detectionResults?.length ?? 0) > 0 || (trajectoryData?.bar_path?.length ?? 0) > 0) && (
                    <TrajectoryCanvas 
                      detectionResults={detectionResults || []}
                      width={videoWidth}
                      height={videoHeight}
                      currentFrame={currentFrame}
                      showBarPath={true}
                      barPath={trajectoryData?.bar_path}
                      personPath={trajectoryData?.person_path}
                      showPersonPath={true}
                    />
                    )}
                  </div>
                </div>
              ) : null
            )}

            {/* Controls */}
            {video.status === 'pending' && !showCalibration && (
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-zinc-500">Ready to process</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowCalibration(true)}>
                    <Settings2 className="h-3.5 w-3.5 mr-1" />Setup
                  </Button>
                  <Button size="sm" onClick={() => processVideo.mutate(undefined)} disabled={processVideo.isPending}>
                    {processVideo.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    <span className="ml-1">Quick Start</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Calibration */}
            {video.status === 'pending' && showCalibration && (
              <CalibrationStep
                videoId={id}
                onComplete={(bbox) => processVideo.mutate(bbox)}
                onClickToTrackComplete={(point, model) => processClickToTrack.mutate({ clickPoint: point, model })}
                onCancel={() => setShowCalibration(false)}
              />
            )}

            {/* Processing with progress */}
            {video.status === 'processing' && (
              <ProcessingProgress videoId={id} />
            )}

            {/* Failed */}
            {video.status === 'failed' && (
              <div className="flex items-center justify-between py-3 text-red-600">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">{video.error_message || 'Processing failed'}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => processVideo.mutate(undefined)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />Retry
                </Button>
              </div>
            )}

            {/* Completed summary */}
            {video.status === 'completed' && trajectoryData && (
              <div className="flex items-center justify-between py-3 border-t border-zinc-100">
                <div className="flex items-center gap-4 text-xs text-zinc-500">
                  {trajectoryData.click_to_track?.enabled && (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {(trajectoryData.click_to_track.tracking_rate * 100).toFixed(0)}% bar
                      </span>
                      {trajectoryData.person_tracking?.enabled && (
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                          {(trajectoryData.person_tracking.detection_rate * 100).toFixed(0)}% person
                        </span>
                      )}
                    </>
                  )}
                  {trajectoryData.velocity_metrics?.estimated_reps && (
                    <span>{trajectoryData.velocity_metrics.estimated_reps} reps</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowCalibration(true)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />Reprocess
                </Button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Info */}
            <div className="text-xs space-y-1.5">
              <InfoRow label="Duration" value={video.duration ? `${video.duration.toFixed(1)}s` : '-'} />
              <InfoRow label="Resolution" value={video.width && video.height ? `${video.width}×${video.height}` : '-'} />
              <InfoRow label="FPS" value={video.fps?.toFixed(0) || '-'} />
              {video.exercise_type && <InfoRow label="Exercise" value={video.exercise_type.replace('_', ' ')} />}
            </div>

            {/* Tabs */}
            {video.status === 'completed' && (
              <Tabs defaultValue="analysis">
                <TabsList className="h-8 w-full">
                  <TabsTrigger value="analysis" className="flex-1 text-xs">Analysis</TabsTrigger>
                  <TabsTrigger value="path" className="flex-1 text-xs">Path</TabsTrigger>
                  <TabsTrigger value="stats" className="flex-1 text-xs">Stats</TabsTrigger>
                  <TabsTrigger value="export" className="flex-1 text-xs">Export</TabsTrigger>
                </TabsList>
                
                <TabsContent value="analysis" className="mt-3">
                  <MovementMetrics
                    barPath={trajectoryData?.bar_path}
                    velocityMetrics={trajectoryData?.velocity_metrics}
                    jointAngles={trajectoryData?.joint_angles}
                    trackingStats={trajectoryData?.tracking_stats as any}
                    formAnalysis={trajectoryData?.form_analysis as any}
                  />
                </TabsContent>

                <TabsContent value="path" className="mt-3">
                  <BarPathChart 
                    barPath={trajectoryData?.bar_path || []}
                    width={280}
                    height={320}
                    showVelocity={true}
                  />
                </TabsContent>
                
                <TabsContent value="stats" className="mt-3 space-y-3 text-xs">
                  {trajectoryData?.click_to_track?.enabled ? (
                    <>
                      <div className="space-y-1.5">
                        <span className="text-zinc-400">Barbell (SAM2)</span>
                        <InfoRow label="Tracked" value={`${trajectoryData.click_to_track.tracked_frames}/${trajectoryData.click_to_track.total_frames}`} />
                        <InfoRow label="Click" value={`(${trajectoryData.click_to_track.click_point[0]}, ${trajectoryData.click_to_track.click_point[1]})`} />
                      </div>
                      {trajectoryData.person_tracking?.enabled && (
                        <div className="space-y-1.5 pt-3 border-t border-zinc-100">
                          <span className="text-zinc-400">Person (YOLO)</span>
                          <InfoRow label="Detected" value={`${trajectoryData.person_tracking.detected_frames}/${trajectoryData.click_to_track.total_frames}`} />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <InfoRow label="Frames" value={detectionResults?.length?.toString() || '0'} />
                    </div>
                  )}
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
      </main>
    </div>
  )
}

function StatusBadge({ status }: { status: Video['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  if (status === 'processing') return <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
  return <Clock className="h-3.5 w-3.5 text-zinc-400" />
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-zinc-600">
      <span className="text-zinc-400">{label}</span>
      <span>{value}</span>
    </div>
  )
}
