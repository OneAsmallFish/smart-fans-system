// pages/Alerts.tsx — 告警规则配置 + 历史时间线
// WEB-06: 颜色按 severity（warning/critical）映射，不再按 alert_type 数字。
// WEB-11: 规则编辑使用 components/AlertRuleEditor（双阈值模型）。
import { useWebSocket } from '../hooks/useWebSocket'
import { AlertRuleEditor } from '../components/AlertRuleEditor'

const API = '/api'
const WS_URL = `ws://${window.location.hostname}:3001`

/* WEB-06/ADJ-2: severity 字符串 → 颜色 */
const SEV_COLORS: Record<string, string> = {
  warning:  '#f59e0b',
  critical: '#ef4444',
  normal:   '#22c55e',
}

function fmtTime(ts: number): string {
  /* WEB-07/ADJ-1: 设备时间未同步（Unix 早期值）时明确标注 */
  if (ts < 1000000000) return '时间未同步'
  return new Date(ts * 1000).toLocaleTimeString()
}

export default function Alerts() {
  const { devices } = useWebSocket(WS_URL)
  const device = devices[0]
  const alerts = device?.alerts ?? []

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 20 }}>Alerts</h1>

      {/* Rules（components/AlertRuleEditor，双阈值） */}
      <div style={{ background: '#1e2030', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        {device ? (
          <AlertRuleEditor deviceId={device.deviceId} apiBase={API} />
        ) : (
          <p style={{ color: '#aaa' }}>No device online</p>
        )}
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
                               background: SEV_COLORS[a.severity] ?? '#6b7280' }} />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  {fmtTime(a.timestamp)}
                </span>
                <span style={{ fontSize: 13, flex: 1 }}>{a.message}</span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{a.alert_type}</span>
                {typeof a.value === 'number' && (
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    val={a.value.toFixed(1)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
