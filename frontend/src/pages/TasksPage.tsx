import { useState, useEffect, useCallback } from 'react'
import {
  Button, Card, Space, Tag, Typography, Spin, Empty, Modal, Input,
  message, Tooltip, Popconfirm, Badge, Collapse, Descriptions, Tabs,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, StopOutlined, ReloadOutlined,
  FileTextOutlined, HolderOutlined, LoadingOutlined,
} from '@ant-design/icons'
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { machinesApi, Machine } from '../api/machines'
import { tasksApi, Pipeline, Task, TaskStatus } from '../api/tasks'
import TaskCreateModal from '../components/TaskCreateModal'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const { Title, Text } = Typography

const STATUS_CONFIG: Record<TaskStatus, { color: string; label: string }> = {
  waiting:   { color: 'default',    label: '等待中' },
  running:   { color: 'processing', label: '运行中' },
  completed: { color: 'success',    label: '已完成' },
  failed:    { color: 'error',      label: '失败'   },
  cancelled: { color: 'warning',    label: '已取消' },
}

/** dnd-kit render-prop sortable wrapper */
function SortableItem({
  id, disabled = false, children,
}: {
  id: string
  disabled?: boolean
  children: (handleRef: (el: HTMLElement | null) => void, listeners: any) => React.ReactNode
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
    >
      {children(setActivatorNodeRef, listeners)}
    </div>
  )
}

