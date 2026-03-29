import { useState, useEffect, useCallback } from 'react'
import {
  Table, Button, Tag, Space, Select, Modal, Spin, Tooltip, message,
  Typography, Descriptions, Tabs, Input,
} from 'antd'
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'
import {
  ReloadOutlined, FileTextOutlined, RedoOutlined, CopyOutlined, FolderOpenOutlined, SearchOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { tasksApi, Task, TaskStatus } from '../api/tasks'
import { machinesApi, Machine } from '../api/machines'
import TaskCreateModal from '../components/TaskCreateModal'
import { ph } from '../theme/tokens'
import { useTheme } from '../theme/useTheme'

dayjs.locale('zh-cn')

const { Text } = Typography
const { Option } = Select

const STATUS_CONFIG: Record<TaskStatus, { color: string; label: string; pillClass: string }> = {
  waiting:   { color: 'default',    label: '等待中', pillClass: 'ph-status-waiting' },
  running:   { color: 'processing', label: '运行中', pillClass: 'ph-status-running' },
  completed: { color: 'success',    label: '已完成', pillClass: 'ph-status-completed' },
  failed:    { color: 'error',      label: '失败',   pillClass: 'ph-status-failed' },
  cancelled: { color: 'warning',    label: '已取消', pillClass: 'ph-status-cancelled' },
}

const HISTORY_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled']
const PAGE_SIZE = 20

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '-'
  const secs = dayjs(end).diff(dayjs(start), 'second')
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60}s`
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`
}

