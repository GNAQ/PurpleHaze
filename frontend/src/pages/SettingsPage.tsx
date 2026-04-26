import { useEffect, useState } from 'react'
import {
  Card, Form, Input, Button, Typography, message, Space, Spin, List, Popconfirm,
  Select, Modal,
} from 'antd'
import {
  LockOutlined, SaveOutlined, DeleteOutlined, PlusOutlined, EditOutlined, ReloadOutlined,
} from '@ant-design/icons'
import { authApi, type SettingItem } from '../api/auth'
import { machinesApi, type Machine } from '../api/machines'
import { tasksApi, type CondaEnv } from '../api/tasks'
import { ph } from '../theme/tokens'
import { useTheme } from '../theme/useTheme'

const { Text } = Typography

const GLOBAL_CONDA_SCOPE = 'global'

const filterGlobalCondaEnvs = (envs: CondaEnv[]) => envs.filter((env) => env.machine_id == null)

function formatLastSeenAt(value?: string | null) {
  if (!value) return '未探测'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatFingerprint(hash?: string | null) {
  if (!hash) return '未生成'
  return `${hash.slice(0, 12)}…`
}

export default function SettingsPage() {
  const { t } = useTheme()
  const [pwdForm] = Form.useForm()
  const [condaForm] = Form.useForm<{ name: string; path?: string }>()
  const [pwdLoading, setPwdLoading] = useState(false)
  const [settings, setSettings] = useState<SettingItem[]>([])
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [machines, setMachines] = useState<Machine[]>([])
  const [machinesLoading, setMachinesLoading] = useState(true)
  const [selectedCondaScope, setSelectedCondaScope] = useState<string | number>(GLOBAL_CONDA_SCOPE)
  const [condaEnvs, setCondaEnvs] = useState<CondaEnv[]>([])
  const [condaLoading, setCondaLoading] = useState(true)
  const [probingCondaEnvs, setProbingCondaEnvs] = useState(false)
  const [condaEditorOpen, setCondaEditorOpen] = useState(false)
  const [editingCondaEnv, setEditingCondaEnv] = useState<CondaEnv | null>(null)
  const [condaSaving, setCondaSaving] = useState(false)
  const [probeWarning, setProbeWarning] = useState<string | null>(null)

  const selectedMachineId = selectedCondaScope === GLOBAL_CONDA_SCOPE ? null : Number(selectedCondaScope)
  const selectedMachine = selectedMachineId == null
    ? null
    : machines.find((machine) => machine.id === selectedMachineId) ?? null

  useEffect(() => {
    authApi.getSettings()
      .then((res) => setSettings(res.data.settings))
      .catch(() => { /* 暂无配置 */ })
      .finally(() => setSettingsLoading(false))

    machinesApi.list()
      .then((res) => setMachines(res.data.machines))
      .catch(() => { message.error('加载机器列表失败') })
      .finally(() => setMachinesLoading(false))
  }, [])

  useEffect(() => {
    void loadCondaEnvs(selectedCondaScope)
  }, [selectedCondaScope])

  async function loadCondaEnvs(scope: string | number) {
    setCondaLoading(true)
    try {
      if (scope === GLOBAL_CONDA_SCOPE) {
        const res = await tasksApi.listCondaEnvs()
        setCondaEnvs(filterGlobalCondaEnvs(res.data))
      } else {
        const res = await machinesApi.listCondaEnvs(Number(scope))
        setCondaEnvs(res.data)
      }
    } catch {
      setCondaEnvs([])
      message.error('加载 Conda 环境失败')
    } finally {
      setCondaLoading(false)
    }
  }

  function openCreateCondaEnvModal() {
    setEditingCondaEnv(null)
    condaForm.setFieldsValue({ name: '', path: '' })
    setCondaEditorOpen(true)
  }

  function openEditCondaEnvModal(env: CondaEnv) {
    setEditingCondaEnv(env)
    condaForm.setFieldsValue({
      name: env.name,
      path: env.path || '',
    })
    setCondaEditorOpen(true)
  }

  async function handleSaveCondaEnv(values: { name: string; path?: string }) {
    const payload = {
      name: values.name.trim(),
      path: values.path?.trim() || '',
    }
    setCondaSaving(true)
    try {
      if (editingCondaEnv) {
        await tasksApi.updateCondaEnv(editingCondaEnv.id, payload)
        message.success('已更新 Conda 环境')
      } else {
        await tasksApi.createCondaEnv({
          ...payload,
          machine_id: selectedMachineId,
        })
        message.success(selectedMachineId == null ? '已添加全局兼容环境' : '已登记机器 Conda 环境')
      }
      setCondaEditorOpen(false)
      setEditingCondaEnv(null)
      condaForm.resetFields()
      await loadCondaEnvs(selectedCondaScope)
    } catch (e: any) {
      message.error(e.response?.data?.detail ?? (editingCondaEnv ? '更新失败' : '保存失败'))
    } finally {
      setCondaSaving(false)
    }
  }

  async function handleDeleteCondaEnv(id: number) {
    try {
      await tasksApi.deleteCondaEnv(id)
      message.success('已删除 Conda 环境')
      await loadCondaEnvs(selectedCondaScope)
    } catch (e: any) {
      message.error(e.response?.data?.detail ?? '删除失败')
    }
  }

  async function handleProbeCondaEnvs() {
    if (!selectedMachineId || !selectedMachine) {
      message.warning('请先选择具体机器')
      return
    }
    if (!selectedMachine.is_local && !selectedMachine.connected) {
      message.warning(`远程机器 "${selectedMachine.name}" 未连接，请先在机器页建立连接`)
      return
    }

    setProbingCondaEnvs(true)
    try {
      const res = await machinesApi.probeCondaEnvs(selectedMachineId)
      setCondaEnvs(res.data.envs)
      setProbeWarning(res.data.warning ?? null)
      message.success(`当前机器环境已刷新：新增 ${res.data.created_count}，更新 ${res.data.updated_count}，移除 ${res.data.removed_count}`)
    } catch (e: any) {
      message.error(e.response?.data?.detail ?? '探测失败')
    } finally {
      setProbingCondaEnvs(false)
    }
  }

  async function handleChangePassword(values: {
    old_password: string; new_password: string; confirm: string
  }) {
    if (values.new_password !== values.confirm) {
      message.error('两次输入的新密码不一致')
      return
    }
    setPwdLoading(true)
    try {
      await authApi.changePassword(values.old_password, values.new_password)
      message.success('密码已修改，下次登录时使用新密码')
      pwdForm.resetFields()
    } catch (e: any) {
      message.error(e.response?.data?.detail ?? '修改失败')
    } finally {
      setPwdLoading(false)
    }
  }

  const condaScopeDescription = selectedMachine
    ? `当前展示 ${selectedMachine.name} 的机器级 Conda inventory；任务创建时仍会自动叠加全局兼容环境供选择。`
    : '当前展示 machine_id = NULL 的全局兼容环境，主要用于跨机通用记录与历史任务兼容。'

  return (
    <div className="ph-page-shell ph-page-shell--settings" style={{ width: '100%', minHeight: '100%' }}>
      <div className="ph-page-toolbar">
        <div className="ph-page-rail">
          <span className="ph-page-chip ph-page-chip--accent">密码与认证</span>
          <span className="ph-page-chip">运行配置</span>
          <span className="ph-page-chip">Conda Inventory</span>
        </div>
      </div>

      <div className="ph-page-content" style={{ overflowY: 'auto' }}>
        <div className="ph-page-content__body" style={{ padding: '2px 0 8px' }}>
          <div className="ph-settings-grid">
            <div className="ph-settings-stack">
              <Card title="修改密码" className="ph-glass-card">
                <Form form={pwdForm} layout="vertical" onFinish={handleChangePassword}>
                  <Form.Item name="old_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}> 
                    <Input.Password prefix={<LockOutlined />} />
                  </Form.Item>
                  <Form.Item name="new_password" label="新密码" rules={[{ required: true, min: 6, message: '新密码至少 6 位' }]}> 
                    <Input.Password prefix={<LockOutlined />} />
                  </Form.Item>
                  <Form.Item name="confirm" label="确认新密码" rules={[{ required: true, message: '请再次输入新密码' }]}> 
                    <Input.Password prefix={<LockOutlined />} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={pwdLoading}>
                    修改密码
                  </Button>
                </Form>
              </Card>

              <Card title="其他配置" className="ph-glass-card">
                {settingsLoading ? (
                  <Spin />
                ) : settings.length === 0 ? (
                  <Text style={{ color: t.textSec }}>暂无可配置项</Text>
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {settings.map((item, idx) => (
                      <div key={item.key}>
                        <Text strong style={{ fontSize: 13, color: t.text }}>{item.key}</Text>
                        {item.description && (
                          <Text style={{ fontSize: 12, marginLeft: 8, color: t.textSec }}>{item.description}</Text>
                        )}
                        <Input
                          value={item.value}
                          onChange={(e) => {
                            const updated = [...settings]
                            updated[idx] = { ...item, value: e.target.value }
                            setSettings(updated)
                          }}
                          style={{ marginTop: 4 }}
                        />
                      </div>
                    ))}
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      loading={settingsSaving}
                      style={{ marginTop: 8 }}
                      onClick={async () => {
                        setSettingsSaving(true)
                        try {
                          await authApi.updateSettings(settings)
                          message.success('配置已保存')
                        } catch (_) {
                          message.error('保存失败')
                        } finally {
                          setSettingsSaving(false)
                        }
                      }}
                    >
                      保存配置
                    </Button>
                  </Space>
                )}
              </Card>
            </div>

            <Card
              title="Conda 环境管理"
              className="ph-glass-card"
              extra={(
                <Space wrap size={8}>
                  <Select
                    value={selectedCondaScope}
                    loading={machinesLoading}
                    style={{ minWidth: 220 }}
                    onChange={(value) => {
                      setProbeWarning(null)
                      setSelectedCondaScope(value)
                    }}
                    options={[
                      { label: '全局兼容环境', value: GLOBAL_CONDA_SCOPE },
                      ...machines.map((machine) => ({
                        label: machine.is_local
                          ? `${machine.name} · 本地`
                          : `${machine.name} · ${machine.connected ? '在线' : '离线'}`,
                        value: machine.id,
                      })),
                    ]}
                  />
                  {selectedMachineId != null && (
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={probingCondaEnvs}
                      disabled={!selectedMachine || (!selectedMachine.is_local && !selectedMachine.connected)}
                      onClick={() => { void handleProbeCondaEnvs() }}
                    >
                      探测此机
                    </Button>
                  )}
                  <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreateCondaEnvModal}>
                    {selectedMachineId == null ? '添加全局环境' : '登记环境'}
                  </Button>
                </Space>
              )}
            >
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text style={{ display: 'block', color: t.textSec }}>
                  {condaScopeDescription}
                </Text>
                {selectedMachine && (
                  <div style={{
                    borderRadius: 10,
                    padding: '10px 12px',
                    background: 'linear-gradient(180deg, rgba(168,64,151,0.06) 0%, rgba(92,193,116,0.04) 100%)',
                    border: '1px solid rgba(83,42,86,0.12)',
                  }}>
                    <Space size={12} wrap>
                      <Text strong style={{ color: t.text }}>{selectedMachine.name}</Text>
                      <Text style={{ color: selectedMachine.is_local || selectedMachine.connected ? ph.green600 : t.textTer }}>
                        {selectedMachine.is_local || selectedMachine.connected ? '可探测' : '未连接'}
                      </Text>
                      <Text style={{ color: t.textSec }}>
                        {selectedMachine.is_local ? 'localhost' : `${selectedMachine.ssh_username}@${selectedMachine.ssh_host}:${selectedMachine.ssh_port}`}
                      </Text>
                    </Space>
                  </div>
                )}
                {probeWarning && (
                  <Text style={{ fontSize: 12, color: ph.warning }}>{probeWarning}</Text>
                )}
                {condaLoading ? (
                  <Spin />
                ) : (
                  <List
                    size="small"
                    dataSource={condaEnvs}
                    locale={{ emptyText: selectedMachineId == null ? '暂无全局兼容环境' : '该机器暂无已登记 Conda 环境' }}
                    renderItem={(env) => (
                      <List.Item
                        actions={[
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditCondaEnvModal(env)}>
                            编辑
                          </Button>,
                          <Popconfirm title="确认删除？" onConfirm={() => { void handleDeleteCondaEnv(env.id) }}>
                            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                              删除
                            </Button>
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={(
                            <Space size={8} wrap>
                              <Text strong style={{ color: t.text }}>{env.name}</Text>
                              <span className="ph-mono" style={{
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: 0.4,
                                color: env.source === 'manual' ? ph.purple400 : ph.green600,
                                background: env.source === 'manual'
                                  ? 'rgba(188,115,173,0.10)'
                                  : 'rgba(117,193,129,0.10)',
                                border: env.source === 'manual'
                                  ? '1px solid rgba(188,115,173,0.14)'
                                  : '1px solid rgba(117,193,129,0.14)',
                                borderRadius: 999,
                                padding: '3px 8px',
                              }}>
                                {env.source === 'manual' ? 'MANUAL' : 'PROBE'}
                              </span>
                            </Space>
                          )}
                          description={(
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              <Text className="ph-mono" style={{ color: t.textSec, wordBreak: 'break-all' }}>
                                {env.path || `conda activate ${env.name}`}
                              </Text>
                              <Space size={12} wrap>
                                <Text style={{ fontSize: 12, color: t.textTer }}>Python: {env.python_version || '未知'}</Text>
                                <Text style={{ fontSize: 12, color: t.textTer }}>Packages: {env.package_count ?? '未知'}</Text>
                                <Text style={{ fontSize: 12, color: t.textTer }}>Fingerprint: {formatFingerprint(env.fingerprint_hash)}</Text>
                                <Text style={{ fontSize: 12, color: t.textTer }}>Last Seen: {formatLastSeenAt(env.last_seen_at)}</Text>
                              </Space>
                            </Space>
                          )}
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Space>
            </Card>
          </div>
        </div>
      </div>

      <Modal
        title={editingCondaEnv ? '编辑 Conda 环境' : (selectedMachineId == null ? '添加全局兼容环境' : `登记 Conda 环境 · ${selectedMachine?.name || ''}`)}
        open={condaEditorOpen}
        onCancel={() => {
          setCondaEditorOpen(false)
          setEditingCondaEnv(null)
          condaForm.resetFields()
        }}
        onOk={() => condaForm.submit()}
        confirmLoading={condaSaving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={condaForm} layout="vertical" onFinish={(values) => { void handleSaveCondaEnv(values) }}>
          <Form.Item
            name="name"
            label="环境名称"
            rules={[{ required: true, message: '请输入 Conda 环境名称' }]}
          >
            <Input placeholder="例如：torch2.4-cu121" />
          </Form.Item>
          <Form.Item name="path" label="环境路径">
            <Input placeholder="例如：/opt/conda/envs/torch2.4-cu121（可选）" allowClear />
          </Form.Item>
          <Text style={{ fontSize: 12, color: t.textSec }}>
            {selectedMachineId == null
              ? '全局兼容环境主要给历史任务和跨机通用记录兜底；路径留空时仍按环境名激活。'
              : '机器级环境会在保存时尝试补齐 fingerprint；自定义路径环境也在这里统一登记。'}
          </Text>
        </Form>
      </Modal>
    </div>
  )
}