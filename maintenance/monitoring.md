# 资源监控机制

## 两类消费者，两种数据结构

`ResourceMonitorService` 维护两份数据，服务于完全不同的消费者：

| 数据结构 | 消费者 | 用途 |
|---|---|---|
| `_cache[machine_id]` | 前端（via GET /api/monitor/{id}/resources） | 展示当前机器状态 |
| `_history[machine_id]` | task_scheduler（via get_history()） | GPU 空闲条件的时间窗口评估 |

`_cache` 只保存最新快照（覆盖写），`_history` 是 deque，按时间追加并自动修剪超出 30 分钟的旧条目。

**前端请求** `GET /api/monitor/{id}/resources` 时，router 直接返回 `_cache` 里的对象，不触发新采集——这是纯内存读取，无 IO。

**调度器请求** `resource_monitor.get_history(machine_id, minutes=N)` 时，从 `_history` deque 中过滤最近 N 分钟的条目返回，也是纯内存读取。

---

## 轮询与采集的并发安全

采集一次资源数据可能需要数秒（SSH 往返 + 脚本执行）。如果前端轮询和后台轮询同时触发采集，会重复执行开销较大的 SSH 命令。`_in_flight` set 解决这个问题：

```python
async def get_snapshot(self, machine_id, is_local):
    if machine_id in self._in_flight:
        # 已有采集在进行：等待其完成后返回缓存
        await asyncio.sleep(0.5)        # 简单等待
        return self.get_cached(machine_id)

    self._in_flight.add(machine_id)
    try:
        snap = await collect()
        self._cache[machine_id] = snap
        self._history[machine_id].append((now, snap))
        # 修剪超出窗口的历史
    finally:
        self._in_flight.discard(machine_id)
```

**含义**：同一时刻对同一台机器只有一个采集在执行。后来的请求直接复用已采集的结果。

---

## 本地 vs 远程采集差异

**本地**：在 Python 进程内直接调用 `psutil`（CPU/内存）和 `pynvml`（GPU），无 IO 等待，采集速度快（< 200ms，含 CPU 利用率的 200ms 等待窗口）。

**远程**：SSH 执行一段内嵌 Python 脚本（约 150 行），脚本在远端完成所有采集后输出 JSON，本地解析。脚本优先使用 `pynvml`，`pynvml` 不可用时回退到两次 `nvidia-smi` 调用（一次查 GPU 信息，一次查 GPU 上的进程）。

远程采集的延迟取决于 SSH 往返时延 + 远端脚本执行时间，通常在 1–3 秒之间。这是轮询精确间隔逻辑存在的原因：

```python
# _poll 循环
t0 = time()
await get_snapshot(...)
await asyncio.sleep(max(0.0, interval - (time() - t0)))
```

如果采集本身耗时 2 秒而设定间隔为 10 秒，则下次采集距本次结束 8 秒后开始——维持大约均匀的实际采集节奏。

---

## 历史数据的有效性依赖

GPU 条件评估要求"过去 N 分钟内每个快照都满足条件"。但 `_history` 里的快照数量取决于：

1. 监控轮询是否已经运行了足够长时间
2. 轮询间隔（默认 10 秒）

刚启动时，`_history` 可能只有一两个快照甚至为空。如果 `idle_minutes=5` 但历史只有 30 秒，`evaluate_gpu_condition` 会用仅有的快照评估——实际上变成"最近 30 秒均满足"而不是"最近 5 分钟均满足"。这是当前实现的一个**软语义不精确**，不影响正确性（不会误判），只是在系统刚启动时可能过快触发任务。

`get_last_snapshot_time()` 返回上次成功采集的时间戳，主要用于调度器的离线检测，不用于判断历史是否充足。
