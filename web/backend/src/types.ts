// src/types.ts — 共享类型定义
export interface SensorBME280 {
  temperature_c: number
  humidity_pct: number
  pressure_hpa: number
  timestamp: number
}

export interface SensorDS18B20 {
  index: number
  temperature_c: number
}

export interface VoltageData {
  voltage_12v: number
  voltage_5v: number
  voltage_3v3: number
}

export interface FanState {
  fan_index: number
  pwm_duty_pct: number
  rpm: number
  stalled: boolean
  mode: 'auto' | 'manual'
}

export interface AlertEvent {
  timestamp: number
  alert_type: number
  message: string
  value: number
  threshold: number
}

export interface DeviceState {
  deviceId: string
  online: boolean
  lastSeen: number
  firmware?: string
  ipAddress?: string
  sensors: {
    bme280?: SensorBME280
    ds18b20?: SensorDS18B20[]
    voltage?: VoltageData
    internal_temp?: number
  }
  fans: FanState[]
  alerts: AlertEvent[]
}
