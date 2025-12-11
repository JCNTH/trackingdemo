'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { DetectionResult, TrackingSession } from '@/types'

interface DataExportProps {
  videoId: string
  detectionResults?: DetectionResult[]
  trackingSession?: TrackingSession | null
}

export function DataExport({ videoId, detectionResults, trackingSession }: DataExportProps) {
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null)

  const exportAsJson = async () => {
    setExporting('json')
    try {
      const data = {
        video_id: videoId,
        exported_at: new Date().toISOString(),
        frame_count: detectionResults?.length || 0,
        tracking_summary: trackingSession ? {
          object_count: trackingSession.object_count,
          has_pose: trackingSession.has_pose,
        } : null,
        frames: detectionResults?.map(frame => ({
          frame_number: frame.frame_number,
          timestamp: frame.timestamp,
          objects: frame.objects,
          pose_landmarks: frame.pose_landmarks,
        })),
        trajectories: trackingSession?.trajectory_data,
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      downloadBlob(blob, `tracking_${videoId.slice(0, 8)}.json`)
      toast.success('JSON exported')
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(null)
    }
  }

  const exportAsCsv = async () => {
    setExporting('csv')
    try {
      if (!detectionResults || detectionResults.length === 0) {
        toast.error('No data to export')
        return
      }

      const headers = ['frame', 'timestamp', 'object_class', 'confidence', 'x1', 'y1', 'x2', 'y2']
      const rows: string[][] = [headers]

      detectionResults.forEach(frame => {
        if (frame.objects && frame.objects.length > 0) {
          frame.objects.forEach(obj => {
            rows.push([
              frame.frame_number.toString(),
              frame.timestamp.toString(),
              obj.class,
              obj.confidence.toString(),
              obj.bbox[0].toString(),
              obj.bbox[1].toString(),
              obj.bbox[2].toString(),
              obj.bbox[3].toString(),
            ])
          })
        }
      })

      const csvContent = rows.map(row => row.join(',')).join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv' })
      downloadBlob(blob, `tracking_${videoId.slice(0, 8)}.csv`)
      toast.success('CSV exported')
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(null)
    }
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const hasData = detectionResults && detectionResults.length > 0

  return (
    <Card className="p-4">
      {hasData ? (
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start h-8"
            onClick={exportAsJson}
            disabled={exporting !== null}
          >
            {exporting === 'json' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <FileJson className="h-4 w-4 mr-1.5" />
            )}
            Export JSON
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start h-8"
            onClick={exportAsCsv}
            disabled={exporting !== null}
          >
            {exporting === 'csv' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            )}
            Export CSV
          </Button>

          <p className="text-xs text-muted-foreground pt-1">
            {detectionResults.length} frames
          </p>
        </div>
      ) : (
        <div className="text-center py-3">
          <Download className="h-6 w-6 text-muted-foreground/50 mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">
            No data yet
          </p>
        </div>
      )}
    </Card>
  )
}
