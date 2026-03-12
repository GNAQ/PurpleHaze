import client from './client'

export interface Machine {
  id: number
  name: string
  is_local: boolean
  ssh_host?: string
  ssh_port: number
  ssh_username?: string
  has_password: boolean
  has_private_key: boolean
  // 跳板机
  proxy_jump_host?: string
  proxy_jump_port: number
  proxy_jump_username?: string
  has_proxy_jump_password: boolean
  has_proxy_jump_private_key: boolean
  auto_connect: boolean
  auto_reconnect: boolean
  monitor_config?: { interval?: number }
  sort_order: number
  created_at: string
  updated_at: string
  connected: boolean
}

export interface MachineCreate {
  name: string
  is_local?: boolean
  ssh_host?: string
  ssh_port?: number
  ssh_username?: string
  ssh_password?: string
  ssh_private_key?: string
  // 跳板机
  proxy_jump_host?: string
  proxy_jump_port?: number
  proxy_jump_username?: string
  proxy_jump_password?: string
  proxy_jump_private_key?: string
  auto_connect?: boolean
  auto_reconnect?: boolean
  monitor_config?: { interval?: number }
  sort_order?: number
}

export type MachineUpdate = Partial<MachineCreate>

export interface ConnectionStatus {
  machine_id: number
  connected: boolean
  error?: string
}

export const machinesApi = {
  list: () => client.get<{ machines: Machine[] }>('/machines'),
  create: (data: MachineCreate) => client.post<Machine>('/machines', data),
  get: (id: number) => client.get<Machine>(`/machines/${id}`),
  update: (id: number, data: MachineUpdate) => client.put<Machine>(`/machines/${id}`, data),
  delete: (id: number) => client.delete(`/machines/${id}`),
  connect: (id: number) => client.post<ConnectionStatus>(`/machines/${id}/connect`),
  disconnect: (id: number) => client.post<ConnectionStatus>(`/machines/${id}/disconnect`),
  getSnapshot: (id: number) =>
    client.get<{ gpus?: Array<{ index: number }> }>(`/monitor/${id}/resources`),
}
