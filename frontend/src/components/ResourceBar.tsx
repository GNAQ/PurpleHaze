import { useMemo } from 'react'
import { Tooltip, Typography } from 'antd'
import { utilColor } from '../theme/tokens'
import { useTheme } from '../theme/useTheme'

const { Text } = Typography

interface Props {
  label: string
  value: number        // 0-100
  color?: string
  subLabel?: string    // e.g. "12.3 / 80.0 GB"
  small?: boolean
}

export default function ResourceBar({ label, value, color, subLabel, small }: Props) {
  const { t } = useTheme()
  const pct = Math.min(100, Math.max(0, value))
  const strokeColor = color ?? utilColor(pct)

  return (
    <Tooltip title={subLabel ?? `${pct.toFixed(1)}%`} placement="right">
      <div style={{ marginBottom: small ? 4 : 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <Text style={{ fontSize: small ? 10 : 11, color: t.textSec }}>{label}</Text>
          <Text className="ph-mono" style={{ fontSize: small ? 10 : 11, color: t.text }}>
            {subLabel ?? `${pct.toFixed(1)}%`}
          </Text>
        </div>
        <div style={{
          height: small ? 4 : 6,
          borderRadius: 3,
          background: 'rgba(188,115,173,0.10)',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 3,
            background: `linear-gradient(90deg, ${strokeColor}, ${strokeColor}dd)`,
            boxShadow: pct > 60 ? `0 0 8px ${strokeColor}40` : 'none',
            transition: 'width 0.6s ease-out',
          }} />
        </div>
      </div>
    </Tooltip>
  )
}
