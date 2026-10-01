// components/ota/OTAProgress.tsx v2 — OTA 触发 + 真实进度（ota/status 经 WS 转发）
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Rocket } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import type { OTAStatus } from '../../types'

interface Props {
  deviceId: string
  online: boolean
  ota?: OTAStatus
}

export function OTAProgress({ deviceId, online, ota }: Props) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const active = ota && ['downloading', 'verifying', 'flashing'].includes(ota.state)
  const failed = ota?.state === 'failed'
  const done = ota?.state === 'success'
  const stateLabel = (s: string) =>
    t(`devices.ota.state.${s}`, { defaultValue: s })

  const trigger = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.startsWith('https://')) {
      toast.error(t('devices.ota.invalidUrl'))
      return
    }
    setBusy(true)
    try {
      await api.triggerOta(deviceId, url)
      toast.success(t('devices.ota.triggered'))
    } catch (err) {
      toast.error(`${t('common.error')}: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        <Rocket size={13} className="text-primary" /> {t('devices.ota.title')}
      </h4>
      <form onSubmit={trigger} className="flex gap-2">
        <Input
          type="url"
          placeholder={t('devices.ota.urlPh')}
          value={url}
          onChange={e => setUrl(e.target.value)}
          disabled={!!active}
          className="flex-1"
        />
        <Button type="submit" variant="primary" disabled={!online || !!active || busy}>
          {active ? `${ota!.progress_pct}%` : t('devices.ota.trigger')}
        </Button>
      </form>

      {ota && (active || failed || done) && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn('h-full rounded-full transition-all duration-500',
                failed ? 'bg-danger' : done ? 'bg-ok' : 'bg-primary')}
              style={{ width: `${ota.progress_pct}%` }}
            />
          </div>
          <p className={cn('num mt-1.5 text-xs',
            failed ? 'text-danger' : done ? 'text-ok' : 'text-muted')}>
            {stateLabel(ota.state)}{ota.message ? ` — ${ota.message}` : ''} · {ota.progress_pct}%
          </p>
        </div>
      )}
    </div>
  )
}
