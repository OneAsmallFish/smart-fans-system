// components/FanCard.tsx
import { useState } from 'react'

interface FanState {
  fan_index: number
  pwm_duty_pct: number
  rpm: number
  stalled: boolean
  mode: string
}

interface Props {
  deviceId: string
  fan: FanState
  apiBase: string
}

export function FanCard({ deviceId, fan, apiBase }: Props) {
  const [duty, setDuty]  = useState(fan.pwm_duty_pct)
  const [mode, setMode]  = useState<'auto' | 'manual'>(
    fan.mode === 'manual' ? 'manual' : 'auto',
  )

  const applySpeed = (val: number) =>
    fetch(`${apiBase}/devices/${deviceId}/fan/${fan.fan_index}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: val }),
    })

  const toggleMode = async () => {
    const next = mode === 'auto' ? 'manual' : 'auto'
    setMode(next)
    if (next === 'manual') applySpeed(duty)
    else
      fetch(`${apiBase}/devices/${deviceId}/fan/${fan.fan_index}/curve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'lut', temperature_source: 'bme280' }),
      })
  }

  return (
    <div style={{
      background: '#111827', borderRadius: 10, padding: '12px 16px',
      flex: '1 1 160px', minWidth: 160,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Fan {fan.fan_index}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {fan.stalled && (
            <span style={{ color: '#ef4444', fontSize: 11 }}>⚠ STALL</span>
          )}
          <button onClick={toggleMode} style={{
            padding: '2px 8px', borderRadius: 99, fontSize: 11, cursor: 'pointer',
            background: mode === 'auto' ? '#14532d' : '#1e3a5f', border: 'none',
            color: mode === 'auto' ? '#86efac' : '#93c5fd',
          }}>
            {mode === 'auto' ? 'AUTO' : 'MANUAL'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 24, fontWeight: 800, textAlign: 'center',
                    color: fan.stalled ? '#ef4444' : '#f9fafb' }}>
        {fan.rpm} <span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af' }}>RPM</span>
      </div>

      <input
        type="range" min={0} max={100} value={duty}
        disabled={mode === 'auto'}
        onChange={e => setDuty(Number(e.target.value))}
        onMouseUp={() => mode === 'manual' && applySpeed(duty)}
        style={{
          width: '100%', marginTop: 8, accentColor: '#3b82f6',
          cursor: mode === 'auto' ? 'not-allowed' : 'pointer', opacity: mode === 'auto' ? 0.5 : 1,
        }}
      />
      <div style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
        {duty}% duty
      </div>
    </div>
  )
}
