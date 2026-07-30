// components/VoltageBar.tsx
interface Props {
  label: string
  value: number
  nominal: number
  tolerance: number     // ±%
  unit?: string
}

export function VoltageBar({ label, value, nominal, tolerance, unit = 'V' }: Props) {
  const min = nominal * (1 - tolerance / 100)
  const max = nominal * (1 + tolerance / 100)
  const ok  = value >= min && value <= max
  const pct = Math.min(100, Math.max(0, (value / (nominal * 1.3)) * 100))

  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: '#9ca3af' }}>{label}</span>
        <span style={{ fontWeight: 600,
                       color: ok ? '#86efac' : '#fca5a5' }}>
          {value.toFixed(2)}{unit}
        </span>
      </div>
      <div style={{ height: 6, background: '#374151', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 99,
          background: ok ? '#22c55e' : '#ef4444',
          transition: 'width 0.4s ease',
        }} />
      </div>
      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
        {min.toFixed(2)} – {max.toFixed(2)}{unit}
      </div>
    </div>
  )
}