export default function HistoryPage() {
  const { t } = useTheme()
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('')
  const [searchName, setSearchName] = useState('')
  const [machineFilter, setMachineFilter] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [machines, setMachines] = useState<Machine[]>([])

  const [logsTaskId, setLogsTaskId] = useState<number | null>(null)
  const [logsContent, setLogsContent] = useState({ stdout: '', stderr: '', truncated: false })
  const [logsTab, setLogsTab] = useState<'stdout' | 'stderr'>('stdout')
  const [logsLoading, setLogsLoading] = useState(false)

  const [rerunTask, setRerunTask] = useState<Task | null>(null)
  const [rerunPipelines, setRerunPipelines] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tasksRes, totalRes, mRes] = await Promise.all([
        tasksApi.listHistory({
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          status_filter: statusFilter || undefined,
        }),
        tasksApi.historyCount(statusFilter ? { status_filter: statusFilter } : undefined),
        machinesApi.list(),
      ])
      setTasks(tasksRes.data)
      setTotal(totalRes.data.count)
      setMachines(mRes.data.machines)
    } catch { message.error('加载失败') }
    finally { setLoading(false) }
  }, [page, statusFilter])

  useEffect(() => { load() }, [load])

  const displayTasks = tasks.filter((t) => {
    const nameOk = !searchName || t.name.toLowerCase().includes(searchName.toLowerCase())
    const machineOk = machineFilter === null || t.machine_id === machineFilter
    return nameOk && machineOk
  })

  function getMachineName(machineId: number | null) {
    if (!machineId) return '本地'
    return machines.find((m) => m.id === machineId)?.name || `机器${machineId}`
  }

  async function handleViewLogs(taskId: number) {
    setLogsTaskId(taskId)
    setLogsTab('stdout')
    setLogsLoading(true)
    setLogsContent({ stdout: '', stderr: '', truncated: false })
    try {
      const res = await tasksApi.getLogs(taskId)
      setLogsContent(res.data)
    } catch { message.error('获取日志失败') }
    finally { setLogsLoading(false) }
  }

  async function handleRerun(task: Task) {
    try {
      const res = await tasksApi.listPipelines()
      setRerunPipelines(res.data)
    } catch {}
    setRerunTask(task)
  }

  async function handleRerunSubmit(data: any) {
    await tasksApi.createTask(data)
    setRerunTask(null)
    message.success('已重新提交任务')
  }

  function cmdSummary(task: Task): string {
    const c = task.config || {}
    const args = (c.args || []).map((a: any) => `${a.name} ${a.value}`).join(' ')
    return [c.command, args].filter(Boolean).join(' ') || '-'
  }

  function renderArgValue(value: string, isLocal: boolean) {
    const isPath = value.startsWith('/') || value.startsWith('~') || value.startsWith('./')
    return (
      <Space size={2}>
        <Text className="ph-mono" style={{ fontSize: 11, color: t.textCode }}>{value}</Text>
        {isPath && (
          <Tooltip title="复制路径">
            <Button
              type="text" size="small" icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(value); message.success('已复制') }}
            />
          </Tooltip>
        )}
        {isPath && isLocal && (
          <Tooltip title="在系统文件管理器中打开">
            <Button
              type="text" size="small" icon={<FolderOpenOutlined />}
              onClick={async () => {
                const dir = value.endsWith('/') ? value : value.split('/').slice(0, -1).join('/')
                try {
                  await tasksApi.openPath(dir)
                  message.success('已在文件管理器中打开')
                } catch {
                  message.error('打开失败，请确认后端运行于本机')
                }
              }}
            />
          </Tooltip>
        )}
      </Space>
    )
  }

  const columns: ColumnsType<Task> = [
    {
      title: '任务名', dataIndex: 'name', key: 'name', width: 160,
      render: (name) => <Text strong style={{ fontSize: 13, color: t.text }}>{name}</Text>,
    },
    {
      title: '机器', key: 'machine', width: 100,
      render: (_, r) => <Text style={{ color: t.textSec }}>{getMachineName(r.machine_id)}</Text>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: TaskStatus) => {
        const sc = STATUS_CONFIG[s]
        return sc ? <span className={`ph-status-pill ${sc.pillClass}`}>{sc.label}</span> : null
      },
    },
    {
      title: '命令摘要', key: 'cmd', ellipsis: true, width: 220,
      render: (_, r) => <Text className="ph-mono" style={{ fontSize: 11, color: t.textCode }}>{cmdSummary(r)}</Text>,
    },
    {
      title: '退出码', key: 'exit_code', width: 80,
      render: (_, r) => {
        if (r.exit_code === null) return <span style={{ color: t.textTer }}>-</span>
        const isOk = r.exit_code === 0
        return (
          <span className="ph-mono" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%', fontSize: 11, fontWeight: 700,
            background: isOk ? 'rgba(117,193,129,0.12)' : 'rgba(224,83,99,0.12)',
            color: isOk ? ph.green500 : ph.error,
            border: `1px solid ${isOk ? 'rgba(117,193,129,0.25)' : 'rgba(224,83,99,0.25)'}`,
          }}>
            {r.exit_code}
          </span>
        )
      },
    },
    {
      title: '开始时间', key: 'started_at', width: 130,
      render: (_, r) => <Text className="ph-mono" style={{ fontSize: 11, color: t.textSec }}>{r.started_at ? dayjs(r.started_at).format('MM-DD HH:mm') : '-'}</Text>,
    },
    {
      title: '耗时', key: 'duration', width: 80,
      render: (_, r) => <Text className="ph-mono" style={{ fontSize: 11, color: t.textSec }}>{formatDuration(r.started_at, r.finished_at)}</Text>,
    },
    {
      title: '操作', key: 'actions', width: 90,
      render: (_, r) => (
        <Space>
          <Tooltip title="查看日志">
            <Button type="text" icon={<FileTextOutlined />} onClick={() => handleViewLogs(r.id)} />
          </Tooltip>
          <Tooltip title="重跑">
            <Button type="text" icon={<RedoOutlined />} onClick={() => handleRerun(r)} />
          </Tooltip>
        </Space>
      ),
    },
  ]

  const pagination: TablePaginationConfig = {
    current: page, pageSize: PAGE_SIZE, total,
    showTotal: (t) => `共 ${t} 条`,
    onChange: (p) => setPage(p),
    showSizeChanger: false,
  }

  return (
    <div className="ph-page-shell ph-page-shell--history" style={{ minHeight: '100%' }}>
      <div className="ph-page-toolbar">
        <div className="ph-page-toolbar-main">
          <div className="ph-page-rail">
            <span className="ph-page-chip ph-page-chip--accent">{loading ? '载入记录中' : `共 ${total} 条记录`}</span>
            <span className="ph-page-chip">完成 / 失败 / 取消</span>
            {statusFilter && <span className="ph-page-chip">状态: {STATUS_CONFIG[statusFilter].label}</span>}
          </div>
        </div>
      </div>

      <div className="ph-page-content">
        <div className="ph-local-surface ph-ledger-surface">
          <div className="ph-surface-toolbar">
            <div className="ph-surface-toolbar-actions">
              <Input
                placeholder="搜索任务名"
                prefix={<SearchOutlined />}
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                style={{ width: 160 }}
                allowClear
              />
              <Select
                value={machineFilter ?? ''}
                onChange={(v) => setMachineFilter(v === '' ? null : (v as number))}
                style={{ width: 130 }}
              >
                <Option value="">所有机器</Option>
                {machines.map((m) => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
              </Select>
              <Select
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v); setPage(1) }}
                style={{ width: 120 }}
                placeholder="状态筛选"
              >
                <Option value="">全部</Option>
                {HISTORY_STATUSES.map((s) => (
                  <Option key={s} value={s}>{STATUS_CONFIG[s].label}</Option>
                ))}
              </Select>
              <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            </div>
          </div>

          <Table<Task>
            rowKey="id"
            dataSource={displayTasks}
            columns={columns}
            pagination={pagination}
            loading={loading}
            size="small"
            rowClassName={() => 'ph-history-row'}
            expandable={{
              expandedRowRender: (record) => {
                const c = record.config || {}
                const isLocal = !record.machine_id
                return (
                  <Descriptions size="small" column={2} style={{ fontSize: 12 }}>
                    {c.work_dir && (
                      <Descriptions.Item label="工作目录" span={2}>
                        {renderArgValue(c.work_dir, isLocal)}
                      </Descriptions.Item>
                    )}
                    {(c.args || []).length > 0 && (
                      <Descriptions.Item label="参数列表" span={2}>
                        <Space direction="vertical" size={2}>
                          {(c.args || []).map((a: any, i: number) => (
                            <Space key={i} size={4}>
                              <Text style={{ fontSize: 11, color: t.textSec }}>{a.name}</Text>
                              {renderArgValue(a.value, isLocal)}
                            </Space>
                          ))}
                        </Space>
                      </Descriptions.Item>
                    )}
                    {Object.keys(c.env_vars || {}).length > 0 && (
                      <Descriptions.Item label="环境变量" span={2}>
                        <Space wrap size={4}>
                          {Object.entries(c.env_vars || {}).map(([k, v]) => (
                            <Tag key={k}>{k}={String(v)}</Tag>
                          ))}
                        </Space>
                      </Descriptions.Item>
                    )}
                    {record.assigned_gpu_ids && record.assigned_gpu_ids.length > 0 && (
                      <Descriptions.Item label="分配GPU">
                        <Tag color="purple">GPU {record.assigned_gpu_ids.join(',')}</Tag>
                      </Descriptions.Item>
                    )}
                    {record.gpu_condition && (
                      <Descriptions.Item label="抢卡条件">
                        <Tag color="purple">
                          {record.gpu_condition.mode === 'force' ? '强制选卡' : '智能抢卡'}
                        </Tag>
                        {record.gpu_condition.mode === 'force' && (record.gpu_condition.gpu_ids || []).length > 0 && (
                          <Text style={{ fontSize: 11, marginLeft: 4, color: t.textSec }}>
                            GPU {(record.gpu_condition.gpu_ids || []).join(',')}
                          </Text>
                        )}
                      </Descriptions.Item>
                    )}
                    {record.started_at && (
                      <Descriptions.Item label="开始时间">
                        {dayjs(record.started_at).format('YYYY-MM-DD HH:mm:ss')}
                      </Descriptions.Item>
                    )}
                    {record.finished_at && (
                      <Descriptions.Item label="完成时间">
                        {dayjs(record.finished_at).format('YYYY-MM-DD HH:mm:ss')}
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                )
              },
            }}
          />
        </div>
      </div>

      {/* 日志弹窗 */}
      <Modal
        title={`任务日志 #${logsTaskId}`}
        open={logsTaskId !== null}
        onCancel={() => setLogsTaskId(null)}
        footer={null}
        width={820}
      >
        <Tabs
          activeKey={logsTab}
          onChange={(k) => setLogsTab(k as 'stdout' | 'stderr')}
          tabBarExtraContent={
            logsTaskId && (
              <Space>
                {logsContent.truncated && <Tag color="orange">已截断</Tag>}
                <Button
                  size="small" type="link"
                  href={tasksApi.getLogDownloadUrl(logsTaskId, logsTab)}
                  target="_blank"
                >
                  下载完整日志
                </Button>
              </Space>
            )
          }
          items={['stdout', 'stderr'].map((tab) => ({
            key: tab,
            label: tab,
            children: logsLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : (
              <pre className="ph-terminal" style={{ height: 400, margin: 0 }}>
                {(tab === 'stdout' ? logsContent.stdout : logsContent.stderr) || '（无输出）'}
              </pre>
            ),
          }))}
        />
      </Modal>

      {/* 重跑弹窗 */}
      {rerunTask && (
        <TaskCreateModal
          open={true}
          onClose={() => setRerunTask(null)}
          onSubmit={handleRerunSubmit}
          pipelines={rerunPipelines}
          machines={machines}
          initialTask={rerunTask}
        />
      )}
    </div>
  )
}
