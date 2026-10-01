// providers/ws.tsx — 全站单条 WebSocket 连接（替代原先每页各建一条 + 5 份重复常量）
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DeviceSummary } from '../types'

interface WsState {
  devices: DeviceSummary[]
  connected: boolean
  /** 取当前数据里的设备（未找到返回 undefined） */
  device: (id: string | null | undefined) => DeviceSummary | undefined
}

const WsContext = createContext<WsState>({
  devices: [],
  connected: false,
  device: () => undefined,
})

export function wsUrl(): string {
  // 生产经反代时前端页面与 3001 同源由 nginx 收口（见 deploy.md 已知限制）；
  // 当前阶段直连后端端口。
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.hostname}:3001`
}

export function WsProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<DeviceSummary[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout>>()
  const devicesRef = useRef<DeviceSummary[]>([])
  devicesRef.current = devices

  useEffect(() => {
    let disposed = false

    const connect = () => {
      if (disposed) return
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        if (!disposed) retryRef.current = setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'devices') setDevices(msg.data)
        } catch { /* malformed */ }
      }
    }

    connect()
    return () => {
      disposed = true
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [])

  const device = (id: string | null | undefined) =>
    id ? devicesRef.current.find(d => d.deviceId === id) : devicesRef.current[0]

  return (
    <WsContext.Provider value={{ devices, connected, device }}>
      {children}
    </WsContext.Provider>
  )
}

export function useWs() {
  return useContext(WsContext)
}
