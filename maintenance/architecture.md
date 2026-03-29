# 系统架构

## 整体模型

后端由三个常驻 async 服务驱动，startup 时启动，通过内存引用共享状态，不经 HTTP 互相通信：

```
resource_monitor   ──→  _cache / _history（内存）
                             ↓
task_scheduler     ──读→  get_history()  ──→  evaluate_gpu_condition()
                   ──写→  DB（Task 状态变更）
                             ↓
ssh_manager        ──→  exec_command()（远程任务执行）
```

FastAPI 路由层只是这些服务的控制面（启停轮询、手动连接、查询状态），不参与核心调度或采集循环。

---

## 三个核心服务

### resource_monitor（`services/resource_monitor.py`）

定期采集机器资源数据，维护两份内存数据结构：

- `_cache[machine_id]`：最新一次快照，供前端实时展示
- `_history[machine_id]`：滚动时间窗口（默认 30 分钟），供调度器评估 GPU 空闲条件

只采集和存储，不做决策。

### task_scheduler（`services/task_scheduler.py`）

每 5 秒（`SCHEDULER_INTERVAL`）扫描一次，判断哪些任务应该从 WAITING 变成 RUNNING。是系统中唯一有权变更 task.status 的地方（取消除外）。

通过 `resource_monitor.get_history()` 获取 GPU 状态，通过 `ssh_manager.exec_command()` 启动远程任务。

### ssh_manager（`services/ssh_manager.py`）

维护 Paramiko SSH 连接池，提供 `exec_command(machine_id, cmd)` 接口。连接生命周期由路由层和 startup 控制，对 task_scheduler 和 resource_monitor 透明。

---

## 启动引导顺序（`main.py startup`）

```
1. init_db() + run_migrations()       # 建表 / 增量迁移
2. 首次运行：自动创建"默认流水线"
3. 遍历所有 Machine 记录：
   - 远程机器：ssh_manager.add(...)   # 注册连接信息（不连接）
   - auto_connect=True：ssh_manager.connect(...)
   - 所有机器：resource_monitor.start_polling(machine_id, is_local, interval)
4. task_scheduler.startup_recovery()  # 遗留 RUNNING 任务标记为 FAILED
5. task_scheduler.start()             # 启动调度主循环
```

资源监控在调度器之前启动，确保第一次 tick 时已有历史数据可查。

---

## 前端同步模型

前端通过定时轮询同步状态，不用 WebSocket：

- `TasksPage`：每 5 秒 `GET /api/tasks/pipelines`，全量拉取
- `MachineCard`：每 `monitor_config.interval`（默认 10 秒）`GET /api/monitor/{id}/resources`

任务状态变更对用户的可见延迟最长 5 秒。

---

## 流水线并发模型

| 业务语义 | 代码实现 |
|---|---|
| 同一流水线内串行 | `_tick()` 中：该 pipeline 有 RUNNING 则跳过，取第一个 WAITING |
| 不同流水线并行 | `_tick()` 遍历所有流水线，独立评估 |
| 孤立任务完全并发 | `pipeline_id IS NULL` 的任务全部进入同一批 `_try_start_task()`，无互斥 |

流水线就是一个独立的串行队列，多个流水线 = 多个并发的串行队列。

---

## 单用户设计

`user` 表固定只有 id=1 一行。JWT 认证只防未授权访问，不存在多用户隔离。密码 bcrypt 哈希存在 `user.password_hash`，NULL 表示首次使用未设密码。
