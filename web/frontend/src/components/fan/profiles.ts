// components/fan/profiles.ts — 曲线预设（纯客户端 localStorage，per 浏览器）
import type { CurveProfile } from '../../types'

const KEY = 'sf.curveProfiles'
const VERSION = 1

interface Store { version: number; profiles: CurveProfile[] }

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Store
      if (s.version === VERSION && Array.isArray(s.profiles)) return s
    }
  } catch { /* corrupt → reset */ }
  return { version: VERSION, profiles: [] }
}

function persist(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* quota */ }
}

export function listProfiles(): CurveProfile[] {
  return load().profiles.sort((a, b) => b.createdAt - a.createdAt)
}

export function saveProfile(p: CurveProfile): void {
  const s = load()
  s.profiles = [p, ...s.profiles.filter(x => x.id !== p.id)]
  persist(s)
}

export function deleteProfile(id: string): void {
  const s = load()
  s.profiles = s.profiles.filter(x => x.id !== id)
  persist(s)
}

export function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 导出为 JSON 文件下载 */
export function exportProfiles(): void {
  const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'fan-curve-presets.json'
  a.click()
  URL.revokeObjectURL(url)
}

/** 从 JSON 文件合并导入（按 id 去重），返回导入条数；格式非法时抛错 */
export async function importProfiles(file: File): Promise<number> {
  const text = await file.text()
  const parsed = JSON.parse(text) as Partial<Store>
  if (!Array.isArray(parsed.profiles)) throw new Error('bad format')
  const s = load()
  let n = 0
  for (const p of parsed.profiles) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue
    if (p.mode !== 'lut' && p.mode !== 'pid') continue
    if (p.mode === 'lut' && !Array.isArray(p.points)) continue
    if (p.mode === 'pid' && typeof p.pid !== 'object') continue
    s.profiles = [p as CurveProfile, ...s.profiles.filter(x => x.id !== p.id)]
    n++
  }
  persist(s)
  return n
}
