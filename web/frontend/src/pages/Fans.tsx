// pages/Fans.tsx — 8 路风扇控制（FanCard v2 网格 + 每卡独立曲线编辑抽屉）
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWs } from '../providers/ws'
import { FanCard } from '../components/fan/FanCard'
import { FanCurveDrawer } from '../components/fan/FanCurveDrawer'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

export default function Fans() {
  const { t } = useTranslation()
  const { devices } = useWs()
  const [selected, setSelected] = useState<string | null>(null)
  const [curveFan, setCurveFan] = useState<number | null>(null)

  const device = devices.find(d => d.deviceId === selected) ?? devices[0]

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t('fans.title')}</h1>
        {devices.length > 1 && (
          <Select value={device?.deviceId ?? ''} onValueChange={setSelected}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={device?.deviceId} />
            </SelectTrigger>
            <SelectContent>
              {devices.map(d => (
                <SelectItem key={d.deviceId} value={d.deviceId}>{d.deviceId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!device ? (
        <div className="glass hud grid place-items-center rounded-2xl py-24 text-sm text-muted">
          {t('fans.noDevices')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {device.fans.map(f => (
            <FanCard
              key={f.fan_index}
              deviceId={device.deviceId}
              fan={f}
              device={device}
              onOpenCurve={setCurveFan}
            />
          ))}
        </div>
      )}

      {device && curveFan !== null && (
        <FanCurveDrawer
          deviceId={device.deviceId}
          fanIdx={curveFan}
          open={curveFan !== null}
          onOpenChange={o => { if (!o) setCurveFan(null) }}
          device={device}
        />
      )}
    </div>
  )
}
