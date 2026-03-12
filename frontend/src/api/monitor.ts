import client from './client'

export interface GpuProcess {
  pid: number
  name: string
  used_memory_mb: number       // GPU 显存占用
  username?: string
  cmdline?: string             // 截断至 300 字符
  cpu_percent: number
  memory_mb: number            // 系统 RAM 占用
}

export interface GpuInfo {
  index: number
  name: string
  utilization: number
  memory_used_mb: number
  memory_total_mb: number
  power_draw_w?: number
  power_limit_w?: number
  temperature_c?: number
  processes: GpuProcess[]
}

export interface ResourceSnapshot {
  machine_id: number
  timestamp: string
  cpu_percent: number
  cpu_name?: string
  cpu_count?: number
  memory_used_mb: number
  memory_total_mb: number
  gpus: GpuInfo[]
  error?: string
}

export const monitorApi = {
  getResources: (machineId: number) =>
    client.get<ResourceSnapshot>(`/monitor/${machineId}/resources`),
}
