// src/hooks/useWebSocket.ts — WebSocket 实时数据 Hook
import { useEffect, useRef, useState, useCallback } from 'react'

export interface DeviceSummary {
  deviceId: string
  online: boolean
  lastSeen: number
  firmware?: string
  ipAddress?: string
  sensors: {
    bme280?: { temperature_c: number; humidity_pct: number; pressure_hpa: number }
    ds18b20?: Array<{ index: number; temperature_c: number }>
    voltage?: { voltage_12v: number; voltage_5v: number; voltage_3v3: number }
    internal_temp?: number
  }
  fans: Array<{
    fan_index: number; pwm_duty_pct: number; rpm: number; stalled: boolean; mode: string
  }>
  alerts: Array<{ timestamp: number; alert_type: number; message: string; value: number }>
}

export function useWebSocket(url: string) {
  const [devices, setDevices] = useState<DeviceSummary[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout>>()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      retryRef.current = setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'devices') setDevices(msg.data)
      } catch { /* ignore malformed */ }
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { devices, connected }
}
