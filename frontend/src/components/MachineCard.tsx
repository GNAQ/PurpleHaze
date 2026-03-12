import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Card, Badge, Button, Tooltip, InputNumber,
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

const { Text, Title } = Typography

interface Props {
  machine: Machine
  onEdit: (machine: Machine) => void
  onDeleted: (id: number) => void
  onConnectionChange: (id: number, connected: boolean) => void
}

const fmtMB = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

/** 单条迷你进度条，用于 GPU 总览网格 */
function MiniBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div style={{ height: 4, borderRadius: 2, overflow: 'hidden', background: 'rgba(0,0,0,0.1)', marginTop: 2 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
    </div>
  )
}

/** 根据利用率百分比返回状态色 */
const utilColor = (pct: number) => pct > 85 ? '#e05363' : pct > 60 ? '#e8a838' : '#75c181'

/** GPU 总览格：显示 GPU#、利用率、显存、温度、功耗——核心扫一眼指标 */
function GpuGridCell({ gpu }: { gpu: GpuInfo }) {
  const util = gpu.utilization
  const vramPct = (gpu.memory_used_mb / gpu.memory_total_mb) * 100
  const powerPct = gpu.power_draw_w != null && gpu.power_limit_w != null
    ? (gpu.power_draw_w / gpu.power_limit_w) * 100 : null

  return (
    <div style={{
      background: '#f0e8f0', border: '1px solid #e0d0e0',
      borderRadius: 8, padding: '8px 10px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#7a3b6e', letterSpacing: 0.5 }}>GPU {gpu.index}</span>
        {gpu.temperature_c != null && (
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: gpu.temperature_c > 80 ? '#e05363' : gpu.temperature_c > 65 ? '#e8a838' : '#4b7a52',
            background: gpu.temperature_c > 80 ? '#fdecea' : gpu.temperature_c > 65 ? '#fef3e0' : '#edf7ef',
            borderRadius: 4, padding: '1px 5px',
          }}>
            {gpu.temperature_c}°C
          </span>
        )}
      </div>
      <div style={{ marginBottom: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: '#9b7090' }}>利用率</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: utilColor(util), fontVariantNumeric: 'tabular-nums' }}>
            {util.toFixed(0)}%
          </span>
        </div>
        <MiniBar value={util} color={utilColor(util)} />
      </div>
      <div style={{ marginTop: 5, marginBottom: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: '#9b7090' }}>显存</span>
          <span style={{ fontSize: 10, color: '#6a4a6a', fontVariantNumeric: 'tabular-nums' }}>
            {fmtMB(gpu.memory_used_mb)}<span style={{ color: '#b090a8' }}>/{fmtMB(gpu.memory_total_mb)}</span>
          </span>
        </div>
        <MiniBar value={vramPct} color={utilColor(vramPct)} />
      </div>
      {powerPct != null && (
        <div style={{ marginTop: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: '#9b7090' }}>功耗</span>
            <span style={{ fontSize: 10, color: '#7a6070', fontVariantNumeric: 'tabular-nums' }}>
              {gpu.power_draw_w!.toFixed(0)}W
            </span>
          </div>
          <MiniBar value={powerPct} color={utilColor(powerPct)} />
        </div>
      )}
    </div>
  )
}

