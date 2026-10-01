// components/charts/VoltageBar.tsx — 电压条：容差窗口高亮 + 额定值刻度
import { cn } from '../../lib/utils'

interface Props {
  label: string
  value: number
  nominal: number
  tolerance: number // ±%
  unit?: string
}

export function VoltageBar({ label, value, nominal, tolerance, unit = 'V' }: Props) {
  const min = nominal * (1 - tolerance / 100)
  const max = nominal * (1 + tolerance / 100)
  const ok = value >= min && value <= max
  const scaleMax = nominal * 1.3
  const pct = Math.min(100, Math.max(0, (value / scaleMax) * 100))
  const winL = (min / scaleMax) * 100
  const winW = ((max - min) / scaleMax) * 100
  const nomPct = (nominal / scaleMax) * 100

  return (
    <div className="min-w-32 flex-1">
      <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-muted">{label}</span>
        <span className={cn('num text-sm font-bold', ok ? 'text-ok' : 'text-danger')}>
          {value.toFixed(2)}
          <span className="ml-0.5 text-[10px] font-normal text-faint">{unit}</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full border border-line bg-surface-2">
        {/* 容差窗口 */}
        <div
          className="absolute inset-y-0 bg-ok/12"
          style={{ left: `${winL}%`, width: `${winW}%` }}
        />
        {/* 当前值 */}
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', ok ? 'bg-ok' : 'bg-danger')}
          style={{ width: `${pct}%` }}
        />
        {/* 额定刻度 */}
        <div
          className="absolute inset-y-0 w-px bg-line-strong"
          style={{ left: `${nomPct}%` }}
        />
      </div>
      <div className="num mt-1 text-[10px] text-faint">
        {min.toFixed(2)} – {max.toFixed(2)}{unit}
      </div>
    </div>
  )
}