export default function TasksPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [orphanTasks, setOrphanTasks] = useState<Task[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [defaultPipelineId, setDefaultPipelineId] = useState<number | null>(null)

  // 流水线管理
  const [addingPipelineColumn, setAddingPipelineColumn] = useState(false)
  const [newPipelineName, setNewPipelineName] = useState('')
  const [addingPipeline, setAddingPipeline] = useState(false)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameName, setRenameName] = useState('')

  // 日志查看 (T5/T6)
  const [logsTask, setLogsTask] = useState<Task | null>(null)
  const [logsContent, setLogsContent] = useState({ stdout: '', stderr: '', truncated: false })
  const [logsLoading, setLogsLoading] = useState(false)

  // 1s 时钟 (T3 运行耗时)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const [plRes, mRes, orphanRes] = await Promise.all([
        tasksApi.listPipelines(),
        machinesApi.list(),
        tasksApi.listOrphanedTasks(),
      ])
      setPipelines(plRes.data)
      setMachines(mRes.data.machines)
      setOrphanTasks(orphanRes.data)
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => load(true), 5000)
    return () => clearInterval(timer)
  }, [load])

  // ── 流水线操作 ─────────────────────────────────────────────────────────────

  async function handleAddPipeline() {
    if (!newPipelineName.trim()) { message.warning('请输入流水线名称'); return }
    setAddingPipeline(true)
    try {
      await tasksApi.createPipeline({ name: newPipelineName.trim() })
      setNewPipelineName('')
      setAddingPipelineColumn(false)
      load()
    } catch { message.error('创建失败') }
    finally { setAddingPipeline(false) }
  }

  async function handleRenamePipeline(id: number) {
    if (!renameName.trim()) return
    try {
      await tasksApi.updatePipeline(id, { name: renameName.trim() })
      setRenamingId(null)
      load()
    } catch { message.error('重命名失败') }
  }

  async function handleDeletePipeline(id: number) {
    try { await tasksApi.deletePipeline(id); load() }
    catch (e: any) { message.error(e.response?.data?.detail || '删除失败') }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)

    // Pipeline column reorder
    if (activeId.startsWith('pl-') && overId.startsWith('pl-')) {
      const aIdx = pipelines.findIndex((p) => `pl-${p.id}` === activeId)
      const oIdx = pipelines.findIndex((p) => `pl-${p.id}` === overId)
      if (aIdx === -1 || oIdx === -1) return
      const reordered = arrayMove(pipelines, aIdx, oIdx)
      setPipelines(reordered)
      try {
        await Promise.all(reordered.map((p, i) => tasksApi.updatePipeline(p.id, { sort_order: i })))
      } catch { message.error('调整顺序失败'); load() }
      return
    }

    // Task reorder within pipeline
    if (activeId.startsWith('tk-') && overId.startsWith('tk-')) {
      const taskActiveId = parseInt(activeId.replace('tk-', ''), 10)
      const taskOverId = parseInt(overId.replace('tk-', ''), 10)
      const ppl = pipelines.find(
        (p) => p.tasks.some((t) => t.id === taskActiveId) && p.tasks.some((t) => t.id === taskOverId),
      )
      if (!ppl) return
      const aIdx = ppl.tasks.findIndex((t) => t.id === taskActiveId)
      const oIdx = ppl.tasks.findIndex((t) => t.id === taskOverId)
      const reorderedTasks = arrayMove(ppl.tasks, aIdx, oIdx)
      setPipelines((prev) => prev.map((p) => p.id === ppl.id ? { ...p, tasks: reorderedTasks } : p))
      try {
        await Promise.all(reorderedTasks.map((t, i) => tasksApi.updateTask(t.id, { sort_order: i })))
      } catch { message.error('调整顺序失败'); load() }
    }
  }

  // ── 任务操作 ───────────────────────────────────────────────────────────────

  async function handleCreateTask(data: any) { await tasksApi.createTask(data); load() }
  async function handleEditTask(data: any) {
    if (!editTask) return
    await tasksApi.updateTask(editTask.id, data)
    setEditTask(null); load()
  }
  async function handleDeleteTask(taskId: number) {
    try { await tasksApi.deleteTask(taskId); load() }
    catch (e: any) { message.error(e.response?.data?.detail || '删除失败') }
  }
  async function handleCancelTask(taskId: number) {
    try { await tasksApi.cancelTask(taskId); load() }
    catch (e: any) { message.error(e.response?.data?.detail || '取消失败') }
  }
  async function handleViewLogs(task: Task) {
    setLogsTask(task)
    setLogsLoading(true)
    setLogsContent({ stdout: '', stderr: '', truncated: false })
    try {
      const res = await tasksApi.getLogs(task.id)
      setLogsContent(res.data)
    } catch { message.error('获取日志失败') }
    finally { setLogsLoading(false) }
  }

  // ── 渲染 ───────────────────────────────────────────────────────────────────

  function getMachineName(machineId: number | null) {
    if (!machineId) return '未指定'
    return machines.find((m) => m.id === machineId)?.name || `机器${machineId}`
  }

  function getElapsed(task: Task): string | null {
    void tick  // trigger re-render each second
    if (task.status !== 'running' || !task.started_at) return null
    const secs = dayjs().diff(dayjs(task.started_at), 'second')
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  function renderTaskCard(
    task: Task,
    pipeline: Pipeline | null,
    dragHandleRef?: (el: HTMLElement | null) => void,
    dragListeners?: any,
  ) {
    const sc = STATUS_CONFIG[task.status]
    const config = task.config || {}
    const cmdPreview = config.command
      ? `${config.command} ${(config.args || []).map((a) => `${a.name} ${a.value}`).join(' ')}`
      : '无命令'

    const elapsed = getElapsed(task)
    const duration =
      task.started_at && task.finished_at
        ? `${dayjs(task.finished_at).diff(dayjs(task.started_at), 'second')}s`
        : null

    return (
      <Card
        key={task.id}
        size="small"
        style={{
          marginBottom: 8,
          borderLeft: `3px solid ${sc.color === 'processing' ? '#75c181' : 'transparent'}`,
        }}
        styles={{ body: { padding: '8px 12px' } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Space size={4} align="center">
            {task.status === 'waiting' && dragHandleRef && (
              <span
                ref={dragHandleRef}
                {...dragListeners}
                style={{ cursor: 'grab', color: '#bbb', lineHeight: 1, marginTop: 1 }}
              >
                <HolderOutlined />
              </span>
            )}
            <Badge status={sc.color as any} />
            <Text strong style={{ fontSize: 13 }}>{task.name}</Text>
            {elapsed && (
              <Text type="secondary" style={{ fontSize: 11 }}>⏱ {elapsed}</Text>
            )}
          </Space>
          <Space size={2}>
            {(task.status === 'waiting' || task.status === 'running') && (
              <Tooltip title="取消">
                <Popconfirm title="确认取消该任务？" onConfirm={() => handleCancelTask(task.id)}>
                  <Button type="text" size="small" icon={<StopOutlined />} danger />
                </Popconfirm>
              </Tooltip>
            )}
            {task.status === 'waiting' && (
              <>
                <Tooltip title="编辑">
                  <Button
                    type="text" size="small" icon={<EditOutlined />}
                    onClick={() => { setEditTask(task); setCreateModalOpen(true) }}
                  />
                </Tooltip>
                <Tooltip title="删除">
                  <Popconfirm title="确认删除该任务？" onConfirm={() => handleDeleteTask(task.id)}>
                    <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                  </Popconfirm>
                </Tooltip>
              </>
            )}
            {(task.status === 'completed' || task.status === 'failed') && (
              <Tooltip title="查看日志">
                <Button
                  type="text" size="small" icon={<FileTextOutlined />}
                  onClick={() => handleViewLogs(task)}
                />
              </Tooltip>
            )}
          </Space>
        </div>

        {/* T4: Always-visible command summary */}
        <div style={{ marginTop: 3, fontSize: 11 }}>
          <Text code style={{ fontSize: 11, color: '#555', wordBreak: 'break-all' }}>{cmdPreview}</Text>
        </div>

        <div style={{ marginTop: 4 }}>
          <Tag color={sc.color as any}>{sc.label}</Tag>
          <Text type="secondary" style={{ fontSize: 11 }}>{getMachineName(task.machine_id)}</Text>
          {task.assigned_gpu_ids && task.assigned_gpu_ids.length > 0 && (
            <Tag color="purple" style={{ marginLeft: 4, fontSize: 10 }}>
              GPU {task.assigned_gpu_ids.join(',')}
            </Tag>
          )}
        </div>

        <Collapse
          ghost size="small"
          items={[{
            key: '1',
            label: <Text type="secondary" style={{ fontSize: 11 }}>详情</Text>,
            children: (
              <Descriptions size="small" column={1} style={{ fontSize: 11 }}>
                {config.work_dir && (
                  <Descriptions.Item label="目录">
                    <Text type="secondary" style={{ fontSize: 11 }}>{config.work_dir}</Text>
                  </Descriptions.Item>
                )}
                {duration && <Descriptions.Item label="耗时">{duration}</Descriptions.Item>}
                {task.exit_code !== null && (
                  <Descriptions.Item label="退出码">
                    <Tag color={task.exit_code === 0 ? 'success' : 'error'}>{task.exit_code}</Tag>
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="创建时间">
                  {dayjs(task.created_at).format('MM-DD HH:mm')}
                </Descriptions.Item>
              </Descriptions>
            ),
          }]}
        />
      </Card>
    )
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 112px)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Title level={5} style={{ margin: 0 }}>任务队列</Title>
          <Tooltip title="刷新">
            <Button
              icon={refreshing ? <LoadingOutlined spin /> : <ReloadOutlined />}
              onClick={() => load(true)} size="small"
            />
          </Tooltip>
        </Space>
      </div>

      {/* 流水线看板 */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={pipelines.map((p) => `pl-${p.id}`)}
          strategy={horizontalListSortingStrategy}
        >
          <div style={{ flex: 1, display: 'flex', gap: 16, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 8 }}>
            {pipelines.length === 0 && !addingPipelineColumn && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="暂无流水线" />
              </div>
            )}

            {pipelines.map((pipeline) => (
              <SortableItem key={pipeline.id} id={`pl-${pipeline.id}`}>
                {(plHandleRef, plListeners) => (
                  <div
                    style={{
                      width: 320, minWidth: 320, display: 'flex', flexDirection: 'column',
                      background: '#faf5f9', border: '1px solid #ecdbea',
                      borderRadius: 8, padding: 12, flexShrink: 0, height: '100%',
                    }}
                  >
                    {/* 列标题 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Space size={4}>
                        <span
                          ref={plHandleRef}
                          {...plListeners}
                          style={{ cursor: 'grab', color: '#bbb', lineHeight: 1 }}
                        >
                          <HolderOutlined />
                        </span>
                        {renamingId === pipeline.id ? (
                          <Space.Compact size="small">
                            <Input
                              value={renameName}
                              onChange={(e) => setRenameName(e.target.value)}
                              onPressEnter={() => handleRenamePipeline(pipeline.id)}
                              autoFocus size="small" style={{ width: 120 }}
                            />
                            <Button size="small" onClick={() => handleRenamePipeline(pipeline.id)}>确认</Button>
                            <Button size="small" onClick={() => setRenamingId(null)}>取消</Button>
                          </Space.Compact>
                        ) : (
                          <Text strong style={{ fontSize: 14 }}>{pipeline.name}</Text>
                        )}
                      </Space>
                      <Space size={2}>
                        <Tooltip title="重命名">
                          <Button
                            type="text" size="small" icon={<EditOutlined />}
                            onClick={() => { setRenamingId(pipeline.id); setRenameName(pipeline.name) }}
                          />
                        </Tooltip>
                        <Tooltip title="删除（流水线为空时可删）">
                          <Popconfirm
                            title="确认删除该流水线？" onConfirm={() => handleDeletePipeline(pipeline.id)}
                          >
                            <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                          </Popconfirm>
                        </Tooltip>
                      </Space>
                    </div>

                    {/* 任务列表 */}
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      <SortableContext
                        items={pipeline.tasks.filter((t) => t.status === 'waiting').map((t) => `tk-${t.id}`)}
                        strategy={verticalListSortingStrategy}
                      >
                        {pipeline.tasks.length === 0 ? (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" style={{ margin: '24px 0' }} />
                        ) : (
                          pipeline.tasks.map((task) =>
                            task.status === 'waiting' ? (
                              <SortableItem key={task.id} id={`tk-${task.id}`}>
                                {(hRef, hListeners) => renderTaskCard(task, pipeline, hRef, hListeners)}
                              </SortableItem>
                            ) : (
                              renderTaskCard(task, pipeline)
                            ),
                          )
                        )}
                      </SortableContext>
                    </div>

                    {/* 新建任务 */}
                    <Button
                      type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }}
                      onClick={() => { setEditTask(null); setDefaultPipelineId(pipeline.id); setCreateModalOpen(true) }}
                    >
                      新建任务
                    </Button>
                  </div>
                )}
              </SortableItem>
            ))}

            {/* T7: Orphan column - neutral gray, no warning icon */}
            {orphanTasks.length > 0 && (
              <div
                key="orphaned"
                style={{
                  width: 320, minWidth: 320, display: 'flex', flexDirection: 'column',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  borderRadius: 8, padding: 12, flexShrink: 0,
                }}
              >
                <Text strong style={{ fontSize: 14, marginBottom: 10, display: 'block', color: '#6b7280' }}>
                  无流水线
                </Text>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {orphanTasks.map((task) => renderTaskCard(task, null))}
                </div>
              </div>
            )}

            {/* T1: New pipeline dashed column at end */}
            {addingPipelineColumn ? (
              <div
                style={{
                  width: 300, minWidth: 300, border: '2px dashed #bc73ad',
                  borderRadius: 8, padding: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'flex-start',
                }}
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    autoFocus
                    value={newPipelineName}
                    onChange={(e) => setNewPipelineName(e.target.value)}
                    onPressEnter={handleAddPipeline}
                    placeholder="流水线名称"
                    size="small"
                  />
                  <Button size="small" onClick={handleAddPipeline} loading={addingPipeline}>确认</Button>
                  <Button size="small" onClick={() => { setAddingPipelineColumn(false); setNewPipelineName('') }}>取消</Button>
                </Space.Compact>
              </div>
            ) : (
              <div
                style={{
                  width: 200, minWidth: 200, border: '2px dashed #ddb8d5',
                  borderRadius: 8, padding: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#bc73ad',
                }}
                onClick={() => setAddingPipelineColumn(true)}
              >
                <Space><PlusOutlined />新建流水线</Space>
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* 任务创建/编辑弹窗 */}
      <TaskCreateModal
        open={createModalOpen}
        onClose={() => { setCreateModalOpen(false); setEditTask(null) }}
        onSubmit={editTask ? handleEditTask : handleCreateTask}
        pipelines={pipelines}
        machines={machines}
        initialTask={editTask}
        defaultPipelineId={editTask ? undefined : defaultPipelineId}
      />

      {/* T5/T6: 日志弹窗 - Tabs + task name title */}
      <Modal
        title={logsTask ? `日志 · ${logsTask.name}` : '日志'}
        open={logsTask !== null}
        onCancel={() => setLogsTask(null)}
        footer={null}
        width={800}
      >
        {logsLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <>
            {logsContent.truncated && (
              <Tag color="orange" style={{ marginBottom: 8 }}>日志已截断，完整内容请下载</Tag>
            )}
            <Tabs
              items={[
                {
                  key: 'stdout', label: 'stdout',
                  children: (
                    <pre style={{
                      background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6,
                      height: 400, overflow: 'auto', fontSize: 12, margin: 0,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {logsContent.stdout || '（无输出）'}
                    </pre>
                  ),
                },
                {
                  key: 'stderr', label: 'stderr',
                  children: (
                    <pre style={{
                      background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6,
                      height: 400, overflow: 'auto', fontSize: 12, margin: 0,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {logsContent.stderr || '（无输出）'}
                    </pre>
                  ),
                },
              ]}
              tabBarExtraContent={
                logsTask && (
                  <Space>
                    <Button type="link" size="small"
                      href={tasksApi.getLogDownloadUrl(logsTask.id, 'stdout')} target="_blank">
                      下载 stdout
                    </Button>
                    <Button type="link" size="small"
                      href={tasksApi.getLogDownloadUrl(logsTask.id, 'stderr')} target="_blank">
                      下载 stderr
                    </Button>
                  </Space>
                )
              }
            />
          </>
        )}
      </Modal>
    </div>
  )
}
