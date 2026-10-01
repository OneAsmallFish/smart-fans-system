// components/CurveEditor.tsx — 风扇曲线编辑器（WEB-11 复活）
// WEB-12: 输入 clamp（duty 0-100）、点位按温度排序、点数上限 10（与固件一致）。
// ADJ-4: PID 字段平铺在 payload 顶层（kp/ki/kd/setpoint_c）。
// ADJ-5: temperature_source 用 4 个合法字符串。
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

const MAX_POINTS = 10   /* WEB-12: 与固件 FAN_CURVE_MAX_POINTS 一致 */

const DEFAULT_LUT: LUTPoint[] = [
  { temp_c: 30, duty_pct: 20 },
  { temp_c: 40, duty_pct: 40 },
  { temp_c: 50, duty_pct: 60 },
  { temp_c: 60, duty_pct: 80 },
  { temp_c: 70, duty_pct: 100 },
]
const DEFAULT_PID: PIDParams = { kp: 2.0, ki: 0.1, kd: 0.5, setpoint_c: 50 }

const clampDuty = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
const sortPoints = (pts: LUTPoint[]) => [...pts].sort((a, b) => a.temp_c - b.temp_c)

export function CurveEditor({ deviceId, fanIdx, apiBase, defaultLUT, defaultPID }: Props) {
  const [mode,   setMode]   = useState<'lut' | 'pid'>('lut')
  const [points, setPoints] = useState<LUTPoint[]>(sortPoints(defaultLUT ?? DEFAULT_LUT))
  const [pid,    setPid]    = useState<PIDParams>(defaultPID ?? DEFAULT_PID)
  const [saved,  setSaved]  = useState(false)

  const apply = async () => {
    /* WEB-12: 提交前 clamp + 排序（固件 FW-33 要求 temp_c 严格递增） */
    const sorted = sortPoints(points.map(p => ({ ...p, duty_pct: clampDuty(p.duty_pct) })))
    const body = mode === 'lut'
      ? { mode: 'lut', temperature_source: 'bme280', points: sorted }
      : { mode: 'pid', temperature_source: 'bme280',
          kp: pid.kp, ki: pid.ki, kd: pid.kd, setpoint_c: pid.setpoint_c }
    await fetch(`${apiBase}/devices/${deviceId}/fan/${fanIdx}/curve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addPoint = () => {
    if (points.length >= MAX_POINTS) return
    const last = points[points.length - 1]
    setPoints([...points, { temp_c: (last?.temp_c ?? 20) + 10, duty_pct: clampDuty((last?.duty_pct ?? 0) + 10) }])
  }
  const removePoint = (i: number) => setPoints(pts => pts.filter((_, j) => j !== i))

  return (
    <div style={{ background: '#161624', borderRadius: 10, padding: 16 }}>
      {/* Mode selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          Fan {fanIdx} Curve（{points.length}/{MAX_POINTS} 点）
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['lut', 'pid'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '3px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
              background: mode === m ? '#3b82f6' : '#374151',
              color: 'white', border: 'none',
            }}>{m.toUpperCase()}</button>
          ))}
          {mode === 'lut' && (
            <button onClick={addPoint} disabled={points.length >= MAX_POINTS} style={{
              padding: '3px 12px', borderRadius: 99, fontSize: 12,
              cursor: points.length >= MAX_POINTS ? 'not-allowed' : 'pointer',
              background: points.length >= MAX_POINTS ? '#374151' : '#1e40af',
              color: 'white', border: 'none',
            }}>+ 点</button>
          )}
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
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={sortPoints(points).map(p => ({ temp: p.temp_c, duty: clampDuty(p.duty_pct) }))}
                       margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
              <XAxis dataKey="temp" unit="°C" tick={{ fontSize: 10 }} />
              <YAxis unit="%" tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip formatter={(v) => [`${v}%`, 'Duty']} />
              <Line dataKey="duty" stroke="#3b82f6" strokeWidth={2}
                    dot={{ fill: '#3b82f6', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>

          {/* Editable points（展示按温度排序后的顺序） */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {sortPoints(points).map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center',
                                    gap: 3, fontSize: 11 }}>
                <input type="number" value={p.temp_c} min={0} max={150}
                  style={{ width: 48, ...inStyle }}
                  onChange={e => {
                    const v = Number(e.target.value)
                    setPoints(pts => sortPoints(pts.map((x, j) =>
                      j === i ? { ...x, temp_c: v } : x)))
                  }} />
                <span style={{ color: '#6b7280' }}>°→</span>
                <input type="number" value={p.duty_pct} min={0} max={100}
                  style={{ width: 48, ...inStyle }}
                  onChange={e => {
                    const v = clampDuty(Number(e.target.value))
                    setPoints(pts => pts.map((x, j) =>
                      j === i ? { ...x, duty_pct: v } : x))
                  }} />
                <span style={{ color: '#6b7280' }}>%</span>
                <button onClick={() => removePoint(i)}
                        title="删除该点" style={{
                  background: 'none', border: 'none', color: '#6b7280',
                  cursor: 'pointer', fontSize: 12, padding: '0 2px',
                }}>×</button>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* PID params（payload 平铺字段，ADJ-4） */
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
  background: '#374151', border: 'none', color: 'white',
  borderRadius: 4, padding: '3px 6px',
}
