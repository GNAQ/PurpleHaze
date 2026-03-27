# 系统架构

## 整体模型

后端由三个**常驻 async 服务**驱动，它们在 startup 启动后独立运行，通过内存引用共享状态，不经过 HTTP 层互相通信：

```
resource_monitor   ──→  _cache / _history（内存）
                               ↓
task_scheduler     ──读→  get_history()  ──→  evaluate_gpu_condition()
                   ──写→  DB（Task 状态变更）
                               ↓
ssh_manager        ──→  exec_command()（远程任务执行）
```

FastAPI 路由层只是这些服务的**控制面**（启停轮询、手动连接、查询状态），不参与核心的任务调度或资源采集循环。

---

## 三个核心服务的职责边界

### resource_monitor（`services/resource_monitor.py`）

**唯一职责**：定期采集机器资源数据，维护供两类消费者使用的两份内存数据结构：

- `_cache[machine_id]`：**最新一次快照**，供前端实时展示用
- `_history[machine_id]`：**滚动时间窗口**（默认保留 30 分钟），供调度器评估 GPU 空闲条件用

它**不做任何决策**，只负责采集和存储。

### task_scheduler（`services/task_scheduler.py`）

**唯一职责**：每 5 秒（`SCHEDULER_INTERVAL`）驱动一次"哪些任务应该从 WAITING 变成 RUNNING"的状态转换。它是系统中**唯一有权变更 task.status 的地方**（取消操作除外）。

它通过询问 `resource_monitor.get_history()` 来获取 GPU 状态，通过询问 `ssh_manager.exec_command()` 来启动远程任务。

### ssh_manager（`services/ssh_manager.py`）

**唯一职责**：维护 Paramiko SSH 连接池，向上层提供同步的 `exec_command(machine_id, cmd)` 接口。连接的生命周期（建立、断开、重连）由路由层和 startup 控制，连接本身对 task_scheduler 和 resource_monitor 透明。

---

## 启动引导顺序（`main.py startup`）

```
1. init_db() + run_migrations()       # 建表 / 增量迁移
2. 首次运行：自动创建"默认流水线"
3. 遍历所有 Machine 记录：
   - 远程机器：ssh_manager.add(...)   # 注册连接信息（不连接）
   - auto_connect=True：ssh_manager.connect(...)
   - 所有机器：resource_monitor.start_polling(machine_id, is_local, interval)
4. task_scheduler.startup_recovery()  # 将上次崩溃遗留的 RUNNING 任务标记为 FAILED
5. task_scheduler.start()             # 启动调度主循环（asyncio.create_task）
```

这个顺序的含义：资源监控在调度器启动前就开始积累历史数据，确保调度器第一次 tick 时就有历史可查（如果机器响应足够快的话）。

---

## 前端同步模型：轮询而非 WebSocket

前端通过**定时轮询**同步状态，不使用 WebSocket：

- `TasksPage`：每 5 秒调 `GET /api/tasks/pipelines`，拉取全量流水线+任务树
- `MachineCard`：每 `monitor_config.interval`（默认 10 秒）调 `GET /api/monitor/{id}/resources`，拉取最新快照

含义：**任务状态变更对用户的可见延迟最长为 5 秒**。

---

## 流水线并发模型

这是业务逻辑到代码逻辑的核心映射：

| 业务语义 | 代码实现 |
|---|---|
| 同一流水线内任务串行执行 | `_tick()` 中：如果该 pipeline 有 RUNNING 任务则跳过，取第一个 WAITING 任务 |
| 不同流水线之间并行执行 | `_tick()` 遍历所有流水线，每条独立评估，互不影响 |
| 孤立任务（无流水线）完全并发 | `pipeline_id IS NULL` 的任务全部进入同一批 `_try_start_task()` 调用，无互斥 |

"流水线"对调度器来说就是一个**独立的串行队列**，多个流水线就是多个并发的串行队列。

---

## 单用户设计

`user` 表固定只有 id=1 的一行记录。JWT 认证的目的只是**防止未授权访问**，不存在多用户隔离。密码 bcrypt 哈希存在 `user.password_hash`，`NULL` 表示首次使用尚未设置密码。
