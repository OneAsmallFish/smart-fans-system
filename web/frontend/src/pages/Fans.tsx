// pages/Fans.tsx — 8 路风扇控制 + 曲线编辑器（WEB-11: 使用 components/，删除内联版）
import { useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { FanCard } from '../components/FanCard'
import { CurveEditor } from '../components/CurveEditor'

const API = '/api'   // vite dev 代理 → backend 3001
const WS_URL = `ws://${window.location.hostname}:3001`

export default function Fans() {
  const { devices } = useWebSocket(WS_URL)
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
                       fan={f} apiBase={API} />
            ))}
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14 }}>Curve editor — Fan:</span>
              {device.fans.map(f => (
                <button key={f.fan_index} onClick={() => setCurveTarget(f.fan_index)} style={{
                  padding: '2px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                  background: curveTarget === f.fan_index ? '#3b82f6' : '#374151',
                  color: 'white', border: 'none',
                }}>{f.fan_index}</button>
              ))}
            </div>
            <CurveEditor deviceId={device.deviceId} fanIdx={curveTarget} apiBase={API} />
          </div>
        </>
      )}
    </main>
  )
}
