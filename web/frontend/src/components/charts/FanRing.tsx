// components/charts/FanRing.tsx — 风扇环：外弧 = 占空比，中心 = RPM
import { cn } from '../../lib/utils'

interface Props {
  rpm: number
  duty: number
  stalled?: boolean
  size?: number
  label?: string
}

export function FanRing({ rpm, duty, stalled, size = 84, label }: Props) {
  const pct = Math.max(0, Math.min(1, duty / 100))
  const r = 40
  const c = 2 * Math.PI * r
  const arc = 0.75 * c
  const color = stalled ? 'var(--danger)' : 'var(--primary)'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-[225deg]">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--chart-grid)" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${arc} ${c}`} />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${pct * arc} ${c}`}
          style={{ transition: 'stroke-dasharray 0.5s ease', filter: 'drop-shadow(0 0 5px var(--glow))' }}
        />
      </svg>
      <div className={cn('num absolute inset-0 flex flex-col items-center justify-center')}>
        <span className={cn('text-lg font-bold leading-none', stalled ? 'text-danger' : 'text-fg')}>{rpm}</span>
        <span className="mt-0.5 text-[9px] font-medium text-faint">{label ?? 'RPM'}</span>
      </div>
    </div>
  )
}
