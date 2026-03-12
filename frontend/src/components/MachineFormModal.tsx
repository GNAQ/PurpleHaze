import { useEffect } from 'react'
import {
  Modal, Form, Input, InputNumber, Switch, Select, Divider,
  Tabs, Typography, Row, Col,
} from 'antd'
import type { Machine, MachineCreate } from '../api/machines'

const { Text } = Typography

interface Props {
  open: boolean
  machine?: Machine | null
  onOk: (data: MachineCreate) => Promise<void>
  onCancel: () => void
}

export default function MachineFormModal({ open, machine, onOk, onCancel }: Props) {
  const [form] = Form.useForm<MachineCreate & {
    auth_method: 'password' | 'key'
    proxy_auth_method: 'password' | 'key'
    use_proxy_jump: boolean
    confirm?: string
  }>()
  const isEdit = !!machine

  useEffect(() => {
    if (open) {
      if (machine) {
        const hasProxy = !!machine.proxy_jump_host
        form.setFieldsValue({
          name: machine.name,
          is_local: machine.is_local,
          ssh_host: machine.ssh_host,
          ssh_port: machine.ssh_port,
          ssh_username: machine.ssh_username,
          auto_connect: machine.auto_connect,
          auto_reconnect: machine.auto_reconnect,
          monitor_config: machine.monitor_config ?? { interval: 10 },
          auth_method: machine.has_private_key ? 'key' : 'password',
          use_proxy_jump: hasProxy,
          proxy_jump_host: machine.proxy_jump_host,
          proxy_jump_port: machine.proxy_jump_port ?? 22,
          proxy_jump_username: machine.proxy_jump_username,
          proxy_auth_method: machine.has_proxy_jump_private_key ? 'key' : 'password',
        })
      } else {
        form.resetFields()
        form.setFieldsValue({
          is_local: false, ssh_port: 22,
          auto_connect: false, auto_reconnect: true,
          monitor_config: { interval: 10 },
          use_proxy_jump: false, proxy_jump_port: 22,
        })
      }
    }
  }, [open, machine])

  const handleOk = async () => {
    const values = await form.validateFields()
    const useProxy = values.use_proxy_jump
    const data: MachineCreate = {
      name: values.name,
      is_local: values.is_local ?? false,
      ssh_host: values.ssh_host,
      ssh_port: values.ssh_port ?? 22,
      ssh_username: values.ssh_username,
      ssh_password: values.ssh_password,
      ssh_private_key: values.ssh_private_key,
      // 跳板机：未启用时置空
      proxy_jump_host: useProxy ? values.proxy_jump_host : undefined,
      proxy_jump_port: useProxy ? (values.proxy_jump_port ?? 22) : undefined,
      proxy_jump_username: useProxy ? values.proxy_jump_username : undefined,
      proxy_jump_password: useProxy ? values.proxy_jump_password : undefined,
      proxy_jump_private_key: useProxy ? values.proxy_jump_private_key : undefined,
      auto_connect: values.auto_connect ?? false,
      auto_reconnect: values.auto_reconnect ?? true,
      monitor_config: values.monitor_config,
      sort_order: values.sort_order ?? 0,
    }
    await onOk(data)
  }

  return (
    <Modal
      title={isEdit ? '编辑机器' : '添加机器'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={isEdit ? '保存' : '添加'}
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" size="middle">
        <Form.Item name="name" label="显示名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="例如：GPU 服务器 #1" />
        </Form.Item>

        <Form.Item name="is_local" label="机器类型" valuePropName="checked">
          <Switch checkedChildren="本地机器" unCheckedChildren="远程机器" />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.is_local !== cur.is_local}>
          {({ getFieldValue }) =>
            !getFieldValue('is_local') && (
              <>
                <Divider orientation="left" plain style={{ fontSize: 12, color: '#6b7280' }}>SSH 连接信息</Divider>
                <Row gutter={12}>
                  <Col span={16}>
                    <Form.Item name="ssh_host" label="主机地址" rules={[{ required: true, message: '请输入主机地址' }]}>
                      <Input placeholder="192.168.1.100" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="ssh_port" label="端口">
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="ssh_username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input placeholder="ubuntu" />
                </Form.Item>

                <Form.Item name="auth_method" label="认证方式">
                  <Select options={[
                    { value: 'password', label: '密码' },
                    { value: 'key', label: 'SSH 私钥' },
                  ]} />
                </Form.Item>

                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.auth_method !== cur.auth_method}>
                  {({ getFieldValue: gfv }) =>
                    gfv('auth_method') === 'key' ? (
                      <Form.Item name="ssh_private_key" label="SSH 私钥（PEM 格式）">
                        <Input.TextArea rows={5} placeholder="-----BEGIN RSA PRIVATE KEY-----" />
                      </Form.Item>
                    ) : (
                      <Form.Item name="ssh_password" label="SSH 密码">
                        <Input.Password placeholder="留空则保持原密码不变" />
                      </Form.Item>
                    )
                  }
                </Form.Item>

                {/* ── 跳板机配置 ── */}
                <Divider orientation="left" plain style={{ fontSize: 12, color: '#6b7280' }}>跳板机（ProxyJump）</Divider>
                <Form.Item name="use_proxy_jump" label="启用跳板机" valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                </Form.Item>

                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.use_proxy_jump !== cur.use_proxy_jump}>
                  {({ getFieldValue: gfv }) =>
                    gfv('use_proxy_jump') && (
                      <>
                        <Row gutter={12}>
                          <Col span={16}>
                            <Form.Item name="proxy_jump_host" label="跳板机地址"
                              rules={[{ required: true, message: '请输入跳板机地址' }]}>
                              <Input placeholder="jump.example.com" />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name="proxy_jump_port" label="端口">
                              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item name="proxy_jump_username" label="跳板机用户名"
                          rules={[{ required: true, message: '请输入跳板机用户名' }]}>
                          <Input placeholder="user" />
                        </Form.Item>
                        <Form.Item name="proxy_auth_method" label="跳板机认证方式">
                          <Select options={[
                            { value: 'password', label: '密码' },
                            { value: 'key', label: 'SSH 私钥' },
                          ]} />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.proxy_auth_method !== cur.proxy_auth_method}>
                          {({ getFieldValue: gfv2 }) =>
                            gfv2('proxy_auth_method') === 'key' ? (
                              <Form.Item name="proxy_jump_private_key" label="跳板机私钥（PEM 格式）">
                                <Input.TextArea rows={4} placeholder="-----BEGIN RSA PRIVATE KEY-----" />
                              </Form.Item>
                            ) : (
                              <Form.Item name="proxy_jump_password" label="跳板机密码">
                                <Input.Password placeholder="留空则保持原密码不变" />
                              </Form.Item>
                            )
                          }
                        </Form.Item>
                      </>
                    )
                  }
                </Form.Item>

                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="auto_connect" label="登录后自动连接" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="auto_reconnect" label="自动重连" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                </Row>
              </>
            )
          }
        </Form.Item>

        <Divider orientation="left" plain style={{ fontSize: 12, color: '#6b7280' }}>监控配置</Divider>
        <Form.Item name={['monitor_config', 'interval']} label="刷新间隔（秒）">
          <InputNumber min={1} max={3600} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
