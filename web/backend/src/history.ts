// src/history.ts — 每设备历史环形缓冲（MVP：内存态，随进程重启清零）
// 采样节拍与 WS 推送一致（2s）；默认保留 24h（HISTORY_HOURS 可配）。
import type { DeviceState } from './types.js'
import { FAN_COUNT } from './types.js'

export interface Sample {
  ts: number                       // Unix 秒
  bme?: number                     // BME280 温度 °C
  ds?: Array<number | null>        // DS18B20 按探头序
  internal?: number                // MCU 温度
  humidity?: number
  v12?: number; v5?: number; v33?: number
  rpm: number[]                    // FAN_COUNT 路
  duty: number[]
}

const HOURS = Number(process.env.HISTORY_HOURS ?? 24)
const CAP = Math.ceil((HOURS * 3600) / 2)   // 2s 采样

class Ring {
  private buf: Sample[] = []
  private head = 0
  private count = 0

  push(s: Sample) {
    if (this.count < CAP) {
      this.buf.push(s)
      this.count++
    } else {
      this.buf[this.head] = s
      this.head = (this.head + 1) % CAP
    }
  }

  range(from: number, to: number): Sample[] {
    // 环形缓冲按时间近似有序，线性过滤即可
    const out: Sample[] = []
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % CAP
      const s = this.buf[idx]
      if (s.ts >= from && s.ts <= to) out.push(s)
    }
    return out
  }

  get size() { return this.count }
}

const buffers = new Map<string, Ring>()

export function recordSample(deviceId: string, d: DeviceState) {
  let ring = buffers.get(deviceId)
  if (!ring) { ring = new Ring(); buffers.set(deviceId, ring) }
  const fans = d.fans ?? []
  ring.push({
    ts: Math.floor(Date.now() / 1000),
    bme: d.sensors.bme280?.temperature_c,
    ds: d.sensors.ds18b20?.map(s => (s.valid ? s.temperature_c : null)),
    internal: d.sensors.internal_temp,
    humidity: d.sensors.bme280?.humidity_pct,
    v12: d.sensors.voltage?.voltage_12v,
    v5: d.sensors.voltage?.voltage_5v,
    v33: d.sensors.voltage?.voltage_3v3,
    rpm: Array.from({ length: FAN_COUNT }, (_, i) => fans[i]?.rpm ?? 0),
    duty: Array.from({ length: FAN_COUNT }, (_, i) => fans[i]?.pwm_duty_pct ?? 0),
  })
}

export function getHistory(deviceId: string, from: number, to: number): Sample[] {
  return buffers.get(deviceId)?.range(from, to) ?? []
}

export function historySize(deviceId: string): number {
  return buffers.get(deviceId)?.size ?? 0
}
