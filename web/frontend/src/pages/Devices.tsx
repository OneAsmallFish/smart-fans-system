// pages/Devices.tsx — 设备管理 + OTA固件更新 + 重启
import { useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'

const API = `http://${window.location.hostname}:3001/api`
const WS_URL = `ws://${window.location.hostname}:3001`

function DeviceRow({ d }: { d: ReturnType<typeof useWebSocket>['devices'][number] }) {
  const [otaUrl, setOtaUrl] = useState('')
  const [otaStatus, setOtaStatus] = useState('')
  const [confirming, setConfirming] = useState(false)

  const triggerOTA = async () => {
    if (!otaUrl.startsWith('https://')) {
      setOtaStatus('URL must start with https://')
      return
    }
    const r = await fetch(`${API}/devices/${d.deviceId}/ota`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: otaUrl }),
    })
    const json = await r.json()
    setOtaStatus(json.ok ? '✓ OTA started — device will reboot when done' : `✗ ${json.error}`)
  }

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

      {/* OTA */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Firmware OTA Update</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="url" placeholder="https://your-server.com/firmware.bin"
            value={otaUrl} onChange={e => setOtaUrl(e.target.value)}
            style={{ flex: 1, background: '#111827', border: '1px solid #374151', color: 'white',
                     borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
          />
          <button onClick={triggerOTA} disabled={!d.online} style={{
            padding: '6px 16px', borderRadius: 6, background: d.online ? '#7c3aed' : '#374151',
            color: 'white', border: 'none', cursor: d.online ? 'pointer' : 'not-allowed', fontSize: 13,
          }}>Flash OTA</button>
        </div>
        {otaStatus && <p style={{ fontSize: 12, marginTop: 6,
                                  color: otaStatus.startsWith('✓') ? '#86efac' : '#fca5a5' }}>
          {otaStatus}</p>}
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
