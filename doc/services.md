# 服务层

所有服务均以**全局单例**形式实例化在模块底部（如 `ssh_manager = SSHManager()`），在 `main.py` 的 `startup` 钩子中初始化，在 `shutdown` 钩子中清理。

---

## SSHManager（`services/ssh_manager.py`）

### 职责
维护到所有远程机器的持久 Paramiko SSH 连接池。提供同步的 `exec_command` 方法，由调用方通过 `run_in_executor` 在线程池异步执行。

### 关键方法

| 方法 | 说明 |
|------|------|
| `add(machine_id, host, port, username, ...)` | 注册机器连接信息（不立即连接） |
| `connect(machine_id) -> bool` | 建立 SSH 连接，支持密码或 PEM 私钥 |
| `disconnect(machine_id)` | 关闭连接 |
| `remove(machine_id)` | 断开并移除连接条目 |
| `exec_command(machine_id, cmd) -> (stdout, stderr)` | 执行命令，超时 `SSH_COMMAND_TIMEOUT`（默认 15s） |
| `all_statuses() -> dict[int, dict]` | 返回各机器的连接状态（`connected`、`last_error`） |

### 连接 & 重连策略
- `SSHConnection.connect()` 内部加锁（`threading.Lock`）防止并发重连竞争。
- `auto_reconnect=True` 时：`exec_command` 检测到连接断开后自动调用 `connect()` 重建，再重试一次命令。
- 连接参数：优先使用私钥（`paramiko.RSAKey.from_private_key()`），无私钥时用密码；`set_missing_host_key_policy(AutoAddPolicy)` 跳过主机密钥验证（已知安全风险，内网使用可接受）。

### 注意
`exec_command` 是阻塞同步调用，调用者**必须**通过 `await loop.run_in_executor(None, ssh_manager.exec_command, ...)` 执行，否则会阻塞 event loop。

---

## ResourceMonitor（`services/resource_monitor.py`）

### 职责
定时采集各机器的资源快照（CPU、内存、GPU），在内存中维护近期历史（用于 GPU 条件评估），并向路由层提供按需/缓存查询接口。

### 数据结构
- **快照**：`ResourceSnapshot`（Pydantic）含 `cpu_percent`、`memory_*`、`gpus: list[GpuInfo]`。
- **历史**：内存中 `deque`，保留最近 `MONITOR_HISTORY_RETAIN_MINUTES`（默认 30 分钟）的快照。超出时间窗口的条目自动清理。

### 本地采集
直接调用 `psutil`（CPU/内存）和 `pynvml`（GPU）。`pynvml` 不可用时降级为解析 `nvidia-smi` 输出。

### 远程采集
向远端 SSH 执行内嵌 Python 3 单文件脚本（`_REMOTE_COLLECT_SCRIPT`），输出为 JSON，后端解析填充 `ResourceSnapshot`。  
脚本依赖：`psutil`（CPU/内存）、`pynvml`（GPU，可选）、`subprocess`（备选 nvidia-smi 路径）。

### 关键方法

| 方法 | 说明 |
|------|------|
| `get_snapshot(machine_id, is_local, include_processes)` | 立即采集一次，返回 `ResourceSnapshot` |
| `get_cached(machine_id)` | 返回最新缓存快照，无缓存返回 `None` |
| `get_history(machine_id, minutes)` | 返回近 N 分钟历史列表 |
| `start_polling(machine_id, is_local, interval)` | 启动后台定时采集 asyncio Task |
| `stop_polling(machine_id)` | 取消该机器的后台 Task |

### GPU 字段说明（`GpuInfo`）

| 字段 | 含义 |
|------|------|
| `index` | GPU 索引（0-based） |
| `name` | GPU 型号名 |
| `utilization` | GPU 核心利用率 % |
| `memory_used_mb` / `memory_total_mb` | 显存 |
| `power_draw_w` / `power_limit_w` | 功耗（W） |
| `temperature_c` | 温度 |
| `processes` | `list[GpuProcess]`：各 GPU 进程（PID、用户、命令行、内存） |

---

## GpuCondition（`services/gpu_condition.py`）

### 职责
根据 `Task.gpu_condition` 字典和近期历史快照，判断目标机器上哪些 GPU 满足条件，返回可用 GPU 索引列表。

### 两种模式

#### `force` 模式
直接指定 GPU 索引，不做条件判断：
```json
{"mode": "force", "gpu_ids": [0, 1]}
```
返回 `[0, 1]`（不检查实际利用率）。

#### `smart` 模式
设置条件，满足后自动分配：
```json
{
  "mode": "smart",
  "min_gpus": 1,
  "idle_minutes": 5,
  "conditions": [
    {"type": "mem",  "op": ">=", "value": 8000},
    {"type": "util", "op": "<",  "value": 10}
  ],
  "condition_expr": "mem >= 8000 and util < 10"
}
```

- `conditions`：简单条件列表，所有条件 AND 逻辑（`conditions` 不为空时使用）。
- `condition_expr`：文本表达式，支持 `and / or / not / ( )`，变量为 `mem`、`util`、`power`、`procs`、`used_mem`、`total_mem`（此字段优先于 `conditions`）。
- 评估窗口：`idle_minutes` 分钟内的**所有**历史快照都满足条件，该 GPU 才通过（避免因短暂空闲而抢卡）。

