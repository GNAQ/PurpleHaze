/**
 * 任务创建/编辑弹窗
 * 覆盖：模板选择、机器选择、conda 环境、环境变量、工作目录、命令、参数、抢卡条件
 */
import { useState, useEffect } from 'react'
import {
  Modal, Form, Input, Select, Button, Space, Tabs, Table,
  Divider, message, Popconfirm, Typography,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, FolderOpenOutlined, ThunderboltOutlined,
  SaveOutlined, ImportOutlined,
} from '@ant-design/icons'
import { Machine, machinesApi } from '../api/machines'
import {
  tasksApi, TaskConfig, GpuCondition, Task, TaskTemplate, CondaEnv, Pipeline,
} from '../api/tasks'
import PathPickerModal from './PathPickerModal'
import GpuConditionDialog from './GpuConditionDialog'
import { ph } from '../theme/tokens'

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

/**
 * 解析一条完整的 shell 命令，拆分为 work_dir / env_vars / command / args。
 *
 * 识别规则：
 *  - `cd /path &&` 或 `cd /path;` 前缀 → work_dir
 *  - `KEY=VALUE` 前缀（出现在命令程序名之前） → env_vars
 *  - 程序名 + 紧跟的 .py/.sh 文件 合并为 command（如 `python train.py`）
 *  - 后续的 `--flag value` / `--flag=value` / `-f value` → args
 *  - 裸值（非 - 开头）→ args with name=""
 */
function parseCommand(raw: string): {
  work_dir: string
  env_vars: { key: string; value: string }[]
  command: string
  args: { name: string; value: string }[]
} {
  let input = raw.trim()
  let work_dir = ''
  const env_vars: { key: string; value: string }[] = []
  const args: { name: string; value: string }[] = []

  // 1. Extract `cd <path> &&` or `cd <path>;` prefix
  const cdMatch = input.match(/^cd\s+(\S+)\s*(?:&&|;)\s*/)
  if (cdMatch) {
    work_dir = cdMatch[1]
    input = input.slice(cdMatch[0].length)
  }

  // 2. Tokenize respecting quotes
  const tokens = shellTokenize(input)
  if (tokens.length === 0) return { work_dir, env_vars, command: '', args }

  // 3. Extract leading KEY=VALUE env vars (before the program name)
  let idx = 0
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
    const eqPos = tokens[idx].indexOf('=')
    env_vars.push({ key: tokens[idx].slice(0, eqPos), value: tokens[idx].slice(eqPos + 1) })
    idx++
  }

  if (idx >= tokens.length) return { work_dir, env_vars, command: '', args }

  // 4. Build command: program name + any immediately following script file (.py, .sh, etc.)
  let command = tokens[idx]
  idx++
  // Absorb the next token if it looks like a script file or module path (e.g. train.py, -m torch.distributed.launch)
  if (idx < tokens.length) {
    const next = tokens[idx]
    if (/\.(py|sh|bash|r|jl|rb|pl)$/i.test(next)) {
      command += ' ' + next
      idx++
    } else if (command === 'python' || command === 'python3') {
      // python -m module.name → keep as command
      if (next === '-m' && idx + 1 < tokens.length) {
        command += ' -m ' + tokens[idx + 1]
        idx += 2
      } else if (next === '-c') {
        // python -c "code" → keep -c as part of command, code as first arg
        command += ' -c'
        idx++
      }
    }
  }

  // 5. Parse remaining tokens as args
  while (idx < tokens.length) {
    const tok = tokens[idx]
    if (tok.startsWith('-')) {
      // --flag=value
      const eqPos = tok.indexOf('=')
      if (eqPos !== -1) {
        args.push({ name: tok.slice(0, eqPos), value: tok.slice(eqPos + 1) })
        idx++
      } else {
        // --flag value or bare flag (boolean)
        const nextTok = tokens[idx + 1]
        if (nextTok !== undefined && !nextTok.startsWith('-')) {
          args.push({ name: tok, value: nextTok })
          idx += 2
        } else {
          args.push({ name: tok, value: '' })
          idx++
        }
      }
    } else {
      // Positional arg
      args.push({ name: '', value: tok })
      idx++
    }
  }

  return { work_dir, env_vars, command, args }
}

