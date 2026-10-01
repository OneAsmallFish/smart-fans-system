// components/charts/TempRing.tsx — 自绘 SVG 环形温度仪表（THRM glacier 风格：270° 弧 + 辉光）
import { cn } from '../../lib/utils'

interface Props {
  value: number
  label: string
  unit?: string
  max?: number
  warnAt?: number
  critAt?: number
  size?: number
  precision?: number
}

export function TempRing({
  value,
  label,
  unit = '°C',
  max = 85,
  warnAt = 55,
  critAt = 75,
  size = 92,
  precision = 1,
}: Props) {
  const pct = Math.max(0, Math.min(1, value / max))
  const r = 40
  const c = 2 * Math.PI * r
  const arc = 0.75 * c // 270°
  const color = value > critAt ? 'var(--danger)' : value > warnAt ? 'var(--warn)' : 'var(--ok)'

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: size + 8 }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-[225deg]">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--chart-grid)" strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={`${arc} ${c}`} />
          <circle
            cx="50" cy="50" r={r} fill="none"
            stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${pct * arc} ${c}`}
            style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.6s ease', filter: 'drop-shadow(0 0 5px var(--glow))' }}
          />
        </svg>
        <div className="num absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold leading-none" style={{ color }}>
            {value.toFixed(precision)}
          </span>
          <span className="mt-0.5 text-[9px] font-medium text-faint">{unit}</span>
        </div>
      </div>
      <span className={cn('text-center text-[11px] font-medium text-muted')}>{label}</span>
    </div>
  )
}
