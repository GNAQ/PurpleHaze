# 架构概览

## 宏观结构

```
┌────────────────────────────────────────────────────────────────┐
│  浏览器（React SPA）                                            │
│  - Ant Design 5 UI                                             │
│  - Zustand 全局状态                                             │
│  - Axios HTTP / 定时轮询替代 WebSocket                          │
└───────────────────┬────────────────────────────────────────────┘
                    │ HTTP REST  /api/*
                    │ Bearer JWT
┌───────────────────▼────────────────────────────────────────────┐
│  FastAPI 后端（Xxium）                                          │
│                                                                │
│  routers/         ← HTTP 路由层（参数校验、权限、事务）          │
│  services/        ← 有状态服务（SSH、监控、调度器）             │
│  models/          ← SQLAlchemy ORM 模型                        │
│  schemas/         ← Pydantic I/O Schema                        │
│  migrations.py    ← 轻量版本迁移系统                            │
│  config.py        ← 环境变量 + 路径常量                        │
│                                                                │
│  数据库：SQLite（aiosqlite 异步驱动）                           │
└────────────────┬──────────────────────────────────────────────┘
                 │ SSH（Paramiko）
      ┌──────────▼──────────┐
      │  远程机器            │
      │  - sshd             │
      │  - Python 3 + psutil│
      │  - pynvml / nvidia-smi (可选 GPU) │
      │  - nohup            │
      └─────────────────────┘
```

---

## 进程模型

后端是**单进程、单线程异步**服务（uvicorn + asyncio event loop）。  
所有 I/O 操作（DB、SSH 命令执行）皆为 async；CPU 密集型或阻塞 SDK 调用（Paramiko、pynvml）通过 `loop.run_in_executor(None, ...)` 放入默认线程池执行。

关键后台 asyncio Task：
- `TaskScheduler._loop_task`：每 `SCHEDULER_INTERVAL`（默认 5s）轮询一次，驱动任务状态机。
- `ResourceMonitor`：每台机器独立一个 asyncio Task，按各自 `interval` 采集资源快照。

---

## 请求生命周期（以启动任务为例）

```
POST /api/tasks  (TaskCreate)
  → routers/tasks.py: 入参校验（Pydantic）
  → 写 Task(status=WAITING) 到 SQLite
  → 返回 TaskBrief

5s 后 TaskScheduler 轮询：
  → 查 status=WAITING 任务（按流水线分组，每线只取队首）
  → 评估 GPU 抢卡条件（gpu_condition.evaluate_gpu_condition）
  → 条件满足：异步启动 _run_task(task)
      → 本地：asyncio.create_subprocess_exec
      → 远程：SSH exec "nohup sh -c '...' &"，获取 remote_pid
  → update Task(status=RUNNING, pid=..., started_at=...)

_run_task 持续等待：
  → 本地：await process.wait()
  → 远程：轮询 SSH "if [ -f exitcode ]; ..."（最多连续失败 5 次才放弃）
  → 完成：收集日志 → update Task(status=COMPLETED/FAILED, exit_code=..., finished_at=...)
```

---

## 目录结构详解

```
backend/
├── config.py          环境变量读取、全局路径/常量（修改这里控制行为）
├── database.py        SQLAlchemy engine + AsyncSessionLocal + Base.metadata
├── main.py            FastAPI app 组装；startup/shutdown 钩子（连接恢复、调度器启动）
├── deps.py            FastAPI Depends：get_current_user（JWT 解析）
├── migrations.py      数据库迁移（版本表 schema_version，幂等）
│
├── models/
│   ├── auth.py        User（密码哈希）、Setting（KV 配置表）
│   ├── machine.py     Machine（SSH + 监控配置）
│   └── task.py        Pipeline、Task、TaskTemplate、CondaEnv、GpuConditionPreset
│
├── schemas/
│   ├── auth.py        登录/设置 I/O
│   ├── machine.py     机器 CRUD I/O
│   ├── monitor.py     ResourceSnapshot、GpuInfo、GpuProcess
│   └── task.py        TaskConfigSchema（命令结构化校验）、TaskBrief、PipelineResponse 等
│
├── routers/
│   ├── auth.py        /api/auth/*
│   ├── machines.py    /api/machines/*
│   ├── monitor.py     /api/monitor/*
│   ├── tasks.py       /api/tasks/*
│   └── fs.py          /api/fs/*（文件浏览 / 在 VSCode server 打开）
│
└── services/
    ├── auth_service.py     密码哈希、JWT 生成/验证
    ├── ssh_manager.py      SSHManager 全局单例（持久连接池）
    ├── resource_monitor.py ResourceMonitor 全局单例（定时采集 + 历史缓存）
    ├── gpu_condition.py    GPU 抢卡条件评估（force/smart 模式）
    └── task_scheduler.py   TaskScheduler 全局单例（任务状态机 + 日志收集）

frontend/src/
├── api/         Axios 封装（按业务领域分文件）
├── components/  可复用组件
├── pages/       页面级组件（MachinesPage、TasksPage、HistoryPage、SettingsPage）
├── store/       Zustand 状态（authStore 等）
└── App.tsx      路由配置（react-router-dom）
```

---

## 关键设计决策

### 1. 单文件 SQLite
选择原因：零运维、易备份（单文件 copy 即可）、数据量小（任务历史 + 机器配置）。  
限制：写并发受限。调度循环和 HTTP 请求可能竞争写锁。  
缓解：所有写操作使用独立 `AsyncSession`，每次操作后立即 `commit()`；SQLAlchemy 的写超时由 aiosqlite 默认重试处理。

### 2. 远程任务 nohup + SSH 轮询
远程任务使用 `nohup sh -c '...' > /dev/null 2>&1 </dev/null &` 启动，与 SSH 连接完全解耦。SSH 断连不影响远程进程运行。  
调度器轮询远程 exitcode 文件，连续 5 次 SSH 失败才放弃（`_MAX_FAILURES=5`），单次断连不会导致任务丢失。

### 3. 资源监控脚本内嵌
远程采集脚本通过 SSH exec 直接运行 `python3 -c "..."` 内嵌脚本，无需在远程机器上安装任何 PurpleHaze 专属组件，只需标准依赖（psutil、pynvml）。

### 4. JWT 单用户无状态认证
Token 有效期 30 天，`SECRET_KEY` 控制签名。无注销机制（token 未过期即有效）。  
生产部署时必须通过 `PPH_SECRET_KEY` 环境变量覆盖默认密鑰，否则任何知道代码的人都能伪造 token。

### 5. GPU 条件评估基于历史快照
`smart` 模式评估的是过去 `idle_minutes` 分钟内**所有**快照是否持续满足条件，而非瞬时值。机器离线超过 `MONITOR_OFFLINE_THRESHOLD_MINUTES`（默认 5 分钟）时，等待中的 smart 模式任务会被标记为 `FAILED`，避免永久阻塞。

### 6. 迁移系统
`migrations.py` 维护严格递增的版本列表。幂等：重复执行安全。  
新增字段：只需在列表末尾追加元组，不改动已有迁移。  
复杂迁移（如检查字段是否存在）使用 `async callable` 而非直接 SQL，便于处理 SQLite ALTER TABLE 限制。

### 7. 日志路径：相对存储、绝对读取
DB 中 `Task.config` 不存日志路径。日志文件路径规则：  
- 存储：`{task_id}/stdout.txt`（相对 `LOGS_DIR`）  
- 读取时：`LOGS_DIR / {task_id} / stdout.txt`  
这样 `LOGS_DIR` 可通过环境变量迁移而不需要更新数据库记录。
