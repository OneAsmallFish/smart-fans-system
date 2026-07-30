// components/DeviceCard.tsx — 设备概览卡（供Dashboard页面使用）
import { TemperatureGauge } from './TemperatureGauge'
import { VoltageBar } from './VoltageBar'
import type { DeviceSummary } from '../hooks/useWebSocket'

interface Props {
  device: DeviceSummary
}

export function DeviceCard({ device: d }: Props) {
  const bme  = d.sensors.bme280
  const volt = d.sensors.voltage

  return (
    <div style={{ background: '#1e2030', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{d.deviceId}</span>
          {d.ipAddress && (
            <span style={{ color: '#6b7280', marginLeft: 8, fontSize: 12 }}>
              {d.ipAddress}
            </span>
          )}
          {d.firmware && (
            <span style={{ color: '#4b5563', marginLeft: 6, fontSize: 11 }}>
              FW {d.firmware}
            </span>
          )}
        </div>
        <span style={{
          padding: '2px 10px', borderRadius: 99, fontSize: 12,
          background: d.online ? '#14532d' : '#450a0a',
          color: d.online ? '#86efac' : '#fca5a5',
        }}>
          {d.online ? '● Online' : '○ Offline'}
        </span>
      </div>

      {/* Alert banner */}
      {d.alerts.length > 0 && (
        <div style={{
          background: '#451a03', borderRadius: 8, padding: '8px 12px',
          marginBottom: 12, fontSize: 13, color: '#fdba74',
        }}>
          ⚠ {d.alerts[0].message}
          {d.alerts.length > 1 && (
            <span style={{ color: '#92400e', marginLeft: 6 }}>
              (+{d.alerts.length - 1} more)
            </span>
          )}
        </div>
      )}

      {/* Temperature row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {bme && <TemperatureGauge temp={bme.temperature_c} label="BME280" />}
        {d.sensors.ds18b20?.map(s => (
          <TemperatureGauge key={s.index} temp={s.temperature_c}
                            label={`DS18B20-${s.index}`} />
        ))}
        {d.sensors.internal_temp !== undefined && (
          <TemperatureGauge temp={d.sensors.internal_temp} label="MCU" maxTemp={90} />
        )}
      </div>

      {/* Fan summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {d.fans.map(f => (
          <div key={f.fan_index} style={{
            background: f.stalled ? '#450a0a' : '#111827',
            borderRadius: 6, padding: '4px 10px', fontSize: 12,
          }}>
            <span style={{ color: '#6b7280' }}>F{f.fan_index} </span>
            <span style={{ fontWeight: 600 }}>{f.rpm}</span>
            <span style={{ color: '#6b7280' }}> RPM / {f.pwm_duty_pct}%</span>
            {f.stalled && <span style={{ color: '#ef4444', marginLeft: 4 }}>⚠</span>}
          </div>
        ))}
      </div>

      {/* Voltage bars */}
      {volt && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <VoltageBar label="12V" value={volt.voltage_12v} nominal={12} tolerance={10} />
          <VoltageBar label="5V"  value={volt.voltage_5v}  nominal={5}  tolerance={5}  />
          <VoltageBar label="3.3V"value={volt.voltage_3v3} nominal={3.3} tolerance={5} />
          {bme && (
            <div style={{ minWidth: 120 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>Humidity</div>
              <div style={{ height: 6, background: '#374151', borderRadius: 99 }}>
                <div style={{
                  height: '100%', width: `${bme.humidity_pct}%`,
                  background: '#3b82f6', borderRadius: 99,
                }} />
              </div>
              <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
                {bme.humidity_pct.toFixed(1)}% RH
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
