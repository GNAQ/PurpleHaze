# REST API 参考

**Base URL**：`http://localhost:34357`  
**鉴权**：除标注"公开"的接口外，所有接口需要 `Authorization: Bearer <token>` 请求头。  
**交互文档**：后端运行后访问 `/docs`（Swagger UI）或 `/redoc`。

---

## 认证（`/api/auth`）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/auth/status` | 公开 | 返回 `{is_setup: bool}`，前端据此跳转首次设置页 |
| POST | `/api/auth/setup` | 公开 | 首次设置密码（已设置后返回 400） |
| POST | `/api/auth/login` | 公开 | 密码登录，返回 `{access_token, token_type}` |
| POST | `/api/auth/change-password` | 需鉴权 | 修改密码 `{old_password, new_password}` |
| GET | `/api/auth/settings` | 需鉴权 | 读取全部 KV 设置 |
| PUT | `/api/auth/settings` | 需鉴权 | 批量写入 KV 设置 `{settings: [{key, value}]}` |

---

## 机器管理（`/api/machines`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/machines` | 列出所有机器（含连接状态） |
| POST | `/api/machines` | 创建机器（本地/远程） |
| GET | `/api/machines/{id}` | 获取单台机器详情 |
| PUT | `/api/machines/{id}` | 更新机器配置 |
| DELETE | `/api/machines/{id}` | 删除机器（同时断开 SSH，关联模板 `machine_id` 置 null） |
| POST | `/api/machines/{id}/connect` | 手动触发 SSH 连接 |
| POST | `/api/machines/{id}/disconnect` | 断开 SSH 连接 |

#### 创建/更新机器字段（`MachineCreate` / `MachineUpdate`）

```json
{
  "name": "服务器A",
  "is_local": false,
  "ssh_host": "192.168.1.100",
  "ssh_port": 22,
  "ssh_username": "user",
  "ssh_password": "xxx",       // 与 ssh_private_key 二选一
  "ssh_private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "auto_connect": true,
  "auto_reconnect": true,
  "monitor_config": {"interval": 10},
  "sort_order": 0
}
```

---

## 资源监控（`/api/monitor`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/monitor/{id}/resources` | 获取最新资源快照（支持 `?include_processes=true`） |
| POST | `/api/monitor/{id}/poll/start` | 启动/重启后台轮询（`?interval=10`） |
| POST | `/api/monitor/{id}/poll/stop` | 停止后台轮询 |

`ResourceSnapshot` 响应结构：
```json
{
  "machine_id": 1,
  "timestamp": "2026-03-12T08:00:00Z",
  "cpu_percent": 23.5,
  "cpu_count": 16,
  "cpu_name": "Intel Xeon ...",
  "memory_used_mb": 8192,
  "memory_total_mb": 65536,
  "gpus": [
    {
      "index": 0,
      "name": "NVIDIA A100",
      "utilization": 5.0,
      "memory_used_mb": 2048,
      "memory_total_mb": 40960,
      "power_draw_w": 60.0,
      "power_limit_w": 400.0,
      "temperature_c": 45,
      "processes": [...]
    }
  ]
}
```

---

## 任务管理（`/api/tasks`）

### 流水线

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/pipelines` | 列出所有流水线及其任务 |
| POST | `/api/tasks/pipelines` | 创建流水线 `{name, sort_order}` |
| PUT | `/api/tasks/pipelines/{pid}` | 更新流水线（名称/排序） |
| DELETE | `/api/tasks/pipelines/{pid}` | 删除流水线（含其所有任务） |

### 任务

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tasks` | 创建任务（`TaskCreate`，见下） |
| PUT | `/api/tasks/{id}` | 更新任务配置（仅 `WAITING` 状态可改） |
| DELETE | `/api/tasks/{id}` | 删除任务（运行中任务会先取消） |
| POST | `/api/tasks/{id}/cancel` | 取消任务（WAITING → CANCELLED；RUNNING → 发送终止信号） |
| GET | `/api/tasks/orphaned` | 列出已完成/失败/取消的孤立任务（无 pipeline） |
| GET | `/api/tasks/{id}/logs` | 读取任务日志 `{stdout, stderr}` 字符串 |
| GET | `/api/tasks/{id}/logs/download` | 下载日志文件（`?stream=stdout\|stderr`） |
| GET | `/api/tasks/history` | 历史任务列表（支持分页：`?page=1&size=50`） |
| GET | `/api/tasks/history/count` | 历史任务总数 |

#### `TaskCreate` 请求体

```json
{
  "name": "训练 ResNet",
  "pipeline_id": 1,
  "machine_id": 2,
  "config": {
    "conda_env_id": 3,
    "env_vars": {"NCCL_DEBUG": "INFO"},
    "work_dir": "/home/user/project",
    "command": "python train.py",
    "args": [{"name": "--epochs", "value": "100"}]
  },
  "gpu_condition": {
    "mode": "smart",
    "min_gpus": 2,
    "idle_minutes": 10,
    "condition_expr": "mem >= 20000 and util < 5"
  }
}
```

#### `TaskUpdate` 注意事项
- `machine_id` 和 `gpu_condition` 使用 Pydantic `model_fields_set`，只有显式传递的字段才会更新（可传 `null` 显式置空）。
- 处于 `RUNNING` / `COMPLETED` / `FAILED` 状态的任务无法修改（路由层返回 409）。

### 任务模板

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/templates` | 列出所有模板 |
| POST | `/api/tasks/templates` | 创建模板 |
| PUT | `/api/tasks/templates/{id}` | 更新模板 |
| DELETE | `/api/tasks/templates/{id}` | 删除模板 |

### GPU 条件预设

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/gpu-presets` | 列出预设 |
| POST | `/api/tasks/gpu-presets` | 创建预设 `{name, condition}` |
| PUT | `/api/tasks/gpu-presets/{id}` | 更新预设 |
| DELETE | `/api/tasks/gpu-presets/{id}` | 删除预设 |

### Conda 环境

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/conda-envs` | 列出已登记环境 |
| POST | `/api/tasks/conda-envs` | 登记环境 `{name, path}` |
| PUT | `/api/tasks/conda-envs/{id}` | 更新 |
| DELETE | `/api/tasks/conda-envs/{id}` | 删除（有 WAITING 任务引用时返回 400） |

---

## 文件系统（`/api/fs`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/fs/browse` | 浏览目录（`?path=/home/user&machine_id=1`，机器可省略则浏览本地） |
| POST | `/api/fs/open` | 在服务端 VSCode 实例中打开路径（`{path, machine_id?}`） |

---

## 健康检查

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/health` | 公开 | 返回 `{status: "ok", service: "Xxium"}` |
