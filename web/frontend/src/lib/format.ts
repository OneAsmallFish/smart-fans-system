// lib/format.ts — 展示格式化（与 i18n 解耦：需要文案的由调用方传入标签）

/** 设备时间未同步（Unix 早期值）时返回 null，由调用方渲染占位文案 */
export function deviceTime(ts: number | undefined): Date | null {
  if (ts === undefined || ts < 1_000_000_000) return null
  return new Date(ts * 1000)
}

export function fmtClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour12: false })
}

export function fmtDateTime(d: Date): string {
  return d.toLocaleString(undefined, { hour12: false })
}

/** 相对时间（分钟/小时/天） */
export function fmtRelative(tsMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - tsMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** 秒数 → 运行时长 */
export function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(seconds % 60)}s`
}
