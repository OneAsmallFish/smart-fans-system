// components/fan/CurveCanvas.tsx — 自绘 SVG 曲线编辑器：拖拽点 / 线段加点 / 双击删点 / 平滑预览
// 校验策略与固件 FW-33 一致：温度严格递增（拖拽时直接 clamp 到邻点之间，天然合法）
import { useRef, useState } from 'react'
import type { LUTPoint } from '../../types'

const W = 620
const H = 300
const TEMP_MAX = 100   // °C 横轴域
const PAD_L = 34
const PAD_R = 12
const PAD_T = 10
const PAD_B = 24

interface Props {
  points: LUTPoint[]
  onChange: (pts: LUTPoint[]) => void
  maxPoints: number
  smooth: boolean
  currentTemp?: number | null
}

const toX = (temp: number) => PAD_L + (temp / TEMP_MAX) * (W - PAD_L - PAD_R)
const toY = (duty: number) => PAD_T + (1 - duty / 100) * (H - PAD_T - PAD_B)
const fromX = (x: number) => Math.round(((x - PAD_L) / (W - PAD_L - PAD_R)) * TEMP_MAX)
const fromY = (y: number) => Math.round((1 - (y - PAD_T) / (H - PAD_T - PAD_B)) * 100)

/** Catmull-Rom → 三次贝塞尔（平滑预览） */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 3) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

