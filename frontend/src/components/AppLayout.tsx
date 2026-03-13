import React, { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Button, Typography, Space, Badge, Drawer } from 'antd'
import {
  DesktopOutlined,
  ScheduleOutlined,
  HistoryOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/authStore'
import { useTasksStore } from '../store/tasksStore'
import { tasksApi } from '../api/tasks'
import MachinesPage from '../pages/MachinesPage'
import TasksPage from '../pages/TasksPage'
import HistoryPage from '../pages/HistoryPage'
import SettingsPage from '../pages/SettingsPage'

const { Header, Content, Sider } = Layout
const { Title } = Typography

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((s) => s.logout)
  const { runningCount, setRunningCount } = useTasksStore()
  const [siderBroken, setSiderBroken] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  // N1: 轮询运行中任务数，驱动侧边菜单 badge
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const [plRes, orphanRes] = await Promise.all([
          tasksApi.listPipelines(),
          tasksApi.listOrphanedTasks(),
        ])
        const count =
          plRes.data.flatMap((p) => p.tasks).filter((t) => t.status === 'running').length +
          orphanRes.data.filter((t) => t.status === 'running').length
        setRunningCount(count)
      } catch {}
    }
    fetchCount()
    const timer = setInterval(fetchCount, 5000)
    return () => clearInterval(timer)
  }, [setRunningCount])

  const selectedKey =
    ['/machines', '/tasks', '/history', '/settings'].find((k) =>
      location.pathname.startsWith(k)
    ) ?? '/machines'

  const menuLabelStyle: React.CSSProperties = { fontWeight: 600, fontSize: 14 }

  const menuItems = [
    { key: '/machines', icon: <DesktopOutlined />, label: <span style={menuLabelStyle}>机器管理</span> },
    {
      key: '/tasks',
      icon: <ScheduleOutlined />,
      label: (
        <Badge count={runningCount} size="small" offset={[8, 0]}>
          <span style={{ ...menuLabelStyle, color: 'inherit' }}>任务管理</span>
        </Badge>
      ),
    },
    { key: '/history', icon: <HistoryOutlined />, label: <span style={menuLabelStyle}>历史任务</span> },
    { key: '/settings', icon: <SettingOutlined />, label: <span style={menuLabelStyle}>设置</span> },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key)
    setMobileDrawerOpen(false)
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#1c0f28',
          padding: '0 16px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <Space align="center">
          {siderBroken && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              style={{ color: '#ddb8d5', marginRight: 4 }}
              onClick={() => setMobileDrawerOpen(true)}
            />
          )}
          <img
            src="/assets/PPH-logo-round.png"
            alt="PurpleHaze"
            style={{ width: 28, height: 28 }}
          />
          <Title level={4} style={{ color: '#f5edf4', margin: 0, lineHeight: 1 }}>
            PurpleHaze
          </Title>
        </Space>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          style={{ color: '#ddb8d5' }}
          onClick={logout}
        >
          {!siderBroken && '退出登录'}
        </Button>
      </Header>

      <Layout>
        <Sider
          width={180}
          breakpoint="md"
          collapsedWidth={0}
          onBreakpoint={(broken) => setSiderBroken(broken)}
          style={{ background: '#1c1030', borderRight: '1px solid rgba(188,115,173,0.15)' }}
          trigger={null}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            theme="dark"
            style={{ height: '100%', borderRight: 0, paddingTop: 8, background: 'transparent' }}
            onClick={handleMenuClick}
          />
        </Sider>

        {/* N3: 手机端抽屉导航 */}
        <Drawer
          placement="left"
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          width={200}
          styles={{ header: { display: 'none' }, body: { padding: 0 } }}
        >
          <div style={{ padding: '16px 0 8px', textAlign: 'center' }}>
            <Title level={5} style={{ color: '#bc73ad', margin: 0 }}>PurpleHaze</Title>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            style={{ borderRight: 0 }}
            onClick={handleMenuClick}
          />
        </Drawer>

        <Content style={{ padding: '24px', background: 'transparent', minHeight: 'calc(100vh - 64px)', overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<MachinesPage />} />
            <Route path="/machines" element={<MachinesPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}
