# 编写新测试的指引

## 添加新的 API 端点测试

1. 在 `test_api_integration.py` 中找到对应资源的 `Test*` 类
2. 新增 `async def test_xxx(self, client, auth_headers)` 方法
3. 如果需要预置数据（机器、流水线），参考 `TestTasks.setup_machine_and_pipeline` fixture
4. 复杂的多资源场景放到 `test_complex_scenarios.py`

```python
async def test_new_endpoint(self, client, auth_headers):
    resp = await client.post("/api/tasks/new-thing", json={...}, headers=auth_headers)
    assert resp.status_code == 200
```

## 添加新的 GPU 条件测试

1. 使用 `make_gpu()` 和 `make_snapshot()` 构造 GPU 数据
2. 使用 `_history()` 辅助函数构造时间序列
3. 直接调用 `evaluate_gpu_condition(condition, history)` 断言结果

```python
from tests.conftest import make_gpu, make_snapshot

def test_new_condition(self):
    gpu = make_gpu(index=0, utilization=50, memory_used_mb=10000, memory_total_mb=24576)
    snap = make_snapshot(gpus=[gpu])
    history = _history([snap], [0])
    result = evaluate_gpu_condition(condition, history)
```

## 添加调度器相关测试

- **纯函数**（如 `_build_command`）：直接调用，不需要 DB
- **涉及数据库**（启动恢复、取消、tick）：使用 `test_engine` fixture，创建 `async_sessionmaker`，通过 `patch("services.task_scheduler.AsyncSessionLocal", factory)` 注入

```python
async def test_scheduler_thing(self, test_engine):
    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        # ... 构造数据 ...
    scheduler = TaskScheduler()
    with patch("services.task_scheduler.AsyncSessionLocal", factory):
        await scheduler.some_method()
```

## 添加复杂场景测试

放到 `test_complex_scenarios.py`，使用辅助函数简化 API 调用：

```python
from tests.test_complex_scenarios import api_create_machine, api_create_pipeline, api_create_task

async def test_complex_thing(self, client, auth_headers):
    m = await api_create_machine(client, auth_headers, "M")
    p = await api_create_pipeline(client, auth_headers, "P")
    t = await api_create_task(client, auth_headers, "T", p["id"], m["id"])
```

## 需要新增 Mock 的情况

如果新功能引入了新的外部依赖（如新的全局单例服务），在 `conftest.py` 中添加 `autouse=True` 的 mock fixture，避免测试触发真实副作用。

```python
@pytest.fixture(autouse=True)
def mock_new_service():
    with patch("routers.xxx.new_service") as m:
        m.some_method.return_value = None
        yield m
```

---

## 已发现并修复的 Bug

| Bug | 位置 | 影响 | 修复 |
|---|---|---|---|
| `ast.Load` 未加入 AST 白名单 | `services/gpu_condition.py:82` | 所有文本表达式条件静默失败 | 在 `_ALLOWED_AST_NODES` 中添加 `ast.Load` |
