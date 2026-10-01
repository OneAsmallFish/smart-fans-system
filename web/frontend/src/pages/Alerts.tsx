// pages/Alerts.tsx v2 — 规则编辑（含设备规则回读）+ severity 过滤时间线
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useWs } from '../providers/ws'
import { AlertRuleEditor } from '../components/alerts/AlertRuleEditor'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Segmented } from '../components/ui/segmented'
import { deviceTime, fmtClock, fmtRelative } from '../lib/format'
import { cn } from '../lib/utils'
import type { AlertRule, AlertSeverity } from '../types'

const SEV_DOT: Record<string, string> = {
  warning: 'bg-warn',
  critical: 'bg-danger',
  normal: 'bg-ok',
}

type Filter = 'all' | 'warning' | 'critical'

export default function Alerts() {
  const { t } = useTranslation()
  const { devices } = useWs()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const dev = devices.find(d => d.deviceId === selected) ?? devices[0]
  const alerts = dev?.alerts ?? []
  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.severity === filter)

  const deviceRules = dev?.config?.alert?.rules as AlertRule[] | undefined
  const onRulesApplied = useCallback(() => toast.success(t('alerts.reloaded')), [t])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t('alerts.title')}</h1>
        {devices.length > 1 && (
          <Segmented
            value={dev?.deviceId ?? ''}
            onChange={setSelected}
            options={devices.map(d => ({ value: d.deviceId, label: d.deviceId }))}
          />
        )}
      </div>

      {/* 规则编辑 */}
      <Card className="hud mb-5">
        <CardContent className="pt-5">
          {dev ? (
            <AlertRuleEditor
              key={dev.deviceId}
              deviceId={dev.deviceId}
              deviceRules={deviceRules}
              onRulesApplied={onRulesApplied}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted">{t('fans.noDevices')}</p>
          )}
        </CardContent>
      </Card>

      {/* 时间线 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('alerts.timeline')}（{filtered.length}）</CardTitle>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('alerts.filter.all') },
              { value: 'warning', label: t('alerts.filter.warning') },
              { value: 'critical', label: t('alerts.filter.critical') },
            ]}
          />
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-faint">{t('alerts.noAlerts')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.slice(0, 50).map((a, i) => {
                const ts = deviceTime(a.timestamp)
                const sev = (['warning', 'critical', 'normal'].includes(a.severity) ? a.severity : 'normal') as AlertSeverity
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/70 px-3 py-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', SEV_DOT[sev] ?? 'bg-faint')} />
                    <span className="num w-20 shrink-0 text-[11px] text-muted">
                      {ts ? fmtClock(ts) : <span className="text-warn">{t('common.timeNotSynced')}</span>}
                    </span>
                    <span className="flex-1 truncate text-[13px]">{a.message}</span>
                    <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-faint sm:block">
                      {a.alert_type}
                    </span>
                    {typeof a.value === 'number' && (
                      <span className="num shrink-0 text-[11px] text-faint">
                        {t('alerts.value')} {a.value.toFixed(1)}
                      </span>
                    )}
                    {ts && <span className="num hidden w-14 shrink-0 text-right text-[10px] text-faint md:block">
                      {fmtRelative(a.timestamp * 1000)}
                    </span>}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
