// pages/Alerts.tsx — 告警规则配置 + 历史时间线
import { useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'

const API = `http://${window.location.hostname}:3001/api`
const WS_URL = `ws://${window.location.hostname}:3001`

const ALERT_TYPES = [
  { type: 'temperature_high', label: 'Temperature High', unit: '°C', defaultThreshold: 75 },
  { type: 'fan_stalled',      label: 'Fan Stalled',      unit: 'RPM', defaultThreshold: 200 },
  { type: 'voltage_abnormal', label: 'Voltage Abnormal', unit: 'V',  defaultThreshold: 10.8 },
  { type: 'wifi_disconnected',label: 'WiFi Disconnect',  unit: 's',  defaultThreshold: 60 },
]

const SEV_COLORS: Record<number, string> = { 0: '#22c55e', 1: '#f59e0b', 2: '#ef4444' }

export default function Alerts() {
  const { devices } = useWebSocket(WS_URL)
  const device = devices[0]
  const [rules, setRules] = useState(
    ALERT_TYPES.map(t => ({ type: t.type, threshold: t.defaultThreshold, enabled: true }))
  )

  const applyRules = async () => {
    if (!device) return
    await fetch(`${API}/devices/${device.deviceId}/alert`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
    })
  }

  const alerts = device?.alerts ?? []

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 20 }}>Alerts</h1>

      {/* Rules */}
      <div style={{ background: '#1e2030', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 600 }}>Alert Rules</span>
          <button onClick={applyRules} style={{
            padding: '4px 16px', borderRadius: 99, background: '#22c55e', color: 'white',
            border: 'none', cursor: 'pointer', fontSize: 12,
          }}>Save Rules</button>
        </div>

        {ALERT_TYPES.map((t, i) => (
          <div key={t.type} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0', borderBottom: i < ALERT_TYPES.length - 1 ? '1px solid #374151' : 'none',
          }}>
            {/* Toggle */}
            <button onClick={() => setRules(r => r.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x))}
              style={{
                width: 38, height: 22, borderRadius: 99, border: 'none', cursor: 'pointer',
                background: rules[i].enabled ? '#22c55e' : '#374151',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%',
                background: 'white', transition: 'left 0.2s',
                left: rules[i].enabled ? 18 : 3,
              }} />
            </button>
            <span style={{ flex: 1, fontSize: 14 }}>{t.label}</span>
            <span style={{ fontSize: 12, color: '#aaa' }}>Threshold:</span>
            <input type="number" value={rules[i].threshold}
              onChange={e => setRules(r => r.map((x, j) => j === i ? { ...x, threshold: Number(e.target.value) } : x))}
              style={{ width: 70, background: '#374151', border: 'none', color: 'white', borderRadius: 6, padding: '4px 8px' }}
            />
            <span style={{ fontSize: 12, color: '#aaa' }}>{t.unit}</span>
          </div>
        ))}
      </div>

      {/* Alert history */}
      <div style={{ background: '#1e2030', borderRadius: 12, padding: 20 }}>
        <span style={{ fontWeight: 600, display: 'block', marginBottom: 12 }}>
          Recent Alerts ({alerts.length})
        </span>
        {alerts.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 14 }}>No alerts</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {alerts.slice(0, 50).map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 8, background: '#111827',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                               background: SEV_COLORS[a.alert_type] ?? '#6b7280' }} />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  {new Date(a.timestamp * 1000).toLocaleTimeString()}
                </span>
                <span style={{ fontSize: 13, flex: 1 }}>{a.message}</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  val={a.value?.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
