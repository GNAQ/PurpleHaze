# 数据模型

所有模型定义在 `backend/models/`，使用 SQLAlchemy 2.0 Mapped 风格。  
数据库：SQLite，路径由 `PPH_DATA_DIR` 环境变量控制（默认 `backend/data/pph.db`）。

---

## auth.py

### `User`（表 `user`）
单用户系统，表中最多一行。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int PK | |
| `password_hash` | Text | bcrypt 哈希，`passlib[bcrypt]` 生成 |
| `created_at` | DateTime | UTC |

### `Setting`（表 `setting`）
KV 配置表，当前用于存储前端自定义配置（用户名称等）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | String(64) PK | 配置键 |
| `value` | Text | JSON 序列化值 |

---

## machine.py

### `Machine`（表 `machine`）
代表一台可用于运行任务的机器（本地或远程）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int PK | |
| `name` | String(128) | 显示名 |
| `is_local` | bool | `True`=本机（无 SSH），`False`=远程 |
| `ssh_host` | String(256) ¦ null | IP 或主机名 |
| `ssh_port` | int | 默认 22 |
| `ssh_username` | String(128) ¦ null | SSH 用户名 |
| `ssh_password` | Text ¦ null | **明文**存储，确保 DATA_DIR 权限为 700 |
| `ssh_private_key` | Text ¦ null | PEM 格式私钥内容（与密码二选一） |
| `auto_connect` | bool | 服务启动时自动建立 SSH 连接 |
| `auto_reconnect` | bool | SSH 断线后自动重连 |
| `monitor_config` | JSON ¦ null | 监控配置，如 `{"interval": 10}`（秒） |
| `sort_order` | int | 前端列表排序 |
| `created_at` / `updated_at` | DateTime | UTC |

**注意**：`interval` 写入时会被 `max(1, int(...))` 约束，最小 1 秒。

---

## task.py

### `Pipeline`（表 `pipeline`）
独立的任务队列。各流水线并发执行，同一流水线内任务按 `sort_order` 顺序执行（FIFO）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int PK | |
| `name` | String(128) | 显示名 |
| `sort_order` | int | 前端排序 |
| `created_at` | DateTime | |
| `tasks` | relationship | 关联 `Task`（按 `sort_order` 排序） |

### `Task`（表 `task`）
实际执行的任务实例。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int PK | |
| `name` | String(256) | |
| `pipeline_id` | int FK ¦ null | 所属流水线（可孤立） |
| `machine_id` | int FK ¦ null | 目标机器；`null`=根据调度器策略自动选择（暂未实现，必须显式指定） |
| `config` | JSON ¦ null | 任务配置，见下方 `config 结构` |
| `gpu_condition` | JSON ¦ null | 抢卡条件，见 [services.md](services.md#gpu-condition) |
| `status` | Enum | `waiting` / `running` / `completed` / `failed` / `cancelled` |
| `sort_order` | int | 流水线内排序（越小越先执行） |
| `assigned_gpu_ids` | JSON ¦ null | 调度器分配的 GPU 索引列表 |
| `pid` | int ¦ null | 本地进程 PID 或远程 PID |
| `exit_code` | int ¦ null | 进程退出码 |
| `meta` | JSON ¦ null | 调度器写入的元数据/错误信息，如 `{"error": "...", "remote_pid": 12345}` |
| `stdout_path` / `stderr_path` | **不再存储** | 日志路径由约定规则推导：`LOGS_DIR/{task_id}/stdout.txt` |
| `created_at` / `started_at` / `finished_at` | DateTime ¦ null | UTC |

#### `config` 结构（`TaskConfigSchema`）

```json
{
  "conda_env_id": 3,           // 可选，关联 CondaEnv.id
  "env_vars": {"KEY": "val"},  // 可选，以内联方式注入环境变量
  "work_dir": "/home/user/exp", // 可选，cd 到此目录后执行
  "command": "python train.py", // 必填，非空
  "args": [
    {"name": "--lr", "value": "0.001"},
    {"name": "--epochs", "value": "100"}
  ]
}
```

最终 shell 命令由 `_build_command()` 拼接：
```
CUDA_VISIBLE_DEVICES=0,1  KEY=val  PATH=/conda/envs/xxx/bin:$PATH  python train.py --lr 0.001 --epochs 100
```

#### 任务状态流转

```
WAITING ──(调度器选中)──→ RUNNING ──(进程结束 exit=0)──→ COMPLETED
                              │
                              ├──(exit≠0)──→ FAILED
                              ├──(cancel_task)──→ CANCELLED
                              └──(连续 SSH 失败 × 5)──→ FAILED

WAITING ──(cancel_task)──→ CANCELLED
```

服务重启时：遗留的 `RUNNING` 状态任务会被 `startup_recovery()` 标记为 `FAILED`（本地进程先收到 SIGTERM）。

### `TaskTemplate`（表 `task_template`）
可复用的任务配置模板，不直接执行。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int PK | |
| `name` | String(256) | |
| `machine_id` | int FK ¦ null | 关联的默认机器（机器删除时自动置 null） |
| `config` | JSON ¦ null | 同 Task.config |
| `gpu_condition` | JSON ¦ null | 同 Task.gpu_condition |
| `created_at` / `updated_at` | DateTime | |

### `CondaEnv`（表 `conda_env`）
Conda 环境记录（用户手动登记）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int PK | |
| `name` | String(128) | 环境名（显示用） |
| `path` | String(512) | Conda 环境根目录路径（用于拼接 `PATH`） |
| `created_at` | DateTime | |

**删除限制**：有 `status=WAITING` 的任务通过 `config.conda_env_id` 引用该环境时，删除请求会被拒绝（HTTP 400）。

### `GpuConditionPreset`（表 `gpu_condition_preset`）
GPU 抢卡条件的命名预设，供前端保存/复用。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int PK | |
| `name` | String(128) | 预设名称 |
| `condition` | JSON ¦ null | 与 `Task.gpu_condition` 相同结构 |
| `created_at` | DateTime | |

---

## 数据库迁移

迁移逻辑在 `backend/migrations.py`，服务启动时自动执行 `run_migrations()`。  
版本记录在 `schema_version` 表中。

新增迁移步骤：在 `MIGRATIONS` 列表末尾追加 `(version, description, sql_or_callable)` 元组，`version` 必须严格递增。复杂迁移（如条件 ALTER TABLE）应写为 `async callable`，可利用 `_add_column_if_missing()` 辅助函数保证幂等。
