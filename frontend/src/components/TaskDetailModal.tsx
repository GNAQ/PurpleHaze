/**
 * 任务详情弹窗 — 展示任务的所有信息
 * 从 HistoryPage 点击行或 TasksPage 归档卡片跳转打开
 */
import { useState, useEffect } from 'react'
import {
  Modal, Descriptions, Tag, Space, Button, Spin, Tabs, Typography, Tooltip, message,
} from 'antd'
import {
  CopyOutlined, DownloadOutlined, ClockCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined,
  PlayCircleOutlined, ExperimentOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { tasksApi, HistoryTask, TaskStatus } from '../api/tasks'
import { ph } from '../theme/tokens'
import { useTheme } from '../theme/useTheme'

const { Text, Paragraph } = Typography

interface Props {
  task: HistoryTask | null
  open: boolean
  onClose: () => void
}

const STATUS_LABELS: Record<TaskStatus, { label: string; color: string; icon: React.ReactNode }> = {
  waiting:   { label: '等待中', color: 'default',  icon: <ClockCircleOutlined /> },
  running:   { label: '运行中', color: 'processing', icon: <PlayCircleOutlined /> },
  completed: { label: '已完成', color: 'success',  icon: <CheckCircleOutlined /> },
  failed:    { label: '失败',   color: 'error',    icon: <CloseCircleOutlined /> },
  cancelled: { label: '已取消', color: 'warning',  icon: <MinusCircleOutlined /> },
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '-'
  const secs = dayjs(end).diff(dayjs(start), 'second')
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ${secs % 60}s`
}

function formatWait(created?: string | null, started?: string | null): string {
  if (!created || !started) return '-'
  const secs = dayjs(started).diff(dayjs(created), 'second')
  if (secs < 1) return '< 1s'
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
  message.success('已复制')
}

export default function TaskDetailModal({ task, open, onClose }: Props) {
  const { t, isDark } = useTheme()

  // Logs state
  const [logsContent, setLogsContent] = useState({ stdout: '', stderr: '', truncated: false })
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsLoaded, setLogsLoaded] = useState(false)

  // Reset and auto-load when task changes
  useEffect(() => {
    if (open && task) {
      setLogsLoaded(false)
      setLogsContent({ stdout: '', stderr: '', truncated: false })
      // 自动加载日志
      setLogsLoading(true)
      tasksApi.getLogs(task.id).then((res) => {
        setLogsContent(res.data)
        setLogsLoaded(true)
      }).catch(() => { message.error('获取日志失败') })
        .finally(() => { setLogsLoading(false) })
    }
  }, [open, task?.id])

  if (!task) return null

  const config = task.config || {}
  const sc = STATUS_LABELS[task.status]
  const args = config.args || []
  const envVars = config.env_vars || {}
  const gpuCond = task.gpu_condition
  const meta = task.meta || {}

  const cmdSummary = config.command
    ? `${config.command} ${args.map((a) => `${a.name} ${a.value}`).join(' ')}`.trim()
    : '-'

  const sectionStyle = {
    background: isDark ? t.surface1 : 'rgba(239,233,240,0.6)',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 12,
    border: `1px solid ${isDark ? t.glassBorder : 'rgba(83,42,86,0.10)'}`,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: t.textTer, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5,
  }

  return (
    <Modal
      title={
        <Space>
          <Tag color={sc.color} icon={sc.icon}>{sc.label}</Tag>
          <Text strong style={{ fontSize: 15 }}>#{task.id} {task.name}</Text>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={1100}
      styles={{ body: { height: '75vh', padding: 0, overflow: 'hidden' } }}
    >
      <div style={{ display: 'flex', height: '100%' }}>
        {/* ── 左栏：任务信息 ── */}
        <div style={{ flex: '0 0 480px', overflowY: 'auto', padding: '16px 20px', borderRight: `1px solid ${t.glassBorder}` }}>
          {/* 时间线 */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>时间线</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 16px' }}>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>创建</Text>
                <div className="ph-mono" style={{ fontSize: 12, color: t.text }}>{dayjs(task.created_at).format('YYYY-MM-DD HH:mm:ss')}</div>
              </div>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>开始</Text>
                <div className="ph-mono" style={{ fontSize: 12, color: t.text }}>
                  {task.started_at ? dayjs(task.started_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
                </div>
              </div>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>结束</Text>
                <div className="ph-mono" style={{ fontSize: 12, color: t.text }}>
                  {task.finished_at ? dayjs(task.finished_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
                </div>
              </div>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>等待</Text>
                <div className="ph-mono" style={{ fontSize: 12, color: ph.purple400 }}>
                  {formatWait(task.created_at, task.started_at)}
                </div>
              </div>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>执行耗时</Text>
                <div className="ph-mono" style={{ fontSize: 12, color: task.status === 'completed' ? ph.green500 : task.status === 'failed' ? ph.error : t.text }}>
                  {formatDuration(task.started_at, task.finished_at)}
                </div>
              </div>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>退出码</Text>
                <div className="ph-mono" style={{ fontSize: 12, color: task.exit_code === 0 ? ph.green500 : task.exit_code != null ? ph.error : t.textTer }}>
                  {task.exit_code ?? '-'}
                </div>
              </div>
            </div>
          </div>

          {/* 归属信息 */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>归属</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 16px' }}>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>流水线</Text>
                <div style={{ fontSize: 12, color: t.text }}>{task.pipeline_name || '未分配'}</div>
              </div>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>机器</Text>
                <div style={{ fontSize: 12, color: t.text }}>{task.machine_name || (task.machine_id ? `机器#${task.machine_id}` : '本地')}</div>
              </div>
              <div>
                <Text style={{ fontSize: 11, color: t.textTer }}>PID</Text>
                <div className="ph-mono" style={{ fontSize: 12, color: t.text }}>{task.pid ?? '-'}</div>
              </div>
              {task.assigned_gpu_ids && task.assigned_gpu_ids.length > 0 && (
                <div>
                  <Text style={{ fontSize: 11, color: t.textTer }}>分配 GPU</Text>
                  <div>
                    {task.assigned_gpu_ids.map((g) => (
                      <Tag key={g} color="purple" style={{ margin: '2px 4px 2px 0', fontSize: 11 }}>GPU {g}</Tag>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 执行配置 */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>执行配置</div>
            <Descriptions size="small" column={1} labelStyle={{ fontSize: 11, color: t.textTer, width: 70 }} contentStyle={{ fontSize: 12 }}>
              {config.work_dir && (
                <Descriptions.Item label="工作目录">
                  <Space size={4}>
                    <Text className="ph-mono" style={{ fontSize: 11, color: t.textCode }}>{config.work_dir}</Text>
                    <Tooltip title="复制"><Button type="text" size="small" icon={<CopyOutlined style={{ fontSize: 11 }} />} onClick={() => copyText(config.work_dir!)} /></Tooltip>
                  </Space>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="命令">
                <Space size={4}>
                  <Text className="ph-mono" style={{ fontSize: 11, color: t.textCode, wordBreak: 'break-all' }}>{cmdSummary}</Text>
                  <Tooltip title="复制"><Button type="text" size="small" icon={<CopyOutlined style={{ fontSize: 11 }} />} onClick={() => copyText(cmdSummary)} /></Tooltip>
                </Space>
              </Descriptions.Item>
              {args.length > 0 && (
                <Descriptions.Item label="参数">
                  <Space direction="vertical" size={2}>
                    {args.map((a, i) => (
                      <Space key={i} size={4}>
                        {a.name && <Text className="ph-mono" style={{ fontSize: 11, color: t.textSec }}>{a.name}</Text>}
                        <Text className="ph-mono" style={{ fontSize: 11, color: t.textCode }}>{a.value}</Text>
                      </Space>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
              {Object.keys(envVars).length > 0 && (
                <Descriptions.Item label="环境变量">
                  <Space wrap size={4}>
                    {Object.entries(envVars).map(([k, v]) => (
                      <Tag key={k} style={{ fontSize: 11, cursor: 'pointer' }} onClick={() => copyText(`${k}=${v}`)}>{k}={v}</Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>

          {/* 实际执行命令 */}
          {task.rendered_command && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={labelStyle}>实际执行命令</span>
                <Tooltip title="复制">
                  <Button type="text" size="small" icon={<CopyOutlined style={{ fontSize: 11 }} />} onClick={() => copyText(task.rendered_command!)} />
                </Tooltip>
              </div>
              <pre className="ph-terminal" style={{ margin: 0, padding: '8px 12px', fontSize: 11, maxHeight: 120, overflow: 'auto' }}>
                {task.rendered_command}
              </pre>
            </div>
          )}

          {/* GPU 条件 */}
          {gpuCond && (
            <div style={sectionStyle}>
              <div style={{ ...labelStyle, marginBottom: 8 }}>GPU 抢卡条件</div>
              <Space wrap size={6}>
                <Tag color="purple" icon={<ExperimentOutlined />}>
                  {gpuCond.mode === 'force' ? '强制选卡' : '智能抢卡'}
                </Tag>
                {gpuCond.mode === 'force' && gpuCond.gpu_ids && gpuCond.gpu_ids.length > 0 && (
                  <Text style={{ fontSize: 11, color: t.textSec }}>指定 GPU: {gpuCond.gpu_ids.join(', ')}</Text>
                )}
                {gpuCond.mode === 'smart' && (
                  <>
                    {gpuCond.min_gpus && <Tag>最少 {gpuCond.min_gpus} 张</Tag>}
                    {gpuCond.idle_minutes && <Tag>空闲 {gpuCond.idle_minutes} 分钟</Tag>}
                    {(gpuCond.conditions || []).map((c, i) => (
                      <Tag key={i}>{c.type} {c.op} {c.value}</Tag>
                    ))}
                    {gpuCond.condition_expr && (
                      <Text className="ph-mono" style={{ fontSize: 11, color: t.textCode }}>{gpuCond.condition_expr}</Text>
                    )}
                  </>
                )}
              </Space>
            </div>
          )}

          {/* 错误信息 */}
          {meta.error && (
            <div style={{ ...sectionStyle, borderColor: 'rgba(224,83,99,0.25)', background: isDark ? 'rgba(224,83,99,0.06)' : 'rgba(224,83,99,0.06)' }}>
              <div style={{ ...labelStyle, marginBottom: 6, color: ph.error }}>错误信息</div>
              <Text style={{ fontSize: 12, color: ph.error }}>{meta.error}</Text>
            </div>
          )}
        </div>

        {/* ── 右栏：日志 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px 16px' }}>
          {logsLoading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin tip="加载日志..." />
            </div>
          ) : logsLoaded ? (
            <Tabs
              size="small"
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              items={[
                {
                  key: 'stdout', label: 'stdout',
                  children: (
                    <pre className="ph-terminal" style={{ margin: 0, flex: 1, height: 0, minHeight: 'calc(75vh - 100px)' }}>
                      {logsContent.stdout || '（无输出）'}
                    </pre>
                  ),
                },
                {
                  key: 'stderr', label: 'stderr',
                  children: (
                    <pre className="ph-terminal" style={{ margin: 0, flex: 1, height: 0, minHeight: 'calc(75vh - 100px)' }}>
                      {logsContent.stderr || '（无输出）'}
                    </pre>
                  ),
                },
              ]}
              tabBarExtraContent={
                <Space>
                  {logsContent.truncated && <Tag color="orange">已截断</Tag>}
                  <Button type="link" size="small" icon={<DownloadOutlined />}
                    href={tasksApi.getLogDownloadUrl(task.id, 'stdout')} target="_blank">stdout</Button>
                  <Button type="link" size="small" icon={<DownloadOutlined />}
                    href={tasksApi.getLogDownloadUrl(task.id, 'stderr')} target="_blank">stderr</Button>
                </Space>
              }
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, color: t.textTer }}>日志加载失败</Text>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
