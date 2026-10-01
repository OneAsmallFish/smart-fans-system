// components/fan/FanCard.tsx v2 — 环形仪表 + 实时滑块（150ms 防抖）+ 挡位预设 + AUTO 命中解释
// 防回弹：本地改动后 3s 内忽略设备快照同步（后端 2s 全量推送存在竞态窗口）
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Settings2, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardContent } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Slider } from '../ui/slider'
import { Segmented } from '../ui/segmented'
import { FanRing } from '../charts/FanRing'
import { api } from '../../lib/api'
import { lutTarget, sourceTemp, clampDuty } from '../../lib/curve'
import type { DeviceSummary, FanState, TempSource } from '../../types'

const PRESETS = [
  { key: 'quiet', duty: 30 },
  { key: 'std', duty: 55 },
  { key: 'boost', duty: 80 },
  { key: 'full', duty: 100 },
] as const

interface Props {
  deviceId: string
  fan: FanState
  device: DeviceSummary
  onOpenCurve: (fanIdx: number) => void
}

export function FanCard({ deviceId, fan, device, onOpenCurve }: Props) {
  const { t } = useTranslation()
  const [display, setDisplay] = useState(fan.pwm_duty_pct)
  const [mode, setMode] = useState<'auto' | 'manual'>(fan.mode === 'manual' ? 'manual' : 'auto')
  const [pending, setPending] = useState(false)
  const lastLocalRef = useRef(0)
  const modeSuppressRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // 设备快照同步（本地改动 2.5s 内不回弹）
  useEffect(() => {
    if (Date.now() - lastLocalRef.current > 2500) setDisplay(fan.pwm_duty_pct)
  }, [fan.pwm_duty_pct])

  useEffect(() => {
    if (Date.now() > modeSuppressRef.current) setMode(fan.mode === 'manual' ? 'manual' : 'auto')
  }, [fan.mode])

  const sendDuty = async (v: number, opts?: { silent?: boolean }) => {
    setPending(true)
    try {
      await api.setFanSpeed(deviceId, fan.fan_index, clampDuty(v))
      if (!opts?.silent) toast.success(t('fans.dutySent', { duty: clampDuty(v) }), { duration: 1600 })
    } catch (e) {
      toast.error(`${t('common.error')}: ${(e as Error).message}`)
      setDisplay(fan.pwm_duty_pct)
    } finally {
      setPending(false)
    }
  }

  const onSliderChange = (v: number) => {
    setDisplay(v)
    lastLocalRef.current = Date.now()
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void sendDuty(v, { silent: true }), 150)
  }

  const switchMode = (next: 'auto' | 'manual') => {
    if (next === mode) return
    setMode(next)
    modeSuppressRef.current = Date.now() + 3000
    lastLocalRef.current = Date.now()
    if (next === 'manual') {
      void sendDuty(display)
    } else {
      // 切回 AUTO：恢复设备存储曲线（沿用该路上次下发的温度源）
      const cached = device.curves?.[String(fan.fan_index)]
      const src = (cached?.temperature_source as TempSource) ?? 'bme280'
      api.setCurve(deviceId, fan.fan_index, { mode: 'lut', temperature_source: src })
        .catch(e => toast.error(`${t('common.error')}: ${(e as Error).message}`))
    }
  }

  const applyPreset = (duty: number) => {
    if (mode === 'auto') {
      setMode('manual')
      modeSuppressRef.current = Date.now() + 3000
    }
    setDisplay(duty)
    lastLocalRef.current = Date.now()
    void sendDuty(duty)
  }

  // AUTO 命中解释：设备曲线缓存 + 当前温度源读数 → LUT 目标
  const cached = device.curves?.[String(fan.fan_index)]
  const src = (cached?.temperature_source as TempSource | undefined) ?? 'bme280'
  const temp = sourceTemp(device, src)
  const target = cached?.points && temp != null ? lutTarget(cached.points, temp) : null

  const shownDuty = mode === 'manual' ? display : fan.pwm_duty_pct

  return (
    <Card className="hud transition-transform hover:-translate-y-0.5">
      <CardContent className="pt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="num font-mono text-sm font-bold text-fg">F{fan.fan_index}</span>
          <div className="flex items-center gap-1.5">
            {fan.stalled && (
              <Badge variant="danger">
                <AlertTriangle size={10} /> {t('fans.stall')}
              </Badge>
            )}
            <Segmented
              value={mode}
              onChange={switchMode}
              size="xs"
              options={[
                { value: 'auto', label: t('fans.auto') },
                { value: 'manual', label: t('fans.manual') },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <FanRing rpm={fan.rpm} duty={shownDuty} stalled={fan.stalled} />
          <div className="num flex items-center gap-1 text-xs text-muted">
            {pending && <Loader2 size={11} className="animate-spin text-primary" />}
            {shownDuty}% {t('common.duty')}
          </div>
        </div>

        <Slider
          className="mt-3"
          value={[shownDuty]}
          min={0} max={100} step={1}
          disabled={mode === 'auto'}
          onValueChange={([v]) => onSliderChange(v)}
        />

        {/* 挡位预设（手动） */}
        {mode === 'manual' && (
          <div className="mt-2.5 grid grid-cols-4 gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.duty)}
                className="cursor-pointer rounded-lg border border-line bg-surface-2 px-1 py-1 text-[10px] font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                {t(`fans.${p.key}`)}
                <span className="num ml-0.5 opacity-60">{p.duty}</span>
              </button>
            ))}
          </div>
        )}

        {/* AUTO 命中解释 */}
        {mode === 'auto' && (
          <p className="mt-2.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-center text-[10px] leading-snug text-muted">
            {target != null && temp != null
              ? t('fans.autoHint', { temp: temp.toFixed(1), source: t(`fans.source.${src}`), duty: target })
              : t('fans.autoHintNoCurve', { temp: temp?.toFixed(1) ?? '--', source: t(`fans.source.${src}`) })}
          </p>
        )}

        <Button variant="secondary" size="sm" className="mt-2.5 w-full" onClick={() => onOpenCurve(fan.fan_index)}>
          <Settings2 size={13} /> {t('fans.curve.title')}
        </Button>
      </CardContent>
    </Card>
  )
}
