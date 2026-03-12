import { useState } from 'react'
import { Card, Form, Input, Button, Typography, message, Space } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../api/auth'

const { Title, Paragraph } = Typography

interface Props {
  isSetup: boolean
}

export default function LoginPage({ isSetup }: Props) {
  const [loading, setLoading] = useState(false)
  const [setupMode, setSetupMode] = useState(!isSetup)
  const login = useAuthStore((s) => s.login)

  const handleSubmit = async (values: { password: string; confirm?: string }) => {
    setLoading(true)
    try {
      if (setupMode) {
        if (!values.confirm || values.password !== values.confirm) {
          message.error('两次输入的密码不一致')
          return
        }
        await authApi.setup(values.password)
        message.success('密码设置成功，请登录')
        setSetupMode(false)
      } else {
        const res = await authApi.login(values.password)
        login(res.data.access_token)
        message.success('登录成功')
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail
      message.error(detail ?? (setupMode ? '设置密码失败' : '密码错误'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1c0f28 0%, #7a3b6e 100%)',
      }}
    >
      <Card
        style={{ width: 380, borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
        variant="borderless"
      >
        <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 24, textAlign: 'center' }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="24" fill="#bc73ad" />
            <text x="24" y="32" textAnchor="middle" fontSize="24" fill="white" fontWeight="bold">P</text>
          </svg>
          <Title level={3} style={{ margin: 0 }}>PurpleHaze</Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            {setupMode ? '首次使用，请设置登录密码' : '请输入密码以继续'}
          </Paragraph>
        </Space>

        <Form layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              setupMode ? { min: 6, message: '密码至少 6 位' } : {},
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" size="large" />
          </Form.Item>

          {setupMode && (
            <Form.Item
              name="confirm"
              label="确认密码"
              rules={[{ required: true, message: '请再次输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请再次输入密码" size="large" />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              size="large"
              block
            >
              {setupMode ? '设置密码' : '登录'}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
