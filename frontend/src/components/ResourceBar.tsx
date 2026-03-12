import { useMemo } from 'react'
import { Progress, Tooltip, Typography } from 'antd'

const { Text } = Typography

interface Props {
  label: string
  value: number        // 0-100
  color?: string
  subLabel?: string    // e.g. "12.3 / 80.0 GB"
  small?: boolean
}

export default function ResourceBar({ label, value, color, subLabel, small }: Props) {
  const pct = Math.min(100, Math.max(0, value))
  const strokeColor = color ?? (pct > 85 ? '#e05363' : pct > 60 ? '#e8a838' : '#75c181')

  return (
    <Tooltip title={subLabel ?? `${pct.toFixed(1)}%`} placement="right">
      <div style={{ marginBottom: small ? 4 : 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <Text style={{ fontSize: small ? 11 : 12, color: '#6b7280' }}>{label}</Text>
          <Text style={{ fontSize: small ? 11 : 12, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
            {subLabel ?? `${pct.toFixed(1)}%`}
          </Text>
        </div>
        <Progress
          percent={pct}
          showInfo={false}
          strokeColor={strokeColor}
          trailColor="#e0dce4"
          size={small ? ['100%', 4] : ['100%', 6]}
          style={{ margin: 0 }}
        />
      </div>
    </Tooltip>
  )
}
