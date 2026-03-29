import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Badge, Button, Tooltip, InputNumber,
  Typography, Space, Dropdown, Modal, message, Divider,
} from 'antd'
import {
  ReloadOutlined, DisconnectOutlined, LinkOutlined,
  DeleteOutlined, EditOutlined, EllipsisOutlined,
  DesktopOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import type { Machine } from '../api/machines'
import type { GpuInfo, ResourceSnapshot } from '../api/monitor'
import { machinesApi } from '../api/machines'
import { monitorApi } from '../api/monitor'
import ResourceBar from './ResourceBar'
import { ph, utilColor, tempColor } from '../theme/tokens'
import { useTheme } from '../theme/useTheme'

const { Text, Title } = Typography

interface Props {
  machine: Machine
  onEdit: (machine: Machine) => void
  onDeleted: (id: number) => void
  onConnectionChange: (id: number, connected: boolean) => void
  dragHandleRef?: (el: HTMLElement | null) => void
  dragListeners?: Record<string, any>
}

const fmtMB = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

/** SVG ring gauge */
function RingGauge({ pct, size = 44, stroke = 3.5, color }: { pct: number; size?: number; stroke?: number; color: string }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(100, pct) / 100)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(188,115,173,0.10)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s ease-out, stroke 0.3s' }}
      />
    </svg>
  )
}

