import { useState } from 'react'
import { Form, Input, Button, Typography, message, Space } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../api/auth'
import { useTheme } from '../theme/useTheme'

const { Title, Paragraph } = Typography

interface Props {
  isSetup: boolean
}

export default function LoginPage({ isSetup }: Props) {
  const { t, isDark } = useTheme()
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

  const lightLoginBackground = 'radial-gradient(circle at 0% 0%, rgba(168,64,151,0.12) 0%, rgba(168,64,151,0.04) 22%, transparent 46%), radial-gradient(circle at 100% 0%, rgba(92,193,116,0.12) 0%, rgba(92,193,116,0.04) 24%, transparent 50%), linear-gradient(135deg, #f1ecef 0%, #f4f0f4 52%, #eef3ee 100%)'

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isDark ? t.bg : lightLoginBackground,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Ambient background glow */}
      <div style={{
        position: 'absolute',
        width: 500, height: 500,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(188,115,173,0.08) 0%, transparent 70%)',
        top: '20%', left: '30%',
        filter: 'blur(80px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        width: 400, height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(117,193,129,0.06) 0%, transparent 70%)',
        bottom: '10%', right: '20%',
        filter: 'blur(80px)',
        pointerEvents: 'none',
      }} />

      <div
        className="ph-glass ph-fade-in"
        style={{
          width: 400,
          borderRadius: 16,
          padding: '40px 32px',
          boxShadow: isDark ? '0 8px 40px rgba(0,0,0,0.5)' : '0 28px 56px rgba(78,52,86,0.12)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 28, textAlign: 'center' }}>
          <img
            src="/assets/PPH-logo-round.png"
            alt="PurpleHaze"
            style={{
              width: 52, height: 52,
              filter: 'drop-shadow(0 0 12px rgba(188,115,173,0.5))',
              margin: '0 auto',
              display: 'block',
            }}
          />
          <Title level={3} style={{ margin: 0, color: t.text, letterSpacing: 1 }}>
            PurpleHaze
          </Title>
          <Paragraph style={{ margin: 0, color: t.textSec, fontSize: 13 }}>
            {setupMode ? '首次使用，请设置登录密码' : '请输入密码以继续'}
          </Paragraph>
        </Space>

        <Form layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Form.Item
            name="password"
            label={<span style={{ color: t.textSec }}>密码</span>}
            rules={[
              { required: true, message: '请输入密码' },
              setupMode ? { min: 6, message: '密码至少 6 位' } : {},
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: t.textTer }} />}
              placeholder="请输入密码"
              size="large"
            />
          </Form.Item>

          {setupMode && (
            <Form.Item
              name="confirm"
              label={<span style={{ color: t.textSec }}>确认密码</span>}
              rules={[{ required: true, message: '请再次输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: t.textTer }} />}
                placeholder="请再次输入密码"
                size="large"
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              size="large"
              block
              style={{ fontWeight: 600, letterSpacing: 0.5 }}
            >
              {setupMode ? '设置密码' : '登录'}
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
