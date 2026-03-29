# 资源监控机制

## 两份数据，两类消费者

`ResourceMonitorService` 维护两份数据：

| 数据结构 | 消费者 | 用途 |
|---|---|---|
| `_cache[machine_id]` | 前端（GET /api/monitor/{id}/resources） | 展示当前状态 |
| `_history[machine_id]` | task_scheduler（get_history()） | GPU 空闲条件的时间窗口评估 |

`_cache` 只保存最新快照（覆盖写），`_history` 是 deque，按时间追加，自动修剪 30 分钟前的条目。

前端请求 `GET /api/monitor/{id}/resources` 直接返回 `_cache` 中的对象，不触发新采集，纯内存读取。

调度器 `get_history(machine_id, minutes=N)` 从 `_history` deque 过滤返回，也是纯内存读取。

---

## 采集并发安全

采集可能耗数秒（SSH 往返 + 脚本执行）。`_in_flight` set 防止同一台机器重复采集：

```python
async def get_snapshot(self, machine_id, is_local):
    if machine_id in self._in_flight:
        await asyncio.sleep(0.5)        # 等待已有采集完成
        return self.get_cached(machine_id)

    self._in_flight.add(machine_id)
    try:
        snap = await collect()
        self._cache[machine_id] = snap
        self._history[machine_id].append((now, snap))
        # 修剪超窗口历史
    finally:
        self._in_flight.discard(machine_id)
```

同一时刻对同一台机器只有一个采集在执行，后来的请求复用结果。

---

## 本地 vs 远程采集

**本地**：Python 进程内直接调 `psutil`（CPU/内存）和 `pynvml`（GPU），< 200ms。

**远程**：SSH 执行一段约 150 行的内嵌 Python 脚本，远端采集后输出 JSON，本地解析。优先用 `pynvml`，不可用时回退到两次 `nvidia-smi` 调用。延迟通常 1-3 秒。

轮询间隔会扣除采集耗时来维持均匀节奏：

```python
t0 = time()
await get_snapshot(...)
await asyncio.sleep(max(0.0, interval - (time() - t0)))
```

---

## 历史数据有效性

GPU 条件评估要求"过去 N 分钟每个快照都满足"。但刚启动时 `_history` 可能只有一两个快照。如果 `idle_minutes=5` 但历史只有 30 秒，实际变成"最近 30 秒均满足"。

这是已知的软语义不精确：不会误判（不会把忙碌判为空闲），只是启动初期可能过快触发任务。

`get_last_snapshot_time()` 返回上次采集时间戳，用于调度器的离线检测，不用于判断历史是否充足。
