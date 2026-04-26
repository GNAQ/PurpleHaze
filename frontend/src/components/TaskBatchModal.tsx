import { useEffect, useState } from 'react'
import {
  Modal, Form, Input, Select, Button, Space, Upload, Typography, message,
} from 'antd'
import {
  UploadOutlined, ThunderboltOutlined, FolderOpenOutlined,
} from '@ant-design/icons'
import { Machine, MachineCondaEnvResolveResult, machinesApi } from '../api/machines'
import {
  tasksApi, CondaEnv, GpuCondition, Pipeline,
} from '../api/tasks'
import GpuConditionDialog from './GpuConditionDialog'
import PathPickerModal from './PathPickerModal'
import { ph } from '../theme/tokens'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  pipelines: Pipeline[]
  machines: Machine[]
}

export default function TaskBatchModal({
  open, onClose, onSuccess, pipelines, machines,
}: Props) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [condaEnvs, setCondaEnvs] = useState<CondaEnv[]>([])
  const [condaLoading, setCondaLoading] = useState(false)
  const [resolvingCondaEnv, setResolvingCondaEnv] = useState(false)
  const [condaRecommendation, setCondaRecommendation] = useState<MachineCondaEnvResolveResult | null>(null)
  const [commands, setCommands] = useState<string[]>([])
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null)
  const [gpuCount, setGpuCount] = useState(0)
  const [pathPickerOpen, setPathPickerOpen] = useState(false)
  const [gpuDialogOpen, setGpuDialogOpen] = useState(false)
  const [gpuCondition, setGpuCondition] = useState<GpuCondition | null>(null)
  const [pendingValues, setPendingValues] = useState<any>(null)
  const watchedWorkDir = Form.useWatch('work_dir', form)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    setCommands([])
    setSelectedMachineId(null)
    setGpuCount(0)
    setGpuCondition(null)
    setPendingValues(null)
    setCondaRecommendation(null)
    void loadCondaEnvs(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    void resolveRecommendedCondaEnv(selectedMachineId, watchedWorkDir)
  }, [open, selectedMachineId, watchedWorkDir])

  async function loadCondaEnvs(machineId?: number | null) {
    setCondaLoading(true)
    try {
      const res = machineId == null
        ? await tasksApi.listCondaEnvs()
        : await tasksApi.listCondaEnvs({ machine_id: machineId })
      const nextEnvs = machineId == null
        ? res.data.filter((env) => env.machine_id == null)
        : res.data
      setCondaEnvs(nextEnvs)
      const currentCondaEnvId = form.getFieldValue('conda_env_id')
      if (currentCondaEnvId && !nextEnvs.some((env) => env.id === currentCondaEnvId)) {
        form.setFieldValue('conda_env_id', undefined)
      }
    } catch {
      setCondaEnvs([])
    } finally {
      setCondaLoading(false)
    }
  }

  async function fetchGpuCount(machineId: number) {
    try {
      const res = await machinesApi.getSnapshot(machineId)
      setGpuCount(res.data.gpus?.length ?? 0)
    } catch {
      setGpuCount(0)
    }
  }

  async function resolveRecommendedCondaEnv(machineId?: number | null, workDir?: string | null) {
    if (!machineId) {
      setCondaRecommendation(null)
      return
    }
    setResolvingCondaEnv(true)
    try {
      const res = await machinesApi.resolveCondaEnv(machineId, { work_dir: workDir?.trim() || undefined })
      setCondaRecommendation(res.data)
      const currentCondaEnvId = form.getFieldValue('conda_env_id')
      if (!currentCondaEnvId && res.data.recommended_env) {
        form.setFieldValue('conda_env_id', res.data.recommended_env.id)
      }
    } catch {
      setCondaRecommendation(null)
    } finally {
      setResolvingCondaEnv(false)
    }
  }

  function getCondaRecommendationText() {
    if (!selectedMachineId) return null
    if (resolvingCondaEnv) return '正在解析当前机器与工作目录的推荐环境...'
    if (!condaRecommendation?.recommended_env) return null
    if (condaRecommendation.reason === 'binding_hint' && condaRecommendation.binding_hint) {
      return `推荐环境：${condaRecommendation.recommended_env.name}，命中目录提示 ${condaRecommendation.binding_hint.work_dir_pattern}`
    }
    if (condaRecommendation.reason === 'single_machine_env') {
      return `推荐环境：${condaRecommendation.recommended_env.name}，当前机器仅登记了这一个环境`
    }
    return condaRecommendation.message || null
  }

  function parseBatchText(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
  }

  async function handleChooseFile(file: File) {
    try {
      const raw = await file.text()
      const parsed = parseBatchText(raw)
      if (parsed.length === 0) {
        message.warning('文件中没有可用命令（空行和 # 注释会自动忽略）')
      } else {
        message.success(`已加载 ${parsed.length} 条命令`)
      }
      setCommands(parsed)
    } catch {
      message.error('读取文件失败')
    }
    return false
  }

  async function handleSubmit() {
    let values: any
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    if (commands.length === 0) {
      message.warning('请先上传 txt/csv 命令文件')
      return
    }

    const machine = machines.find((m) => m.id === values.machine_id)
    if (machine && !machine.is_local && !machine.connected) {
      message.error(`远程机器 "${machine.name}" 未连接，请先连接后再提交`)
      return
    }

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
      await tasksApi.createBatchTasks({
        pipeline_ids: values.pipeline_ids,
        machine_id: values.machine_id,
        config: {
          conda_env_id: values.conda_env_id || null,
          env_vars: {},
          work_dir: values.work_dir,
          command: commands[0],
          args: [],
        },
        gpu_condition: condition,
        commands,
      })
      message.success(`批量提交成功，共 ${commands.length} 条任务`)
      onClose()
      onSuccess()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '批量提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedMachine = machines.find((machine) => machine.id === selectedMachineId)

  return (
    <>
      <Modal
        title="批量任务"
        open={open}
        onCancel={onClose}
        width={760}
        footer={(
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={submitting}
              onClick={handleSubmit}
              icon={<ThunderboltOutlined />}
              style={{ background: ph.purple500 }}
            >
              批量加入队列
            </Button>
          </Space>
        )}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="pipeline_ids"
            label="目标流水线"
            rules={[{ required: true, message: '请至少选择一个流水线' }]}
          >
            <Select
              mode="multiple"
              placeholder="选择一个或多个流水线（将按顺序均摊）"
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
                form.setFieldValue('conda_env_id', undefined)
                void loadCondaEnvs(v ?? null)
                if (v) fetchGpuCount(v)
                else setGpuCount(0)
              }}
            />
          </Form.Item>

          <Form.Item
            label="Conda 环境"
            extra={selectedMachineId
              ? '机器级 Conda inventory 现在统一在设置页按机器维护；这里会直接读取当前机器可用环境。'
              : '未选机器时只显示全局兼容环境；选中机器后会补充该机器的 inventory。'}
          >
            <Form.Item name="conda_env_id" noStyle>
              <Select
                placeholder="不使用 Conda 环境"
                allowClear
                loading={condaLoading}
                options={condaEnvs.map((e) => ({
                  label: `${e.name} (${e.path || `conda activate ${e.name}`})`,
                  value: e.id,
                }))}
              />
            </Form.Item>
            {getCondaRecommendationText() && (
              <Typography.Text style={{ fontSize: 12, marginTop: 4, display: 'block', color: ph.green600 }}>
                {getCondaRecommendationText()}
              </Typography.Text>
            )}
          </Form.Item>

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
                onClick={() => setPathPickerOpen(true)}
              >
                浏览
              </Button>
            </Space.Compact>
          </Form.Item>

          <Form.Item label="批量命令文件（txt/csv）" required>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Upload
                accept=".txt,.csv,text/plain,text/csv"
                maxCount={1}
                beforeUpload={handleChooseFile}
                showUploadList={false}
              >
                <Button icon={<UploadOutlined />}>选择文件</Button>
              </Upload>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                文件中每行一条命令；空行和以 # 开头的行会被忽略。
              </Typography.Text>
              <Input.TextArea
                value={commands.join('\n')}
                readOnly
                rows={8}
                placeholder="上传后这里会展示解析后的命令列表"
              />
              <Typography.Text type="secondary">共 {commands.length} 条命令</Typography.Text>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <PathPickerModal
        open={pathPickerOpen}
        onClose={() => setPathPickerOpen(false)}
        machineId={selectedMachineId ?? undefined}
        dirsOnly
        onSelect={(path) => {
          form.setFieldValue('work_dir', path)
          setPathPickerOpen(false)
        }}
      />

      <GpuConditionDialog
        open={gpuDialogOpen}
        onClose={() => { setGpuDialogOpen(false); setPendingValues(null) }}
        onOk={(condition) => { setGpuCondition(condition); void handleGpuDialogConfirm(condition) }}
        onSkip={() => { setGpuCondition(null); void handleGpuDialogConfirm(null) }}
        initialValue={gpuCondition}
        gpuCount={gpuCount > 0 ? gpuCount : 8}
      />
    </>
  )
}
