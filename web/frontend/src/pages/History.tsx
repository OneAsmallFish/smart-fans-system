// pages/History.tsx — 历史趋势图 + 时间范围选择 + CSV导出
import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend,
         ResponsiveContainer, CartesianGrid } from 'recharts'
import { useWebSocket } from '../hooks/useWebSocket'

const WS_URL = `ws://${window.location.hostname}:3001`

// Generates mock rolling data from live WebSocket readings
function buildHistory(
  deviceHistory: Array<{ time: string; bme_temp: number; fan0_rpm: number }>,
) {
  return deviceHistory
}

const TIME_RANGES = ['1h', '6h', '24h', '7d']

export default function History() {
  const { devices } = useWebSocket(WS_URL)
  const device = devices[0]

  const [range, setRange] = useState('1h')
  const [history, setHistory] = useState<Array<{
    time: string; bme_temp?: number; ds_temp?: number; fan0_rpm?: number; fan1_rpm?: number
  }>>([])

  // Accumulate live readings into local history buffer
  useEffect(() => {
    if (!device?.sensors?.bme280) return
    const now = new Date()
    const entry = {
      time: `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`,
      bme_temp: device.sensors.bme280.temperature_c,
      ds_temp: device.sensors.ds18b20?.[0]?.temperature_c,
      fan0_rpm: device.fans[0]?.rpm,
      fan1_rpm: device.fans[1]?.rpm,
    }
    setHistory(h => {
      const maxPts = range === '1h' ? 360 : range === '6h' ? 360 : 288
      const next = [...h, entry]
      return next.length > maxPts ? next.slice(-maxPts) : next
    })
  }, [device?.sensors?.bme280?.temperature_c])

  const exportCSV = useCallback(() => {
    const header = 'time,bme_temp,ds_temp,fan0_rpm,fan1_rpm'
    const rows = history.map(r => `${r.time},${r.bme_temp ?? ''},${r.ds_temp ?? ''},${r.fan0_rpm ?? ''},${r.fan1_rpm ?? ''}`)
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'fan-history.csv'; a.click()
    URL.revokeObjectURL(url)
  }, [history])

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>History</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {TIME_RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} style={{
              padding: '3px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
              background: range === r ? '#3b82f6' : '#374151', color: 'white', border: 'none',
            }}>{r}</button>
          ))}
          <button onClick={exportCSV} style={{
            padding: '3px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
            background: '#374151', color: '#22c55e', border: '1px solid #22c55e',
          }}>↓ CSV</button>
        </div>
      </div>

      {/* Temperature chart */}
      <div style={{ background: '#1e2030', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Temperature (°C)</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} unit="°C" />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="bme_temp"  name="BME280"  stroke="#3b82f6" dot={false} strokeWidth={2} />
            <Line dataKey="ds_temp"   name="DS18B20" stroke="#f59e0b" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Fan RPM chart */}
      <div style={{ background: '#1e2030', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Fan Speed (RPM)</div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={history} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="fan0_rpm" name="Fan 0" stroke="#8b5cf6" dot={false} strokeWidth={2} />
            <Line dataKey="fan1_rpm" name="Fan 1" stroke="#06b6d4" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </main>
  )
}
