// src/types.ts — 共享类型定义
// v1.2: 8 路风扇（WEB-03/ADJ-13）；告警 schema 对齐协议 §5（字符串
// alert_type + severity + sensor，WEB-06/ADJ-2）；DS18B20 按 address 匹配。

/** 风扇路数（硬件决策 D2，全项目唯一基准） */
export const FAN_COUNT = 8

export interface SensorBME280 {
  temperature_c: number
  humidity_pct: number
  pressure_hpa: number
  timestamp: number
}

export interface SensorDS18B20 {
  address: string
  valid: boolean
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

/** 协议 §5: alert_type 为字符串枚举 */
export type AlertType = 'temperature_high' | 'fan_stall' | 'voltage_abnormal' | 'wifi_disconnected'
export type AlertSeverity = 'normal' | 'warning' | 'critical'

export interface AlertEvent {
  timestamp: number
  device_id?: string
  alert_type: AlertType | string
  severity: AlertSeverity | string
  message: string
  value: number
  threshold: number
  sensor?: string
}

/** 协议 §7: OTA 状态反馈（WEB-04） */
export interface OTAStatus {
  timestamp?: number
  state: 'downloading' | 'verifying' | 'flashing' | 'success' | 'failed' | string
  progress_pct: number
  message?: string
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
  ota?: OTAStatus
}
