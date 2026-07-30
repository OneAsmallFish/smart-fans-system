// components/CurveEditor.tsx
import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
} from 'recharts'

export interface LUTPoint {
  temp_c: number
  duty_pct: number
}

export interface PIDParams {
  kp: number; ki: number; kd: number; setpoint_c: number
}

interface Props {
  deviceId: string
  fanIdx: number
  apiBase: string
  defaultLUT?: LUTPoint[]
  defaultPID?: PIDParams
}

const DEFAULT_LUT: LUTPoint[] = [
  { temp_c: 30, duty_pct: 20 },
  { temp_c: 40, duty_pct: 40 },
  { temp_c: 50, duty_pct: 60 },
  { temp_c: 60, duty_pct: 80 },
  { temp_c: 70, duty_pct: 100 },
]
const DEFAULT_PID: PIDParams = { kp: 2.0, ki: 0.1, kd: 0.5, setpoint_c: 50 }

export function CurveEditor({ deviceId, fanIdx, apiBase, defaultLUT, defaultPID }: Props) {
  const [mode,   setMode]   = useState<'lut' | 'pid'>('lut')
  const [points, setPoints] = useState<LUTPoint[]>(defaultLUT ?? DEFAULT_LUT)
  const [pid,    setPid]    = useState<PIDParams>(defaultPID ?? DEFAULT_PID)
  const [saved,  setSaved]  = useState(false)

  const apply = async () => {
    const body = mode === 'lut'
      ? { mode: 'lut', temperature_source: 'bme280', points }
      : { mode: 'pid', temperature_source: 'bme280', pid }
    await fetch(`${apiBase}/devices/${deviceId}/fan/${fanIdx}/curve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ background: '#0f1117', borderRadius: 10, padding: 16 }}>
      {/* Mode selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Fan {fanIdx} Curve</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['lut', 'pid'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '3px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
              background: mode === m ? '#3b82f6' : '#374151',
              color: 'white', border: 'none',
            }}>{m.toUpperCase()}</button>
          ))}
          <button onClick={apply} style={{
            padding: '3px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
            background: saved ? '#14532d' : '#22c55e', color: 'white', border: 'none',
          }}>
            {saved ? '✓ Saved' : 'Apply'}
          </button>
        </div>
      </div>

      {mode === 'lut' ? (
        <>
          {/* Chart */}
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={points.map(p => ({ temp: p.temp_c, duty: p.duty_pct }))}
                       margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="temp" unit="°C" tick={{ fontSize: 10 }} />
              <YAxis unit="%" tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip formatter={(v) => [`${v}%`, 'Duty']} />
              <Line dataKey="duty" stroke="#3b82f6" strokeWidth={2}
                    dot={{ fill: '#3b82f6', r: 5, cursor: 'pointer' }} />
            </LineChart>
          </ResponsiveContainer>

          {/* Editable points */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {points.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center',
                                    gap: 3, fontSize: 11 }}>
                <input type="number" value={p.temp_c}
                  style={{ width: 44, ...inStyle }}
                  onChange={e => {
                    const next = [...points]
                    next[i] = { ...next[i], temp_c: Number(e.target.value) }
                    setPoints(next)
                  }} />
                <span style={{ color: '#6b7280' }}>°→</span>
                <input type="number" value={p.duty_pct}
                  style={{ width: 44, ...inStyle }}
                  onChange={e => {
                    const next = [...points]
                    next[i] = { ...next[i], duty_pct: Number(e.target.value) }
                    setPoints(next)
                  }} />
                <span style={{ color: '#6b7280' }}>%</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* PID params */
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(Object.entries(pid) as [keyof PIDParams, number][]).map(([k, v]) => (
            <label key={k} style={{ fontSize: 12, display: 'flex',
                                    flexDirection: 'column', gap: 3 }}>
              <span style={{ color: '#9ca3af' }}>{k}</span>
              <input type="number" value={v}
                step={k === 'setpoint_c' ? 1 : 0.05}
                style={{ width: 76, ...inStyle }}
                onChange={e => setPid(prev => ({ ...prev, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

const inStyle: React.CSSProperties = {
  background: '#1f2937', border: 'none', color: 'white',
  borderRadius: 4, padding: '3px 6px',
}
