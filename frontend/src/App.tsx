import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, Spin } from 'antd'
import { useAuthStore } from './store/authStore'
import { antdTheme } from './theme/antdTheme'
import { authApi } from './api/auth'
import LoginPage from './pages/LoginPage'
import AppLayout from './components/AppLayout'

export default function App() {
  const { isAuthenticated } = useAuthStore()
  const [isSetup, setIsSetup] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi
      .getStatus()
      .then((res) => setIsSetup(res.data.is_setup))
      .catch(() => setIsSetup(false))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Spin size="large" tip="正在连接服务..." />
      </div>
    )
  }

  return (
    <ConfigProvider theme={antdTheme}>
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? <Navigate to="/" replace /> : <LoginPage isSetup={isSetup ?? false} />
          }
        />
        <Route
          path="/*"
          element={isAuthenticated ? <AppLayout /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </BrowserRouter>
    </ConfigProvider>
  )
}
