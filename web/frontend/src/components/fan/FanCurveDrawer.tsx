// components/fan/FanCurveDrawer.tsx — 曲线编辑抽屉：拖拽画布 + 温度源 + PID + 预设 + 回读回显
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Save, Trash2, Upload, Download, Waves, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent } from '../ui/dialog'
import { Button } from '../ui/button'
import { Segmented } from '../ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'
import { CurveCanvas } from './CurveCanvas'
import { listProfiles, saveProfile, deleteProfile, newId, exportProfiles, importProfiles } from './profiles'
import { api } from '../../lib/api'
import { validatePoints, sourceTemp, clampDuty } from '../../lib/curve'
import { MAX_CURVE_POINTS, type CurvePayload, type DeviceSummary, type LUTPoint, type PIDParams, type TempSource } from '../../types'

const DEFAULT_LUT: LUTPoint[] = [
  { temp_c: 30, duty_pct: 20 },
  { temp_c: 40, duty_pct: 40 },
  { temp_c: 50, duty_pct: 60 },
  { temp_c: 60, duty_pct: 80 },
  { temp_c: 70, duty_pct: 100 },
]
const DEFAULT_PID: PIDParams = { kp: 2.0, ki: 0.1, kd: 0.5, setpoint_c: 50 }

interface Props {
  deviceId: string
  fanIdx: number
  open: boolean
  onOpenChange: (open: boolean) => void
  device?: DeviceSummary
}

