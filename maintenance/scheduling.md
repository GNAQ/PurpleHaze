# 任务调度机制

## Tick 循环

调度器是拉取式设计，每 5 秒扫一次数据库，判断哪些任务可以启动：

```python
# _main_loop
while True:
    await self._tick()
    await asyncio.sleep(SCHEDULER_INTERVAL)   # 5秒
```

`_tick()` 每次开一个 DB session，遍历所有流水线尝试启动下一个任务。不保存跨轮次状态（`_running` 字典除外，记录当前飞行中的 asyncio.Task）。

---

## GPU 条件门控

`_try_start_task()` 的核心是一个门控：条件通过才从 WAITING 转 RUNNING，否则跳过等下一轮。

```
_try_start_task(task):
    1. 机器存在？ → 否：FAILED（配置错误）
    2. gpu_condition 为空？ → 跳过检查，直接启动
    3. 拉历史：resource_monitor.get_history(machine_id, idle_minutes + 1)
    4. evaluate_gpu_condition(condition, history)
       → None：跳过（GPU 不满足）
       → [gpu_ids]：写入 assigned_gpu_ids
    5. 获取 conda 环境信息
    6. UPDATE task: status=RUNNING, started_at=now, assigned_gpu_ids
    7. asyncio.create_task(_run_task(...)) → 放入 _running[task_id]
```

注意步骤 6 先写 DB，步骤 7 再创建 asyncio.Task。如果 Task 创建失败，DB 已是 RUNNING 状态，下次 startup_recovery 会修正为 FAILED。

---

## GPU 空闲判断的时间窗口

业务需求是"GPU 持续 N 分钟空闲"而不是"当前瞬间空闲"，防止短暂利用率低谷（如模型加载间隙）误触发。

实现：`evaluate_gpu_condition()` 取最近 `idle_minutes` 分钟的所有快照，候选 GPU 必须在每一个快照中都满足条件，有一个不满足就淘汰。

```python
cutoff = datetime.utcnow() - timedelta(minutes=idle_minutes)
recent = [(ts, snap) for ts, snap in history if ts >= cutoff]

for gidx in candidates:
    ok = True
    for _ts, snap in recent:
        metrics = _get_gpu_metrics(gpu_info)
        if not all(_eval_simple_condition(c, metrics) for c in simple_conditions):
            ok = False; break
        if expr and not _eval_expr(expr, metrics):
            ok = False; break
    if ok:
        passing.append(gidx)
```

`idle_minutes` 的精度受限于采集间隔（默认 10 秒）：`idle_minutes=1` 实际检查约 6 个快照。

---

## 机器离线检测

smart 模式任务如果机器长时间无监控数据，`evaluate_gpu_condition()` 会因 `recent` 为空永远返回 None，任务永远等下去。

`_try_start_task()` 在调用条件评估前检查：

```python
last_snap = resource_monitor.get_last_snapshot_time(task.machine_id)
if last_snap is not None:
    if datetime.utcnow() - last_snap > timedelta(minutes=MONITOR_OFFLINE_THRESHOLD_MINUTES):
        # FAILED，meta["error"] = "机器长时间无监控数据..."
```

阈值默认 5 分钟。边界情况：`last_snap is None`（从未采集过）不触发此检查，任务继续等——这是新机器监控还没开始采集的场景。

---

## 任务取消

路由层触发，直接操作 `_running` 字典：

```python
if task_id in self._running:
    self._running[task_id].cancel()          # 触发 CancelledError
    # _run_task 捕获 CancelledError → status=CANCELLED
```

本地任务：`_local_procs[task_id]` 持有 subprocess 引用，cancel 后进程被终止。

远程任务：轮询循环被 CancelledError 打断，`meta["remote_pid"]` 有远端 PID。当前代码会 SSH 过去发 kill 信号终止远端进程。

---

## 孤立任务（pipeline_id=NULL）

`_tick()` 对孤立任务的处理与流水线任务不同：所有 WAITING 孤立任务在同一个 tick 内都会尝试启动，没有串行化。

后果：
- 10 个孤立任务 + 10 张卡 → 可能同时全部启动
- 多个孤立任务可能竞争同一张 GPU（force 模式），系统不做冲突检测
