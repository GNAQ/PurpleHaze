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

dayjs.locale('zh-cn')

const { Text } = Typography
const { Option } = Select

const STATUS_CONFIG: Record<TaskStatus, { color: string; label: string }> = {
  waiting:   { color: 'default',   label: '等待中' },
  running:   { color: 'processing', label: '运行中' },
  completed: { color: 'success',   label: '已完成' },
  failed:    { color: 'error',     label: '失败' },
  cancelled: { color: 'warning',   label: '已取消' },
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
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('')
  const [searchName, setSearchName] = useState('')
  const [machineFilter, setMachineFilter] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [machines, setMachines] = useState<Machine[]>([])

  // 日志弹窗
  const [logsTaskId, setLogsTaskId] = useState<number | null>(null)
  const [logsContent, setLogsContent] = useState({ stdout: '', stderr: '', truncated: false })
  const [logsTab, setLogsTab] = useState<'stdout' | 'stderr'>('stdout')
  const [logsLoading, setLogsLoading] = useState(false)

  // 重跑弹窗
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

  // 命令摘要
  function cmdSummary(task: Task): string {
    const c = task.config || {}
    const args = (c.args || []).map((a: any) => `${a.name} ${a.value}`).join(' ')
    return [c.command, args].filter(Boolean).join(' ') || '-'
  }

  // 渲染单个参数值（路径类型带复制/打开）
  function renderArgValue(value: string, isLocal: boolean) {
    const isPath = value.startsWith('/') || value.startsWith('~') || value.startsWith('./')
    return (
      <Space size={2}>
        <Text code style={{ fontSize: 11 }}>{value}</Text>
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
      render: (name) => <Text strong style={{ fontSize: 13 }}>{name}</Text>,
    },
    {
      title: '机器', key: 'machine', width: 100,
      render: (_, r) => <Text type="secondary">{getMachineName(r.machine_id)}</Text>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: TaskStatus) => <Tag color={STATUS_CONFIG[s]?.color}>{STATUS_CONFIG[s]?.label}</Tag>,
    },
    {
      title: '命令摘要', key: 'cmd', ellipsis: true, width: 220,
      render: (_, r) => (
        <Text code style={{ fontSize: 11 }}>{cmdSummary(r)}</Text>
      ),
    },
    {
      title: '退出码', key: 'exit_code', width: 80,
      render: (_, r) => r.exit_code !== null
        ? <Tag color={r.exit_code === 0 ? 'success' : 'error'}>{r.exit_code}</Tag>
        : '-',
    },
    {
      title: '开始时间', key: 'started_at', width: 130,
      render: (_, r) => r.started_at ? dayjs(r.started_at).format('MM-DD HH:mm') : '-',
    },
    {
      title: '耗时', key: 'duration', width: 80,
      render: (_, r) => formatDuration(r.started_at, r.finished_at),
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
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
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

      <Table<Task>
        rowKey="id"
        dataSource={displayTasks}
        columns={columns}
        pagination={pagination}
        loading={loading}
        size="small"
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
                          <Text type="secondary" style={{ fontSize: 11 }}>{a.name}</Text>
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
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
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
              <pre style={{
                background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6,
                height: 400, overflow: 'auto', fontSize: 12, margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
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