/** GPU 总览格 — ring gauge + compact bars */
function GpuGridCell({ gpu }: { gpu: GpuInfo }) {
  const { t, isDark } = useTheme()
  const util = gpu.utilization
  const vramPct = (gpu.memory_used_mb / gpu.memory_total_mb) * 100
  const uColor = utilColor(util)

  return (
    <div style={{
      background: isDark
        ? t.surface2
        : 'linear-gradient(180deg, rgba(239,233,240,0.96) 0%, rgba(230,237,231,0.92) 100%)',
      border: isDark ? `1px solid ${t.glassBorder}` : '1px solid rgba(83,42,86,0.12)',
      borderRadius: 8,
      padding: '8px 10px',
      transition: 'border-color 0.2s',
      boxShadow: isDark ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.24)',
    }}>
      {/* Header: GPU index + temp */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="ph-mono" style={{ fontSize: 10, fontWeight: 700, color: ph.purple400, letterSpacing: 0.5 }}>
          GPU {gpu.index}
        </span>
        {gpu.temperature_c != null && (
          <span className="ph-mono" style={{ fontSize: 10, fontWeight: 700, color: tempColor(gpu.temperature_c) }}>
            {gpu.temperature_c}°C
          </span>
        )}
      </div>
      {/* Ring + data */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <RingGauge pct={util} color={uColor} />
          <span className="ph-mono" style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%) rotate(0deg)',
            fontSize: 10, fontWeight: 700, color: uColor, lineHeight: 1,
          }}>
            {util.toFixed(0)}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* VRAM bar */}
          <div style={{ marginBottom: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
              <span style={{ fontSize: 9, color: t.textTer }}>VRAM</span>
              <span className="ph-mono" style={{ fontSize: 9, color: t.textSec }}>{fmtMB(gpu.memory_used_mb)}</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: isDark ? 'rgba(188,115,173,0.08)' : 'rgba(83,42,86,0.10)', position: 'relative' }}>
              <div style={{ width: `${Math.min(100, vramPct)}%`, height: '100%', background: utilColor(vramPct), borderRadius: 2, transition: 'width 0.5s ease' }} />
              {/* Tick marks */}
              {[25, 50, 75].map((t) => (
                <div key={t} style={{
                  position: 'absolute', left: `${t}%`, top: -1, width: 1, height: 5,
                  background: isDark ? 'rgba(188,115,173,0.15)' : 'rgba(83,42,86,0.16)',
                }} />
              ))}
            </div>
          </div>
          {/* Power */}
          {gpu.power_draw_w != null && gpu.power_limit_w != null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                <span style={{ fontSize: 9, color: t.textTer }}>PWR</span>
                <span className="ph-mono" style={{ fontSize: 9, color: t.textSec }}>{gpu.power_draw_w.toFixed(0)}W</span>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: isDark ? 'rgba(188,115,173,0.08)' : 'rgba(83,42,86,0.10)', position: 'relative' }}>
                <div style={{
                  width: `${Math.min(100, (gpu.power_draw_w / gpu.power_limit_w) * 100)}%`,
                  height: '100%', background: utilColor((gpu.power_draw_w / gpu.power_limit_w) * 100),
                  borderRadius: 2, transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** GPU 详情区 */
function GpuDetail({ gpu }: { gpu: GpuInfo }) {
  const { t, isDark } = useTheme()
  return (
    <div style={{
      background: isDark
        ? t.surface2
        : 'linear-gradient(180deg, rgba(240,233,240,0.97) 0%, rgba(231,237,232,0.94) 100%)',
      border: isDark ? `1px solid ${t.glassBorder}` : '1px solid rgba(83,42,86,0.12)',
      borderRadius: 8, padding: '10px 12px', marginBottom: 8,
      boxShadow: isDark ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.24)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <ThunderboltOutlined style={{ fontSize: 12, color: ph.purple500 }} />
        <Text strong style={{ fontSize: 12, color: ph.purple400 }}>GPU {gpu.index}</Text>
        <Text style={{ fontSize: 11, color: t.textSec }}>{gpu.name}</Text>
        {gpu.temperature_c != null && (
          <span className="ph-mono" style={{
            fontSize: 10, fontWeight: 600, marginLeft: 'auto',
            color: tempColor(gpu.temperature_c!),
          }}>
            {gpu.temperature_c}°C
          </span>
        )}
      </div>
      <ResourceBar label="利用率" value={gpu.utilization} subLabel={`${gpu.utilization.toFixed(0)}%`} small />
      <ResourceBar
        label="显存"
        value={(gpu.memory_used_mb / gpu.memory_total_mb) * 100}
        subLabel={`${fmtMB(gpu.memory_used_mb)} / ${fmtMB(gpu.memory_total_mb)}`}
        small
      />
      {gpu.power_draw_w != null && gpu.power_limit_w != null && (
        <ResourceBar
          label="功耗"
          value={(gpu.power_draw_w / gpu.power_limit_w) * 100}
          subLabel={`${gpu.power_draw_w.toFixed(0)}W / ${gpu.power_limit_w.toFixed(0)}W`}
          small
        />
      )}
      {gpu.processes.length > 0 ? (
        <div style={{ marginTop: 8, borderRadius: 6, overflow: 'hidden', border: isDark ? `1px solid ${t.glassBorder}` : '1px solid rgba(83,42,86,0.12)' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 60px 44px 42px 54px 66px',
            padding: '3px 8px', background: isDark ? t.surface0 : 'linear-gradient(90deg, rgba(168,64,151,0.10) 0%, rgba(92,193,116,0.06) 100%)',
            borderBottom: isDark ? `1px solid ${t.glassBorder}` : '1px solid rgba(83,42,86,0.12)', gap: 4,
          }}>
            {['进程名', '用户', 'PID', 'CPU', '内存', '显存'].map((col) => (
              <span key={col} className="ph-mono" style={{ fontSize: 9, color: t.textTer, fontWeight: 600, lineHeight: '16px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {col}
              </span>
            ))}
          </div>
          {gpu.processes.map((p, rowIdx) => (
            <Tooltip
              key={p.pid}
              title={p.cmdline
                ? <div style={{ wordBreak: 'break-all', maxWidth: 340, fontSize: 12 }}><b>CMD:</b> {p.cmdline}</div>
                : undefined}
              color={t.surface2}
            >
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 44px 42px 54px 66px',
                padding: '4px 8px', gap: 4,
                background: rowIdx % 2 === 0
                  ? 'transparent'
                  : isDark ? 'rgba(188,115,173,0.03)' : 'rgba(116,84,122,0.04)',
                borderBottom: rowIdx < gpu.processes.length - 1
                  ? isDark ? `1px solid rgba(188,115,173,0.06)` : '1px solid rgba(83,42,86,0.08)'
                  : 'none',
                cursor: p.cmdline ? 'help' : 'default', alignItems: 'center',
              }}>
                <span className="ph-mono" style={{ fontSize: 11, color: t.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name || `PID ${p.pid}`}
                </span>
                <span style={{ fontSize: 11, color: t.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.username || '—'}
                </span>
                <span className="ph-mono" style={{ fontSize: 11, color: t.textTer }}>{p.pid}</span>
                <span className="ph-mono" style={{ fontSize: 11, color: p.cpu_percent > 50 ? ph.error : p.cpu_percent > 20 ? ph.warning : ph.green500 }}>
                  {p.cpu_percent.toFixed(1)}%
                </span>
                <span className="ph-mono" style={{ fontSize: 11, color: t.textSec }}>{fmtMB(p.memory_mb)}</span>
                <span className="ph-mono" style={{ fontSize: 11, color: ph.purple400, fontWeight: 500 }}>{fmtMB(p.used_memory_mb)}</span>
              </div>
            </Tooltip>
          ))}
        </div>
      ) : (
        <Text style={{ fontSize: 11, display: 'block', marginTop: 6, color: t.textTer }}>暂无 GPU 进程</Text>
      )}
    </div>
  )
}

export default function MachineCard({ machine, onEdit, onDeleted, onConnectionChange, dragHandleRef, dragListeners }: Props) {
  const { t, isDark } = useTheme()
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [editingInterval, setEditingInterval] = useState(false)
  const [intervalValue, setIntervalValue] = useState(machine.monitor_config?.interval ?? 10)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const interval = machine.monitor_config?.interval ?? 10

  const fetchResources = useCallback(async () => {
    if (!machine.is_local && !machine.connected) return
    try {
      const res = await monitorApi.getResources(machine.id)
      setSnapshot(res.data)
    } catch (_) {}
  }, [machine.id, machine.is_local, machine.connected])

  useEffect(() => {
    fetchResources()
    intervalRef.current = setInterval(fetchResources, interval * 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchResources, interval])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const res = await machinesApi.connect(machine.id)
      if (res.data.connected) {
        message.success('连接成功')
        onConnectionChange(machine.id, true)
      } else {
        message.error(`连接失败：${res.data.error ?? '未知错误'}`)
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail ?? '连接失败')
    }
    setConnecting(false)
  }

  const handleDisconnect = async () => {
    try {
      await machinesApi.disconnect(machine.id)
      message.success('已断开连接')
      onConnectionChange(machine.id, false)
      setSnapshot(null)
    } catch (_) {}
  }

  async function saveInterval() {
    try {
      await machinesApi.update(machine.id, { monitor_config: { ...machine.monitor_config, interval: intervalValue } })
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(fetchResources, intervalValue * 1000)
      setEditingInterval(false)
      message.success('轮询间隔已更新')
    } catch {
      message.error('更新失败')
    }
  }

  const handleDelete = () => {
    Modal.confirm({
      title: `确认删除机器「${machine.name}」？`,
      content: '删除后相关监控数据将清除，此操作不可恢复。',
      okType: 'danger',
      onOk: async () => {
        try {
          await machinesApi.delete(machine.id)
          onDeleted(machine.id)
          message.success('已删除')
        } catch (e: any) {
          message.error(e.response?.data?.detail ?? '删除失败')
        }
      },
    })
  }

  const menuItems = [
    { key: 'edit', label: '编辑', icon: <EditOutlined /> },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
  ]

  const connected = machine.is_local || machine.connected
  const gpuCols = snapshot && snapshot.gpus.length > 4 ? 3 : 2
  const cardBorderColor = connected
    ? (isDark ? 'rgba(117,193,129,0.20)' : 'rgba(92,193,116,0.22)')
    : t.glassBorder

  return (
    <div
      className="ph-glass"
      style={{
        borderRadius: 14,
        boxShadow: connected
          ? (isDark ? '0 4px 24px rgba(0,0,0,0.4)' : '0 18px 32px rgba(77,176,108,0.08), 0 12px 24px rgba(78,52,86,0.06)')
          : (isDark ? '0 4px 16px rgba(0,0,0,0.3)' : '0 12px 24px rgba(78,52,86,0.06)'),
        borderTop: `1px solid ${cardBorderColor}`,
        borderRight: `1px solid ${cardBorderColor}`,
        borderBottom: `1px solid ${cardBorderColor}`,
        borderLeft: connected ? `3px solid ${ph.green500}` : `1px solid ${cardBorderColor}`,
        overflow: 'hidden',
        transition: 'border-color 0.3s, box-shadow 0.3s',
      }}
    >
      {/* 拖拽排序条 */}
      {dragHandleRef && (
        <Tooltip title="拖拽排序" mouseEnterDelay={0.6}>
          <div
            ref={dragHandleRef}
            {...dragListeners}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '4px 0',
              background: isDark
                ? 'rgba(188,115,173,0.06)'
                : 'linear-gradient(90deg, rgba(168,64,151,0.08) 0%, rgba(92,193,116,0.05) 100%)',
              borderBottom: isDark ? `1px solid rgba(188,115,173,0.10)` : '1px solid rgba(83,42,86,0.12)',
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
            <div className="ph-grip">
              <span /><span /><span /><span /><span /><span />
            </div>
          </div>
        </Tooltip>
      )}

      <div style={{ padding: 16 }}>
        {/* ── 头部 ── */}
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${t.divider}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: isDark
                  ? 'linear-gradient(135deg, rgba(188,115,173,0.20) 0%, rgba(117,193,129,0.10) 100%)'
                  : 'linear-gradient(135deg, rgba(168,64,151,0.22) 0%, rgba(92,193,116,0.14) 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <DesktopOutlined style={{ fontSize: 17, color: ph.purple400 }} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Title level={5} style={{ margin: 0, lineHeight: 1.25, wordBreak: 'break-word', color: t.text }}>{machine.name}</Title>
                <Text className="ph-mono" style={{ fontSize: 11, display: 'block', marginTop: 2, wordBreak: 'break-all', color: t.textSec }}>
                  {machine.is_local
                    ? 'localhost'
                    : `${machine.ssh_username}@${machine.ssh_host}:${machine.ssh_port}`}
                </Text>
                {!machine.is_local && machine.proxy_jump_host && (
                  <Text className="ph-mono" style={{ fontSize: 10, display: 'block', marginTop: 2, color: t.textTer }}>
                    via {machine.proxy_jump_username}@{machine.proxy_jump_host}:{machine.proxy_jump_port}
                  </Text>
                )}
              </div>
            </div>
            <Badge
              status={connected ? 'success' : 'default'}
              text={<Text style={{ fontSize: 11, fontWeight: 500, color: connected ? ph.green500 : t.textTer }}>{connected ? 'ONLINE' : 'OFFLINE'}</Text>}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 999,
              background: isDark ? 'rgba(188,115,173,0.06)' : 'rgba(168,64,151,0.10)',
              border: isDark ? `1px solid rgba(188,115,173,0.12)` : '1px solid rgba(83,42,86,0.12)',
              minHeight: 28,
            }}>
              <Text className="ph-mono" style={{ fontSize: 10, color: t.textTer }}>POLL</Text>
              {editingInterval ? (
                <>
                  <InputNumber size="small" min={1} max={3600} value={intervalValue}
                    onChange={(v) => v && setIntervalValue(v)} style={{ width: 64 }} />
                  <Text style={{ fontSize: 10, color: t.textTer }}>s</Text>
                  <Button size="small" type="link" onClick={saveInterval} style={{ padding: '0 2px', height: 18, fontSize: 11 }}>OK</Button>
                  <Button size="small" type="text" onClick={() => setEditingInterval(false)} style={{ padding: '0 2px', height: 18, fontSize: 11, color: t.textTer }}>×</Button>
                </>
              ) : (
                <>
                  <Text className="ph-mono" style={{ fontSize: 11, fontWeight: 600, color: t.text }}>{intervalValue}s</Text>
                  <Button type="text" size="small" icon={<EditOutlined />}
                    onClick={() => setEditingInterval(true)}
                    style={{ padding: 0, width: 16, height: 16, minWidth: 16, color: t.textTer }} />
                </>
              )}
            </div>

            {!machine.is_local && (
              connected ? (
                <Button size="small" icon={<DisconnectOutlined />} onClick={handleDisconnect}>断开</Button>
              ) : (
                <Button size="small" type="primary" ghost icon={<LinkOutlined />} loading={connecting} onClick={handleConnect}>连接</Button>
              )
            )}
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchResources} disabled={!connected}>刷新</Button>
            <Dropdown
              menu={{
                items: menuItems,
                onClick: ({ key }) => {
                  if (key === 'edit') onEdit(machine)
                  if (key === 'delete') handleDelete()
                },
              }}
              trigger={['click']}
            >
              <Button type="text" icon={<EllipsisOutlined />} size="small" />
            </Dropdown>
          </div>
        </div>

        {/* ── 资源区 ── */}
        {connected && snapshot && !snapshot.error ? (
          <div>
            <ResourceBar
              label={`CPU${snapshot.cpu_name ? ` — ${snapshot.cpu_name}` : ''}`}
              value={snapshot.cpu_percent}
              subLabel={`${snapshot.cpu_percent.toFixed(1)}%`}
            />
            <ResourceBar
              label="内存"
              value={(snapshot.memory_used_mb / snapshot.memory_total_mb) * 100}
              subLabel={`${fmtMB(snapshot.memory_used_mb)} / ${fmtMB(snapshot.memory_total_mb)}`}
            />

            {snapshot.gpus.length > 0 && (
              <>
                <Divider style={{ margin: '10px 0 8px', borderColor: t.divider }}>
                  <Text className="ph-mono" style={{ fontSize: 10, color: ph.purple500, fontWeight: 600, letterSpacing: 1 }}>
                    GPU × {snapshot.gpus.length}
                  </Text>
                </Divider>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${gpuCols}, 1fr)`,
                  gap: 6, marginBottom: 12,
                }}>
                  {snapshot.gpus.map((gpu) => (
                    <GpuGridCell key={gpu.index} gpu={gpu} />
                  ))}
                </div>

                <Text className="ph-mono" style={{ fontSize: 10, color: ph.purple500, fontWeight: 600, display: 'block', marginBottom: 6, letterSpacing: 0.5 }}>
                  DETAILS & PROCESSES
                </Text>
                {snapshot.gpus.map((gpu) => (
                  <GpuDetail key={gpu.index} gpu={gpu} />
                ))}
              </>
            )}
          </div>
        ) : connected && snapshot?.error ? (
          <Text style={{ fontSize: 12, color: ph.error }}>采集失败：{snapshot.error}</Text>
        ) : !connected ? (
          <Text style={{ fontSize: 12, color: t.textTer }}>未连接，无法获取资源信息</Text>
        ) : (
          <Text style={{ fontSize: 12, color: t.textTer }}>正在获取资源信息...</Text>
        )}
      </div>
    </div>
  )
}
