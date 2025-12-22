'use client'

import { useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { 
  Activity, 
  TrendingUp, 
  ArrowUpDown,
  Ruler,
  BarChart3,
  Target,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldAlert,
} from 'lucide-react'

interface BarPathPoint {
  x: number
  y: number
  frame: number
  timestamp: number
  confidence: number
  source?: string
  speed?: number
  vx?: number
  vy?: number
}

interface VelocityMetrics {
  peak_concentric_velocity?: number
  peak_eccentric_velocity?: number
  average_speed?: number
  vertical_displacement?: number
  horizontal_deviation?: number
  path_verticality?: number
  estimated_reps?: number
  frame_velocities?: Array<{
    frame: number
    timestamp: number
    vx: number
    vy: number
    speed: number
    vertical_velocity: number
  }>
}

interface JointAngles {
  frame: number
  timestamp: number
  left_elbow?: number
  right_elbow?: number
  avg_elbow_angle?: number
  elbow_asymmetry?: number
  wrist_alignment?: number
}

interface TrackingStats {
  both_wrists: number
  single_wrist: number
  kalman_prediction: number
  lost: number
}

interface FormAnalysisImprovement {
  area: string
  priority: 'high' | 'medium' | 'low'
  suggestion: string
}

interface FormAnalysis {
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
    improvements?: FormAnalysisImprovement[]
    coaching_cues?: string[]
  }
  error?: string
  model?: string
  duration_seconds?: number
}

interface MovementMetricsProps {
  barPath?: BarPathPoint[]
  velocityMetrics?: VelocityMetrics
  jointAngles?: JointAngles[]
  trackingStats?: TrackingStats
  formAnalysis?: FormAnalysis
}

function MetricCard({ 
  icon: Icon, 
  label, 
  value, 
  unit,
  subtitle,
  color = 'text-primary' 
}: { 
  icon: React.ElementType
  label: string
  value: string | number
  unit?: string
  subtitle?: string
  color?: string
}) {
  return (
    <div className="p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>
      )}
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const colorClass = score >= 80 
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
    : score >= 60 
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' 
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-sm font-medium ${colorClass}`}>
      {score}/100
    </span>
  )
}

function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  const config = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  }
  
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${config[priority]}`}>
      {priority}
    </span>
  )
}

function ElbowAngleIndicator({ angle }: { angle: number }) {
  const isIdeal = angle >= 45 && angle <= 75
  const isAcceptable = angle >= 30 && angle <= 90
  
  let dotColor = 'bg-red-500'
  let status = 'Poor'
  
  if (isIdeal) {
    dotColor = 'bg-green-500'
    status = 'Ideal'
  } else if (isAcceptable) {
    dotColor = 'bg-amber-500'
    status = 'OK'
  }
  
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className="text-sm font-medium tabular-nums">{angle.toFixed(0)}°</span>
      <span className="text-xs text-muted-foreground">({status})</span>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
      {children}
    </h4>
  )
}

