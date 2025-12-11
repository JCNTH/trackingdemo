'use client'

import { useState, useRef, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Users, Target, AlertCircle, Loader2 } from 'lucide-react'
import type { DetectedPerson, CalibrationResponse } from '@/lib/api'

interface PersonSelectorProps {
  calibrationData: CalibrationResponse
  onSelectPerson: (person: DetectedPerson) => void
  onSkip: () => void
  isLoading?: boolean
}

export function PersonSelector({
  calibrationData,
  onSelectPerson,
  onSkip,
  isLoading = false,
}: PersonSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selectedPerson, setSelectedPerson] = useState<DetectedPerson | null>(null)
  const [hoveredPerson, setHoveredPerson] = useState<DetectedPerson | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)

  const { people, frame_image, width, height } = calibrationData

  // Draw the frame and detected people
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      // Set canvas size to match image
      const aspectRatio = width / height
      const maxWidth = 800
      const displayWidth = Math.min(maxWidth, width)
      const displayHeight = displayWidth / aspectRatio

      canvas.width = displayWidth
      canvas.height = displayHeight

      // Draw image
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight)

      // Draw people bounding boxes
      const scaleX = displayWidth / width
      const scaleY = displayHeight / height

      people.forEach((person) => {
        const [x1, y1, x2, y2] = person.bbox
        const isSelected = selectedPerson?.id === person.id
        const isHovered = hoveredPerson?.id === person.id

        // Draw bounding box
        ctx.strokeStyle = isSelected 
          ? '#10b981' // Emerald for selected
          : isHovered 
            ? '#f59e0b' // Amber for hovered
            : '#6366f1' // Indigo for others
        ctx.lineWidth = isSelected || isHovered ? 4 : 2
        ctx.strokeRect(
          x1 * scaleX,
          y1 * scaleY,
          (x2 - x1) * scaleX,
          (y2 - y1) * scaleY
        )

        // Draw person ID badge
        ctx.fillStyle = isSelected ? '#10b981' : isHovered ? '#f59e0b' : '#6366f1'
        ctx.beginPath()
        ctx.arc(x1 * scaleX + 16, y1 * scaleY + 16, 16, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = '#fff'
        ctx.font = 'bold 14px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${person.id + 1}`, x1 * scaleX + 16, y1 * scaleY + 16)

        // Draw bar center if detected
        if (person.bar_center) {
          const barX = person.bar_center.x * width * scaleX
          const barY = person.bar_center.y * height * scaleY
          
          // Crosshair
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth = 2
          const size = 15
          ctx.beginPath()
          ctx.moveTo(barX - size, barY)
          ctx.lineTo(barX + size, barY)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(barX, barY - size)
          ctx.lineTo(barX, barY + size)
          ctx.stroke()

          // Center dot
          ctx.beginPath()
          ctx.arc(barX, barY, 5, 0, Math.PI * 2)
          ctx.fillStyle = '#f59e0b'
          ctx.fill()
        }

        // Draw wrists if pose detected (landmarks 15 and 16)
        if (person.pose && person.pose.length >= 17) {
          const leftWrist = person.pose[15]
          const rightWrist = person.pose[16]

          if (leftWrist.visibility > 0.3) {
            const wx = leftWrist.x * width * scaleX
            const wy = leftWrist.y * height * scaleY
            ctx.beginPath()
            ctx.arc(wx, wy, 8, 0, Math.PI * 2)
            ctx.fillStyle = '#f59e0b'
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 2
            ctx.stroke()
          }

          if (rightWrist.visibility > 0.3) {
            const wx = rightWrist.x * width * scaleX
            const wy = rightWrist.y * height * scaleY
            ctx.beginPath()
            ctx.arc(wx, wy, 8, 0, Math.PI * 2)
            ctx.fillStyle = '#f59e0b'
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 2
            ctx.stroke()
          }
        }
      })

      setImageLoaded(true)
    }

    img.src = `data:image/jpeg;base64,${frame_image}`
  }, [frame_image, width, height, people, selectedPerson, hoveredPerson])

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    const scaleX = canvas.width / width
    const scaleY = canvas.height / height

    // Find clicked person
    for (const person of people) {
      const [x1, y1, x2, y2] = person.bbox
      const boxX1 = x1 * scaleX
      const boxY1 = y1 * scaleY
      const boxX2 = x2 * scaleX
      const boxY2 = y2 * scaleY

      if (clickX >= boxX1 && clickX <= boxX2 && clickY >= boxY1 && clickY <= boxY2) {
        setSelectedPerson(person)
        return
      }
    }
  }

  // Handle canvas hover
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const scaleX = canvas.width / width
    const scaleY = canvas.height / height

    // Find hovered person
    for (const person of people) {
      const [x1, y1, x2, y2] = person.bbox
      const boxX1 = x1 * scaleX
      const boxY1 = y1 * scaleY
      const boxX2 = x2 * scaleX
      const boxY2 = y2 * scaleY

      if (mouseX >= boxX1 && mouseX <= boxX2 && mouseY >= boxY1 && mouseY <= boxY2) {
        setHoveredPerson(person)
        return
      }
    }
    setHoveredPerson(null)
  }

  const handleConfirm = () => {
    if (selectedPerson) {
      onSelectPerson(selectedPerson)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">Select Person to Track</h3>
          <p className="text-sm text-muted-foreground mt-1">
            We detected <strong className="text-foreground">{people.length}</strong> {people.length === 1 ? 'person' : 'people'} in the video. 
            Click on the person you want to track.
          </p>
        </div>
      </div>

      {people.length === 0 ? (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-6 w-6 flex-shrink-0" />
            <div>
              <p className="font-medium">No people detected</p>
              <p className="text-sm text-muted-foreground mt-1">
                Try a different frame or check video quality.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Video Frame Preview */}
          <Card className="overflow-hidden">
            <div className="relative bg-black">
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMouseMove}
                onMouseLeave={() => setHoveredPerson(null)}
                className="w-full h-auto cursor-pointer block"
                style={{ maxHeight: '400px', objectFit: 'contain' }}
              />
              
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="px-4 py-2 bg-muted/50 border-t text-xs text-muted-foreground">
              Click on a person in the video or select from the list below
            </div>
          </Card>

          {/* Person Selection Cards */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Detected People</h4>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(people.length, 3)}, 1fr)` }}>
              {people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => setSelectedPerson(person)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    selectedPerson?.id === person.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                      selectedPerson?.id === person.id
                        ? 'bg-primary text-white'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {person.id + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Person {person.id + 1}</span>
                        {selectedPerson?.id === person.id && (
                          <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        {person.pose ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                            Pose OK
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No pose</span>
                        )}
                        {person.bar_center && (
                          <span className="inline-flex items-center gap-1 text-amber-500">
                            <Target className="h-3 w-3" />
                            Bar
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          onClick={onSkip}
          disabled={isLoading}
          className="px-6"
        >
          Skip
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!selectedPerson || isLoading}
          className="flex-1"
          size="lg"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          )}
          Continue with Person {selectedPerson ? selectedPerson.id + 1 : ''}
        </Button>
      </div>
    </div>
  )
}

