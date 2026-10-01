// pages/Devices.tsx v2 — 设备管理：链路健康 + OTA + 重启（对话框确认）
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Power, Activity, Server } from 'lucide-react'
import { useWs } from '../providers/ws'
import { OTAProgress } from '../components/ota/OTAProgress'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogClose } from '../components/ui/dialog'
import { api } from '../lib/api'
import { fmtRelative, fmtUptime } from '../lib/format'

interface Health {
  ok: boolean
  uptime: number
  mqtt?: boolean
}

export default function Devices() {
  const { t } = useTranslation()
  const { devices, connected } = useWs()
  const [health, setHealth] = useState<Health | null>(null)
  const [rebootTarget, setRebootTarget] = useState<string | null>(null)

  useEffect(() => {
    const poll = () => fetch('/health').then(r => r.json()).then(setHealth).catch(() => setHealth(null))
    poll()
    const timer = setInterval(poll, 10000)
    return () => clearInterval(timer)
  }, [])

  const doReboot = async (id: string) => {
    try {
      await api.rebootDevice(id)
      toast.success(t('devices.reboot.sent'))
    } catch (e) {
      toast.error(`${t('devices.reboot.failed')}: ${(e as Error).message}`)
    }
    setRebootTarget(null)
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{t('devices.title')}</h1>
        <span className="num text-xs text-muted">{t('devices.count', { n: devices.length })}</span>
      </div>

      {/* 链路状态 */}
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-5 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-muted">
            <Activity size={13} /> {t('devices.mqtt.title')}
          </span>
          <span className="flex items-center gap-1.5">
            <Server size={13} className="text-faint" /> {t('devices.mqtt.backend')}
            <Badge variant={connected ? 'ok' : 'danger'}>
              {connected ? t('common.connected') : t('common.disconnected')}
            </Badge>
            {health && <span className="num text-faint">up {fmtUptime(health.uptime)}</span>}
          </span>
          <span className="flex items-center gap-1.5">
            {t('devices.mqtt.broker')}
            <Badge variant={health?.mqtt ? 'ok' : 'danger'}>
              {health?.mqtt ? t('common.connected') : t('common.disconnected')}
            </Badge>
          </span>
        </CardContent>
      </Card>

      {devices.length === 0 ? (
        <div className="glass hud grid place-items-center rounded-2xl py-24 text-sm text-muted">
          {connected ? t('devices.noneFound') : t('devices.connecting')}
        </div>
      ) : (
        devices.map(d => (
          <Card key={d.deviceId} className="mb-4">
            <CardContent className="pt-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="num font-mono text-base font-bold text-primary">{d.deviceId}</span>
                  <Badge variant={d.online ? 'ok' : 'danger'}>
                    {d.online ? t('common.online') : t('common.offline')}
                  </Badge>
                  {d.ipAddress && <span className="num text-xs text-muted">{d.ipAddress}</span>}
                  {d.firmware && <span className="text-xs text-faint">FW {d.firmware}</span>}
                </div>
                <span className="num text-[11px] text-faint">
                  {t('devices.lastSeen')}: {fmtRelative(d.lastSeen)}
                </span>
              </div>

              <div className="mb-4 border-t border-line pt-4">
                <OTAProgress deviceId={d.deviceId} online={d.online} ota={d.ota} />
              </div>

              <div className="border-t border-line pt-4">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!d.online}
                  onClick={() => setRebootTarget(d.deviceId)}
                >
                  <Power size={13} /> {t('devices.reboot.button')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {/* 重启确认 */}
      <Dialog open={rebootTarget != null} onOpenChange={o => { if (!o) setRebootTarget(null) }}>
        <DialogContent title={t('devices.reboot.button')} className="!w-[min(94vw,420px)]">
          <p className="text-sm text-muted">{t('devices.reboot.confirm')}</p>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t('common.cancel')}</Button>
            </DialogClose>
            <Button variant="danger" onClick={() => rebootTarget && doReboot(rebootTarget)}>
              <Power size={14} /> {t('common.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