export function MovementMetrics({
  barPath,
  velocityMetrics,
  jointAngles,
  trackingStats,
  formAnalysis,
}: MovementMetricsProps) {
  const summary = useMemo(() => {
    if (!barPath || barPath.length === 0) {
      return null
    }

    let avgElbowAngle: number | null = null
    let minElbowAngle: number | null = null
    
    if (jointAngles && jointAngles.length > 0) {
      const validAngles = jointAngles
        .filter(j => j.avg_elbow_angle !== undefined)
        .map(j => j.avg_elbow_angle!)
      
      if (validAngles.length > 0) {
        avgElbowAngle = validAngles.reduce((a, b) => a + b, 0) / validAngles.length
        minElbowAngle = Math.min(...validAngles)
      }
    }

    // Raw pixel values - no conversion to real-world units (no calibration)
    const displacementPx = velocityMetrics?.vertical_displacement ?? null

    return {
      totalFrames: barPath.length,
      avgElbowAngle,
      minElbowAngle,
      displacementPx,
    }
  }, [barPath, jointAngles, velocityMetrics])

  if (!summary) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground py-8">
          <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No movement data available</p>
          <p className="text-xs mt-1 opacity-70">Process a video to see metrics</p>
        </div>
      </Card>
    )
  }

  return (
    <div className="relative">
      {/* Scrollable content with max height */}
      <div className="overflow-y-auto max-h-[60vh] space-y-5 pb-4 pr-1">
        
        {/* Movement Analysis */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-base">Movement Analysis</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {velocityMetrics?.peak_concentric_velocity !== undefined && (
              <MetricCard
                icon={TrendingUp}
                label="Peak Velocity"
                value={velocityMetrics.peak_concentric_velocity.toFixed(0)}
                unit="px/s"
                color="text-green-500"
              />
            )}
            
            {summary.displacementPx !== null && (
              <MetricCard
                icon={ArrowUpDown}
                label="Displacement"
                value={summary.displacementPx.toFixed(0)}
                unit="px"
                color="text-blue-500"
              />
            )}
            
            {velocityMetrics?.path_verticality !== undefined && (
              <MetricCard
                icon={Ruler}
                label="Path Verticality"
                value={(velocityMetrics.path_verticality * 100).toFixed(0)}
                unit="%"
                subtitle="Higher = straighter"
                color="text-purple-500"
              />
            )}
            
            {velocityMetrics?.estimated_reps !== undefined && velocityMetrics.estimated_reps > 0 && (
              <MetricCard
                icon={BarChart3}
                label="Estimated Reps"
                value={velocityMetrics.estimated_reps}
                color="text-amber-500"
              />
            )}
          </div>
        </Card>

        {/* Elbow Analysis */}
        {summary.avgElbowAngle !== null && (
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-5 w-5 text-primary" />
              <h3 className="font-medium text-base">Elbow Analysis</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                <span className="text-sm text-muted-foreground">Average Angle</span>
                <ElbowAngleIndicator angle={summary.avgElbowAngle} />
              </div>
              
              {summary.minElbowAngle !== null && (
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                  <span className="text-sm text-muted-foreground">Minimum Angle</span>
                  <ElbowAngleIndicator angle={summary.minElbowAngle} />
                </div>
              )}
              
              <div className="mt-4 p-3 rounded-lg bg-muted/20">
                <div className="flex items-start gap-2.5">
                  {summary.avgElbowAngle >= 45 && summary.avgElbowAngle <= 75 ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        Good elbow position. 45-75° helps protect shoulders while maximizing power.
                      </p>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        {summary.avgElbowAngle < 45 
                          ? 'Elbows too tucked. Try widening slightly for better chest activation.'
                          : 'Elbows flared too much. Tuck more to protect shoulders.'}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* AI Coach Feedback */}
        {formAnalysis?.success && formAnalysis.analysis && (
          <Card className="p-5">
            {/* Header with score */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                <h3 className="font-medium text-base">AI Coach Feedback</h3>
              </div>
              {formAnalysis.analysis.overall_score && (
                <ScoreBadge score={formAnalysis.analysis.overall_score} />
              )}
            </div>
            
            <div className="space-y-5">
              {/* Summary */}
              {formAnalysis.analysis.summary && (
                <p className="text-sm leading-relaxed">{formAnalysis.analysis.summary}</p>
              )}

              {/* Strengths */}
              {formAnalysis.analysis.strengths && formAnalysis.analysis.strengths.length > 0 && (
                <div>
                  <SectionHeader>Strengths</SectionHeader>
                  <div className="space-y-2">
                    {formAnalysis.analysis.strengths.map((strength, i) => (
                      <div key={i} className="flex items-start gap-2.5 py-2 px-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{strength}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Areas to Improve */}
              {formAnalysis.analysis.improvements && formAnalysis.analysis.improvements.length > 0 && (
                <div>
                  <SectionHeader>Areas to Improve</SectionHeader>
                  <div className="space-y-2">
                    {formAnalysis.analysis.improvements.map((item, i) => (
                      <div 
                        key={i} 
                        className={`p-3 rounded-lg bg-muted/30 border-l-2 ${
                          item.priority === 'high' ? 'border-red-400' :
                          item.priority === 'medium' ? 'border-amber-400' :
                          'border-blue-400'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="font-medium text-sm">{item.area}</span>
                          <PriorityBadge priority={item.priority} />
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Coaching Cues */}
              {formAnalysis.analysis.coaching_cues && formAnalysis.analysis.coaching_cues.length > 0 && (
                <div className="pt-4 border-t">
                  <SectionHeader>Coaching Cues</SectionHeader>
                  <div className="flex flex-wrap gap-2">
                    {formAnalysis.analysis.coaching_cues.map((cue, i) => (
                      <span 
                        key={i} 
                        className="inline-flex items-center h-7 px-3 rounded-full border bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800 text-sm"
                      >
                        {cue}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Safety Concerns */}
              {formAnalysis.analysis.safety_concerns && formAnalysis.analysis.safety_concerns.length > 0 && (
                <div className="pt-4 border-t">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldAlert className="h-4 w-4 text-red-500" />
                    <SectionHeader>Safety Concerns</SectionHeader>
                  </div>
                  <div className="space-y-2">
                    {formAnalysis.analysis.safety_concerns.map((concern, i) => (
                      <div key={i} className="flex items-start gap-2.5 py-2 px-3 rounded-lg bg-red-50 dark:bg-red-900/20">
                        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-red-700 dark:text-red-300">{concern}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
