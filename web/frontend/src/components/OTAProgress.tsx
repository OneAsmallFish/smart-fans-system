// components/OTAProgress.tsx — OTA 固件更新触发 + 真实进度（WEB-04/WEB-11）
// 进度来自 MQTT ota/status（经后端 WebSocket 转发的 device.ota 字段）。
interface Props {
  deviceId: string
  apiBase: string
  online: boolean
  ota?: { state: string; progress_pct: number; message?: string }
}

export function OTAProgress({ deviceId, apiBase, online, ota }: Props) {
  const trigger = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const url = (form.elements.namedItem('ota-url') as HTMLInputElement).value
    if (!url.startsWith('https://')) return
    await fetch(`${apiBase}/devices/${deviceId}/ota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  }

  const active = ota && ['downloading', 'verifying', 'flashing'].includes(ota.state)
  const failed = ota?.state === 'failed'
  const done   = ota?.state === 'success'

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        Firmware OTA Update
      </div>
      <form onSubmit={trigger} style={{ display: 'flex', gap: 8 }}>
        <input
          name="ota-url"
          type="url" placeholder="https://your-server.com/firmware.bin"
          disabled={!!active}
          style={{
            flex: 1, background: '#111827', border: '1px solid #374151',
            color: 'white', borderRadius: 6, padding: '6px 10px', fontSize: 13,
          }}
        />
        <button type="submit" disabled={!online || !!active} style={{
          padding: '6px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
          background: !online || active ? '#374151' : '#7c3aed',
          color: 'white', border: 'none',
          opacity: !online ? 0.5 : 1,
        }}>
          {active ? `${ota!.progress_pct}%` : 'Flash OTA'}
        </button>
      </form>

      {ota && (active || failed || done) && (
        <div style={{ marginTop: 8 }}>
          <div style={{
            height: 5, background: '#1f2937', borderRadius: 99, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 99,
              width: `${ota.progress_pct}%`,
              background: failed ? '#ef4444' : done ? '#22c55e' : '#7c3aed',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <p style={{ fontSize: 12, marginTop: 5,
                      color: failed ? '#fca5a5' : done ? '#86efac' : '#9ca3af' }}>
            {ota.state}{ota.message ? ` — ${ota.message}` : ''} ({ota.progress_pct}%)
          </p>
        </div>
      )}
    </div>
  )
}
