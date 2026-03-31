import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Table, Button, Tag, Space, Select, Modal, Spin, Tooltip, message,
  Typography, Tabs, Input,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ReloadOutlined, RedoOutlined, SearchOutlined, LoadingOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { tasksApi, HistoryTask, TaskStatus } from '../api/tasks'
import { machinesApi, Machine } from '../api/machines'
import TaskCreateModal from '../components/TaskCreateModal'
import TaskDetailModal from '../components/TaskDetailModal'
import { ph } from '../theme/tokens'
import { useTheme } from '../theme/useTheme'
import { useLocation } from 'react-router-dom'

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
const PAGE_SIZE = 30

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '-'
  const secs = dayjs(end).diff(dayjs(start), 'second')
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60}s`
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`
}

function formatWait(created?: string | null, started?: string | null): string {
  if (!created || !started) return '-'
  const secs = dayjs(started).diff(dayjs(created), 'second')
  if (secs < 1) return '<1s'
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60}s`
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`
}

export default function HistoryPage() {
  const { t } = useTheme()
  const location = useLocation()
  const [tasks, setTasks] = useState<HistoryTask[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('')
  const [searchName, setSearchName] = useState('')
  const [machineFilter, setMachineFilter] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [machines, setMachines] = useState<Machine[]>([])
  const sentinelRef = useRef<HTMLDivElement>(null)
  // ref 防止并发加载 & 跨闭包共享最新状态
  const scrollState = useRef({ busy: false, hasMore: true, offset: 0, total: 0 })

  // 详情弹窗
  const [detailTask, setDetailTask] = useState<HistoryTask | null>(null)

  // 重跑
  const [rerunTask, setRerunTask] = useState<HistoryTask | null>(null)
  const [rerunPipelines, setRerunPipelines] = useState<any[]>([])

  // 首次加载 / 筛选变化时重置
  const load = useCallback(async () => {
    setLoading(true)
    scrollState.current = { busy: true, hasMore: true, offset: 0, total: 0 }
    try {
      const [tasksRes, totalRes, mRes] = await Promise.all([
        tasksApi.listHistory({
          limit: PAGE_SIZE,
          offset: 0,
          status_filter: statusFilter || undefined,
        }),
        tasksApi.historyCount(statusFilter ? { status_filter: statusFilter } : undefined),
        machinesApi.list(),
      ])
      const count = totalRes.data.count
      setTasks(tasksRes.data)
      setTotal(count)
      setMachines(mRes.data.machines)
      scrollState.current = {
        busy: false,
        hasMore: tasksRes.data.length < count,
        offset: tasksRes.data.length,
        total: count,
      }
    } catch { message.error('加载失败') }
    finally { setLoading(false); scrollState.current.busy = false }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  // 加载更多
  const loadMore = useCallback(async () => {
    const st = scrollState.current
    if (st.busy || !st.hasMore) return
    st.busy = true
    setLoadingMore(true)
    try {
      const res = await tasksApi.listHistory({
        limit: PAGE_SIZE,
        offset: st.offset,
        status_filter: statusFilter || undefined,
      })
      const newTasks = res.data
      setTasks((prev) => [...prev, ...newTasks])
      st.offset += newTasks.length
      st.hasMore = st.offset < st.total
    } catch { message.error('加载失败') }
    finally { st.busy = false; setLoadingMore(false) }
  }, [statusFilter])

  // IntersectionObserver 触发加载更多
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  // 处理 URL 中的 ?task=ID 参数，自动打开对应任务详情
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const taskId = params.get('task')
    if (taskId && !loading) {
      const found = tasks.find((t) => t.id === Number(taskId))
      if (found) {
        setDetailTask(found)
      } else {
        tasksApi.getTaskDetail(Number(taskId)).then((res) => {
          setDetailTask(res.data)
        }).catch(() => {
          message.warning('未找到该任务')
        })
      }
    }
  }, [location.search, loading])

  const displayTasks = tasks.filter((task) => {
    const nameOk = !searchName || task.name.toLowerCase().includes(searchName.toLowerCase())
    const machineOk = machineFilter === null || task.machine_id === machineFilter
    return nameOk && machineOk
  })

  async function handleRerun(task: HistoryTask, e: React.MouseEvent) {
    e.stopPropagation()
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

  const columns: ColumnsType<HistoryTask> = [
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 55,
      render: (id) => <Text className="ph-mono" style={{ fontSize: 11, color: t.textTer }}>#{id}</Text>,
    },
    {
      title: '任务名', dataIndex: 'name', key: 'name', width: 150, ellipsis: true,
      render: (name) => <Text strong style={{ fontSize: 13, color: t.text }}>{name}</Text>,
    },
    {
      title: '流水线', key: 'pipeline', width: 100, ellipsis: true,
      render: (_, r) => (
        <Text style={{ fontSize: 12, color: r.pipeline_name ? t.textSec : t.textTer }}>
          {r.pipeline_name || '-'}
        </Text>
      ),
    },
    {
      title: '机器', key: 'machine', width: 100, ellipsis: true,
      render: (_, r) => <Text style={{ color: t.textSec, fontSize: 12 }}>{r.machine_name || '本地'}</Text>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: TaskStatus) => {
        const sc = STATUS_CONFIG[s]
        return sc ? <span className={`ph-status-pill ${sc.pillClass}`}>{sc.label}</span> : null
      },
    },
    {
      title: '命令', key: 'cmd', ellipsis: true, width: 200,
      render: (_, r) => {
        const c = r.config || {}
        const summary = c.command
          ? `${c.command} ${(c.args || []).map((a: any) => `${a.name} ${a.value}`).join(' ')}`.trim()
          : '-'
        return <Text className="ph-mono" style={{ fontSize: 11, color: t.textCode }}>{summary}</Text>
      },
    },
    {
      title: '退出码', key: 'exit_code', width: 65, align: 'center' as const,
      render: (_, r) => {
        if (r.exit_code === null) return <span style={{ color: t.textTer }}>-</span>
        const isOk = r.exit_code === 0
        return (
          <span className="ph-mono" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: '50%', fontSize: 11, fontWeight: 700,
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
      title: '等待', key: 'wait', width: 65,
      render: (_, r) => <Text className="ph-mono" style={{ fontSize: 11, color: ph.purple400 }}>{formatWait(r.created_at, r.started_at)}</Text>,
    },
    {
      title: '耗时', key: 'duration', width: 70,
      render: (_, r) => <Text className="ph-mono" style={{ fontSize: 11, color: t.textSec }}>{formatDuration(r.started_at, r.finished_at)}</Text>,
    },
    {
      title: '完成时间', key: 'finished_at', width: 120,
      render: (_, r) => <Text className="ph-mono" style={{ fontSize: 11, color: t.textSec }}>{r.finished_at ? dayjs(r.finished_at).format('MM-DD HH:mm') : '-'}</Text>,
    },
    {
      title: '', key: 'actions', width: 40,
      render: (_, r) => (
        <Tooltip title="重跑">
          <Button type="text" size="small" icon={<RedoOutlined />} onClick={(e) => handleRerun(r, e)} />
        </Tooltip>
      ),
    },
  ]

  return (
    <div className="ph-page-shell ph-page-shell--history" style={{ minHeight: '100%' }}>
      <div className="ph-page-toolbar">
        <div className="ph-page-toolbar-main">
          <div className="ph-page-rail">
            <span className="ph-page-chip ph-page-chip--accent">{loading ? '载入记录中' : `已加载 ${tasks.length} / ${total} 条`}</span>
            <span className="ph-page-chip">点击任意行查看详情</span>
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
                onChange={(v) => { setStatusFilter(v) }}
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

          <Table<HistoryTask>
            rowKey="id"
            dataSource={displayTasks}
            columns={columns}
            pagination={false}
            loading={loading}
            size="small"
            rowClassName={() => 'ph-history-row'}
            onRow={(record) => ({
              onClick: () => setDetailTask(record),
              style: { cursor: 'pointer' },
            })}
          />
          {/* 滚动加载哨兵 */}
          <div ref={sentinelRef} style={{ padding: '16px 0', textAlign: 'center' }}>
            {loadingMore && <Spin indicator={<LoadingOutlined />} size="small" />}
            {!loading && !loadingMore && tasks.length >= total && tasks.length > 0 && (
              <Text style={{ fontSize: 12, color: t.textTer }}>已加载全部 {total} 条记录</Text>
            )}
          </div>
        </div>
      </div>

      {/* 任务详情弹窗 */}
      <TaskDetailModal
        task={detailTask}
        open={detailTask !== null}
        onClose={() => setDetailTask(null)}
      />

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