export function FanCurveDrawer({ deviceId, fanIdx, open, onOpenChange, device }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'lut' | 'pid'>('lut')
  const [source, setSource] = useState<TempSource>('bme280')
  const [points, setPoints] = useState<LUTPoint[]>(DEFAULT_LUT)
  const [pid, setPid] = useState<PIDParams>(DEFAULT_PID)
  const [smooth, setSmooth] = useState(true)
  const [readback, setReadback] = useState<'device' | 'default'>('default')
  const [saving, setSaving] = useState(false)
  const [profiles, setProfiles] = useState(listProfiles)
  const [naming, setNaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  /** 打开/切风扇时加载回读（GET 缓存 → WS 缓存 → 默认模板） */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setReadback('default')
    api.getCurve(deviceId, fanIdx).then(c => {
      if (cancelled) return
      const cached = c ?? device?.curves?.[String(fanIdx)]
      if (cached) {
        setMode(cached.mode === 'pid' ? 'pid' : 'lut')
        if (cached.temperature_source) setSource(cached.temperature_source as TempSource)
        if (cached.points?.length) setPoints(cached.points.map(p => ({ ...p })))
        if (cached.mode === 'pid' && cached.kp !== undefined)
          setPid({ kp: cached.kp, ki: cached.ki ?? 0, kd: cached.kd ?? 0, setpoint_c: cached.setpoint_c ?? 50 })
        setReadback('device')
      }
    }).catch(() => { /* 离线时静默落到默认 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fanIdx, deviceId])

  const refreshProfiles = useCallback(() => setProfiles(listProfiles()), [])

  const validation = mode === 'lut' ? validatePoints(points) : null
  const curTemp = device ? sourceTemp(device, source) : null

  const apply = async () => {
    if (validation) return
    setSaving(true)
    const payload: CurvePayload =
      mode === 'lut'
        ? { mode: 'lut', temperature_source: source, points: points.map(p => ({ temp_c: p.temp_c, duty_pct: clampDuty(p.duty_pct) })) }
        : { mode: 'pid', temperature_source: source, kp: pid.kp, ki: pid.ki, kd: pid.kd, setpoint_c: pid.setpoint_c }
    try {
      await api.setCurve(deviceId, fanIdx, payload)
      toast.success(t('fans.curve.applied'))
      setReadback('device')
    } catch (e) {
      toast.error(`${t('common.error')}: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const doSaveProfile = () => {
    const name = nameDraft.trim() || `P${profiles.length + 1}`
    saveProfile({
      id: newId(), name,
      mode, temperature_source: source,
      ...(mode === 'lut' ? { points: points.map(p => ({ ...p })) } : { pid: { ...pid } }),
      createdAt: Date.now(),
    })
    refreshProfiles()
    setNameDraft('')
    setNaming(false)
    toast.success(t('fans.profile.saved', { name }))
  }

  const applyProfile = (id: string) => {
    const p = profiles.find(x => x.id === id)
    if (!p) return
    setMode(p.mode)
    setSource(p.temperature_source)
    if (p.mode === 'lut' && p.points) setPoints(p.points.map(x => ({ ...x })))
    if (p.mode === 'pid' && p.pid) setPid({ ...p.pid })
    toast.success(t('fans.profile.applied', { name: p.name }))
  }

  const doImport = async (f: File) => {
    try {
      const n = await importProfiles(f)
      refreshProfiles()
      toast.success(`${t('fans.profile.import')} +${n}`)
    } catch {
      toast.error(t('fans.profile.importBad'))
    }
  }

  const sorted = [...points].sort((a, b) => a.temp_c - b.temp_c)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`${t('fans.curve.title')} · ${t('fans.curve.fan', { fan: fanIdx })}`}>
        {/* 回读状态条 */}
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[11px] text-muted">
          <RefreshCw size={12} className={readback === 'device' ? 'text-ok' : 'text-faint'} />
          {readback === 'device' ? t('fans.curve.readback') : t('fans.curve.default')}
          <span className="ml-auto text-faint">{t('fans.curve.readbackNote')}</span>
        </div>

        {/* 模式 + 温度源 + 平滑 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'lut', label: t('fans.curve.tab.lut') },
              { value: 'pid', label: t('fans.curve.tab.pid') },
            ]}
          />
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {t('fans.sourceLabel')}
            <Select value={source} onValueChange={v => setSource(v as TempSource)}>
              <SelectTrigger className="w-40">{<SelectValue />}</SelectTrigger>
              <SelectContent>
                {(['bme280', 'ds18b20_0', 'ds18b20_1', 'internal'] as TempSource[]).map(s => (
                  <SelectItem key={s} value={s}>{t(`fans.source.${s}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mode === 'lut' && (
            <Button size="sm" variant={smooth ? 'primary' : 'ghost'} onClick={() => setSmooth(s => !s)}>
              <Waves size={13} /> {t('fans.curve.smooth')}
            </Button>
          )}
          {curTemp != null && (
            <span className="num ml-auto text-xs text-warn">● {curTemp.toFixed(1)}°C</span>
          )}
        </div>

        {mode === 'lut' ? (
          <>
            <CurveCanvas
              points={points}
              onChange={setPoints}
              maxPoints={MAX_CURVE_POINTS}
              smooth={smooth}
              currentTemp={curTemp}
            />
            <p className="mt-1 text-center text-[11px] text-faint">{t('fans.curve.editHint')}</p>

            {/* 点位精调 chips */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm" variant="secondary"
                disabled={points.length >= MAX_CURVE_POINTS}
                onClick={() => {
                  const last = sorted[sorted.length - 1]
                  setPoints(pts => [...pts, {
                    temp_c: Math.min(100, (last?.temp_c ?? 20) + 10),
                    duty_pct: clampDuty((last?.duty_pct ?? 0) + 10),
                  }])
                }}
              >
                <Plus size={13} /> {t('fans.curve.addPoint')}
              </Button>
              <span className="text-[11px] text-faint">
                {t('fans.curve.points', { n: points.length, max: MAX_CURVE_POINTS })}
              </span>
              {sorted.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-1.5 py-0.5 text-[11px]">
                  <input type="number" value={p.temp_c} min={0} max={100}
                         className="num w-10 bg-transparent text-right outline-none"
                         onChange={e => {
                           const v = Number(e.target.value)
                           setPoints(pts => {
                             const next = pts.map(x => (x.temp_c === p.temp_c && x.duty_pct === p.duty_pct ? { ...x, temp_c: v } : x))
                             return next
                           })
                         }} />
                  °C→
                  <input type="number" value={p.duty_pct} min={0} max={100}
                         className="num w-9 bg-transparent text-right outline-none"
                         onChange={e => {
                           const v = clampDuty(Number(e.target.value))
                           setPoints(pts => pts.map(x => (x.temp_c === p.temp_c && x.duty_pct === p.duty_pct ? { ...x, duty_pct: v } : x)))
                         }} />
                  %
                  <button className="cursor-pointer text-faint hover:text-danger"
                          onClick={() => setPoints(pts => pts.filter(x => !(x.temp_c === p.temp_c && x.duty_pct === p.duty_pct)))}>
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
            {validation && (
              <p className="mt-2 text-xs text-danger">⚠ {t(`fans.${validation}`)}</p>
            )}
          </>
        ) : (
          /* PID 面板 */
          <div className="rounded-xl border border-line bg-surface-2/60 p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(['kp', 'ki', 'kd', 'setpoint_c'] as const).map(k => (
                <label key={k} className="flex flex-col gap-1 text-xs">
                  <span className="text-muted">{t(`fans.pid.${k === 'setpoint_c' ? 'setpoint' : k}`)}</span>
                  <Input
                    type="number" step={k === 'setpoint_c' ? 1 : 0.05}
                    value={pid[k]}
                    onChange={e => setPid(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                  />
                  <span className="text-[10px] text-faint">
                    {k === 'setpoint_c' ? '°C' : ''}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-faint">{t('fans.pid.hint')}</p>
          </div>
        )}

        {/* 预设管理 */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
          <span className="text-xs font-medium text-muted">{t('fans.profile.title')}</span>
          <Select onValueChange={applyProfile} value="">
            <SelectTrigger className="w-44">{<span className="text-faint">{t('fans.profile.title')}</span>}</SelectTrigger>
            <SelectContent>
              {profiles.length === 0
                ? <div className="px-3 py-2 text-xs text-faint">{t('fans.profile.empty')}</div>
                : profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {naming ? (
            <span className="inline-flex items-center gap-1">
              <Input className="h-7 w-32" autoFocus placeholder={t('fans.profile.namePh')}
                     value={nameDraft}
                     onChange={e => setNameDraft(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && doSaveProfile()} />
              <Button size="sm" variant="primary" onClick={doSaveProfile}>{t('common.save')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>{t('common.cancel')}</Button>
            </span>
          ) : (
            <Button size="sm" variant="secondary" disabled={mode === 'lut' && !!validation}
                    onClick={() => { setNaming(true) }}>
              <Save size={13} /> {t('fans.profile.save')}
            </Button>
          )}
          {profiles.length > 0 && (
            <Select onValueChange={id => { deleteProfile(id); refreshProfiles(); toast.success(t('fans.profile.deleted')) }} value="">
              <SelectTrigger className="w-9 !px-2" title={t('common.delete')}>
                <Trash2 size={13} className="text-danger" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => exportProfiles()} title={t('common.export')}>
              <Download size={13} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()} title={t('common.import')}>
              <Upload size={13} />
            </Button>
            <input ref={importRef} type="file" accept="application/json" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
          </span>
        </div>

        {/* 底部动作 */}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          <Button variant="primary" disabled={!!validation || saving} onClick={apply}>
            {saving ? t('common.loading') : t('fans.curve.apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
