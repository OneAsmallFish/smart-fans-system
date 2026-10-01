// pages/History.tsx — 历史趋势图 + 时间范围选择 + CSV 导出
// WEB-07: 8 路风扇序列全覆盖；timestamp < 1000000000 显示"时间未同步"。
// 注：当前数据源为页面运行期累积的实时读数；后端 /history 端点为未接通占位
// （WEB-10，接通 ESP32 Flash 日志/agent 通道后自动可用）。
import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend,
         ResponsiveContainer, CartesianGrid } from 'recharts'
import { useWebSocket } from '../hooks/useWebSocket'

const WS_URL = `ws://${window.location.hostname}:3001`
const FAN_COUNT = 8   /* WEB-03/ADJ-13: 与后端常量一致 */

const FAN_COLORS = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b',
                    '#ef4444', '#ec4899', '#3b82f6', '#14b8a6']

const TIME_RANGES = ['1h', '6h', '24h', '7d']

function fmtEntryTime(ts?: number): string {
  if (ts !== undefined && ts < 1000000000) return '时间未同步'
  const now = new Date()
  return `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`
}

export default function History() {
  const { devices } = useWebSocket(WS_URL)
  const device = devices[0]

  const [range, setRange] = useState('1h')
  const [history, setHistory] = useState<Array<{
    time: string; ts?: number
    bme_temp?: number; ds_temp?: number
    fan_rpm?: Array<number | undefined>
  }>>([])

  // Accumulate live readings into local history buffer
  useEffect(() => {
    if (!device?.sensors?.bme280) return
    const bme = device.sensors.bme280
    const entry = {
      time: fmtEntryTime(bme.timestamp),
      ts: bme.timestamp,
      bme_temp: bme.temperature_c,
      ds_temp: device.sensors.ds18b20?.find(s => s.valid)?.temperature_c,
      fan_rpm: Array.from({ length: FAN_COUNT },
                          (_, i) => device.fans[i]?.rpm),
    }
    setHistory(h => {
      const maxPts = range === '1h' ? 360 : range === '6h' ? 360 : 288
      const next = [...h, entry]
      return next.length > maxPts ? next.slice(-maxPts) : next
    })
  }, [device?.sensors?.bme280?.temperature_c, range])

  const exportCSV = useCallback(() => {
    const header = 'time,' + ['bme_temp', 'ds_temp', ...Array.from({length: FAN_COUNT}, (_, i) => `fan${i}_rpm`)].join(',')
    const rows = history.map(r =>
      `${r.time},${r.bme_temp ?? ''},${r.ds_temp ?? ''},${(r.fan_rpm ?? []).map(v => v ?? '').join(',')}`)
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'fan-history.csv'; a.click()
    URL.revokeObjectURL(url)
  }, [history])

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
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

      <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
        数据为页面运行期累积的实时读数；设备 Flash 历史导入为规划功能（后端 /history 端点未接通）。
      </p>

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

      {/* Fan RPM chart — 8 路全覆盖（WEB-07） */}
      <div style={{ background: '#1e2030', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Fan Speed (RPM, 8 fans)</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {Array.from({ length: FAN_COUNT }, (_, i) => (
              <Line key={i}
                    dataKey={(d: any) => d.fan_rpm?.[i]}
                    name={`Fan ${i}`}
                    stroke={FAN_COLORS[i % FAN_COLORS.length]}
                    dot={false} strokeWidth={1.6} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </main>
  )
}
