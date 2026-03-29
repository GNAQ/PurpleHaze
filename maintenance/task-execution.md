# 任务执行路径

## 命令构建（`_build_command`）

用户表单里的结构化配置，执行时被拼成一条 shell 命令。这是配置到 shell 命令的唯一映射点。

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

Conda 激活有两种路径：
- `path` 非空 → `PATH=/path/to/env/bin:$PATH`，不需要 conda 初始化
- `path` 为空、`name` 非空 → `conda run -n <name> bash -c '...'`

`work_dir` 不注入命令字符串，而是作为 `cwd` 参数传给 subprocess 或远端 nohup 的 `cd`。

参数值经 `shlex.quote()` 处理，参数名（如 `--lr`）不 quote（假设是安全标识符）。

---

## 本地执行（`_exec_local`）

```python
proc = await asyncio.create_subprocess_shell(
    cmd_str, cwd=work_dir,
    stdout=open(stdout_path, "w"),
    stderr=open(stderr_path, "w"),
)
self._local_procs[task_id] = proc
await db.execute(update(Task).where(...).values(pid=proc.pid))
return await proc.wait()
```

顺序：先存 `_local_procs` → 再写 DB → 最后 `await proc.wait()`。这样取消操作到来时即使 DB 写入未完成，也能通过 `_local_procs` 拿到进程引用终止。

日志路径：绝对路径（`LOGS_DIR/{task_id}/stdout.txt`）用于文件 I/O，相对路径（`"{task_id}/stdout.txt"`）存 DB，避免迁移目录后失效。

---

## 远程执行（`_exec_remote`）

远程执行用 nohup 让进程后台运行，SSH 只负责启动和轮询，不阻塞连接。

启动：
```bash
mkdir -p /tmp/pph_task_logs/123 &&
nohup sh -c 'cd /workspace && CUDA_VISIBLE_DEVICES=0 python train.py \
  > /tmp/pph_task_logs/123/stdout \
  2> /tmp/pph_task_logs/123/stderr; \
  echo $? > /tmp/pph_task_logs/123/exitcode' \
  > /dev/null 2>&1 </dev/null & echo $!
```

返回远端 PID，存入 `task.pid` 和 `task.meta["remote_pid"]`。

轮询（每 5 秒）：
```bash
if [ -f /tmp/pph_task_logs/123/exitcode ]; then
    echo done:$(cat /tmp/pph_task_logs/123/exitcode)
elif kill -0 {remote_pid} 2>/dev/null; then
    echo running
else
    echo dead:-1
fi
```

判据是 `exitcode` 文件是否存在（shell 脚本在主命令退出后写入），而不是进程是否存活——避免进程已退出但文件还没写完的竞态。

日志收集：SCP 把远端 `/tmp/pph_task_logs/{task_id}/` 拉到本地 `LOGS_DIR/{task_id}/`，DB 存相对路径。

---

## 状态转换

```
WAITING
  │
  ├── 机器不存在/未指定 → FAILED（meta.error 说明原因）
  │
  ↓ UPDATE status=RUNNING（先写 DB，再创建 asyncio.Task）
RUNNING
  │
  ├── exit_code == 0   → COMPLETED
  ├── exit_code != 0   → FAILED
  ├── CancelledError   → CANCELLED（exit_code = -2）
  └── 其他异常         → FAILED（exit_code = -1，meta.error = 异常信息）
```

`exit_code = -1` 有两种来源：远端 nohup 进程意外消失（`dead:-1`），或调度器 Python 异常。通过 `meta` 字段区分。

---

## 崩溃恢复（startup_recovery）

后端启动时，所有 `status=RUNNING` 的任务是上次崩溃遗留的（进程已不在），统一标记 FAILED：

```python
await db.execute(
    update(Task)
    .where(Task.status == TaskStatus.RUNNING)
    .values(status=TaskStatus.FAILED, meta={"error": "服务重启，任务中断"}, finished_at=now)
)
```

在 `task_scheduler.start()` 之前执行，确保调度器启动时 RUNNING 集合是干净的。
