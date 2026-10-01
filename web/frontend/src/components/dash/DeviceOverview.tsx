// components/dash/DeviceOverview.tsx — 单设备概览（Hero 头 + 温度环 + 电压 + 风扇阵列 + 告警横幅）
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { TriangleAlert, Fan, ArrowRight, Clock, Wifi, CircuitBoard } from 'lucide-react'
import type { DeviceSummary } from '../../types'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card'
import { Badge } from '../ui/badge'
import { TempRing } from '../charts/TempRing'
import { VoltageBar } from '../charts/VoltageBar'
import { fmtRelative, fmtUptime, deviceTime, fmtClock } from '../../lib/format'
import { cn } from '../../lib/utils'

const SEV_CLASS: Record<string, string> = {
  warning: 'border-warn/35 bg-warn/10 text-warn',
  critical: 'border-danger/35 bg-danger/10 text-danger',
  normal: 'border-ok/35 bg-ok/10 text-ok',
}

export function DeviceOverview({ device: d }: { device: DeviceSummary }) {
  const { t } = useTranslation()
  const bme = d.sensors.bme280
  const volt = d.sensors.voltage
  const latest = d.alerts[0]
  const bmeTime = deviceTime(d.sensors.bme280?.timestamp)

  return (
    <Card className={cn('hud mb-5 overflow-hidden', !d.online && 'opacity-75')}>
      {/* Hero 头 */}
      <CardHeader className="flex-wrap pb-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num font-mono text-base font-bold text-primary drop-shadow-[0_0_8px_var(--glow)]">
            {d.deviceId}
          </span>
          <Badge variant={d.online ? 'ok' : 'danger'}>
            {d.online ? t('common.online') : t('common.offline')}
          </Badge>
          {d.ipAddress && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Wifi size={12} /> {d.ipAddress}
            </span>
          )}
          {d.firmware && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <CircuitBoard size={12} /> {t('dash.fw')} {d.firmware}
            </span>
          )}
          {d.online && d.uptime_s !== undefined && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Clock size={12} /> {t('dash.uptime')} {fmtUptime(d.uptime_s)}
            </span>
          )}
        </div>
        <span className="num text-[11px] text-faint">
          {t('dash.lastSeen')} {fmtRelative(d.lastSeen)}
          {bmeTime && ` · ${fmtClock(bmeTime)}`}
        </span>
      </CardHeader>

      <CardContent className="pt-2">
        {/* 告警横幅 */}
        {latest && (
          <Link
            to="/alerts"
            className={cn(
              'mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] transition-transform hover:translate-y-[-1px]',
              SEV_CLASS[latest.severity] ?? 'border-line bg-surface-2 text-fg',
            )}
          >
            <TriangleAlert size={15} className="shrink-0" />
            <span className="flex-1 truncate">{latest.message}</span>
            {d.alerts.length > 1 && (
              <span className="shrink-0 text-[11px] opacity-75">
                {t('dash.moreAlerts', { n: d.alerts.length - 1 })}
              </span>
            )}
            <ArrowRight size={14} className="shrink-0 opacity-60" />
          </Link>
        )}

        {/* 温度环 */}
        <div className="mb-5 flex flex-wrap items-start justify-around gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-4">
          {bme && <TempRing value={bme.temperature_c} label="BME280" />}
          {d.sensors.ds18b20?.map((s, i) => (
            <TempRing
              key={s.address}
              value={s.temperature_c}
              label={`DS18B20 #${i}${s.valid ? '' : ' ?'}`}
            />
          ))}
          {d.sensors.internal_temp !== undefined && (
            <TempRing value={d.sensors.internal_temp} label={t('dash.mcu')} max={90} critAt={80} />
          )}
          {!bme && !d.sensors.ds18b20?.length && d.sensors.internal_temp === undefined && (
            <span className="py-6 text-sm text-faint">{t('common.noData')}</span>
          )}
        </div>

        {/* 电压 + 湿度 */}
        {volt && (
          <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-line bg-surface-2/60 px-4 py-4">
            <VoltageBar label="12V" value={volt.voltage_12v} nominal={12} tolerance={10} />
            <VoltageBar label="5V" value={volt.voltage_5v} nominal={5} tolerance={5} />
            <VoltageBar label="3.3V" value={volt.voltage_3v3} nominal={3.3} tolerance={5} />
            {bme && (
              <div className="min-w-28 flex-1">
                <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
                  <span className="font-medium text-muted">{t('dash.humidity')}</span>
                  <span className="num text-sm font-bold text-primary">{bme.humidity_pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-line bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.min(100, bme.humidity_pct)}%` }}
                  />
                </div>
                <div className="num mt-1 text-[10px] text-faint">
                  {bme.pressure_hpa ? `${bme.pressure_hpa.toFixed(0)} hPa` : ''}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 风扇阵列（8 路） */}
        <div>
          <CardTitle className="mb-2 !px-0 !pt-0 text-xs uppercase tracking-wider text-faint">
            {t('dash.fansSummary')}
          </CardTitle>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {d.fans.map(f => (
              <Link
                key={f.fan_index}
                to="/fans"
                className={cn(
                  'group flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2.5 transition-all hover:-translate-y-0.5',
                  f.stalled
                    ? 'border-danger/40 bg-danger/10'
                    : 'border-line bg-surface-2 hover:border-primary/40',
                )}
              >
                <span className="num text-[10px] font-semibold text-faint">F{f.fan_index}</span>
                <span className={cn('num text-sm font-bold leading-none', f.stalled ? 'text-danger' : 'text-fg')}>
                  {f.rpm}
                </span>
                <span className="num text-[9px] text-faint">{f.pwm_duty_pct}%</span>
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${f.pwm_duty_pct}%` }}
                  />
                </div>
                {f.stalled && <Fan size={10} className="text-danger" />}
              </Link>
            ))}
          </div>
        </div>

        {!d.online && (
          <p className="mt-3 text-[11px] text-faint">{t('dash.offlineHint')}</p>
        )}
      </CardContent>
    </Card>
  )
}