export function CurveCanvas({ points, onChange, maxPoints, smooth, currentTemp }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIdx = useRef<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const sorted = [...points].sort((a, b) => a.temp_c - b.temp_c)
  const svgPts = sorted.map(p => ({ x: toX(p.temp_c), y: toY(p.duty_pct), p }))

  const clientToTempDuty = (e: React.PointerEvent): { temp: number; duty: number } => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H
    return { temp: fromX(x), duty: Math.max(0, Math.min(100, fromY(y))) }
  }

  /** 拖拽时 clamp 温度到 [prev+1, next-1]，保证严格递增 */
  const clampTemp = (idx: number, temp: number): number => {
    const prev = sorted[idx - 1]?.temp_c
    const next = sorted[idx + 1]?.temp_c
    const lo = prev !== undefined ? prev + 1 : 0
    const hi = next !== undefined ? next - 1 : TEMP_MAX
    return Math.max(lo, Math.min(hi, temp))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIdx.current === null) return
    const idx = dragIdx.current
    const { temp, duty } = clientToTempDuty(e)
    const next = sorted.map((p, i) =>
      i === idx
        ? { temp_c: clampTemp(idx, temp), duty_pct: duty }
        : { ...p },
    )
    onChange(next)
  }

  const endDrag = () => { dragIdx.current = null }

  const addPointAt = (e: React.MouseEvent) => {
    if (sorted.length >= maxPoints) return
    const rect = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const temp = fromX(x)
    // 找到插入位置（按温度），duty 取该处插值
    let insertAt = sorted.findIndex(p => p.temp_c > temp)
    if (insertAt === -1) insertAt = sorted.length
    const prev = sorted[insertAt - 1]
    const nextP = sorted[insertAt]
    let duty = 50
    if (prev && nextP) {
      const t = (temp - prev.temp_c) / (nextP.temp_c - prev.temp_c)
      duty = Math.round(prev.duty_pct + t * (nextP.duty_pct - prev.duty_pct))
    } else duty = prev?.duty_pct ?? nextP?.duty_pct ?? 50
    // 温度防撞（严格递增）
    const lo = prev ? prev.temp_c + 1 : 0
    const hi = nextP ? nextP.temp_c - 1 : TEMP_MAX
    const safeTemp = Math.max(lo, Math.min(hi, temp))
    if (safeTemp <= lo - 1 || safeTemp >= hi + 1) return
    const next = [...sorted]
    next.splice(insertAt, 0, { temp_c: safeTemp, duty_pct: duty })
    onChange(next)
  }

  const removePoint = (idx: number) => {
    if (sorted.length <= 2) return
    onChange(sorted.filter((_, i) => i !== idx))
  }

  // 当前温度命中线
  const hit = currentTemp != null && currentTemp >= 0 && currentTemp <= TEMP_MAX
    ? { x: toX(currentTemp), duty: null as number | null }
    : null

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onMouseMove={onPointerMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <defs>
        <clipPath id="curve-clip">
          <rect x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={H - PAD_T - PAD_B} rx="6" />
        </clipPath>
      </defs>

      {/* 网格 */}
      {[0, 25, 50, 75, 100].map(d => (
        <g key={d}>
          <line x1={PAD_L} x2={W - PAD_R} y1={toY(d)} y2={toY(d)} stroke="var(--chart-grid)" strokeWidth="1" />
          <text x={PAD_L - 6} y={toY(d) + 3} textAnchor="end" fontSize="9" fill="var(--chart-axis)" className="num">{d}</text>
        </g>
      ))}
      {[0, 20, 40, 60, 80, 100].map(temp => (
        <g key={temp}>
          <line x1={toX(temp)} x2={toX(temp)} y1={PAD_T} y2={H - PAD_B} stroke="var(--chart-grid)" strokeWidth="1" />
          <text x={toX(temp)} y={H - PAD_B + 14} textAnchor="middle" fontSize="9" fill="var(--chart-axis)" className="num">{temp}°</text>
        </g>
      ))}

      {/* 绘图区边框 */}
      <rect x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={H - PAD_T - PAD_B}
            fill="var(--surface-2)" stroke="var(--line)" rx="6" />

      <g clipPath="url(#curve-clip)">
        {/* 曲线（平滑或折线） */}
        {smooth && svgPts.length >= 3 ? (
          <path d={smoothPath(svgPts)} fill="none" stroke="var(--primary)" strokeWidth="2.5"
                style={{ filter: 'drop-shadow(0 0 4px var(--glow))' }} />
        ) : (
          <polyline
            points={svgPts.map(q => `${q.x},${q.y}`).join(' ')}
            fill="none" stroke="var(--primary)" strokeWidth="2.5"
            style={{ filter: 'drop-shadow(0 0 4px var(--glow))' }}
          />
        )}
        {/* 曲线下方渐变填充 */}
        {svgPts.length >= 2 && (
          <polygon
            points={`${svgPts[0].x},${H - PAD_B} ${svgPts.map(q => `${q.x},${q.y}`).join(' ')} ${svgPts[svgPts.length - 1].x},${H - PAD_B}`}
            fill="var(--primary)" opacity="0.07"
          />
        )}

        {/* 当前温度命中线 */}
        {hit && (
          <g>
            <line x1={hit.x} x2={hit.x} y1={PAD_T} y2={H - PAD_B}
                  stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="4 4" />
            <circle cx={hit.x} cy={PAD_T + 6} r="3" fill="var(--warn)" />
          </g>
        )}
      </g>

      {/* 可交互点（不裁剪，保持可拖） */}
      {svgPts.map((q, i) => (
        <g key={i}>
          {/* 线段点击区（加点半径用） */}
          {i < svgPts.length - 1 && (
            <line
              x1={q.x} y1={q.y} x2={svgPts[i + 1].x} y2={svgPts[i + 1].y}
              stroke="transparent" strokeWidth="16" style={{ cursor: 'copy' }}
              onClick={addPointAt}
            />
          )}
          <circle
            cx={q.x} cy={q.y}
            r={dragIdx.current === i ? 8 : hoverIdx === i ? 7 : 5.5}
            fill="var(--primary)" stroke="var(--bg)" strokeWidth="2.5"
            style={{ cursor: 'grab', transition: 'r 0.12s', filter: 'drop-shadow(0 0 4px var(--glow))' }}
            onPointerDown={e => {
              dragIdx.current = i
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onMouseDown={() => { dragIdx.current = i }}
            onDoubleClick={() => removePoint(i)}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
          {/* 点位标签 */}
          <text x={q.x} y={q.y - 12} textAnchor="middle" fontSize="9.5"
                fill="var(--fg)" className="num" style={{ pointerEvents: 'none', fontWeight: 600 }}>
            {q.p.duty_pct}%
          </text>
        </g>
      ))}
    </svg>
  )
}
