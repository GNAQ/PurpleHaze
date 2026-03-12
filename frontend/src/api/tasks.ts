import client from './client'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type TaskStatus = 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ArgItem {
  name: string
  value: string
}

export interface TaskConfig {
  conda_env_id?: number | null
  env_vars?: Record<string, string>
  work_dir?: string
  command?: string
  args?: ArgItem[]
}

export interface GpuConditionItem {
  type: 'mem' | 'util' | 'power' | 'procs'
  op: '>' | '<' | '>=' | '<='
  value: number
}

export interface GpuCondition {
  mode: 'force' | 'smart'
  gpu_ids?: number[]
  min_gpus?: number
  idle_minutes?: number
  conditions?: GpuConditionItem[]
  condition_expr?: string
}

export interface Task {
  id: number
  name: string
  pipeline_id: number | null
  sort_order: number
  machine_id: number | null
  config: TaskConfig | null
  gpu_condition: GpuCondition | null
  status: TaskStatus
  assigned_gpu_ids: number[] | null
  pid: number | null
  exit_code: number | null
  meta: Record<string, any> | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface Pipeline {
  id: number
  name: string
  sort_order: number
  created_at: string
  tasks: Task[]
}

export interface TaskTemplate {
  id: number
  name: string
  machine_id: number | null
  config: TaskConfig | null
  gpu_condition: GpuCondition | null
  created_at: string
  updated_at: string
}

export interface GpuPreset {
  id: number
  name: string
  condition: GpuCondition | null
  created_at: string
}

export interface CondaEnv {
  id: number
  name: string
  path: string
  created_at: string
}

export interface TaskLogsResponse {
  task_id: number
  stdout: string
  stderr: string
  truncated: boolean
}

// ── 路径浏览 ──────────────────────────────────────────────────────────────────

export interface FsItem {
  name: string
  path: string
  is_dir: boolean
}

export interface BrowseResponse {
  path: string
  parent: string | null
  items: FsItem[]
}

// ── API ───────────────────────────────────────────────────────────────────────

export const tasksApi = {
  // 流水线
  listPipelines: () => client.get<Pipeline[]>('/tasks/pipelines'),
  createPipeline: (data: { name: string; sort_order?: number }) =>
    client.post<Pipeline>('/tasks/pipelines', data),
  updatePipeline: (id: number, data: { name?: string; sort_order?: number }) =>
    client.put<Pipeline>(`/tasks/pipelines/${id}`, data),
  deletePipeline: (id: number) => client.delete(`/tasks/pipelines/${id}`),

  // 任务
  createTask: (data: {
    name?: string
    pipeline_id?: number | null
    machine_id?: number | null
    config?: TaskConfig | null
    gpu_condition?: GpuCondition | null
  }) => client.post<Task>('/tasks', data),
  updateTask: (id: number, data: {
    name?: string
    pipeline_id?: number | null
    sort_order?: number
    machine_id?: number | null
    config?: TaskConfig | null
    gpu_condition?: GpuCondition | null
  }) => client.put<Task>(`/tasks/${id}`, data),
  deleteTask: (id: number) => client.delete(`/tasks/${id}`),
  cancelTask: (id: number) => client.post<Task>(`/tasks/${id}/cancel`),

  // 日志
  getLogs: (id: number) => client.get<TaskLogsResponse>(`/tasks/${id}/logs`),
  getLogDownloadUrl: (id: number, logType: 'stdout' | 'stderr') =>
    `/api/tasks/${id}/logs/download?log_type=${logType}`,

  // 模板
  listTemplates: () => client.get<TaskTemplate[]>('/tasks/templates'),
  createTemplate: (data: { name: string; machine_id?: number | null; config?: TaskConfig | null; gpu_condition?: GpuCondition | null }) =>
    client.post<TaskTemplate>('/tasks/templates', data),
  updateTemplate: (id: number, data: { name?: string; machine_id?: number | null; config?: TaskConfig | null; gpu_condition?: GpuCondition | null }) =>
    client.put<TaskTemplate>(`/tasks/templates/${id}`, data),
  listOrphanedTasks: () => client.get<Task[]>('/tasks/orphaned'),
  deleteTemplate: (id: number) => client.delete(`/tasks/templates/${id}`),

  // 抢卡条件预设
  listGpuPresets: () => client.get<GpuPreset[]>('/tasks/gpu-presets'),
  createGpuPreset: (data: { name: string; condition?: GpuCondition | null }) =>
    client.post<GpuPreset>('/tasks/gpu-presets', data),
  updateGpuPreset: (id: number, data: { name?: string; condition?: GpuCondition | null }) =>
    client.put<GpuPreset>(`/tasks/gpu-presets/${id}`, data),
  deleteGpuPreset: (id: number) => client.delete(`/tasks/gpu-presets/${id}`),

  // Conda 环境
  listCondaEnvs: () => client.get<CondaEnv[]>('/tasks/conda-envs'),
  createCondaEnv: (data: { name: string; path?: string }) =>
    client.post<CondaEnv>('/tasks/conda-envs', data),
  updateCondaEnv: (id: number, data: { name?: string; path?: string }) =>
    client.put<CondaEnv>(`/tasks/conda-envs/${id}`, data),
  deleteCondaEnv: (id: number) => client.delete(`/tasks/conda-envs/${id}`),

  // 历史
  listHistory: (params?: { limit?: number; offset?: number; status_filter?: string }) =>
    client.get<Task[]>('/tasks/history', { params }),
  historyCount: (params?: { status_filter?: string }) => client.get<{ count: number }>('/tasks/history/count', { params }),

  // 文件浏览
  browse: (path: string, machineId?: number) =>
    client.get<BrowseResponse>('/fs/browse', { params: { path, machine_id: machineId || 0 } }),

  // 在系统文件管理器中打开本地目录
  openPath: (path: string) =>
    client.post<{ ok: boolean }>('/fs/open', null, { params: { path } }),
}
