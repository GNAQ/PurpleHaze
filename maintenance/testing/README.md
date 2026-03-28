# 测试体系

## 概览

后端测试全部位于 `backend/tests/`，使用 pytest + pytest-asyncio 运行。

| 层级 | 文件 | 测试数 | 关注点 | 文档 |
|---|---|---|---|---|
| API 集成测试 | `test_api_integration.py` | 30 | 端到端请求→响应，覆盖全部 CRUD 端点 | [api-integration.md](api-integration.md) |
| GPU 条件评估 | `test_gpu_condition.py` | 30 | 纯业务逻辑：条件表达式、多 GPU 场景 | [gpu-condition.md](gpu-condition.md) |
| 调度器服务 | `test_scheduler.py` | 17 | 命令构建、崩溃恢复、任务取消状态机 | [scheduler.md](scheduler.md) |
| 复杂场景 | `test_complex_scenarios.py` | 26 | 多流水线×多任务×多机器×混合状态 | [complex-scenarios.md](complex-scenarios.md) |

**共 103 个测试**。编写新测试的指引见 [guide.md](guide.md)。

### 运行

```bash
cd backend && .venv/bin/python -m pytest tests/ -v
```

运行单个文件：

```bash
.venv/bin/python -m pytest tests/test_complex_scenarios.py -v
```

运行单个测试类：

```bash
.venv/bin/python -m pytest tests/test_complex_scenarios.py::TestSchedulerTick -v
```

---

## 基础设施（conftest.py）

### 测试数据库

每个测试函数使用**独立的内存 SQLite**（`sqlite+aiosqlite:///:memory:`），通过 `test_engine` fixture 创建。表结构在每次测试前通过 `Base.metadata.create_all` 自动建表，测试后 `drop_all` 清理。

FastAPI 的 `get_db` 依赖通过 `app.dependency_overrides` 替换为测试数据库会话，确保 API 集成测试走完整请求链路但不碰生产数据。

### httpx AsyncClient

使用 `ASGITransport` 直连 FastAPI app，不启动真实 HTTP 服务。请求走完整的中间件→路由→依赖注入→DB 链路，但无网络开销。

```python
# 用法示例（fixture 自动注入）
async def test_example(client: AsyncClient, auth_headers):
    resp = await client.get("/api/machines", headers=auth_headers)
```

### 认证

`auth_token` fixture 自动执行：创建用户 → 设置密码（`test123456`） → 签发 JWT。`auth_headers` 返回 `{"Authorization": "Bearer <token>"}` 字典，直接传入请求 headers。

### 外部服务 Mock

SSH 和资源监控通过 `autouse=True` fixture **全局自动 mock**，所有测试默认不会触发真实 SSH 连接或系统资源采集：

- `mock_ssh_manager`：`is_connected` 返回 False，`connect` 返回 True，其余操作为空
- `mock_resource_monitor`：`start_polling` / `stop_polling` 为空，`get_history` 返回空列表

### 虚拟机器工厂

提供两个工厂函数，用于在测试中快速构造机器记录：

```python
# 本地机器
machine = await create_local_machine(db, "我的工作站")

# 远程 GPU 服务器
machine = await create_remote_machine(db, "A100集群", ssh_host="10.0.0.1")
```

### GPU 快照工厂

`make_gpu()` 和 `make_snapshot()` 用于构造任意配置的 GPU 监控数据：

```python
gpu = make_gpu(index=0, utilization=85.0, memory_used_mb=20000, memory_total_mb=24576)
snap = make_snapshot(machine_id=1, gpus=[gpu])
```

### Fixture 依赖关系

```
test_engine          ← 独立内存 SQLite 引擎
  └─ db_session      ← 供直接操作 DB 的测试使用
  └─ override_db     ← 替换 FastAPI get_db 依赖
       └─ client     ← httpx AsyncClient
       └─ auth_token ← JWT token
            └─ auth_headers  ← {"Authorization": "Bearer ..."}
            └─ authed_client ← (client, headers) 元组

mock_ssh_manager     ← autouse，全局生效
mock_resource_monitor← autouse，全局生效
```
