// components/AlertRuleEditor.tsx
import { useState } from 'react'

export interface AlertRule {
  type: string
  threshold: number
  enabled: boolean
}

const RULE_META = [
  { type: 'temperature_high', label: 'Temperature High', unit: '°C', defaultThreshold: 75 },
  { type: 'fan_stalled',      label: 'Fan Stalled',      unit: 'RPM', defaultThreshold: 200 },
  { type: 'voltage_abnormal', label: 'Voltage Abnormal', unit: 'V',   defaultThreshold: 10.8 },
  { type: 'wifi_disconnected',label: 'WiFi Disconnect',  unit: 's',   defaultThreshold: 60 },
]

interface Props {
  deviceId: string
  apiBase: string
  initialRules?: AlertRule[]
}

export function AlertRuleEditor({ deviceId, apiBase, initialRules }: Props) {
  const [rules, setRules] = useState<AlertRule[]>(
    initialRules ?? RULE_META.map(m => ({
      type: m.type, threshold: m.defaultThreshold, enabled: true,
    })),
  )
  const [saved, setSaved] = useState(false)

  const apply = async () => {
    await fetch(`${apiBase}/devices/${deviceId}/alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Alert Rules</span>
        <button onClick={apply} style={{
          padding: '4px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
          background: saved ? '#14532d' : '#22c55e', color: 'white', border: 'none',
        }}>
          {saved ? '✓ Saved' : 'Save Rules'}
        </button>
      </div>

      {RULE_META.map((meta, i) => (
        <div key={meta.type} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 0',
          borderBottom: i < RULE_META.length - 1 ? '1px solid #1f2937' : 'none',
        }}>
          {/* Toggle switch */}
          <button onClick={() =>
            setRules(r => r.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x))
          } style={{
            flexShrink: 0, width: 38, height: 22, borderRadius: 99,
            border: 'none', cursor: 'pointer', position: 'relative',
            background: rules[i].enabled ? '#22c55e' : '#374151',
          }}>
            <span style={{
              position: 'absolute', top: 3, width: 16, height: 16,
              borderRadius: '50%', background: 'white',
              left: rules[i].enabled ? 18 : 3, transition: 'left 0.2s',
            }} />
          </button>

          <span style={{ flex: 1, fontSize: 13 }}>{meta.label}</span>

          <span style={{ fontSize: 11, color: '#6b7280' }}>Threshold:</span>
          <input type="number" value={rules[i].threshold}
            style={{
              width: 68, background: '#1f2937', border: 'none', color: 'white',
              borderRadius: 6, padding: '4px 8px', fontSize: 12,
            }}
            onChange={e =>
              setRules(r => r.map((x, j) => j === i ? { ...x, threshold: Number(e.target.value) } : x))
            } />
          <span style={{ fontSize: 11, color: '#6b7280', width: 24 }}>{meta.unit}</span>
        </div>
      ))}
    </div>
  )
}
