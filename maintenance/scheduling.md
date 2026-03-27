# 任务调度机制

## Tick 循环：拉取式状态机

调度器不监听事件，而是每 5 秒主动扫描一次数据库，判断哪些任务可以启动。这是**拉取式**（pull-based）设计，不是事件驱动：

```python
# _main_loop
while True:
    await self._tick()
    await asyncio.sleep(SCHEDULER_INTERVAL)   # 5秒
```

`_tick()` 每次打开一个 DB session，遍历所有流水线，尝试启动下一个任务。它不保存任何跨轮次的状态（除了 `_running` 字典记录当前飞行中的 asyncio.Task）。

---

## GPU 条件评估：启动任务前的门控

`_try_start_task()` 的核心逻辑是一个**门控**：只有通过条件的任务才能从 WAITING 转为 RUNNING，否则该轮跳过，等待下一次 tick。

```
_try_start_task(task):
    1. 机器存在？→ 否：直接 FAILED（配置错误，不应永久等待）
    2. gpu_condition 为空？→ 跳过条件检查，直接启动
    3. 拉取历史：resource_monitor.get_history(machine_id, idle_minutes + 1)
    4. evaluate_gpu_condition(condition, history)
       → None：本轮跳过（等待 GPU 空闲）
       → [gpu_ids]：继续，将 gpu_ids 写入 assigned_gpu_ids
    5. 获取 conda 环境信息（路径/名称）
    6. UPDATE task: status=RUNNING, started_at=now, assigned_gpu_ids
    7. asyncio.create_task(_run_task(...)) → 放入 _running[task_id]
```

**关键细节**：步骤 6 先写数据库，步骤 7 再创建 asyncio.Task。这意味着即使 Task 创建失败，数据库里也已经是 RUNNING 状态，会在下次 startup_recovery 时被修正为 FAILED。

---

## GPU 空闲判断：为什么需要时间窗口

业务需求是"GPU 已经**持续** N 分钟空闲"，而不是"当前瞬间空闲"。这防止了 GPU 短暂利用率低谷（如模型加载间隙）触发任务启动。

代码实现：`evaluate_gpu_condition()` 取最近 `idle_minutes` 分钟内的**所有历史快照**，要求候选 GPU 在**每一个快照**中都满足条件。只要有一个快照不满足，该 GPU 就被淘汰。

```python
# gpu_condition.py 核心逻辑
cutoff = datetime.utcnow() - timedelta(minutes=idle_minutes)
recent = [(ts, snap) for ts, snap in history if ts >= cutoff]

for gidx in candidates:
    ok = True
    for _ts, snap in recent:          # 每一个历史快照都必须满足
        metrics = _get_gpu_metrics(gpu_info)
        if not all(_eval_simple_condition(c, metrics) for c in simple_conditions):
            ok = False; break
        if expr and not _eval_expr(expr, metrics):
            ok = False; break
    if ok:
        passing.append(gidx)
```

因此 `idle_minutes` 的实际精度受限于监控采集间隔（默认 10 秒）：如果设置 `idle_minutes=1`，实际会检查过去约 6 个快照（60s / 10s）。

---

## 机器离线检测：防止永久等待

smart 模式的任务如果机器长时间无监控数据（`_history` 中没有近期快照），`evaluate_gpu_condition()` 会因 `recent` 为空而返回 `None`，导致任务永远等待下去。

`_try_start_task()` 在调用 `evaluate_gpu_condition()` 之前专门做了这个检查：

```python
last_snap = resource_monitor.get_last_snapshot_time(task.machine_id)
if last_snap is not None:
    if datetime.utcnow() - last_snap > timedelta(minutes=MONITOR_OFFLINE_THRESHOLD_MINUTES):
        # 标记 FAILED，meta["error"] = "机器长时间无监控数据..."
```

`MONITOR_OFFLINE_THRESHOLD_MINUTES` 默认 5 分钟。注意：如果 `last_snap is None`（从未采集过数据），则不触发此检查，任务会继续等待——这是一个边界情况，意味着新添加的机器监控还未来得及采集就提交了任务。

---

## 任务取消

取消由路由层触发，直接操作 `_running` 字典：

```python
# cancel_task(task_id)
if task_id in self._running:
    self._running[task_id].cancel()          # 触发 asyncio.CancelledError
    # _run_task 捕获 CancelledError → status=CANCELLED
```

本地任务：`_local_procs[task_id]` 持有 subprocess 引用，`cancel()` 触发后 `_exec_local` 的 `proc.wait()` 会因协程取消而中断，需要在外部额外 kill 进程：

```python
# _exec_local 的 finally 块
finally:
    self._local_procs.pop(task_id, None)
```

远程任务：`_exec_remote` 中的轮询循环被 `CancelledError` 打断，任务的 `meta["remote_pid"]` 中有远端 PID，但当前代码不主动 SSH 过去 kill 远端进程——远端进程会继续运行直到自然结束。这是一个**已知的不完整行为**。

---

## 孤立任务（pipeline_id=NULL）

`_tick()` 对孤立任务的处理与流水线任务本质不同：**所有** WAITING 孤立任务在同一个 tick 内都会尝试启动，没有序列化保证。

这意味着：
- 提交 10 个孤立任务 + 机器有 10 张卡 → 理论上可以同时全部启动
- 多个孤立任务可能竞争同一张 GPU（gpu_condition 的 force 模式直接指定 GPU 索引），系统目前不做冲突检测
