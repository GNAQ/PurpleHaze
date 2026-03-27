# 任务执行路径

## 命令构建（`_build_command`）

用户在表单里填写的结构化配置，在执行时被拼装成一个 shell 命令字符串。这是**业务配置到 shell 命令的唯一映射点**。

```
config = {
    env_vars: {"KEY": "VAL"},
    conda_env_id: 3,              # → 查 CondaEnv 表得到 name/path
    work_dir: "/workspace",
    command: "python",
    args: [{"name": "--lr", "value": "0.001"}, {"name": "", "value": "train.py"}]
}
gpu_ids = [0, 1]
```

生成结果（PATH 激活方式）：
```bash
CUDA_VISIBLE_DEVICES=0,1 KEY=VAL PATH=/conda/envs/myenv/bin:$PATH python --lr 0.001 train.py
```

**Conda 激活有两种路径**，取决于 CondaEnv 记录的 `path` 字段是否填写：
- `path` 非空（直接指定环境目录）→ `PATH=/path/to/env/bin:$PATH`，无需 conda shell 初始化
- `path` 为空、`name` 非空 → `conda run -n <name> bash -c '...'`，依赖系统 conda 可执行

`work_dir` 不注入进命令字符串，而是作为 `cwd` 参数传给 subprocess 或注入到远端 nohup 命令的 `cd` 部分。

参数值经过 `shlex.quote()` 处理，参数名（如 `--lr`）不 quote（假设参数名是安全的标识符）。

---

## 本地执行路径（`_exec_local`）

```python
proc = await asyncio.create_subprocess_shell(
    cmd_str, cwd=work_dir,
    stdout=open(stdout_path, "w"),
    stderr=open(stderr_path, "w"),
)
self._local_procs[task_id] = proc   # 存引用，供 cancel 使用
await db.execute(update(Task).where(...).values(pid=proc.pid))
return await proc.wait()
```

**关键顺序**：先把 proc 存入 `_local_procs`，再写 DB，最后 `await proc.wait()`。这样取消操作到来时，即使 DB 写入还没完成，`_local_procs[task_id]` 也已经有进程引用，可以安全终止。

日志文件路径：
- 绝对路径（`LOGS_DIR/{task_id}/stdout.txt`）用于文件 I/O
- 相对路径（`"{task_id}/stdout.txt"`）存入 DB，避免迁移数据目录后路径失效

---

## 远程执行路径（`_exec_remote`）

远程执行**不能阻塞** SSH 连接等待进程结束（连接可能中断，且会占用连接），因此用 nohup 让进程在后台独立运行，SSH 只负责启动和轮询：

**启动阶段**：
```bash
# 在远端执行
mkdir -p /tmp/pph_task_logs/123 &&
nohup sh -c 'cd /workspace && CUDA_VISIBLE_DEVICES=0 python train.py \
  > /tmp/pph_task_logs/123/stdout \
  2> /tmp/pph_task_logs/123/stderr; \
  echo $? > /tmp/pph_task_logs/123/exitcode' \
  > /dev/null 2>&1 </dev/null & echo $!
```

返回远端 PID，存入 `task.pid` 和 `task.meta["remote_pid"]`。

**轮询阶段**（每 5 秒）：
```bash
if [ -f /tmp/pph_task_logs/123/exitcode ]; then
    echo done:$(cat /tmp/pph_task_logs/123/exitcode)
elif kill -0 {remote_pid} 2>/dev/null; then
    echo running
else
    echo dead:-1
fi
```

进程结束的判据是 `exitcode` 文件的存在（shell 脚本在主命令退出后写入），而不是进程是否存活——这样可以避免进程已退出但文件尚未写完的竞态。

**日志收集阶段**：用 SCP 将远端 `/tmp/pph_task_logs/{task_id}/` 下的文件拉到本地 `LOGS_DIR/{task_id}/`，然后统一存相对路径到 DB。

---

## 任务状态转换与 exit_code 映射

```
WAITING
  │
  ├── _try_start_task：机器不存在/未指定 → FAILED（meta.error 说明原因）
  │
  ↓ UPDATE status=RUNNING（先写 DB，再创建 asyncio.Task）
RUNNING
  │
  ├── exit_code == 0   → COMPLETED
  ├── exit_code != 0   → FAILED
  ├── CancelledError   → CANCELLED（exit_code = -2）
  └── 其他异常         → FAILED（exit_code = -1，meta.error = 异常信息）
```

`exit_code = -1` 有两种来源：远端 nohup 进程意外消失（`dead:-1`），或调度器本身的 Python 异常。可通过 `meta` 字段区分。

---

## startup_recovery：崩溃恢复

后端启动时，所有 `status=RUNNING` 的任务一定是上次崩溃/重启遗留的（进程已不存在），统一标记为 FAILED：

```python
# 将遗留 RUNNING 全部改为 FAILED
await db.execute(
    update(Task)
    .where(Task.status == TaskStatus.RUNNING)
    .values(status=TaskStatus.FAILED, meta={"error": "服务重启，任务中断"}, finished_at=now)
)
```

这发生在 `task_scheduler.start()` 之前，确保调度器启动时 RUNNING 任务集合是干净的。
