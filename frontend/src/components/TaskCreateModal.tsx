/**
 * 任务创建/编辑弹窗
 * 覆盖：模板选择、机器选择、conda 环境、环境变量、工作目录、命令、参数、抢卡条件
 */
import { useState, useEffect } from 'react'
import {
  Modal, Form, Input, Select, Button, Space, Tabs, Table, InputNumber,
  Divider, message, Popconfirm, Tag, Popover, Typography,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, FolderOpenOutlined, ThunderboltOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { Machine, machinesApi } from '../api/machines'
import {
  tasksApi, TaskConfig, GpuCondition, Task, TaskTemplate, CondaEnv, Pipeline,
} from '../api/tasks'
import PathPickerModal from './PathPickerModal'
import GpuConditionDialog from './GpuConditionDialog'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    pipeline_id: number | null
    machine_id: number | null
    config: TaskConfig
    gpu_condition: GpuCondition | null
  }) => Promise<void>
  pipelines: Pipeline[]
  machines: Machine[]
  /** 编辑模式：预填任务数据 */
  initialTask?: Task | null
  /** 新建模式：预选流水线 */
  defaultPipelineId?: number | null
}

export default function TaskCreateModal({
  open, onClose, onSubmit, pipelines, machines, initialTask, defaultPipelineId,
}: Props) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null)
  const [gpuCondition, setGpuCondition] = useState<GpuCondition | null>(null)
  const [condaEnvs, setCondaEnvs] = useState<CondaEnv[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [args, setArgs] = useState<{ name: string; value: string }[]>([])
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([])
  // GPU 数量（用于抢卡选卡，跟随所选机器）
  const [gpuCount, setGpuCount] = useState(0)

  // 弹窗状态
  const [pathPickerOpen, setPathPickerOpen] = useState(false)
  const [pathPickerFor, setPathPickerFor] = useState<'work_dir'>('work_dir')
  const [argPathPickerIndex, setArgPathPickerIndex] = useState<number | null>(null)
  const [gpuDialogOpen, setGpuDialogOpen] = useState(false)
  // GPU 条件弹窗：存储表单已校验字段，等待抗卡条件确认后再提交
  const [pendingValues, setPendingValues] = useState<any>(null)

  // 模板管理
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savePopoverOpen, setSavePopoverOpen] = useState(false)

  useEffect(() => {
    if (open) {
      loadCondaEnvs()
      loadTemplates()
      if (initialTask) {
        const config = initialTask.config || {}
        setSelectedMachineId(initialTask.machine_id)
        setGpuCondition(initialTask.gpu_condition)
        const envVarList = Object.entries(config.env_vars || {}).map(([k, v]) => ({ key: k, value: v }))
        setEnvVars(envVarList)
        setArgs(config.args || [])
        form.setFieldsValue({
          name: initialTask.name,
          pipeline_id: initialTask.pipeline_id,
          machine_id: initialTask.machine_id,
          conda_env_id: config.conda_env_id,
          work_dir: config.work_dir || '',
          command: config.command || '',
        })
        // 获取该机器的 GPU 数量
        if (initialTask.machine_id) fetchGpuCount(initialTask.machine_id)
      } else {
        form.resetFields()
        setSelectedMachineId(null)
        setGpuCondition(null)
        setArgs([])
        setEnvVars([])
        setGpuCount(0)
        // 预填流水线
        if (defaultPipelineId != null) {
          form.setFieldsValue({ pipeline_id: defaultPipelineId })
        }
      }
    }
  }, [open])

  async function loadCondaEnvs() {
    try { setCondaEnvs((await tasksApi.listCondaEnvs()).data) } catch {}
  }
  async function loadTemplates() {
    try { setTemplates((await tasksApi.listTemplates()).data) } catch {}
  }
  async function fetchGpuCount(machineId: number) {
    try {
      const res = await machinesApi.getSnapshot(machineId)
      setGpuCount(res.data.gpus?.length ?? 0)
    } catch {
      setGpuCount(0)
    }
  }

  function loadFromTemplate(tpl: TaskTemplate) {
    const config = tpl.config || {}
    form.setFieldsValue({
      conda_env_id: config.conda_env_id,
      work_dir: config.work_dir || '',
      command: config.command || '',
    })
    setArgs(config.args || [])
    setEnvVars(Object.entries(config.env_vars || {}).map(([k, v]) => ({ key: k, value: v })))
    setGpuCondition(tpl.gpu_condition)
    // 同步模板中保存的 machine_id
    if (tpl.machine_id != null) {
      form.setFieldsValue({ machine_id: tpl.machine_id })
      setSelectedMachineId(tpl.machine_id)
      fetchGpuCount(tpl.machine_id)
    }
    message.success(`已加载模板: ${tpl.name}`)
  }

  async function handleSaveTemplate() {
    if (!saveTemplateName.trim()) { message.warning('请输入模板名称'); return }
    setSavingTemplate(true)
    try {
      const values = form.getFieldsValue()
      const config = buildConfig(values)
      await tasksApi.createTemplate({
        name: saveTemplateName.trim(),
        machine_id: form.getFieldValue('machine_id') ?? null,
        config,
        gpu_condition: gpuCondition,
      })
      message.success('模板已保存')
      setSaveTemplateName('')
      setSavePopoverOpen(false)
      loadTemplates()
    } catch { message.error('保存失败') }
    finally { setSavingTemplate(false) }
  }

  async function handleAddCondaEnv() {
    message.info('请到设置页管理 Conda 环境')
  }

  async function handleDeleteCondaEnv(id: number) {
    try { await tasksApi.deleteCondaEnv(id); loadCondaEnvs() }
    catch { message.error('删除失败') }
  }

  function buildConfig(values: any): TaskConfig {
    const env_vars: Record<string, string> = {}
    for (const { key, value } of envVars) {
      if (key.trim()) env_vars[key.trim()] = value
    }
    return {
      conda_env_id: values.conda_env_id || null,
      env_vars,
      work_dir: values.work_dir || '',
      command: values.command || '',
      args: args.filter((a) => a.name.trim() || a.value.trim()),
    }
  }

  async function handleSubmit() {
    let values: any
    try {
      values = await form.validateFields()
    } catch {
      return  // antd 会自行显示字段错误
    }
    // 远程机器必须已连接才能提交
    if (values.machine_id) {
      const machine = machines.find((m) => m.id === values.machine_id)
      if (machine && !machine.is_local && !machine.connected) {
        message.error(`远程机器 "${machine.name}" 未连接，请先在机器管理页面建立连接后再提交任务`)
        return
      }
    }
    // 展示抗卡条件弹窗作为提交前的第二步
    setPendingValues(values)
    setGpuDialogOpen(true)
  }

  async function handleGpuDialogConfirm(condition: GpuCondition | null) {
    setGpuDialogOpen(false)
    const values = pendingValues
    setPendingValues(null)
    if (!values) return
    setSubmitting(true)
    try {
      await onSubmit({
        name: values.name || '未命名任务',
        pipeline_id: values.pipeline_id ?? null,
        machine_id: values.machine_id ?? null,
        config: buildConfig(values),
        gpu_condition: condition,
      })
      onClose()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e?.response?.data?.detail || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedMachine = machines.find((m) => m.id === selectedMachineId)

  return (
    <>
      <Modal
        title={initialTask ? '编辑任务' : '创建任务'}
        open={open}
        onCancel={onClose}
        width={780}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Popover
              open={savePopoverOpen}
              onOpenChange={setSavePopoverOpen}
              trigger="click"
              title="存为模板"
              content={
                <Space>
                  <Input
                    placeholder="模板名称"
                    value={saveTemplateName}
                    onChange={(e) => setSaveTemplateName(e.target.value)}
                    style={{ width: 160 }}
                    onPressEnter={handleSaveTemplate}
                  />
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={savingTemplate}
                    onClick={handleSaveTemplate}
                    style={{ background: '#7c3aed' }}
                  >确认</Button>
                </Space>
              }
            >
              <Button icon={<SaveOutlined />}>存为模板</Button>
            </Popover>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                loading={submitting}
                onClick={handleSubmit}
                icon={<ThunderboltOutlined />}
                style={{ background: '#7c3aed' }}
              >
                {initialTask ? '保存' : '加入队列'}
              </Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical">
          <Tabs
            defaultActiveKey="basic"
            items={[
              {
                key: 'basic',
                label: '基本信息',
                children: (
                  <>
                    {/* 模板加载 */}
                    {templates.length > 0 && (
                      <Form.Item label="从模板加载">
                        <Select
                          placeholder="选择模板（将覆盖当前配置）"
                          onChange={(id) => { const t = templates.find((x) => x.id === id); if (t) loadFromTemplate(t) }}
                          options={templates.map((t) => ({ label: t.name, value: t.id }))}
                          showSearch
                          filterOption={(input, option) =>
                            (option?.label as string).toLowerCase().includes(input.toLowerCase())
                          }
                        />
                      </Form.Item>
                    )}

                    <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
                      <Input placeholder="未命名任务" />
                    </Form.Item>

                    <Form.Item name="pipeline_id" label="所属流水线">
                      <Select
                        placeholder="选择流水线（不选则不加入任何流水线）"
                        allowClear
                        options={pipelines.map((p) => ({ label: p.name, value: p.id }))}
                      />
                    </Form.Item>

                    <Form.Item
                      name="machine_id"
                      label="运行机器"
                      rules={[{ required: true, message: '请选择运行机器' }]}
                    >
                      <Select
                        placeholder="选择机器"
                        options={machines.map((m) => ({
                          label: m.is_local ? `${m.name} (本地)` : `${m.name} (${m.ssh_host})`,
                          value: m.id,
                        }))}
                        onChange={(v) => {
                          setSelectedMachineId(v)
                          if (v) fetchGpuCount(v)
                          else setGpuCount(0)
                        }}
                      />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'env',
                label: '运行环境',
                children: (
                  <>
                    <Form.Item label="Conda 环境">
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name="conda_env_id" noStyle>
                          <Select
                            placeholder="不使用 Conda 环境"
                            allowClear
                            options={condaEnvs.map((e) => ({ label: `${e.name} (${e.path})`, value: e.id }))}
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      </Space.Compact>
                      <Typography.Link
                        href="#"
                        style={{ fontSize: 12, marginTop: 4, display: 'block' }}
                        onClick={(e) => { e.preventDefault(); onClose() }}
                      >
                        在「设置」页管理 Conda 环境 →
                      </Typography.Link>
                    </Form.Item>

                    <Divider orientation="left" plain>环境变量</Divider>
                    {envVars.map((ev, i) => (
                      <Space key={i} style={{ display: 'flex', marginBottom: 6 }}>
                        <Input
                          placeholder="变量名"
                          value={ev.key}
                          onChange={(e) => setEnvVars(prev => prev.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                          style={{ width: 160 }}
                        />
                        <Input
                          placeholder="值"
                          value={ev.value}
                          onChange={(e) => setEnvVars(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                          style={{ width: 240 }}
                        />
                        <Button
                          type="text" danger icon={<DeleteOutlined />}
                          onClick={() => setEnvVars(prev => prev.filter((_, j) => j !== i))}
                        />
                      </Space>
                    ))}
                    <Button
                      type="dashed" icon={<PlusOutlined />}
                      onClick={() => setEnvVars(prev => [...prev, { key: '', value: '' }])}
                    >
                      添加环境变量
                    </Button>
                  </>
                ),
              },
              {
                key: 'command',
                label: '命令配置',
                children: (
                  <>
                    <Form.Item
                      name="work_dir"
                      label="执行根目录"
                      rules={[{ required: true, message: '请填写执行根目录' }]}
                    >
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name="work_dir" noStyle>
                          <Input placeholder="/path/to/workdir" />
                        </Form.Item>
                        <Button
                          icon={<FolderOpenOutlined />}
                          onClick={() => { setPathPickerFor('work_dir'); setPathPickerOpen(true) }}
                        >
                          浏览
                        </Button>
                      </Space.Compact>
                    </Form.Item>

                    <Form.Item
                      name="command"
                      label="基础命令"
                      rules={[{ required: true, message: '请填写命令' }]}
                    >
                      <Input placeholder="python train.py" />
                    </Form.Item>

                    <Form.Item label="命令行参数">
                      {args.map((arg, i) => (
                        <Space key={i} style={{ display: 'flex', marginBottom: 6 }} align="center">
                          <Input
                            placeholder="参数名（--lr）"
                            value={arg.name}
                            onChange={(e) => setArgs(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                            style={{ width: 160 }}
                          />
                          <Space.Compact>
                            <Input
                              placeholder="参数值（0.001）"
                              value={arg.value}
                              onChange={(e) => setArgs(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                              style={{ width: 200 }}
                            />
                            <Button
                              icon={<FolderOpenOutlined />}
                              onClick={() => { setArgPathPickerIndex(i); setPathPickerOpen(true) }}
                              title="选择路径"
                            />
                          </Space.Compact>
                          <Button
                            type="text" danger icon={<DeleteOutlined />}
                            onClick={() => setArgs(prev => prev.filter((_, j) => j !== i))}
                          />
                        </Space>
                      ))}
                      <Button
                        type="dashed" icon={<PlusOutlined />}
                        onClick={() => setArgs(prev => [...prev, { name: '', value: '' }])}
                        block
                      >
                        添加参数
                      </Button>
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'template',
                label: '模板管理',
                children: (
                  <Table
                    size="small"
                    dataSource={templates}
                    rowKey="id"
                    pagination={false}
                    locale={{ emptyText: '暂无模板' }}
                    columns={[
                      { title: '名称', dataIndex: 'name' },
                      {
                        title: '操作',
                        width: 180,
                        render: (_, tpl: TaskTemplate) => (
                          <Space>
                            <Button size="small" onClick={() => loadFromTemplate(tpl)}>加载</Button>
                            <Popconfirm
                              title="删除模板？"
                              onConfirm={async () => {
                                await tasksApi.deleteTemplate(tpl.id)
                                loadTemplates()
                              }}
                            >
                              <Button size="small" danger>删除</Button>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* 路径选择器 */}
      <PathPickerModal
        open={pathPickerOpen}
        onClose={() => { setPathPickerOpen(false); setArgPathPickerIndex(null) }}
        machineId={selectedMachineId ?? undefined}
        dirsOnly={argPathPickerIndex === null}
        onSelect={(path) => {
          if (argPathPickerIndex !== null) {
            setArgs(prev => prev.map((x, i) => i === argPathPickerIndex ? { ...x, value: path } : x))
          } else {
            form.setFieldValue('work_dir', path)
          }
        }}
      />

      {/* GPU 抢卡条件弹窗（提交第二步：设置抢卡条件 / 跳过） */}
      <GpuConditionDialog
        open={gpuDialogOpen}
        onClose={() => { setGpuDialogOpen(false); setPendingValues(null) }}
        onOk={(condition) => handleGpuDialogConfirm(condition)}
        onSkip={() => handleGpuDialogConfirm(null)}
        initialValue={gpuCondition}
        gpuCount={gpuCount > 0 ? gpuCount : 8}
      />
    </>
  )
}
