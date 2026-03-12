import client from './client'

export interface AuthStatus {
  is_setup: boolean
}

export interface LoginResponse {
  access_token: string
  token_type: string
}

export interface SettingItem {
  key: string
  value: string
  description?: string
}

export const authApi = {
  getStatus: () => client.get<AuthStatus>('/auth/status'),
  setup: (password: string) => client.post('/auth/setup', { password }),
  login: (password: string) => client.post<LoginResponse>('/auth/login', { password }),
  changePassword: (old_password: string, new_password: string) =>
    client.post('/auth/change-password', { old_password, new_password }),
  getSettings: () => client.get<{ settings: SettingItem[] }>('/auth/settings'),
  updateSettings: (settings: SettingItem[]) =>
    client.put('/auth/settings', { settings }),
}
