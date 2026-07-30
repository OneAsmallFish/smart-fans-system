// pages/Dashboard.tsx — 实时仪表盘
import { useWebSocket, type DeviceSummary } from '../hooks/useWebSocket'
import { ResponsiveContainer, RadialBarChart, RadialBar, Cell,
         BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

const WS_URL = `ws://${window.location.hostname}:3001`
const API    = `http://${window.location.hostname}:3001/api`

const TEMP_MAX = 85

function TempGauge({ temp, label }: { temp: number; label: string }) {
  const pct = Math.min(100, (temp / TEMP_MAX) * 100)
  const color = temp > 75 ? '#ef4444' : temp > 55 ? '#f59e0b' : '#22c55e'
  return (
    <div style={{ textAlign: 'center', minWidth: 100 }}>
      <ResponsiveContainer width={100} height={80}>
        <RadialBarChart innerRadius={28} outerRadius={46}
                        data={[{ value: pct }]} startAngle={180} endAngle={0}>
          <RadialBar dataKey="value" cornerRadius={4} background={{ fill: '#333' }}>
            <Cell fill={color} />
          </RadialBar>
        </RadialBarChart>
      </ResponsiveContainer>
      <div style={{ marginTop: -24, fontSize: 14, fontWeight: 600 }}>{temp.toFixed(1)}°C</div>
      <div style={{ fontSize: 11, color: '#aaa' }}>{label}</div>
    </div>
  )
}

function FanBar({ fans }: { fans: DeviceSummary['fans'] }) {
  const data = fans.map(f => ({ name: `Fan ${f.fan_index}`, RPM: f.rpm, Duty: f.pwm_duty_pct }))
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="RPM" fill="#3b82f6" radius={[3,3,0,0]} />
        <Bar dataKey="Duty" fill="#8b5cf6" radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function DeviceCard({ d }: { d: DeviceSummary }) {
  const bme  = d.sensors.bme280
  const volt = d.sensors.voltage

  return (
    <div style={{ background: '#1e2030', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{d.deviceId}</span>
          {d.ipAddress && <span style={{ color: '#aaa', marginLeft: 8, fontSize: 12 }}>{d.ipAddress}</span>}
        </div>
        <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12,
                       background: d.online ? '#166534' : '#7f1d1d',
                       color: d.online ? '#86efac' : '#fca5a5' }}>
          {d.online ? '● Online' : '○ Offline'}
        </span>
      </div>

      {/* Alerts */}
      {d.alerts.length > 0 && (
        <div style={{ background: '#451a03', borderRadius: 8, padding: '8px 12px',
                      marginBottom: 12, color: '#fdba74', fontSize: 13 }}>
          ⚠ {d.alerts[0].message}
        </div>
      )}

      {/* Temperature row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        {bme && <TempGauge temp={bme.temperature_c} label="BME280" />}
        {d.sensors.ds18b20?.map(s =>
          <TempGauge key={s.index} temp={s.temperature_c} label={`DS18B20-${s.index}`} />
        )}
        {d.sensors.internal_temp !== undefined &&
          <TempGauge temp={d.sensors.internal_temp} label="Internal" />}
      </div>

      {/* Fan bars */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>Fans (RPM / Duty%)</div>
        <FanBar fans={d.fans} />
      </div>

      {/* Voltage badges */}
      {volt && (
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: '12V', val: volt.voltage_12v, ok: volt.voltage_12v > 10.8 && volt.voltage_12v < 13.2 },
            { label: '5V',  val: volt.voltage_5v,  ok: Math.abs(volt.voltage_5v - 5) < 0.25 },
            { label: '3.3V',val: volt.voltage_3v3, ok: Math.abs(volt.voltage_3v3 - 3.3) < 0.165 },
          ].map(({ label, val, ok }) => (
            <span key={label} style={{
              padding: '3px 10px', borderRadius: 99, fontSize: 12,
              background: ok ? '#14532d' : '#7f1d1d', color: ok ? '#86efac' : '#fca5a5'
            }}>
              {label}: {val.toFixed(2)}V
            </span>
          ))}
          {bme && <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 12,
            background: '#1e3a5f', color: '#93c5fd' }}>
            {bme.humidity_pct.toFixed(1)}% RH
          </span>}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { devices, connected } = useWebSocket(`${WS_URL}`)

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
        devices.map(d => <DeviceCard key={d.deviceId} d={d} />)
      )}
    </main>
  )
}
