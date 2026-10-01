// components/alerts/AlertRuleEditor.tsx v2 — 双阈值规则编辑 + 设备规则回读（config/alert）
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Input } from '../ui/input'
import { api } from '../../lib/api'
import type { AlertRule } from '../../types'

export const DEFAULT_RULES: AlertRule[] = [
  { type: 'temperature_high', warn_c: 75, crit_c: 80, enabled: true },
  { type: 'fan_stall', threshold: 200, enabled: true },
  { type: 'voltage_abnormal', '12v_min': 10.8, '12v_max': 13.2, enabled: true },
  { type: 'wifi_disconnected', threshold: 60, enabled: true },
]

interface Props {
  deviceId: string
  /** 设备侧规则（WS 推送的 config/alert 应答；undefined = 尚未回读） */
  deviceRules: AlertRule[] | undefined
  onRulesApplied: () => void
}

export function AlertRuleEditor({ deviceId, deviceRules, onRulesApplied }: Props) {
  const { t } = useTranslation()
  const [rules, setRules] = useState<AlertRule[]>(DEFAULT_RULES)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const pendingReload = useRef(false)

  // 设备规则到达（回读应答）后应用到编辑器
  useEffect(() => {
    if (pendingReload.current && deviceRules) {
      pendingReload.current = false
      setReloading(false)
      setRules(deviceRules)
      onRulesApplied()
    }
  }, [deviceRules, onRulesApplied])

  const reload = async () => {
    setReloading(true)
    pendingReload.current = true
    try {
      await api.requestAlertRules(deviceId)
      // 应答经 MQTT → WS 推送，由上方 effect 应用；5s 超时兜底
      setTimeout(() => {
        if (pendingReload.current) {
          pendingReload.current = false
          setReloading(false)
          toast.error(t('alerts.noDevice'))
        }
      }, 5000)
    } catch (e) {
      pendingReload.current = false
      setReloading(false)
      toast.error(`${t('common.error')}: ${(e as Error).message}`)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.saveAlertRules(deviceId, rules)
      toast.success(t('alerts.rulesSaved'))
    } catch (e) {
      toast.error(`${t('common.error')}: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const update = (i: number, patch: Partial<AlertRule>) =>
    setRules(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const numField = (label: string, value: number, unit: string, onChange: (v: number) => void, step = 1) => (
    <label className="flex items-center gap-1.5 text-[11px]">
      <span className="text-muted">{label}</span>
      <Input type="number" step={step} value={value}
             className="num h-7 w-16 px-1.5 text-right text-xs"
             onChange={e => onChange(Number(e.target.value))} />
      <span className="w-6 text-faint">{unit}</span>
    </label>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t('alerts.rules')}</h3>
          <p className="text-[11px] text-faint">{t('alerts.rulesHint')}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={reload} disabled={reloading}>
            <RefreshCw size={13} className={reloading ? 'animate-spin' : ''} />
            {t('alerts.reload')}
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-line">
        {rules.map((rule, i) => (
          <div key={rule.type} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <Switch checked={rule.enabled} onCheckedChange={v => update(i, { enabled: v })} />
            <span className="min-w-24 flex-1 text-[13px] font-medium">{t(`alerts.rule.${rule.type}`)}</span>

            {rule.type === 'temperature_high' && (
              <>
                {numField(t('alerts.field.warn'), rule.warn_c ?? 75, '°C', v => update(i, { warn_c: v }))}
                {numField(t('alerts.field.crit'), rule.crit_c ?? 80, '°C', v => update(i, { crit_c: v }))}
              </>
            )}
            {rule.type === 'fan_stall' &&
              numField(t('alerts.field.below'), rule.threshold ?? 200, 'RPM', v => update(i, { threshold: v }))}
            {rule.type === 'voltage_abnormal' && (
              <>
                {numField(t('alerts.field.min'), rule['12v_min'] ?? 10.8, 'V', v => update(i, { '12v_min': v }), 0.1)}
                {numField(t('alerts.field.max'), rule['12v_max'] ?? 13.2, 'V', v => update(i, { '12v_max': v }), 0.1)}
                <span className="text-[10px] text-faint">{t('alerts.voltageFixedNote')}</span>
              </>
            )}
            {rule.type === 'wifi_disconnected' &&
              numField(t('alerts.field.exceed'), rule.threshold ?? 60, t('common.seconds'), v => update(i, { threshold: v }))}
          </div>
        ))}
      </div>
    </div>
  )
}