/** GPU 详情区：resource bar + 进程任务管理器表格 */
function GpuDetail({ gpu }: { gpu: GpuInfo }) {
  return (
    <div style={{
      background: 'rgba(245,237,244,0.65)', border: '1px solid #e4d4e4',
      borderRadius: 8, padding: '10px 12px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <ThunderboltOutlined style={{ fontSize: 12, color: '#bc73ad' }} />
        <Text strong style={{ fontSize: 12, color: '#5a2a58' }}>GPU {gpu.index}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{gpu.name}</Text>
        {gpu.temperature_c != null && (
          <span style={{
            fontSize: 10, fontWeight: 600, marginLeft: 'auto',
            color: gpu.temperature_c > 80 ? '#e05363' : gpu.temperature_c > 65 ? '#e8a838' : '#4b7a52',
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
        <div style={{ marginTop: 8, borderRadius: 6, overflow: 'hidden', border: '1px solid #ddd0dd' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 60px 44px 42px 54px 66px',
            padding: '3px 8px', background: '#ecdaea',
            borderBottom: '1px solid #ddd0dd', gap: 4,
          }}>
            {['进程名', '用户', 'PID', 'CPU', '内存', '显存'].map((col) => (
              <span key={col} style={{ fontSize: 10, color: '#825880', fontWeight: 600, lineHeight: '16px' }}>{col}</span>
            ))}
          </div>
          {gpu.processes.map((p, rowIdx) => (
            <Tooltip
              key={p.pid}
              title={p.cmdline
                ? <div style={{ wordBreak: 'break-all', maxWidth: 340, fontSize: 12 }}><b>命令：</b>{p.cmdline}</div>
                : undefined}
              color="#1c0f28"
            >
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 44px 42px 54px 66px',
                padding: '4px 8px', gap: 4,
                background: rowIdx % 2 === 0 ? '#faf5f9' : '#f4ecf4',
                borderBottom: rowIdx < gpu.processes.length - 1 ? '1px solid #ece4ec' : 'none',
                cursor: p.cmdline ? 'help' : 'default', alignItems: 'center',
              }}>
                <span style={{ fontSize: 11, color: '#2d1a2b', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name || `PID ${p.pid}`}
                </span>
                <span style={{ fontSize: 11, color: '#6b4b66', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.username || '—'}
                </span>
                <span style={{ fontSize: 11, color: '#8a8a9a', fontVariantNumeric: 'tabular-nums' }}>{p.pid}</span>
                <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: p.cpu_percent > 50 ? '#e05363' : p.cpu_percent > 20 ? '#e8a838' : '#4b7a52' }}>
                  {p.cpu_percent.toFixed(1)}%
                </span>
                <span style={{ fontSize: 11, color: '#4b6a7a', fontVariantNumeric: 'tabular-nums' }}>{fmtMB(p.memory_mb)}</span>
                <span style={{ fontSize: 11, color: '#7a3b6e', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtMB(p.used_memory_mb)}</span>
              </div>
            </Tooltip>
          ))}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>暂无 GPU 进程</Text>
      )}
    </div>
  )
}

export default function MachineCard({ machine, onEdit, onDeleted, onConnectionChange }: Props) {
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
  // 6/8 卡时用 3 列总览，否则 2 列
  const gpuCols = snapshot && snapshot.gpus.length > 4 ? 3 : 2

  return (
    <Card
      style={{
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(28,15,40,0.35)',
        border: connected ? '1px solid #c8e8cc' : '1px solid rgba(188,115,173,0.25)',
        background: '#faf5f9',
        flex: 1,
      }}
      styles={{ body: { padding: 16 } }}
    >
      {/* ── 头部 ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <Space align="center">
          <DesktopOutlined style={{ fontSize: 18, color: '#bc73ad' }} />
          <div>
            <Title level={5} style={{ margin: 0, lineHeight: 1.3 }}>{machine.name}</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {machine.is_local
                ? 'localhost（本地）'
                : `${machine.ssh_username}@${machine.ssh_host}:${machine.ssh_port}`}
            </Text>
            {!machine.is_local && machine.proxy_jump_host && (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                via {machine.proxy_jump_username}@{machine.proxy_jump_host}:{machine.proxy_jump_port}
              </Text>
            )}
          </div>
        </Space>
        <Space>
          <Badge
            status={connected ? 'success' : 'default'}
            text={<Text style={{ fontSize: 12 }}>{connected ? '已连接' : '未连接'}</Text>}
          />
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
        </Space>
      </div>

      {/* ── 连接控制 ── */}
      {!machine.is_local && (
        <Space style={{ marginBottom: 12 }}>
          {connected ? (
            <Button size="small" icon={<DisconnectOutlined />} onClick={handleDisconnect}>断开</Button>
          ) : (
            <Button size="small" type="primary" ghost icon={<LinkOutlined />} loading={connecting} onClick={handleConnect}>
              连接
            </Button>
          )}
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchResources} disabled={!connected}>刷新</Button>
        </Space>
      )}

      {/* ── 资源区 ── */}
      {connected && snapshot && !snapshot.error ? (
        <div>
          {/* CPU + 内存 */}
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

          {/* ── GPU 区域 ── */}
          {snapshot.gpus.length > 0 && (
            <>
              <Divider style={{ margin: '10px 0 8px', borderColor: '#e0d0e0' }}>
                <Text style={{ fontSize: 11, color: '#9b7090', fontWeight: 600 }}>
                  GPU × {snapshot.gpus.length}
                </Text>
              </Divider>

              {/* 总览网格：快速纵览所有 GPU */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${gpuCols}, 1fr)`,
                gap: 6,
                marginBottom: 12,
              }}>
                {snapshot.gpus.map((gpu) => (
                  <GpuGridCell key={gpu.index} gpu={gpu} />
                ))}
              </div>

              {/* 详情列表：每颗 GPU 完整 bar + 进程表 */}
              <Text style={{ fontSize: 11, color: '#9b7090', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                GPU 详情 &amp; 进程
              </Text>
              {snapshot.gpus.map((gpu) => (
                <GpuDetail key={gpu.index} gpu={gpu} />
              ))}
            </>
          )}
        </div>
      ) : connected && snapshot?.error ? (
        <Text type="danger" style={{ fontSize: 12 }}>采集失败：{snapshot.error}</Text>
      ) : !connected ? (
        <Text type="secondary" style={{ fontSize: 12 }}>未连接，无法获取资源信息</Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>正在获取资源信息...</Text>
      )}

      {/* 轮询间隔 */}
      <div style={{ borderTop: '1px solid #e0dce4', marginTop: 10, paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>轮询间隔</Text>
        {editingInterval ? (
          <Space size={4}>
            <InputNumber
              size="small" min={1} max={3600}
              value={intervalValue}
              onChange={(v) => v && setIntervalValue(v)}
              style={{ width: 64 }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>秒</Text>
            <Button size="small" type="link" onClick={saveInterval} style={{ padding: '0 4px', height: 'auto', fontSize: 12 }}>保存</Button>
            <Button size="small" type="text" onClick={() => setEditingInterval(false)} style={{ padding: '0 4px', height: 'auto', fontSize: 12 }}>取消</Button>
          </Space>
        ) : (
          <Space size={4}>
            <Text style={{ fontSize: 11 }}>{intervalValue}s</Text>
            <Button
              type="text" size="small" icon={<EditOutlined />}
              onClick={() => setEditingInterval(true)}
              style={{ padding: '0 2px', height: 18, lineHeight: '18px', fontSize: 11 }}
            />
          </Space>
        )}
      </div>
    </Card>
  )
}
