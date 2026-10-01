// lib/api.ts — 统一 API 客户端（{ok,data} 信封解包 + 错误抛出）
import type { AlertRule, CurvePayload, DeviceSummary, HistoryPoint } from '../types'

export const API = '/api' // vite dev 代理 → backend 3001

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  let body: { ok?: boolean; data?: T; error?: string } = {}
  try { body = await res.json() } catch { /* non-JSON */ }
  if (!res.ok || body.ok === false) {
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return body.data as T
}

export const api = {
  devices: () => request<DeviceSummary[]>('/devices'),

  setFanSpeed: (deviceId: string, fanIdx: number, speed: number) =>
    request<{ queued: boolean }>(`/devices/${deviceId}/fan/${fanIdx}`, {
      method: 'POST',
      body: JSON.stringify({ speed }),
    }),

  setCurve: (deviceId: string, fanIdx: number, body: CurvePayload) =>
    request<{ applied: boolean }>(`/devices/${deviceId}/fan/${fanIdx}/curve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 曲线回读：后端缓存最近一次下发的 curve 命令（设备侧无回读协议） */
  getCurve: (deviceId: string, fanIdx: number) =>
    request<CurvePayload | null>(`/devices/${deviceId}/curve/${fanIdx}`),

  saveAlertRules: (deviceId: string, rules: AlertRule[]) =>
    request<{ applied: boolean }>(`/devices/${deviceId}/alert`, {
      method: 'POST',
      body: JSON.stringify({ rules }),
    }),

  requestAlertRules: (deviceId: string) =>
    request<{ requested: boolean }>(`/devices/${deviceId}/alert/get`, { method: 'POST' }),

  triggerOta: (deviceId: string, url: string) =>
    request<{ ota_started: boolean }>(`/devices/${deviceId}/ota`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  rebootDevice: (deviceId: string) =>
    request<{ rebooting: boolean }>(`/devices/${deviceId}/reboot`, { method: 'POST' }),

  /** 历史查询：from/to 为 Unix 秒；返回降采样后的时间序列 */
  history: (deviceId: string, from: number, to: number) =>
    request<{ deviceId: string; from: number; to: number; points: HistoryPoint[] }>(
      `/devices/${deviceId}/history?from=${from}&to=${to}`,
    ),
}
