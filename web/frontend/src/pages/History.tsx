// pages/History.tsx v2 — 真实历史数据（后端环形缓冲 /history）+ 风扇筛选 + CSV 导出
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend,
         ResponsiveContainer, CartesianGrid } from 'recharts'
import { useWs } from '../providers/ws'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Segmented } from '../components/ui/segmented'
import { api } from '../lib/api'
import { deviceTime } from '../lib/format'
import { FAN_COUNT, type HistoryPoint } from '../types'

const FAN_COLORS = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b',
                    '#ef4444', '#ec4899', '#3b82f6', '#14b8a6']

type RangeKey = '1h' | '6h' | '24h'
const RANGE_SECONDS: Record<RangeKey, number> = { '1h': 3600, '6h': 21600, '24h': 86400 }

const AXIS = { fontSize: 10, fill: 'var(--chart-axis)' }

export default function History() {
  const { t } = useTranslation()
  const { devices } = useWs()
  const [selected, setSelected] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('1h')
  const [points, setPoints] = useState<HistoryPoint[]>([])
  const [fanFilter, setFanFilter] = useState<number | 'all'>('all')

  const dev = devices.find(d => d.deviceId === selected) ?? devices[0]

  const load = useCallback(async () => {
    if (!dev) return
    const to = Math.floor(Date.now() / 1000)
    try {
      const res = await api.history(dev.deviceId, to - RANGE_SECONDS[range], to)
      setPoints(res.points)
    } catch { /* 后端暂不可达时保留旧数据 */ }
  }, [dev, range])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 10000)
    return () => clearInterval(timer)
  }, [load])

  // Recharts 数据：展平 fans 数组为 fan{i} 列
  const chartData = useMemo(() => points.map(p => {
    const ts = deviceTime(p.ts)
    const row: Record<string, number | string | null | undefined> = {
      time: ts ? ts.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
    }
    if (p.bme !== undefined) row.bme = p.bme
    p.ds?.forEach((v: number | null, i: number) => { if (v != null) row[`ds${i}`] = v })
    if (p.internal !== undefined) row.internal = p.internal
    p.rpm.forEach((v, i) => { row[`fan${i}`] = v })
    return row
  }), [points])

  const visibleFans = fanFilter === 'all'
    ? Array.from({ length: FAN_COUNT }, (_, i) => i)
    : [fanFilter]

  const dsProbeCount = useMemo(() => {
    let n = 0
    for (const p of points) n = Math.max(n, p.ds?.length ?? 0)
    return n
  }, [points])

  const exportCSV = () => {
    const dsHeader = Array.from({ length: dsProbeCount }, (_, i) => `ds${i}`).join(',')
    const fanHeader = Array.from({ length: FAN_COUNT }, (_, i) => `fan${i}_rpm`).join(',')
    const header = `time,bme,${dsHeader},${fanHeader}`
    const rows = points.map(p => {
      const ts = deviceTime(p.ts)
      const ds = Array.from({ length: dsProbeCount }, (_, i) => p.ds?.[i] ?? '').join(',')
      const fans = Array.from({ length: FAN_COUNT }, (_, i) => p.rpm[i] ?? '').join(',')
      return `${ts?.toISOString() ?? ''},${p.bme ?? ''},${ds},${fans}`
    })
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fan-history-${dev?.deviceId ?? 'device'}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('history.csvExported'))
  }

  const empty = points.length === 0

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t('history.title')}</h1>
        <div className="flex items-center gap-2">
          <Segmented
            value={range}
            onChange={r => setRange(r as RangeKey)}
            options={(['1h', '6h', '24h'] as RangeKey[]).map(r => ({ value: r, label: t(`history.range.${r}`) }))}
          />
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={empty}>
            <Download size={13} /> CSV
          </Button>
        </div>
      </div>

      <p className="mb-4 text-[11px] text-faint">{t('history.bufferNote')}</p>

      {dev && devices.length > 1 && (
        <div className="mb-4">
          <Segmented
            value={dev.deviceId}
            onChange={setSelected}
            options={devices.map(d => ({ value: d.deviceId, label: d.deviceId }))}
          />
        </div>
      )}

      {/* 温度图 */}
      <Card className="relative mb-4 overflow-hidden">
        <span className="scan-line" />
        <CardHeader>
          <CardTitle>{t('history.tempChart')}</CardTitle>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="grid h-40 place-items-center text-sm text-faint">{t('history.empty')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} syncId="hist">
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={AXIS} interval="preserveStartEnd" minTickGap={48} />
                <YAxis tick={AXIS} unit="°C" width={46} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--muted)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="bme" name="BME280" stroke="#3b82f6" dot={false} strokeWidth={2} />
                {Array.from({ length: dsProbeCount }, (_, i) => (
                  <Line key={i} dataKey={`ds${i}`} name={t('history.dsProbe', { n: i })} stroke="#f59e0b" dot={false} strokeWidth={2} />
                ))}
                <Line dataKey="internal" name={t('dash.mcu')} stroke="#ec4899" dot={false} strokeWidth={1.6} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 风扇 RPM 图 + 筛选 */}
      <Card className="relative overflow-hidden">
        <span className="scan-line" />
        <CardHeader className="flex-wrap">
          <CardTitle>{t('history.rpmChart')}</CardTitle>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFanFilter('all')}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                fanFilter === 'all' ? 'border-primary/50 bg-primary-soft text-primary' : 'border-line text-muted hover:text-fg'
              }`}
            >
              {t('history.fanAll')}
            </button>
            {Array.from({ length: FAN_COUNT }, (_, i) => (
              <button
                key={i}
                onClick={() => setFanFilter(i)}
                className={`num cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                  fanFilter === i ? 'border-primary/50 bg-primary-soft text-primary' : 'border-line text-muted hover:text-fg'
                }`}
              >
                F{i}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="grid h-40 place-items-center text-sm text-faint">{t('history.empty')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} syncId="hist">
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={AXIS} interval="preserveStartEnd" minTickGap={48} />
                <YAxis tick={AXIS} width={46} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--muted)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {visibleFans.map(i => (
                  <Line key={i} dataKey={`fan${i}`} name={t('history.fanN', { n: i })}
                        stroke={FAN_COLORS[i % FAN_COLORS.length]}
                        dot={false} strokeWidth={fanFilter === 'all' ? 1.5 : 2.4} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  fontSize: 12,
  backdropFilter: 'blur(10px)',
}
