// pages/Devices.tsx — 设备管理 + OTA（WEB-11: 使用 components/OTAProgress，接真实进度）+ 重启
import { useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { OTAProgress } from '../components/OTAProgress'

const API = '/api'
const WS_URL = `ws://${window.location.hostname}:3001`

function DeviceRow({ d }: { d: ReturnType<typeof useWebSocket>['devices'][number] }) {
  const [confirming, setConfirming] = useState(false)

  const reboot = async () => {
    if (!confirming) { setConfirming(true); return }
    await fetch(`${API}/devices/${d.deviceId}/reboot`, { method: 'POST' })
    setConfirming(false)
  }

  return (
    <div style={{ background: '#1e2030', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{d.deviceId}</span>
          {d.ipAddress && <span style={{ color: '#9ca3af', marginLeft: 10, fontSize: 13 }}>{d.ipAddress}</span>}
          {d.firmware && <span style={{ color: '#6b7280', marginLeft: 10, fontSize: 12 }}>FW {d.firmware}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12,
                         background: d.online ? '#14532d' : '#450a0a',
                         color: d.online ? '#86efac' : '#fca5a5' }}>
            {d.online ? '● Online' : '○ Offline'}
          </span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            Last seen: {new Date(d.lastSeen).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* OTA（真实进度：device.ota 来自 ota/status，WEB-04） */}
      <div style={{ marginBottom: 16 }}>
        <OTAProgress deviceId={d.deviceId} apiBase={API} online={d.online} ota={d.ota} />
      </div>

      {/* Reboot */}
      <div style={{ borderTop: '1px solid #374151', paddingTop: 12 }}>
        <button onClick={reboot} disabled={!d.online} style={{
          padding: '6px 16px', borderRadius: 6, fontSize: 13, cursor: d.online ? 'pointer' : 'not-allowed',
          background: confirming ? '#ef4444' : '#374151', color: 'white', border: 'none',
        }}>
          {confirming ? 'Click again to confirm reboot' : 'Reboot Device'}
        </button>
        {confirming && <button onClick={() => setConfirming(false)} style={{
          marginLeft: 8, padding: '6px 12px', borderRadius: 6, fontSize: 12,
          background: '#374151', color: '#9ca3af', border: 'none', cursor: 'pointer',
        }}>Cancel</button>}
      </div>
    </div>
  )
}

export default function Devices() {
  const { devices, connected } = useWebSocket(WS_URL)

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Devices</h1>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{devices.length} device(s)</span>
      </div>

      {devices.length === 0 ? (
        <p style={{ color: '#6b7280' }}>
          {connected ? 'No devices found. Check MQTT connection.' : 'Connecting to server...'}
        </p>
      ) : (
        devices.map(d => <DeviceRow key={d.deviceId} d={d} />)
      )}
    </main>
  )
}
