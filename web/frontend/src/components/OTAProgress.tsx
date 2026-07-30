// components/OTAProgress.tsx — OTA固件更新进度 + 确认对话框
import { useState } from 'react'

interface Props {
  deviceId: string
  apiBase: string
  online: boolean
}

type OTAState = 'idle' | 'pending' | 'started' | 'error'

export function OTAProgress({ deviceId, apiBase, online }: Props) {
  const [url,    setUrl]    = useState('')
  const [state,  setState]  = useState<OTAState>('idle')
  const [message,setMessage]= useState('')

  const trigger = async () => {
    if (!url.startsWith('https://')) {
      setState('error')
      setMessage('URL must start with https://')
      return
    }
    setState('pending')
    const r = await fetch(`${apiBase}/devices/${deviceId}/ota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const json = await r.json()
    if (json.ok) {
      setState('started')
      setMessage('OTA started — device will reboot automatically when complete')
    } else {
      setState('error')
      setMessage(json.error ?? 'Unknown error')
    }
  }

  const stateColor = { idle: '#3b82f6', pending: '#f59e0b',
                       started: '#22c55e', error: '#ef4444' }[state]
  const stateLabel = { idle: 'Flash OTA', pending: 'Sending…',
                       started: '✓ Started', error: '✗ Failed' }[state]

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        Firmware OTA Update
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="url" placeholder="https://your-server.com/firmware.bin"
          value={url} onChange={e => { setUrl(e.target.value); setState('idle') }}
          style={{
            flex: 1, background: '#1f2937', border: '1px solid #374151',
            color: 'white', borderRadius: 6, padding: '6px 10px', fontSize: 13,
          }}
        />
        <button onClick={trigger} disabled={!online || state === 'pending'} style={{
          padding: '6px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
          background: online && state !== 'pending' ? stateColor : '#374151',
          color: 'white', border: 'none',
          opacity: !online ? 0.5 : 1,
        }}>
          {stateLabel}
        </button>
      </div>
      {message && (
        <p style={{ fontSize: 12, marginTop: 6,
                    color: state === 'error' ? '#fca5a5' : '#86efac' }}>
          {message}
        </p>
      )}
      {state === 'started' && (
        <div style={{
          marginTop: 10, height: 4, background: '#1f2937',
          borderRadius: 99, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', background: '#22c55e',
            animation: 'progress-indeterminate 1.5s infinite linear',
            width: '40%',
          }} />
        </div>
      )}
    </div>
  )
}
