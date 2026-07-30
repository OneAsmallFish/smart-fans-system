// components/TemperatureGauge.tsx
import { RadialBarChart, RadialBar, Cell, ResponsiveContainer } from 'recharts'

interface Props {
  temp: number
  label: string
  maxTemp?: number
}

export function TemperatureGauge({ temp, label, maxTemp = 85 }: Props) {
  const pct  = Math.min(100, (temp / maxTemp) * 100)
  const color = temp > 75 ? '#ef4444' : temp > 55 ? '#f59e0b' : '#22c55e'

  return (
    <div style={{ textAlign: 'center', minWidth: 90 }}>
      <ResponsiveContainer width={90} height={70}>
        <RadialBarChart innerRadius={24} outerRadius={42}
                        data={[{ value: pct }]} startAngle={180} endAngle={0}>
          <RadialBar dataKey="value" cornerRadius={4}
                     background={{ fill: '#2d3748' }}>
            <Cell fill={color} />
          </RadialBar>
        </RadialBarChart>
      </ResponsiveContainer>
      <div style={{ marginTop: -20, fontSize: 13, fontWeight: 700,
                    color }}>
        {temp.toFixed(1)}°C
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  )
}
