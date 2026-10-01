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

/** 曲线回读缓存：设备侧无 curve 回读协议，缓存最近一次下发的 curve 命令供 UI 回显 */
export interface CurveCache {
  mode: 'lut' | 'pid'
  temperature_source?: string
  points?: Array<{ temp_c: number; duty_pct: number }>
  kp?: number
  ki?: number
  kd?: number
  setpoint_c?: number
  timestamp: number
}

export interface DeviceState {
  deviceId: string
  online: boolean
  lastSeen: number
  firmware?: string
  ipAddress?: string
  uptime_s?: number   // status 消息的 uptime_seconds（协议 §4.1）
  sensors: {
    bme280?: SensorBME280
    ds18b20?: SensorDS18B20[]
    voltage?: VoltageData
    internal_temp?: number
  }
  fans: FanState[]
  alerts: AlertEvent[]
  ota?: OTAStatus
  /** config/# 回读（alert 规则等） */
  config?: {
    alert?: Record<string, unknown>
  }
  /** 每路风扇最近下发的曲线缓存（key = fan_index 字符串） */
  curves?: Record<string, CurveCache>
}