/** Simple shell tokenizer respecting single/double quotes. */
function shellTokenize(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < input.length) {
    // Skip whitespace
    while (i < input.length && /\s/.test(input[i])) i++
    if (i >= input.length) break

    let token = ''
    while (i < input.length && !/\s/.test(input[i])) {
      const ch = input[i]
      if (ch === "'" || ch === '"') {
        const quote = ch
        i++ // skip opening quote
        while (i < input.length && input[i] !== quote) {
          if (input[i] === '\\' && quote === '"' && i + 1 < input.length) {
            i++
            token += input[i]
          } else {
            token += input[i]
          }
          i++
        }
        i++ // skip closing quote
      } else if (ch === '\\' && i + 1 < input.length) {
        i++
        token += input[i]
        i++
      } else {
        token += ch
        i++
      }
    }
    if (token) tokens.push(token)
  }
  return tokens
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
  // GPU 条件弹窗：存储表单已校验字段，等待抢卡条件确认后再提交
  const [pendingValues, setPendingValues] = useState<any>(null)

  // 命令粘贴识别
  const [pasteInput, setPasteInput] = useState('')

  // 模板管理
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)

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
      setSelectedTemplateId(null)
      setSaveTemplateName('')
    }
  }, [open])

  async function loadCondaEnvs() {
    try { setCondaEnvs((await tasksApi.listCondaEnvs()).data) } catch {}
  }
  async function loadTemplates() {
    try {
      const list = (await tasksApi.listTemplates()).data
      setTemplates(list)
      setSelectedTemplateId((prev) => (prev && list.some((t) => t.id === prev) ? prev : null))
    } catch {}
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
    const nextValues: Record<string, any> = {
      conda_env_id: config.conda_env_id,
      work_dir: config.work_dir || '',
      command: config.command || '',
    }
    if (!initialTask) nextValues.name = tpl.name
    form.setFieldsValue(nextValues)
    setArgs(config.args || [])
    setEnvVars(Object.entries(config.env_vars || {}).map(([k, v]) => ({ key: k, value: v })))
    setGpuCondition(tpl.gpu_condition)
    // 同步模板中保存的 machine_id
    if (tpl.machine_id != null) {
      form.setFieldsValue({ machine_id: tpl.machine_id })
      setSelectedMachineId(tpl.machine_id)
      fetchGpuCount(tpl.machine_id)
    }
    setSelectedTemplateId(tpl.id)
    setSaveTemplateName(tpl.name)
    message.success(`已加载模板: ${tpl.name}`)
  }

  async function handleSaveTemplate() {
    if (!saveTemplateName.trim()) { message.warning('请输入模板名称'); return }
    setSavingTemplate(true)
    try {
      const values = form.getFieldsValue()
      const config = buildConfig(values)
      const res = await tasksApi.createTemplate({
        name: saveTemplateName.trim(),
        machine_id: form.getFieldValue('machine_id') ?? null,
        config,
        gpu_condition: gpuCondition,
      })
      message.success('模板已保存')
      setSelectedTemplateId(res.data.id)
      setSaveTemplateName(res.data.name)
      await loadTemplates()
    } catch { message.error('保存失败') }
    finally { setSavingTemplate(false) }
  }

  async function handleUpdateTemplate() {
    if (!selectedTemplateId) { message.warning('请先在左侧选择一个模板'); return }
    const selected = templates.find((t) => t.id === selectedTemplateId)
    if (!selected) { message.warning('模板不存在，请刷新后重试'); return }
    setSavingTemplate(true)
    try {
      const values = form.getFieldsValue()
      const config = buildConfig(values)
      await tasksApi.updateTemplate(selectedTemplateId, {
        name: saveTemplateName.trim() || selected.name,
        machine_id: form.getFieldValue('machine_id') ?? null,
        config,
        gpu_condition: gpuCondition,
      })
      message.success('模板已更新')
      await loadTemplates()
    } catch {
      message.error('更新失败')
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleAddCondaEnv() {
    message.info('请到设置页管理 Conda 环境')
  }

  async function handleDeleteCondaEnv(id: number) {
    try { await tasksApi.deleteCondaEnv(id); loadCondaEnvs() }
    catch { message.error('删除失败') }
  }

  async function handleDeleteTemplate(id: number) {
    try {
      await tasksApi.deleteTemplate(id)
      if (selectedTemplateId === id) {
        setSelectedTemplateId(null)
        setSaveTemplateName('')
      }
      await loadTemplates()
      message.success('模板已删除')
    } catch {
      message.error('删除失败')
    }
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

  function handleParseCommand() {
    if (!pasteInput.trim()) { message.warning('请先粘贴命令'); return }
    const parsed = parseCommand(pasteInput)
    form.setFieldsValue({
      command: parsed.command,
      ...(parsed.work_dir ? { work_dir: parsed.work_dir } : {}),
    })
    setArgs(parsed.args)
    if (parsed.env_vars.length > 0) setEnvVars(parsed.env_vars)
    setPasteInput('')
    message.success('命令已识别填入')
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
    // 展示抢卡条件弹窗作为提交前的第二步
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
        width="min(1320px, calc(100vw - 48px))"
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        footer={
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={submitting}
              onClick={handleSubmit}
              icon={<ThunderboltOutlined />}
              style={{ background: ph.purple500 }}
            >
              {initialTask ? '保存' : '加入队列'}
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              border: `1px solid ${ph.dark.border}`,
              borderRadius: 10,
              padding: 12,
              background: ph.dark.surface0,
            }}
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography.Text strong>任务预设</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  点击行选中，点“加载”应用模板；“修改选中”会用下方当前字段覆盖模板。
                </Typography.Text>
              </div>

              <Space wrap size={8} style={{ width: '100%' }}>
                <Input
                  placeholder="模板名称"
                  value={saveTemplateName}
                  onChange={(e) => setSaveTemplateName(e.target.value)}
                  onPressEnter={selectedTemplateId ? handleUpdateTemplate : handleSaveTemplate}
                  style={{ width: 300, maxWidth: '100%' }}
                />
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={savingTemplate}
                  onClick={handleSaveTemplate}
                  style={{ background: ph.purple500 }}
                >
                  新建保存
                </Button>
                <Button
                  size="small"
                  loading={savingTemplate}
                  onClick={handleUpdateTemplate}
                  disabled={!selectedTemplateId}
                >
                  修改选中
                </Button>
              </Space>

              <Table
                size="small"
                dataSource={templates}
                rowKey="id"
                pagination={{ pageSize: 6, hideOnSinglePage: true, size: 'small' }}
                locale={{ emptyText: '暂无模板' }}
                onRow={(tpl) => ({
                  onClick: () => {
                    setSelectedTemplateId(tpl.id)
                    setSaveTemplateName(tpl.name)
                  },
                  style: {
                    cursor: 'pointer',
                    background: tpl.id === selectedTemplateId ? 'rgba(188,115,173,0.12)' : undefined,
                  },
                })}
                columns={[
                  {
                    title: '名称',
                    dataIndex: 'name',
                    ellipsis: true,
                    render: (name: string, tpl: TaskTemplate) => (
                      <span style={{ fontWeight: tpl.id === selectedTemplateId ? 600 : 400 }}>{name}</span>
                    ),
                  },
                  {
                    title: '操作',
                    width: 130,
                    render: (_, tpl: TaskTemplate) => (
                      <Space size={4}>
                        <Button
                          size="small"
                          onClick={(e) => { e.stopPropagation(); loadFromTemplate(tpl) }}
                        >
                          加载
                        </Button>
                        <Popconfirm
                          title="删除模板？"
                          onConfirm={() => handleDeleteTemplate(tpl.id)}
                        >
                          <Button
                            size="small"
                            danger
                            onClick={(e) => e.stopPropagation()}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </Space>
          </div>

          <Form form={form} layout="vertical">
            <Tabs
              defaultActiveKey="basic"
              items={[
                {
                  key: 'basic',
                  label: '基本信息',
                  children: (
                    <>
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
                      <div style={{
                        border: `1px dashed ${ph.dark.border}`,
                        borderRadius: 8,
                        padding: '10px 12px',
                        marginBottom: 16,
                        background: ph.dark.surface0,
                      }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                          粘贴完整命令，自动识别工作目录、环境变量、命令和参数
                        </Typography.Text>
                        <Space.Compact style={{ width: '100%' }}>
                          <Input.TextArea
                            placeholder="cd /workspace && CUDA_VISIBLE_DEVICES=0,1 python train.py --lr 0.001 --epochs 100"
                            value={pasteInput}
                            onChange={(e) => setPasteInput(e.target.value)}
                            onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleParseCommand() } }}
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            style={{ flex: 1 }}
                          />
                          <Button
                            icon={<ImportOutlined />}
                            onClick={handleParseCommand}
                            style={{ height: 'auto' }}
                          >
                            识别填入
                          </Button>
                        </Space.Compact>
                      </div>

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
              ]}
            />
          </Form>
        </div>
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
