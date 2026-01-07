'use client'

import { useMemo } from 'react'
import { Card } from '@/components/ui/card'

interface BarPathPoint {
  x: number
  y: number
  frame: number
  timestamp: number
  speed?: number
}

interface BarPathChartProps {
  barPath: BarPathPoint[]
  width?: number
  height?: number
  showVelocity?: boolean
  className?: string
}

/**
 * 2D Bar Path Visualization
 * 
 * Shows the bar trajectory from a side view perspective.
 * X-axis: horizontal displacement (forward = right, backward = left)
 * Y-axis: vertical position (up = top, down = bottom)
 * 
 * Color gradient indicates velocity (optional):
 * - Blue: slow/pause
 * - Green: moderate
 * - Orange/Red: fast
 */
export function BarPathChart({
  barPath,
  width = 300,
  height = 400,
  showVelocity = true,
  className = '',
}: BarPathChartProps) {
  const chartData = useMemo(() => {
    if (!barPath || barPath.length === 0) return null

    // Get bounds for normalization
    const xValues = barPath.map(p => p.x)
    const yValues = barPath.map(p => p.y)
    const speeds = barPath.filter(p => p.speed !== undefined).map(p => p.speed!)

    const xMin = Math.min(...xValues)
    const xMax = Math.max(...xValues)
    const yMin = Math.min(...yValues)
    const yMax = Math.max(...yValues)
    const speedMax = speeds.length > 0 ? Math.max(...speeds) : 1

    // Add padding
    const xRange = xMax - xMin || 1
    const yRange = yMax - yMin || 1
    const padding = 40
    const chartWidth = width - padding * 2
    const chartHeight = height - padding * 2

    // Normalize points to chart coordinates
    // Video Y increases downward, but we want HIGH bar = TOP of chart
    // Since video Y is low when bar is high, we DON'T invert
    const normalizedPoints = barPath.map((point, i) => ({
      ...point,
      cx: padding + ((point.x - xMin) / xRange) * chartWidth,
      cy: padding + ((point.y - yMin) / yRange) * chartHeight,
      normalizedSpeed: point.speed !== undefined ? point.speed / speedMax : 0.5,
    }))

    // Create path string for the trajectory line
    const pathD = normalizedPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx} ${p.cy}`)
      .join(' ')

    // Find key points
    const startPoint = normalizedPoints[0]
    const endPoint = normalizedPoints[normalizedPoints.length - 1]
    const lowestPoint = normalizedPoints.reduce((min, p) => 
      p.cy > min.cy ? p : min, normalizedPoints[0])

    return {
      points: normalizedPoints,
      pathD,
      startPoint,
      endPoint,
      lowestPoint,
      xMin,
      xMax,
      yMin,
      yMax,
      speedMax,
      padding,
      chartWidth,
      chartHeight,
    }
  }, [barPath, width, height])

  if (!chartData) {
    return (
      <Card className={`p-4 ${className}`}>
        <p className="text-sm text-muted-foreground text-center">
          No bar path data available
        </p>
      </Card>
    )
  }

  // Get color based on velocity
  const getVelocityColor = (normalizedSpeed: number) => {
    if (!showVelocity) return '#10b981' // Default emerald
    
    // Blue (slow) -> Green (moderate) -> Orange (fast)
    if (normalizedSpeed < 0.33) {
      return `rgb(59, 130, 246)` // Blue
    } else if (normalizedSpeed < 0.66) {
      return `rgb(16, 185, 129)` // Emerald
    } else {
      return `rgb(249, 115, 22)` // Orange
    }
  }

  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Bar Path (Side View)</h3>
        {showVelocity && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              Slow
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              Mid
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              Fast
            </span>
          </div>
        )}
      </div>

      <svg 
        width={width} 
        height={height} 
        className="mx-auto"
        style={{ background: 'var(--muted)' }}
      >
        {/* Grid lines */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path 
              d="M 40 0 L 0 0 0 40" 
              fill="none" 
              stroke="var(--border)" 
              strokeWidth="0.5" 
              opacity="0.5"
            />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#grid)" rx="8" />

        {/* Axis labels */}
        <text 
          x={width / 2} 
          y={height - 8} 
          textAnchor="middle" 
          className="fill-muted-foreground text-[10px]"
        >
          ← Toward Head | Toward Feet →
        </text>
        <text 
          x={12} 
          y={height / 2} 
          textAnchor="middle" 
          className="fill-muted-foreground text-[10px]"
          transform={`rotate(-90, 12, ${height / 2})`}
        >
          Bar Height
        </text>

        {/* Main trajectory line */}
        <path
          d={chartData.pathD}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.3"
        />

        {/* Velocity-colored points */}
        {chartData.points.map((point, i) => (
          <circle
            key={i}
            cx={point.cx}
            cy={point.cy}
            r={i % 3 === 0 ? 3 : 2} // Show every 3rd point larger
            fill={getVelocityColor(point.normalizedSpeed)}
            opacity={i % 3 === 0 ? 1 : 0.6}
          />
        ))}

        {/* Start point marker */}
        <g>
          <circle
            cx={chartData.startPoint.cx}
            cy={chartData.startPoint.cy}
            r="8"
            fill="var(--primary)"
            opacity="0.2"
          />
          <circle
            cx={chartData.startPoint.cx}
            cy={chartData.startPoint.cy}
            r="5"
            fill="var(--primary)"
          />
          <text
            x={chartData.startPoint.cx + 12}
            y={chartData.startPoint.cy + 4}
            className="fill-foreground text-[10px] font-medium"
          >
            START
          </text>
        </g>

        {/* End point marker */}
        <g>
          <circle
            cx={chartData.endPoint.cx}
            cy={chartData.endPoint.cy}
            r="8"
            fill="#10b981"
            opacity="0.2"
          />
          <circle
            cx={chartData.endPoint.cx}
            cy={chartData.endPoint.cy}
            r="5"
            fill="#10b981"
          />
          <text
            x={chartData.endPoint.cx + 12}
            y={chartData.endPoint.cy + 4}
            className="fill-foreground text-[10px] font-medium"
          >
            END
          </text>
        </g>

        {/* Lowest point (bottom of lift) */}
        {chartData.lowestPoint !== chartData.startPoint && 
         chartData.lowestPoint !== chartData.endPoint && (
          <g>
            <circle
              cx={chartData.lowestPoint.cx}
              cy={chartData.lowestPoint.cy}
              r="6"
              fill="#f59e0b"
              opacity="0.3"
            />
            <circle
              cx={chartData.lowestPoint.cx}
              cy={chartData.lowestPoint.cy}
              r="4"
              fill="#f59e0b"
            />
            <text
              x={chartData.lowestPoint.cx}
              y={chartData.lowestPoint.cy + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              BOTTOM
            </text>
          </g>
        )}

        {/* Ideal J-curve reference (dashed) */}
        <path
          d={`M ${chartData.startPoint.cx} ${chartData.startPoint.cy} 
              Q ${chartData.startPoint.cx - 20} ${chartData.lowestPoint.cy - 20}, 
                ${chartData.lowestPoint.cx - 10} ${chartData.lowestPoint.cy}
              Q ${chartData.lowestPoint.cx + 10} ${chartData.lowestPoint.cy - 30},
                ${chartData.endPoint.cx} ${chartData.endPoint.cy}`}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.15"
        />
      </svg>

      {/* Stats below chart */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground">Horizontal Range</p>
          <p className="text-sm font-medium tabular-nums">
            {Math.round(chartData.xMax - chartData.xMin)} px
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Vertical Range</p>
          <p className="text-sm font-medium tabular-nums">
            {Math.round(chartData.yMax - chartData.yMin)} px
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Points</p>
          <p className="text-sm font-medium tabular-nums">
            {chartData.points.length}
          </p>
        </div>
      </div>
    </Card>
  )
}
