// src/types.ts — 前端共享类型（对齐后端 types.ts / 协议 v1.0.1）

export const FAN_COUNT = 8
export const MAX_CURVE_POINTS = 10 // 与固件 FAN_CURVE_MAX_POINTS 一致

export interface SensorBME280 {
  temperature_c: number
  humidity_pct: number
  pressure_hpa: number
  timestamp?: number
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

export type AlertType = 'temperature_high' | 'fan_stall' | 'voltage_abnormal' | 'wifi_disconnected'
export type AlertSeverity = 'normal' | 'warning' | 'critical'

export interface AlertEvent {
  timestamp: number
  alert_type: AlertType | string
  severity: AlertSeverity | string
  message: string
  value: number
  threshold?: number
  sensor?: string
}

export interface OTAStatus {
  state: 'downloading' | 'verifying' | 'flashing' | 'success' | 'failed' | string
  progress_pct: number
  message?: string
}

export interface DeviceSummary {
  deviceId: string
  online: boolean
  lastSeen: number
  firmware?: string
  ipAddress?: string
  uptime_s?: number
  sensors: {
    bme280?: SensorBME280
    ds18b20?: SensorDS18B20[]
    voltage?: VoltageData
    internal_temp?: number
  }
  fans: FanState[]
  alerts: AlertEvent[]
  ota?: OTAStatus
  config?: {
    alert?: { rules?: AlertRule[] }
  }
  /** 每路风扇最近下发的曲线（后端回读缓存，key = fan_index 字符串） */
  curves?: Record<string, CurvePayload & { timestamp: number }>
}

/* ---- 曲线 / 告警规则（下发 payload 与回读共用） ---- */

export type TempSource = 'bme280' | 'ds18b20_0' | 'ds18b20_1' | 'internal'
export const TEMP_SOURCES: TempSource[] = ['bme280', 'ds18b20_0', 'ds18b20_1', 'internal']

export interface LUTPoint {
  temp_c: number
  duty_pct: number
}

export interface PIDParams {
  kp: number
  ki: number
  kd: number
  setpoint_c: number
}

export interface CurvePayload {
  mode: 'lut' | 'pid'
  temperature_source: TempSource
  points?: LUTPoint[]
  kp?: number
  ki?: number
  kd?: number
  setpoint_c?: number
}

export interface AlertRule {
  type: AlertType
  threshold?: number   // fan_stall RPM / wifi 超时秒
  warn_c?: number      // 温度警告阈值
  crit_c?: number      // 温度严重阈值
  '12v_min'?: number
  '12v_max'?: number
  enabled: boolean
}

/* ---- 曲线预设（纯客户端 localStorage） ---- */

export interface CurveProfile {
  id: string
  name: string
  mode: 'lut' | 'pid'
  temperature_source: TempSource
  points?: LUTPoint[]
  pid?: PIDParams
  createdAt: number
}

/* ---- History（后端环形缓冲，形状对齐 backend history.ts Sample） ---- */

export interface HistoryPoint {
  ts: number                 // Unix 秒
  bme?: number               // BME280 温度 °C
  ds?: Array<number | null>  // DS18B20 按探头序
  internal?: number          // MCU 温度
  humidity?: number
  v12?: number
  v5?: number
  v33?: number
  rpm: number[]              // 8 路
  duty: number[]
}
