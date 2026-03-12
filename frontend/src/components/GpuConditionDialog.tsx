/**
 * GPU 抢卡条件设置弹窗
 * 支持：强制选卡 / 智能条件（简单条件 + 文本表达式）+ 预设保存/加载
 */
import { useState, useEffect } from 'react'
import {
  Modal, Form, Radio, Select, InputNumber, Space, Button, Table,
  Input, Divider, Tag, Tooltip, message, Popconfirm, Typography,
} from 'antd'
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { GpuCondition, GpuConditionItem, GpuPreset, tasksApi } from '../api/tasks'

const { TextArea } = Input
const { Text } = Typography

const CONDITION_TYPE_OPTIONS = [
  { label: '空闲显存 (MB)', value: 'mem' },
  { label: 'GPU 利用率 (%)', value: 'util' },
  { label: '功耗占比 (%)', value: 'power' },
  { label: 'Python 进程数', value: 'procs' },
]
const OP_OPTIONS = [
  { label: '>', value: '>' },
  { label: '<', value: '<' },
  { label: '≥', value: '>=' },
  { label: '≤', value: '<=' },
]

const EXPR_HELP = `可用变量：
  mem      - 空闲显存 MB
  util     - GPU 利用率 %
  power    - 功耗占最大功耗 %
  procs    - GPU 上的 Python 进程数
  used_mem - 已用显存 MB
  total_mem - 总显存 MB

支持运算符：>  <  >=  <=  ==  !=  and  or  not  ( )

示例：mem > 8000 and util < 10
示例：(mem > 4096 or power < 20) and procs < 2`

interface Props {
  open: boolean
  onClose: () => void
  onOk: (condition: GpuCondition) => void
  /** 跳过抢卡条件（无需抢卡），传入时底部显示「无需抢卡条件」按鈕 */
  onSkip?: () => void
  initialValue?: GpuCondition | null
  /** 机器上的 GPU 数量（用于选卡） */
  gpuCount?: number
}

