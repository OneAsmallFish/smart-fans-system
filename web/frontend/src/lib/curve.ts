// lib/curve.ts — LUT 求值与校验（ Fans 卡命中解释 + 曲线编辑器共用）
import type { DeviceSummary, LUTPoint, TempSource } from '../types'

/** 温度严格递增（固件 FW-33 同规则） */
export function validatePoints(points: LUTPoint[]): string | null {
  if (points.length < 2) return 'curve.validation.minPoints'
  for (let i = 1; i < points.length; i++) {
    if (!(points[i].temp_c > points[i - 1].temp_c)) return 'curve.validation.tempOrder'
    if (points[i].duty_pct < 0 || points[i].duty_pct > 100) return 'curve.validation.dutyRange'
  }
  return null
}

/** LUT 查值：分段线性插值（固件 fan_curve 同口径） */
export function lutTarget(points: LUTPoint[], temp: number): number | null {
  if (points.length === 0) return null
  const sorted = [...points].sort((a, b) => a.temp_c - b.temp_c)
  if (temp <= sorted[0].temp_c) return sorted[0].duty_pct
  const last = sorted[sorted.length - 1]
  if (temp >= last.temp_c) return last.duty_pct
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i]
    if (temp <= b.temp_c) {
      const t = (temp - a.temp_c) / (b.temp_c - a.temp_c)
      return Math.round(a.duty_pct + t * (b.duty_pct - a.duty_pct))
    }
  }
  return last.duty_pct
}

/** 温度源 → 当前读数（°C） */
export function sourceTemp(device: DeviceSummary, source: TempSource): number | null {
  switch (source) {
    case 'bme280': return device.sensors.bme280?.temperature_c ?? null
    case 'ds18b20_0': return device.sensors.ds18b20?.[0]?.temperature_c ?? null
    case 'ds18b20_1': return device.sensors.ds18b20?.[1]?.temperature_c ?? null
    case 'internal': return device.sensors.internal_temp ?? null
  }
}

export const clampDuty = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
