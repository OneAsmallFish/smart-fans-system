// pages/Dashboard.tsx — 总览：设备概览卡（Hero + 环形仪表 + 电压 + 风扇阵列）
import { useTranslation } from 'react-i18next'
import { useWs } from '../providers/ws'
import { DeviceOverview } from '../components/dash/DeviceOverview'

export default function Dashboard() {
  const { t } = useTranslation()
  const { devices, connected } = useWs()

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">{t('dash.title')}</h1>
        <span className={`text-xs ${connected ? 'text-ok' : 'text-danger'}`}>
          {connected ? t('common.connected') : t('common.disconnected')}
        </span>
      </div>

      {devices.length === 0 ? (
        <div className="glass hud grid place-items-center rounded-2xl py-24 text-sm text-muted">
          {t('dash.waiting')}
        </div>
      ) : (
        devices.map(d => <DeviceOverview key={d.deviceId} device={d} />)
      )}
    </div>
  )
}
