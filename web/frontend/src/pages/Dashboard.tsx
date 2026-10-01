// pages/Dashboard.tsx — 实时仪表盘（WEB-11: 使用 components/DeviceCard，删除内联版）
import { useWebSocket } from '../hooks/useWebSocket'
import { DeviceCard } from '../components/DeviceCard'

const WS_URL = `ws://${window.location.hostname}:3001`

export default function Dashboard() {
  const { devices, connected } = useWebSocket(WS_URL)

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <span style={{ fontSize: 12, color: connected ? '#22c55e' : '#ef4444' }}>
          {connected ? '● WebSocket' : '○ Disconnected'}
        </span>
      </div>

      {devices.length === 0 ? (
        <p style={{ color: '#aaa' }}>Waiting for devices to come online...</p>
      ) : (
        devices.map(d => <DeviceCard key={d.deviceId} device={d} />)
      )}
    </main>
  )
}
