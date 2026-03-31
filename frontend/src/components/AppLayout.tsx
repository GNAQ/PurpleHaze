import React, { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Button, Space, Badge, Tooltip, Drawer, Menu } from 'antd'
import {
  DesktopOutlined,
  ScheduleOutlined,
  HistoryOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/authStore'
import { useTasksStore } from '../store/tasksStore'
import { tasksApi } from '../api/tasks'
import { ph } from '../theme/tokens'
import { useTheme } from '../theme/useTheme'
import MachinesPage from '../pages/MachinesPage'
import TasksPage from '../pages/TasksPage'
import HistoryPage from '../pages/HistoryPage'
import SettingsPage from '../pages/SettingsPage'

const NAV_ITEMS = [
  { key: '/machines', icon: <DesktopOutlined />, label: '机器管理' },
  { key: '/tasks', icon: <ScheduleOutlined />, label: '任务管理' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史任务' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
]

const SIDEBAR_COLLAPSED = 54
const SIDEBAR_EXPANDED = 188

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t, isDark, toggle } = useTheme()
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

  const lightShellBackground = 'radial-gradient(circle at 0% 0%, rgba(168,64,151,0.12) 0%, rgba(168,64,151,0.04) 22%, transparent 46%), radial-gradient(circle at 100% 0%, rgba(92,193,116,0.12) 0%, rgba(92,193,116,0.04) 24%, transparent 50%), linear-gradient(135deg, #f1ecef 0%, #f4f0f4 52%, #eef3ee 100%)'
  const lightSidebarBackground = 'linear-gradient(180deg, rgba(231,223,232,0.97) 0%, rgba(236,229,236,0.97) 42%, rgba(224,234,226,0.97) 100%)'

  const sidebarWidth = isMobile ? 0 : (sidebarHover ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED)

  const handleNav = (key: string) => {
    navigate(key)
    setMobileDrawerOpen(false)
  }

  // Build status summary line
  const statusParts: string[] = []
  if (runningCount > 0) statusParts.push(`${runningCount} running`)
  const statusLabel = statusParts.length > 0 ? statusParts.join(' · ') : 'scheduler ready'

  return (
    <div
      style={{
        height: '100vh',
        overflow: 'hidden',
        background: isDark ? t.bg : lightShellBackground,
        display: 'flex',
      }}
    >
      {/* ── Sidebar (icon rail) ── */}
      {!isMobile && (
        <nav
          className="ph-sidebar"
          onMouseEnter={() => setSidebarHover(true)}
          onMouseLeave={() => setSidebarHover(false)}
          style={{
            width: sidebarWidth,
            minWidth: sidebarWidth,
            background: isDark ? 'rgba(11,8,17,0.65)' : lightSidebarBackground,
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRight: `1px solid ${t.glassBorder}`,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 12,
            flexShrink: 0,
            position: 'relative',
            zIndex: 50,
          }}
        >
          <div style={{ padding: '0 10px 10px 12px' }}>
            <Tooltip title={!sidebarHover ? statusLabel : undefined} placement="right">
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: sidebarHover ? 'flex-start' : 'center',
                  gap: 8,
                  width: sidebarHover ? '100%' : 28,
                  minHeight: 28,
                  padding: sidebarHover ? '0 10px' : 0,
                  borderRadius: 999,
                  background: isDark
                    ? 'rgba(29,22,42,0.72)'
                    : 'linear-gradient(90deg, rgba(168,64,151,0.12) 0%, rgba(92,193,116,0.08) 100%)',
                  border: `1px solid ${t.glassBorder}`,
                  boxShadow: isDark ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.18)',
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: statusParts.length > 0 ? ph.green500 : t.textTer,
                    boxShadow: statusParts.length > 0 ? `0 0 10px ${ph.green500}` : 'none',
                    flexShrink: 0,
                  }}
                />
                {sidebarHover && (
                  <span className="ph-mono" style={{ fontSize: 10, color: statusParts.length > 0 ? ph.green500 : t.textSec, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
                    {statusLabel}
                  </span>
                )}
              </div>
            </Tooltip>
          </div>

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
                      padding: '0 14px 0 16px',
                      height: 44,
                      cursor: 'pointer',
                      position: 'relative',
                      color: active ? (isDark ? ph.purple400 : ph.purple700) : t.textSec,
                      background: active ? t.activeTint : 'transparent',
                      borderLeft: active ? `3px solid ${ph.purple500}` : '3px solid transparent',
                      borderRadius: '0 14px 14px 0',
                      marginRight: 10,
                      boxShadow: active && !isDark ? '0 8px 18px rgba(99,54,104,0.06), inset 0 1px 0 rgba(255,255,255,0.18)' : undefined,
                      transition: 'all 0.2s ease',
                      fontSize: 16,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = t.hoverTint
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

          {/* Theme toggle */}
          <Tooltip title={!sidebarHover ? (isDark ? '浅色模式' : '深色模式') : undefined} placement="right">
            <div
              onClick={toggle}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 16px',
                height: 44,
                cursor: 'pointer',
                color: t.textTer,
                transition: 'color 0.2s',
                marginTop: 'auto',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = isDark ? ph.purple400 : ph.purple700 }}
              onMouseLeave={(e) => { e.currentTarget.style.color = t.textTer }}
            >
              {isDark
                ? <SunOutlined style={{ fontSize: 16, flexShrink: 0 }} />
                : <MoonOutlined style={{ fontSize: 16, flexShrink: 0 }} />}
              <span className="ph-nav-label" style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                {isDark ? '浅色模式' : '深色模式'}
              </span>
            </div>
          </Tooltip>

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
                color: t.textTer,
                borderTop: `1px solid ${t.divider}`,
                transition: 'color 0.2s',
                marginTop: 'auto',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = ph.error }}
              onMouseLeave={(e) => { e.currentTarget.style.color = t.textTer }}
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
          body: { padding: '12px 0 0', background: t.surface0 },
        }}
      >
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={NAV_ITEMS.map((i) => ({ key: i.key, icon: i.icon, label: i.label }))}
          theme={isDark ? 'dark' : 'light'}
          style={{ borderRight: 0, background: 'transparent' }}
          onClick={({ key }) => handleNav(key)}
        />
      </Drawer>

      {/* ── Content ── */}
      <main style={{ flex: 1, padding: isMobile ? '56px 12px 12px' : '14px 16px 16px', overflow: 'hidden', height: '100%', position: 'relative' }}>
        {isMobile && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              right: 12,
              zIndex: 90,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pointerEvents: 'none',
            }}
          >
            <Button
              type="text"
              icon={<MenuOutlined />}
              style={{
                pointerEvents: 'auto',
                color: isDark ? ph.purple400 : ph.purple700,
                background: isDark ? 'rgba(20,15,30,0.78)' : 'rgba(239,233,239,0.92)',
                border: `1px solid ${t.glassBorder}`,
                boxShadow: isDark ? 'none' : '0 10px 20px rgba(78,52,86,0.08)',
              }}
              onClick={() => setMobileDrawerOpen(true)}
            />
            <div
              style={{
                pointerEvents: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                minHeight: 32,
                padding: '0 10px',
                borderRadius: 999,
                background: isDark
                  ? 'rgba(29,22,42,0.72)'
                  : 'linear-gradient(90deg, rgba(168,64,151,0.12) 0%, rgba(92,193,116,0.08) 100%)',
                border: `1px solid ${t.glassBorder}`,
                boxShadow: isDark ? 'none' : '0 10px 20px rgba(78,52,86,0.08)',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: statusParts.length > 0 ? ph.green500 : t.textTer,
                  boxShadow: statusParts.length > 0 ? `0 0 10px ${ph.green500}` : 'none',
                  flexShrink: 0,
                }}
              />
              <span className="ph-mono" style={{ fontSize: 10, color: statusParts.length > 0 ? ph.green500 : t.textSec, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
                {statusLabel}
              </span>
            </div>
          </div>
        )}
        <div
          key={routeKey}
          className="ph-page-enter"
          style={{
            height: '100%',
            overflow: 'hidden',
            background: 'transparent',
            borderRadius: 0,
          }}
        >
          <Routes>
            <Route path="/" element={<MachinesPage />} />
            <Route path="/machines" element={<MachinesPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/history" element={<div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}><HistoryPage /></div>} />
            <Route path="/settings" element={<div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}><SettingsPage /></div>} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
