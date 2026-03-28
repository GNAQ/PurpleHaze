import React, { useEffect, useState, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Button, Typography, Space, Badge, Tooltip, Drawer, Menu } from 'antd'
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
import { ph } from '../theme/tokens'
import MachinesPage from '../pages/MachinesPage'
import TasksPage from '../pages/TasksPage'
import HistoryPage from '../pages/HistoryPage'
import SettingsPage from '../pages/SettingsPage'

const { Title, Text } = Typography

const NAV_ITEMS = [
  { key: '/machines', icon: <DesktopOutlined />, label: '机器管理' },
  { key: '/tasks', icon: <ScheduleOutlined />, label: '任务管理' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史任务' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
]

const SIDEBAR_COLLAPSED = 56
const SIDEBAR_EXPANDED = 192
const HEADER_HEIGHT = 48

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((s) => s.logout)
  const { runningCount, setRunningCount } = useTasksStore()
  const [sidebarHover, setSidebarHover] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [routeKey, setRouteKey] = useState(location.pathname)

  useEffect(() => {
    setRouteKey(location.pathname)
  }, [location.pathname])

  // Check breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Poll running task count
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

  const sidebarWidth = isMobile ? 0 : (sidebarHover ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED)

  const handleNav = (key: string) => {
    navigate(key)
    setMobileDrawerOpen(false)
  }

  // Build status summary line
  const statusParts: string[] = []
  if (runningCount > 0) statusParts.push(`${runningCount} running`)

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: ph.dark.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(11,8,17,0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${ph.glass.border}`,
          padding: '0 20px',
          height: HEADER_HEIGHT,
          flexShrink: 0,
          zIndex: 100,
        }}
      >
        <Space align="center" size={10}>
          {isMobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              style={{ color: ph.purple400 }}
              onClick={() => setMobileDrawerOpen(true)}
            />
          )}
          <img
            src="/assets/PPH-logo-round.png"
            alt="PurpleHaze"
            style={{ width: 24, height: 24, filter: 'drop-shadow(0 0 6px rgba(188,115,173,0.4))' }}
          />
          <Title level={5} style={{ color: ph.purple300, margin: 0, lineHeight: 1, letterSpacing: 1, fontSize: 14 }}>
            PurpleHaze
          </Title>
        </Space>
        <Space size={16} align="center">
          {statusParts.length > 0 && (
            <Text className="ph-mono" style={{ fontSize: 11, color: ph.green500 }}>
              {statusParts.join(' · ')}
            </Text>
          )}
        </Space>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ── Sidebar (icon rail) ── */}
        {!isMobile && (
          <nav
            className="ph-sidebar"
            onMouseEnter={() => setSidebarHover(true)}
            onMouseLeave={() => setSidebarHover(false)}
            style={{
              width: sidebarWidth,
              minWidth: sidebarWidth,
              background: 'rgba(11,8,17,0.65)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRight: `1px solid ${ph.glass.border}`,
              display: 'flex',
              flexDirection: 'column',
              paddingTop: 12,
              flexShrink: 0,
              position: 'relative',
              zIndex: 50,
            }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {NAV_ITEMS.map((item) => {
                const active = selectedKey === item.key
                const isTask = item.key === '/tasks'
                return (
                  <Tooltip key={item.key} title={!sidebarHover ? item.label : undefined} placement="right">
                    <div
                      onClick={() => handleNav(item.key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '0 16px',
                        height: 44,
                        cursor: 'pointer',
                        position: 'relative',
                        color: active ? ph.purple400 : ph.dark.textSec,
                        background: active ? 'rgba(188,115,173,0.10)' : 'transparent',
                        borderLeft: active ? `3px solid ${ph.purple500}` : '3px solid transparent',
                        transition: 'all 0.2s ease',
                        fontSize: 16,
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = 'rgba(188,115,173,0.06)'
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        {isTask && runningCount > 0 ? (
                          <Badge count={runningCount} size="small" offset={[4, -2]} color={ph.green500}>
                            {item.icon}
                          </Badge>
                        ) : item.icon}
                      </span>
                      <span
                        className="ph-nav-label"
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          letterSpacing: 0.3,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                        }}
                      >
                        {item.label}
                      </span>
                    </div>
                  </Tooltip>
                )
              })}
            </div>

            {/* Logout at bottom */}
            <Tooltip title={!sidebarHover ? '退出' : undefined} placement="right">
              <div
                onClick={logout}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0 16px',
                  height: 44,
                  cursor: 'pointer',
                  color: ph.dark.textTer,
                  borderTop: `1px solid ${ph.dark.divider}`,
                  transition: 'color 0.2s',
                  marginTop: 'auto',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = ph.error }}
                onMouseLeave={(e) => { e.currentTarget.style.color = ph.dark.textTer }}
              >
                <LogoutOutlined style={{ fontSize: 16, flexShrink: 0 }} />
                <span className="ph-nav-label" style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                  退出
                </span>
              </div>
            </Tooltip>
          </nav>
        )}

        {/* Mobile drawer */}
        <Drawer
          placement="left"
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          width={200}
          styles={{
            header: { display: 'none' },
            body: { padding: 0, background: ph.dark.surface0 },
          }}
        >
          <div style={{ padding: '16px 0 8px', textAlign: 'center' }}>
            <Title level={5} style={{ color: ph.purple400, margin: 0 }}>PurpleHaze</Title>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={NAV_ITEMS.map((i) => ({ key: i.key, icon: i.icon, label: i.label }))}
            theme="dark"
            style={{ borderRight: 0, background: 'transparent' }}
            onClick={({ key }) => handleNav(key)}
          />
        </Drawer>

        {/* ── Content ── */}
        <main style={{ flex: 1, padding: '20px 24px', overflow: 'hidden', height: '100%' }}>
          <div key={routeKey} className="ph-page-enter" style={{ height: '100%', overflow: 'hidden' }}>
            <Routes>
              <Route path="/" element={<MachinesPage />} />
              <Route path="/machines" element={<MachinesPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/history" element={<div style={{ height: '100%', overflowY: 'auto' }}><HistoryPage /></div>} />
              <Route path="/settings" element={<div style={{ height: '100%', overflowY: 'auto' }}><SettingsPage /></div>} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}