### 安全性
`condition_expr` 使用 Python AST 白名单解析（`ast.parse` + 节点类型检查），只允许数字、比较、布尔运算，拒绝任意代码执行。

### 机器离线保护
若目标机器最近 `MONITOR_OFFLINE_THRESHOLD_MINUTES` 分钟内无快照，`evaluate_gpu_condition` 返回 `None`，调度器据此将任务标记为 `FAILED`（避免永久阻塞）。

---

## TaskScheduler（`services/task_scheduler.py`）

### 职责
唯一的任务执行驱动器。以固定间隔（`SCHEDULER_INTERVAL`，默认 5s）轮询数据库，将满足条件的 `WAITING` 任务提升为 `RUNNING` 并监控至完成。

### 调度逻辑
```
for each Pipeline（有 WAITING 任务的流水线）：
   取 sort_order 最小的 WAITING 任务
   if 该流水线有 RUNNING 任务：跳过（同流水线串行）
   else：
      获取目标机器的 Machine 记录
      evaluate_gpu_condition(task)
      if gpus is None（机器离线）：
           task.status = FAILED; continue
      if gpus is False（条件不满足）：
           continue（等待下次轮询）
      else：
           asyncio.create_task(_run_task(task, gpus))
```

### `_run_task(task, gpu_ids)`
1. 构建命令字符串（`_build_command(config, conda_path, gpu_ids)`）。
2. 创建 `LOGS_DIR/{task_id}/` 目录。
3. 日志路径：`stdout_abs` / `stderr_abs` 用于文件 I/O，`stdout_rel` / `stderr_rel`（`{task_id}/stdout.txt`）存入 DB。
4. 分支执行：
   - **本地**（`machine.is_local`）：`asyncio.create_subprocess_exec`，直接 `await process.wait()`。
   - **远程**：`_exec_remote()`。
5. 完成后更新 `Task.status`、`exit_code`、`finished_at`。

### `_exec_remote(task_id, machine_id, cmd_str, ...)`
远端任务全生命周期：

1. **启动**：SSH 执行 `mkdir -p {remote_dir} && nohup sh -c '...' > /dev/null 2>&1 </dev/null & echo $!`，获取 `remote_pid`，写入 `Task.meta`。
2. **轮询**（每 5s 检查一次 `{remote_dir}/exitcode` 文件）：
   - SSH 成功 → 重置失败计数器。
   - `done:{code}` → 记录退出码，退出循环。
   - `dead:-1` → 进程意外结束，退出码 -1。
   - SSH 异常 → 失败计数器 +1；达到 `_MAX_FAILURES=5` 才放弃（单次网络抖动不影响任务）。
   - `asyncio.CancelledError` → **立即 re-raise**（不被吞掉）。
3. **取消时日志回收**：轮询循环被 `asyncio.CancelledError` 打断时，先通过 SSH `cat` 拉取远端日志写本地，再清理 `remote_dir`，最后 re-raise。
4. **正常结束日志收集**：`cat remote_stdout/stderr` → 写本地文件 → `rm -rf remote_dir`。

### `cancel_task(task_id)`
- 有运行中的 asyncio Task：调用 `.cancel()`（触发 CancelledError，由 `_exec_remote` 的 CancelledError 处理器回收日志）。
- 远程进程：`kill -15 {pid}; sleep 1; kill -9 {pid}`（不再包含 `rm -rf`，由日志回收路径负责清理）。
- 本地进程：优先从 `_local_procs` dict 取 `asyncio.subprocess.Process` 引用，调用 `.terminate()`；无引用时通过 `os.kill(pid, SIGTERM)`。

### `startup_recovery()`
服务重启时，将遗留的 `RUNNING` 状态任务批量标记为 `FAILED`。对本地机器任务，先尝试向遗留 PID 发送 `SIGTERM`，清理孤立进程，再更新状态。

### 日志存储路径约定

远程日志文件在远端存储于：
```
/tmp/pph_task_logs/{task_id}/stdout
/tmp/pph_task_logs/{task_id}/stderr
/tmp/pph_task_logs/{task_id}/exitcode
```
回收后删除，本地永久存储于：
```
{LOGS_DIR}/{task_id}/stdout.txt
{LOGS_DIR}/{task_id}/stderr.txt
```
`LOGS_DIR` 默认为 `{PPH_DATA_DIR}/task_logs/`。

---

## AuthService（`services/auth_service.py`）

简单的单用户密码认证服务。

| 方法 | 说明 |
|------|------|
| `is_setup(db)` | 检查 `user` 表是否有记录 |
| `ensure_user(db)` | 首次启动时创建未设置密码的用户行 |
| `setup_password(db, password)` | bcrypt 哈希后写入 `User.password_hash` |
| `authenticate(db, password) -> bool` | 验证密码 |
| `create_access_token() -> str` | 生成 JWTtoken（`exp` = 现在 + 30 天） |
| `verify_token(token) -> bool` | 验证 JWT 签名和过期时间 |

`get_current_user`（`deps.py`）从 `Authorization: Bearer` 头读取 token，验证失败返回 401。
