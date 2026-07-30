// pages/Fans.tsx — 4路风扇控制 + 曲线编辑器 + PID面板
import { useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const API = `http://${window.location.hostname}:3001/api`
const WS_URL = `ws://${window.location.hostname}:3001`

const DEFAULT_LUT = [
  { temp_c: 30, duty_pct: 20 },
  { temp_c: 40, duty_pct: 40 },
  { temp_c: 50, duty_pct: 60 },
  { temp_c: 60, duty_pct: 80 },
  { temp_c: 70, duty_pct: 100 },
]

function FanCard({ deviceId, fanIdx, fanState }: {
  deviceId: string
  fanIdx: number
  fanState: { pwm_duty_pct: number; rpm: number; stalled: boolean; mode: string }
}) {
  const [duty, setDuty] = useState(fanState.pwm_duty_pct)
  const [mode, setMode] = useState<'auto' | 'manual'>(fanState.mode as any ?? 'auto')

  const applySpeed = async (val: number) => {
    await fetch(`${API}/devices/${deviceId}/fan/${fanIdx}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: val }),
    })
  }

  const toggleMode = async () => {
    const next = mode === 'auto' ? 'manual' : 'auto'
    setMode(next)
    if (next === 'manual') applySpeed(duty)
    else {
      // restore auto by sending curve command
      await fetch(`${API}/devices/${deviceId}/fan/${fanIdx}/curve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'lut', temperature_source: 'bme280' }),
      })
    }
  }

  return (
    <div style={{ background: '#1e2030', borderRadius: 10, padding: 16, flex: '1 1 200px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600 }}>Fan {fanIdx}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {fanState.stalled && <span style={{ color: '#ef4444', fontSize: 12 }}>⚠ Stalled</span>}
          <span style={{ fontSize: 12, color: '#6b7280' }}>{fanState.rpm} RPM</span>
          <button onClick={toggleMode} style={{
            padding: '2px 10px', borderRadius: 99, fontSize: 11, cursor: 'pointer',
            background: mode === 'auto' ? '#166534' : '#1e40af',
            color: mode === 'auto' ? '#86efac' : '#93c5fd', border: 'none',
          }}>
            {mode === 'auto' ? 'AUTO' : 'MANUAL'}
          </button>
        </div>
      </div>

      <input
        type="range" min={0} max={100} value={duty}
        disabled={mode === 'auto'}
        onChange={e => setDuty(Number(e.target.value))}
        onMouseUp={() => mode === 'manual' && applySpeed(duty)}
        style={{ width: '100%', accentColor: '#3b82f6', cursor: mode === 'auto' ? 'not-allowed' : 'pointer' }}
      />
      <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 700, marginTop: 4 }}>
        {duty}%
      </div>
    </div>
  )
}

function CurveEditor({ deviceId, fanIdx }: { deviceId: string; fanIdx: number }) {
  const [points, setPoints] = useState([...DEFAULT_LUT])
  const [mode, setMode] = useState<'lut' | 'pid'>('lut')
  const [pid, setPid] = useState({ kp: 2.0, ki: 0.1, kd: 0.5, setpoint_c: 50 })

  const apply = async () => {
    const body = mode === 'lut'
      ? { mode: 'lut', temperature_source: 'bme280', points }
      : { mode: 'pid', temperature_source: 'bme280', pid }
    await fetch(`${API}/devices/${deviceId}/fan/${fanIdx}/curve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const chartData = points.map(p => ({ temp: p.temp_c, duty: p.duty_pct }))

  return (
    <div style={{ background: '#161624', borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600 }}>Fan {fanIdx} Curve</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['lut', 'pid'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '2px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
              background: mode === m ? '#3b82f6' : '#374151', color: 'white', border: 'none',
            }}>{m.toUpperCase()}</button>
          ))}
          <button onClick={apply} style={{
            padding: '2px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
            background: '#22c55e', color: 'white', border: 'none',
          }}>Apply</button>
        </div>
      </div>

      {mode === 'lut' ? (
        <>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="temp" unit="°C" tick={{ fontSize: 11 }} />
              <YAxis unit="%" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line dataKey="duty" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {points.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                <input type="number" value={p.temp_c} min={0} max={100} style={{ width: 48, background: '#374151', border: 'none', color: 'white', borderRadius: 4, padding: '2px 4px' }}
                  onChange={e => { const np = [...points]; np[i] = { ...np[i], temp_c: Number(e.target.value) }; setPoints(np) }} />
                <span style={{ color: '#aaa' }}>°C→</span>
                <input type="number" value={p.duty_pct} min={0} max={100} style={{ width: 48, background: '#374151', border: 'none', color: 'white', borderRadius: 4, padding: '2px 4px' }}
                  onChange={e => { const np = [...points]; np[i] = { ...np[i], duty_pct: Number(e.target.value) }; setPoints(np) }} />
                <span style={{ color: '#aaa' }}>%</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(pid).map(([k, v]) => (
            <label key={k} style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: '#aaa' }}>{k}</span>
              <input type="number" value={v} step={k === 'setpoint_c' ? 1 : 0.05}
                style={{ width: 80, background: '#374151', border: 'none', color: 'white', borderRadius: 4, padding: '3px 6px' }}
                onChange={e => setPid(p => ({ ...p, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Fans() {
  const { devices, connected } = useWebSocket(WS_URL)
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)
  const [curveTarget, setCurveTarget] = useState(0)

  const device = devices.find(d => d.deviceId === (selectedDevice ?? devices[0]?.deviceId))

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Fans</h1>
        {devices.length > 1 && (
          <select value={selectedDevice ?? ''} onChange={e => setSelectedDevice(e.target.value)}
            style={{ background: '#374151', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px' }}>
            {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.deviceId}</option>)}
          </select>
        )}
      </div>

      {!device ? (
        <p style={{ color: '#aaa' }}>No devices online</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {device.fans.map(f => (
              <FanCard key={f.fan_index} deviceId={device.deviceId}
                fanIdx={f.fan_index} fanState={f} />
            ))}
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14 }}>Curve editor — Fan:</span>
              {device.fans.map(f => (
                <button key={f.fan_index} onClick={() => setCurveTarget(f.fan_index)} style={{
                  padding: '2px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                  background: curveTarget === f.fan_index ? '#3b82f6' : '#374151',
                  color: 'white', border: 'none',
                }}>{f.fan_index}</button>
              ))}
            </div>
            <CurveEditor deviceId={device.deviceId} fanIdx={curveTarget} />
          </div>
        </>
      )}
    </main>
  )
}
