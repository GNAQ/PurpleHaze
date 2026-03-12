import { useEffect, useState } from 'react'
import {
  Card, Form, Input, Button, Typography, message, Space, Spin, List, Popconfirm,
} from 'antd'
import { LockOutlined, SaveOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { authApi, type SettingItem } from '../api/auth'
import { tasksApi, type CondaEnv } from '../api/tasks'

const { Title, Text } = Typography

export default function SettingsPage() {
  const [pwdForm] = Form.useForm()
  const [pwdLoading, setPwdLoading] = useState(false)
  const [settings, setSettings] = useState<SettingItem[]>([])
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [condaEnvs, setCondaEnvs] = useState<CondaEnv[]>([])
  const [condaLoading, setCondaLoading] = useState(true)
  const [condaForm] = Form.useForm()
  const [condaAdding, setCondaAdding] = useState(false)
  const [condaSaving, setCondaSaving] = useState(false)

  // 加载配置
  useEffect(() => {
    authApi.getSettings()
      .then((res) => setSettings(res.data.settings))
      .catch(() => { /* 暂无配置 */ })
      .finally(() => setSettingsLoading(false))
    tasksApi.listCondaEnvs()
      .then((res) => setCondaEnvs(res.data))
      .catch(() => {})
      .finally(() => setCondaLoading(false))
  }, [])

  const loadCondaEnvs = async () => {
    try { const r = await tasksApi.listCondaEnvs(); setCondaEnvs(r.data) } catch (_) {}
  }

  const handleAddCondaEnv = async (values: { name: string; path?: string }) => {
    setCondaSaving(true)
    try {
      await tasksApi.createCondaEnv(values)
      message.success('已添加 Conda 环境')
      condaForm.resetFields()
      setCondaAdding(false)
      await loadCondaEnvs()
    } catch (e: any) {
      message.error(e.response?.data?.detail ?? '添加失败')
    }
    setCondaSaving(false)
  }

  const handleDeleteCondaEnv = async (id: number) => {
    try {
      await tasksApi.deleteCondaEnv(id)
      setCondaEnvs((prev) => prev.filter((e) => e.id !== id))
    } catch (_) { message.error('删除失败') }
  }

  // 修改密码
  const handleChangePassword = async (values: {
    old_password: string; new_password: string; confirm: string
  }) => {
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
    }
    setPwdLoading(false)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <Title level={4} style={{ marginBottom: 20 }}>设置</Title>

      {/* 修改密码 */}
      <Card title="修改密码" style={{ marginBottom: 16, borderRadius: 10 }}>
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

      {/* 其他配置（键值对） */}
      <Card title="其他配置" style={{ borderRadius: 10 }}>
        {settingsLoading ? (
          <Spin />
        ) : settings.length === 0 ? (
          <Text type="secondary">暂无可配置项</Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {settings.map((item, idx) => (
              <div key={item.key}>
                <Text strong style={{ fontSize: 13 }}>{item.key}</Text>
                {item.description && (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>{item.description}</Text>
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
                }
                setSettingsSaving(false)
              }}
            >
              保存配置
            </Button>
          </Space>
        )}
      </Card>

      {/* Conda 环境管理 */}
      <Card title="Conda 环境" style={{ marginTop: 16, borderRadius: 10 }}
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={() => setCondaAdding((v) => !v)}>
            {condaAdding ? '取消' : '添加'}
          </Button>
        }
      >
        {condaLoading ? <Spin /> : (
          <>
            {condaAdding && (
              <Form form={condaForm} layout="inline" onFinish={handleAddCondaEnv} style={{ marginBottom: 12 }}>
                <Form.Item name="name" rules={[{ required: true, message: '请输入名称' }]}>
                  <Input placeholder="环境名称" style={{ width: 140 }} />
                </Form.Item>
                <Form.Item name="path">
                  <Input placeholder="环境路径（选填，空则用 conda activate）" style={{ width: 260 }} allowClear />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={condaSaving}>确认</Button>
                </Form.Item>
              </Form>
            )}
            <List
              size="small"
              dataSource={condaEnvs}
              locale={{ emptyText: '暂无 Conda 环境' }}
              renderItem={(env) => (
                <List.Item
                  actions={[
                    <Popconfirm title="确认删除？" onConfirm={() => handleDeleteCondaEnv(env.id)}>
                      <Button type="link" danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={env.name}
                    description={env.path ? env.path : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>conda activate {env.name}</span>}
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </Card>
    </div>
  )
}
