// components/AlertRuleEditor.tsx — 告警规则编辑器（WEB-11 复活，ADJ-14 双阈值模型）
// 发布到 config/alert（协议 §6.2，经 WEB-05 后端端点）。
import { useState } from 'react'

export interface AlertRule {
  type: 'temperature_high' | 'fan_stall' | 'voltage_abnormal' | 'wifi_disconnected'
  threshold?: number
  warn_c?: number
  crit_c?: number
  '12v_min'?: number
  '12v_max'?: number
  enabled: boolean
}

interface Props {
  deviceId: string
  apiBase: string
  initialRules?: AlertRule[]
}

/* ADJ-14 双阈值口径：温度 75 警告 / 80 critical；12V 10.8-13.2V；
 * 5V ±0.25V；3.3V ±0.165V；停转 <200RPM 且 duty>5%；WiFi 断连 >60s */
const DEFAULT_RULES: AlertRule[] = [
  { type: 'temperature_high', warn_c: 75, crit_c: 80, enabled: true },
  { type: 'fan_stall', threshold: 200, enabled: true },
  { type: 'voltage_abnormal', '12v_min': 10.8, '12v_max': 13.2, enabled: true },
  { type: 'wifi_disconnected', threshold: 60, enabled: true },
]

const LABELS: Record<AlertRule['type'], string> = {
  temperature_high: 'Temperature High',
  fan_stall: 'Fan Stalled',
  voltage_abnormal: 'Voltage Abnormal',
  wifi_disconnected: 'WiFi Disconnect',
}

const numStyle: React.CSSProperties = {
  width: 62, background: '#374151', border: 'none', color: 'white',
  borderRadius: 6, padding: '4px 6px', fontSize: 12,
}

function NumField({ label, value, onChange, unit }: {
  label: string; value: number; onChange: (v: number) => void; unit: string
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
      <span style={{ color: '#9ca3af' }}>{label}</span>
      <input type="number" value={value} style={numStyle}
             onChange={e => onChange(Number(e.target.value))} />
      <span style={{ color: '#6b7280', width: 22 }}>{unit}</span>
    </label>
  )
}

export function AlertRuleEditor({ deviceId, apiBase, initialRules }: Props) {
  const [rules, setRules] = useState<AlertRule[]>(initialRules ?? DEFAULT_RULES)
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

  const update = (i: number, patch: Partial<AlertRule>) =>
    setRules(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Alert Rules（双阈值模型）</span>
        <button onClick={apply} style={{
          padding: '4px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
          background: saved ? '#14532d' : '#22c55e', color: 'white', border: 'none',
        }}>
          {saved ? '✓ Saved' : 'Save Rules'}
        </button>
      </div>

      {rules.map((rule, i) => (
        <div key={rule.type} style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 0',
          borderBottom: i < rules.length - 1 ? '1px solid #374151' : 'none',
        }}>
          <button onClick={() => update(i, { enabled: !rule.enabled })} style={{
            flexShrink: 0, width: 38, height: 22, borderRadius: 99,
            border: 'none', cursor: 'pointer', position: 'relative',
            background: rule.enabled ? '#22c55e' : '#374151',
          }}>
            <span style={{
              position: 'absolute', top: 3, width: 16, height: 16,
              borderRadius: '50%', background: 'white',
              left: rule.enabled ? 18 : 3, transition: 'left 0.2s',
            }} />
          </button>

          <span style={{ flex: '1 1 120px', fontSize: 13 }}>{LABELS[rule.type]}</span>

          {rule.type === 'temperature_high' && (
            <>
              <NumField label="警告" unit="°C" value={rule.warn_c ?? 75}
                        onChange={v => update(i, { warn_c: v })} />
              <NumField label="critical" unit="°C" value={rule.crit_c ?? 80}
                        onChange={v => update(i, { crit_c: v })} />
            </>
          )}
          {rule.type === 'fan_stall' && (
            <NumField label="低于" unit="RPM" value={rule.threshold ?? 200}
                      onChange={v => update(i, { threshold: v })} />
          )}
          {rule.type === 'voltage_abnormal' && (
            <>
              <NumField label="12V 下限" unit="V" value={rule['12v_min'] ?? 10.8}
                        onChange={v => update(i, { '12v_min': v })} />
              <NumField label="12V 上限" unit="V" value={rule['12v_max'] ?? 13.2}
                        onChange={v => update(i, { '12v_max': v })} />
              <span style={{ fontSize: 10, color: '#6b7280' }}>
                5V ±0.25V / 3.3V ±0.165V 固定
              </span>
            </>
          )}
          {rule.type === 'wifi_disconnected' && (
            <NumField label="超过" unit="s" value={rule.threshold ?? 60}
                      onChange={v => update(i, { threshold: v })} />
          )}
        </div>
      ))}
    </div>
  )
}