export default function GpuConditionDialog({ open, onClose, onOk, onSkip, initialValue, gpuCount = 8 }: Props) {
  const [form] = Form.useForm()
  const [mode, setMode] = useState<'force' | 'smart'>('smart')
  const [simpleConditions, setSimpleConditions] = useState<GpuConditionItem[]>([])
  const [presets, setPresets] = useState<GpuPreset[]>([])
  const [savePresetName, setSavePresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)

  useEffect(() => {
    if (open) {
      loadPresets()
      if (initialValue) {
        setMode(initialValue.mode || 'smart')
        setSimpleConditions(initialValue.conditions || [])
        form.setFieldsValue({
          mode: initialValue.mode || 'smart',
          gpu_ids: initialValue.gpu_ids || [],
          min_gpus: initialValue.min_gpus ?? 1,
          idle_minutes: initialValue.idle_minutes ?? 1,
          condition_expr: initialValue.condition_expr || '',
        })
      } else {
        setMode('smart')
        setSimpleConditions([])
        form.resetFields()
        form.setFieldsValue({ mode: 'smart', min_gpus: 1, idle_minutes: 1, gpu_ids: [] })
      }
    }
  }, [open])

  async function loadPresets() {
    try {
      const res = await tasksApi.listGpuPresets()
      setPresets(res.data)
    } catch {}
  }

  function loadPreset(preset: GpuPreset) {
    const c = preset.condition
    if (!c) return
    setMode(c.mode || 'smart')
    setSimpleConditions(c.conditions || [])
    form.setFieldsValue({
      mode: c.mode || 'smart',
      gpu_ids: c.gpu_ids || [],
      min_gpus: c.min_gpus ?? 1,
      idle_minutes: c.idle_minutes ?? 1,
      condition_expr: c.condition_expr || '',
    })
  }

  async function handleSavePreset() {
    if (!savePresetName.trim()) { message.warning('请输入预设名称'); return }
    setSavingPreset(true)
    try {
      const values = form.getFieldsValue()
      const condition: GpuCondition = {
        mode, gpu_ids: values.gpu_ids || [],
        min_gpus: values.min_gpus, idle_minutes: values.idle_minutes,
        conditions: simpleConditions,
        condition_expr: values.condition_expr || '',
      }
      await tasksApi.createGpuPreset({ name: savePresetName.trim(), condition })
      message.success('预设已保存')
      setSavePresetName('')
      loadPresets()
    } catch { message.error('保存失败') }
    finally { setSavingPreset(false) }
  }

  async function handleDeletePreset(id: number) {
    try { await tasksApi.deleteGpuPreset(id); loadPresets() }
    catch { message.error('删除失败') }
  }

  function addCondition() {
    setSimpleConditions(prev => [...prev, { type: 'util', op: '<', value: 10 }])
  }

  function updateCondition(index: number, key: keyof GpuConditionItem, val: any) {
    setSimpleConditions(prev => prev.map((c, i) => i === index ? { ...c, [key]: val } : c))
  }

  function removeCondition(index: number) {
    setSimpleConditions(prev => prev.filter((_, i) => i !== index))
  }

  function handleOk() {
    form.validateFields().then((values) => {
      // 强制选卡模式下至少需要选中一张 GPU
      if (mode === 'force' && (!values.gpu_ids || values.gpu_ids.length === 0)) {
        message.warning('强制选卡模式下至少需要选择一张 GPU')
        return
      }
      const condition: GpuCondition = {
        mode,
        gpu_ids: values.gpu_ids || [],
        min_gpus: mode === 'smart' ? (values.min_gpus ?? 1) : undefined,
        idle_minutes: mode === 'smart' ? (values.idle_minutes ?? 1) : undefined,
        conditions: mode === 'smart' ? simpleConditions : undefined,
        condition_expr: mode === 'smart' ? (values.condition_expr || '') : undefined,
      }
      onOk(condition)
      onClose()
    })
  }

  const gpuOptions = Array.from({ length: gpuCount }, (_, i) => ({ label: `GPU ${i}`, value: i }))

  return (
    <Modal
      title="设置抢卡条件"
      open={open}
      onCancel={onClose}
      width={640}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          {onSkip && (
            <Button onClick={() => { onClose(); onSkip() }}>无需抢卡条件</Button>
          )}
          <Button type="primary" onClick={handleOk} style={{ background: '#7c3aed' }}>确认</Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" initialValues={{ mode: 'smart', min_gpus: 1, idle_minutes: 1 }}>

        {/* 预设 */}
        {presets.length > 0 && (
          <>
            <Form.Item label="加载预设">
              <Select
                placeholder="选择预设"
                onChange={(id) => { const p = presets.find(x => x.id === id); if (p) loadPreset(p) }}
                options={presets.map(p => ({ label: p.name, value: p.id }))}
              />
            </Form.Item>
            <Divider style={{ margin: '8px 0' }} />
          </>
        )}

        {/* 模式选择 */}
        <Form.Item name="mode" label="模式">
          <Radio.Group onChange={(e) => setMode(e.target.value)}>
            <Radio value="force">强制指定 GPU</Radio>
            <Radio value="smart">智能抢卡</Radio>
          </Radio.Group>
        </Form.Item>

        {/* 选卡（两种模式都有） */}
        <Form.Item
          name="gpu_ids"
          label={mode === 'force' ? '指定 GPU（多选，全部使用）' : '候选 GPU（留空=所有卡）'}
        >
          <Select mode="multiple" options={gpuOptions} placeholder="不选则使用所有 GPU" />
        </Form.Item>

        {mode === 'smart' && (
          <>
            <Space style={{ width: '100%' }} size="middle">
              <Form.Item name="min_gpus" label="最少使用 GPU 数" style={{ marginBottom: 0 }}>
                <InputNumber min={1} max={gpuCount} style={{ width: 100 }} />
              </Form.Item>
              <Form.Item
                name="idle_minutes"
                label={<>连续满足时长 (分钟) <Tooltip title="每张候选 GPU 需在过去 N 分钟内的所有采样点都满足条件"><InfoCircleOutlined /></Tooltip></>}
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={0.1} step={0.5} style={{ width: 120 }} />
              </Form.Item>
            </Space>

            <Divider orientation="left" plain style={{ marginTop: 16 }}>简单条件（所有条件同时满足）</Divider>

            {simpleConditions.map((cond, i) => (
              <Space key={i} style={{ display: 'flex', marginBottom: 8 }} align="center">
                <Select
                  value={cond.type}
                  options={CONDITION_TYPE_OPTIONS}
                  onChange={(v) => updateCondition(i, 'type', v)}
                  style={{ width: 150 }}
                />
                <Select
                  value={cond.op}
                  options={OP_OPTIONS}
                  onChange={(v) => updateCondition(i, 'op', v)}
                  style={{ width: 70 }}
                />
                <InputNumber
                  value={cond.value}
                  onChange={(v) => updateCondition(i, 'value', v ?? 0)}
                  style={{ width: 100 }}
                />
                <Button
                  type="text" danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeCondition(i)}
                />
              </Space>
            ))}
            <Button
              type="dashed" onClick={addCondition}
              icon={<PlusOutlined />} block style={{ marginBottom: 12 }}
            >
              添加简单条件
            </Button>

            <Divider orientation="left" plain>文本条件表达式（可替代或补充简单条件）</Divider>
            <Form.Item
              name="condition_expr"
              extra={<Text type="secondary" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{EXPR_HELP}</Text>}
            >
              <TextArea
                rows={3}
                placeholder="例：mem > 8000 and util < 10"
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          </>
        )}

        <Divider orientation="left" plain>保存为预设</Divider>
        <Space>
          <Input
            value={savePresetName}
            onChange={(e) => setSavePresetName(e.target.value)}
            placeholder="预设名称"
            style={{ width: 180 }}
          />
          <Button loading={savingPreset} onClick={handleSavePreset}>保存预设</Button>
        </Space>
        {presets.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {presets.map(p => (
              <Tag key={p.id} closable onClose={() => handleDeletePreset(p.id)}>{p.name}</Tag>
            ))}
          </div>
        )}

      </Form>
    </Modal>
  )
}
