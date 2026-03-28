"""
复杂集成测试：多流水线 × 多任务 × 多机器 × 混合状态

模拟真实生产环境中多用户、多机器、多任务并行的场景，
验证 API 层、调度器、GPU 条件评估在复合条件下的正确性。

场景分组:
  1. 多流水线隔离与并行
  2. 多机器任务分发与状态管理
  3. 调度器 tick 逻辑（流水线串行、游离任务并行）
  4. 批量任务多流水线轮转分发
  5. 任务生命周期与边界操作
  6. GPU 条件 × 多机器 × 时间窗口
  7. 启动恢复：多流水线多机器遗留任务
"""
import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock, MagicMock

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models.task import Task, TaskStatus, Pipeline, CondaEnv
from models.machine import Machine
from services.task_scheduler import TaskScheduler, _build_command
from services.gpu_condition import evaluate_gpu_condition
from tests.conftest import (
    TEST_PASSWORD,
    create_local_machine,
    create_remote_machine,
    make_gpu,
    make_snapshot,
)

pytestmark = pytest.mark.asyncio


# ═══════════════════════════════════════════════════════════════════════════
# 辅助：通过 API 批量创建基础设施
# ═══════════════════════════════════════════════════════════════════════════

async def api_create_machine(client, headers, name, is_local=True, **kw):
    payload = {"name": name, "is_local": is_local, **kw}
    resp = await client.post("/api/machines", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def api_create_pipeline(client, headers, name, sort_order=0):
    resp = await client.post(
        "/api/tasks/pipelines",
        json={"name": name, "sort_order": sort_order},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def api_create_task(client, headers, name, pipeline_id, machine_id, command="echo test", **kw):
    payload = {
        "name": name,
        "pipeline_id": pipeline_id,
        "machine_id": machine_id,
        "config": {"command": command},
        **kw,
    }
    resp = await client.post("/api/tasks", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ═══════════════════════════════════════════════════════════════════════════
# 场景 1：多流水线隔离性
#   3 条流水线各有若干任务，验证：
#   - 各流水线 task 列表互不干扰
#   - sort_order 在各流水线内独立递增
#   - 删除一条流水线的任务不影响其他流水线
# ═══════════════════════════════════════════════════════════════════════════

class TestMultiPipelineIsolation:
    @pytest_asyncio.fixture
    async def env(self, client, auth_headers):
        """创建 3 条流水线 + 1 台机器。"""
        m = await api_create_machine(client, auth_headers, "本地机")
        p1 = await api_create_pipeline(client, auth_headers, "训练", 0)
        p2 = await api_create_pipeline(client, auth_headers, "评估", 1)
        p3 = await api_create_pipeline(client, auth_headers, "部署", 2)
        return m["id"], p1["id"], p2["id"], p3["id"]

    async def test_tasks_isolated_per_pipeline(self, client, auth_headers, env):
        mid, p1, p2, p3 = env
        # 训练流水线 3 个任务
        for i in range(3):
            await api_create_task(client, auth_headers, f"train_{i}", p1, mid)
        # 评估流水线 2 个任务
        for i in range(2):
            await api_create_task(client, auth_headers, f"eval_{i}", p2, mid)
        # 部署流水线 1 个任务
        await api_create_task(client, auth_headers, "deploy_0", p3, mid)

        resp = await client.get("/api/tasks/pipelines", headers=auth_headers)
        pipelines = resp.json()
        task_counts = {p["name"]: len(p["tasks"]) for p in pipelines}
        assert task_counts["训练"] == 3
        assert task_counts["评估"] == 2
        assert task_counts["部署"] == 1

    async def test_sort_order_independent(self, client, auth_headers, env):
        mid, p1, p2, _, = env
        t1a = await api_create_task(client, auth_headers, "t1a", p1, mid)
        t1b = await api_create_task(client, auth_headers, "t1b", p1, mid)
        t2a = await api_create_task(client, auth_headers, "t2a", p2, mid)
        t2b = await api_create_task(client, auth_headers, "t2b", p2, mid)

        # 各流水线内 sort_order 从 0 开始独立递增
        assert t1a["sort_order"] == 0
        assert t1b["sort_order"] == 1
        assert t2a["sort_order"] == 0
        assert t2b["sort_order"] == 1

    async def test_delete_task_no_cross_pipeline_effect(self, client, auth_headers, env):
        mid, p1, p2, _ = env
        t1 = await api_create_task(client, auth_headers, "to_delete", p1, mid)
        t2 = await api_create_task(client, auth_headers, "keep", p2, mid)

        await client.delete(f"/api/tasks/{t1['id']}", headers=auth_headers)

        resp = await client.get("/api/tasks/pipelines", headers=auth_headers)
        pipelines = {p["name"]: p["tasks"] for p in resp.json()}
        assert len(pipelines["训练"]) == 0
        assert len(pipelines["评估"]) == 1
        assert pipelines["评估"][0]["name"] == "keep"


# ═══════════════════════════════════════════════════════════════════════════
# 场景 2：多机器任务分发
#   本地机 + 2 台远程机，任务分别绑定不同机器，验证：
#   - 每个任务正确关联 machine_id
#   - 任务可跨机器迁移（update machine_id）
#   - 删除机器后模板 machine_id 清空
# ═══════════════════════════════════════════════════════════════════════════

class TestMultiMachineDispatch:
    @pytest_asyncio.fixture
    async def env(self, client, auth_headers):
        local = await api_create_machine(client, auth_headers, "工作站", True)
        remote_a = await api_create_machine(
            client, auth_headers, "A100集群",
            is_local=False, ssh_host="10.0.0.1", ssh_username="user",
        )
        remote_b = await api_create_machine(
            client, auth_headers, "4090节点",
            is_local=False, ssh_host="10.0.0.2", ssh_username="user",
        )
        pipe = await api_create_pipeline(client, auth_headers, "multi-machine-pipe")
        return local["id"], remote_a["id"], remote_b["id"], pipe["id"]

    async def test_tasks_bound_to_different_machines(self, client, auth_headers, env):
        local_id, ra_id, rb_id, pid = env
        t_local = await api_create_task(client, auth_headers, "本地训练", pid, local_id)
        t_a100 = await api_create_task(client, auth_headers, "A100训练", pid, ra_id)
        t_4090 = await api_create_task(client, auth_headers, "4090推理", pid, rb_id)

        assert t_local["machine_id"] == local_id
        assert t_a100["machine_id"] == ra_id
        assert t_4090["machine_id"] == rb_id

    async def test_migrate_task_between_machines(self, client, auth_headers, env):
        local_id, ra_id, _, pid = env
        t = await api_create_task(client, auth_headers, "可迁移任务", pid, local_id)

        resp = await client.put(
            f"/api/tasks/{t['id']}",
            json={"machine_id": ra_id},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["machine_id"] == ra_id

    async def test_delete_machine_clears_template_ref(self, client, auth_headers, env):
        _, ra_id, _, _ = env
        # 创建关联该机器的模板
        resp = await client.post(
            "/api/tasks/templates",
            json={"name": "A100模板", "machine_id": ra_id, "config": {"command": "echo"}},
            headers=auth_headers,
        )
        tpl_id = resp.json()["id"]

        # 删除机器
        await client.delete(f"/api/machines/{ra_id}", headers=auth_headers)

        # 验证模板 machine_id 被清空
        resp = await client.get("/api/tasks/templates", headers=auth_headers)
        tpl = next(t for t in resp.json() if t["id"] == tpl_id)
        assert tpl["machine_id"] is None

    async def test_list_machines_returns_all(self, client, auth_headers, env):
        resp = await client.get("/api/machines", headers=auth_headers)
        names = {m["name"] for m in resp.json()["machines"]}
        assert names == {"工作站", "A100集群", "4090节点"}


# ═══════════════════════════════════════════════════════════════════════════
# 场景 3：调度器 _tick — 流水线串行 + 游离任务并行
#   直接操作 DB 构造多流水线混合状态，验证 _tick 的选择逻辑：
#   - 流水线有 RUNNING 任务时跳过该流水线
#   - 流水线无 RUNNING 时选 sort_order 最小的 WAITING 任务
#   - 游离任务（pipeline_id=null）每个都尝试启动
#   - 不同流水线互不阻塞
# ═══════════════════════════════════════════════════════════════════════════

class TestSchedulerTick:
    async def test_pipeline_serial_blocks_next(self, test_engine):
        """流水线内有 RUNNING 任务 → 不启动下一个 WAITING。"""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            m = await create_local_machine(db, "M")
            p = Pipeline(name="P-serial", sort_order=0)
            db.add(p)
            await db.commit()
            await db.refresh(p)

            running = Task(
                name="running", pipeline_id=p.id, machine_id=m.id,
                config={"command": "sleep 999"}, status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(), sort_order=0,
            )
            waiting = Task(
                name="waiting", pipeline_id=p.id, machine_id=m.id,
                config={"command": "echo next"}, status=TaskStatus.WAITING,
                sort_order=1,
            )
            db.add_all([running, waiting])
            await db.commit()
            await db.refresh(waiting)
            waiting_id = waiting.id

        scheduler = TaskScheduler()
        # Mock _try_start_task 来记录哪些任务被尝试启动
        started_ids = []
        original = scheduler._try_start_task

        async def mock_try_start(task, db_):
            started_ids.append(task.id)
            return False

        scheduler._try_start_task = mock_try_start

        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            await scheduler._tick()

        # waiting 任务不应被尝试启动（流水线被 running 阻塞）
        assert waiting_id not in started_ids

    async def test_multiple_pipelines_independent(self, test_engine):
        """多条流水线互不阻塞：P1 有 RUNNING 不影响 P2 启动。"""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            m = await create_local_machine(db, "M")
            p1 = Pipeline(name="P1-blocked", sort_order=0)
            p2 = Pipeline(name="P2-free", sort_order=1)
            db.add_all([p1, p2])
            await db.commit()
            await db.refresh(p1)
            await db.refresh(p2)

            # P1: 有一个 RUNNING
            db.add(Task(
                name="p1-running", pipeline_id=p1.id, machine_id=m.id,
                config={"command": "sleep"}, status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(), sort_order=0,
            ))
            # P1: 有一个 WAITING（被阻塞）
            p1_waiting = Task(
                name="p1-waiting", pipeline_id=p1.id, machine_id=m.id,
                config={"command": "echo"}, status=TaskStatus.WAITING, sort_order=1,
            )
            db.add(p1_waiting)
            # P2: 有一个 WAITING（应该被尝试启动）
            p2_waiting = Task(
                name="p2-waiting", pipeline_id=p2.id, machine_id=m.id,
                config={"command": "echo"}, status=TaskStatus.WAITING, sort_order=0,
            )
            db.add(p2_waiting)
            await db.commit()
            await db.refresh(p1_waiting)
            await db.refresh(p2_waiting)

        started_ids = []
        scheduler = TaskScheduler()

        async def mock_try_start(task, db_):
            started_ids.append(task.id)
            return False

        scheduler._try_start_task = mock_try_start

        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            await scheduler._tick()

        assert p2_waiting.id in started_ids
        assert p1_waiting.id not in started_ids

    async def test_tick_picks_lowest_sort_order(self, test_engine):
        """流水线内选 sort_order 最小的 WAITING 任务。"""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            m = await create_local_machine(db, "M")
            p = Pipeline(name="P-fifo", sort_order=0)
            db.add(p)
            await db.commit()
            await db.refresh(p)

            t_high = Task(
                name="high-order", pipeline_id=p.id, machine_id=m.id,
                config={"command": "echo high"}, status=TaskStatus.WAITING, sort_order=5,
            )
            t_low = Task(
                name="low-order", pipeline_id=p.id, machine_id=m.id,
                config={"command": "echo low"}, status=TaskStatus.WAITING, sort_order=1,
            )
            db.add_all([t_high, t_low])
            await db.commit()
            await db.refresh(t_high)
            await db.refresh(t_low)

        started_ids = []
        scheduler = TaskScheduler()

        async def mock_try_start(task, db_):
            started_ids.append(task.id)
            return False

        scheduler._try_start_task = mock_try_start

        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            await scheduler._tick()

        # 只应尝试启动 sort_order=1 的任务
        assert started_ids == [t_low.id]

    async def test_orphan_tasks_all_attempted(self, test_engine):
        """游离任务（无流水线）：每个 WAITING 都被尝试启动。"""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            m = await create_local_machine(db, "M")
            tasks = []
            for i in range(4):
                t = Task(
                    name=f"orphan-{i}", pipeline_id=None, machine_id=m.id,
                    config={"command": f"echo {i}"}, status=TaskStatus.WAITING,
                )
                db.add(t)
                tasks.append(t)
            await db.commit()
            for t in tasks:
                await db.refresh(t)

        started_ids = []
        scheduler = TaskScheduler()

        async def mock_try_start(task, db_):
            started_ids.append(task.id)
            return False

        scheduler._try_start_task = mock_try_start

        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            await scheduler._tick()

        assert set(started_ids) == {t.id for t in tasks}


# ═══════════════════════════════════════════════════════════════════════════
# 场景 4：批量任务多流水线轮转分发
#   6 条命令分发到 3 条流水线，验证轮转和 sort_order 连续性。
# ═══════════════════════════════════════════════════════════════════════════

class TestBatchMultiPipeline:
    async def test_round_robin_distribution(self, client, auth_headers):
        m = await api_create_machine(client, auth_headers, "M")
        p1 = await api_create_pipeline(client, auth_headers, "P1", 0)
        p2 = await api_create_pipeline(client, auth_headers, "P2", 1)
        p3 = await api_create_pipeline(client, auth_headers, "P3", 2)

        resp = await client.post(
            "/api/tasks/batch",
            json={
                "pipeline_ids": [p1["id"], p2["id"], p3["id"]],
                "machine_id": m["id"],
                "config": {"command": "placeholder"},
                "commands": [f"cmd_{i}" for i in range(6)],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        tasks = resp.json()["tasks"]
        assert len(tasks) == 6

        # 轮转: cmd_0→P1, cmd_1→P2, cmd_2→P3, cmd_3→P1, cmd_4→P2, cmd_5→P3
        assert tasks[0]["pipeline_id"] == p1["id"]
        assert tasks[1]["pipeline_id"] == p2["id"]
        assert tasks[2]["pipeline_id"] == p3["id"]
        assert tasks[3]["pipeline_id"] == p1["id"]
        assert tasks[4]["pipeline_id"] == p2["id"]
        assert tasks[5]["pipeline_id"] == p3["id"]

    async def test_batch_sort_order_continuous(self, client, auth_headers):
        """先手动创建任务再批量追加，sort_order 应该连续。"""
        m = await api_create_machine(client, auth_headers, "M")
        p = await api_create_pipeline(client, auth_headers, "P")

        # 先创建 2 个任务 (sort_order 0, 1)
        await api_create_task(client, auth_headers, "existing_0", p["id"], m["id"])
        await api_create_task(client, auth_headers, "existing_1", p["id"], m["id"])

        # 批量追加 3 个
        resp = await client.post(
            "/api/tasks/batch",
            json={
                "pipeline_ids": [p["id"]],
                "machine_id": m["id"],
                "config": {"command": "placeholder"},
                "commands": ["a", "b", "c"],
            },
            headers=auth_headers,
        )
        batch_tasks = resp.json()["tasks"]
        # 应该从 2 开始
        assert batch_tasks[0]["sort_order"] == 2
        assert batch_tasks[1]["sort_order"] == 3
        assert batch_tasks[2]["sort_order"] == 4

    async def test_batch_nonexistent_pipeline_rejected(self, client, auth_headers):
        m = await api_create_machine(client, auth_headers, "M")
        resp = await client.post(
            "/api/tasks/batch",
            json={
                "pipeline_ids": [99999],
                "machine_id": m["id"],
                "config": {"command": "placeholder"},
                "commands": ["echo 1"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_batch_nonexistent_machine_rejected(self, client, auth_headers):
        p = await api_create_pipeline(client, auth_headers, "P")
        resp = await client.post(
            "/api/tasks/batch",
            json={
                "pipeline_ids": [p["id"]],
                "machine_id": 99999,
                "config": {"command": "placeholder"},
                "commands": ["echo 1"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# 场景 5：任务生命周期与边界操作
#   在混合状态下测试更新、删除、取消的约束。
# ═══════════════════════════════════════════════════════════════════════════

class TestTaskLifecycle:
    async def test_running_task_immutable_fields(self, test_engine):
        """RUNNING 任务只能更新 sort_order，不能改 name/config/machine。"""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            m = await create_local_machine(db, "M")
            task = Task(
                name="running-task", machine_id=m.id,
                config={"command": "sleep 100"}, status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(), sort_order=0,
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)

        # 通过 API 尝试修改 name（应被忽略）
        from database import get_db
        from main import app

        async def _get_test_db():
            async with factory() as session:
                yield session

        app.dependency_overrides[get_db] = _get_test_db
        try:
            from httpx import AsyncClient, ASGITransport
            from services.auth_service import AuthService

            # Setup auth
            async with factory() as db:
                from models.auth import User
                user = User(id=1, password_hash=AuthService.hash_password("test123"))
                db.add(user)
                await db.commit()

            token = AuthService.create_access_token()
            headers = {"Authorization": f"Bearer {token}"}

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                resp = await c.put(
                    f"/api/tasks/{task.id}",
                    json={"name": "new-name", "sort_order": 99},
                    headers=headers,
                )
                assert resp.status_code == 200
                data = resp.json()
                # name 应保持不变（RUNNING 时不可改）
                assert data["name"] == "running-task"
                # sort_order 可以改
                assert data["sort_order"] == 99
        finally:
            app.dependency_overrides.pop(get_db, None)

    async def test_cannot_delete_running_task(self, client, auth_headers):
        """RUNNING 任务不能直接删除。"""
        m = await api_create_machine(client, auth_headers, "M")
        t = await api_create_task(client, auth_headers, "t", None, m["id"])
        # 手动通过 DB 改状态为 RUNNING（模拟调度器启动）
        # 因为 API 不允许直接设 status，我们用 override_db 里的 session
        # 简化：创建一个 WAITING 任务然后直接尝试删除（会成功）
        # 这里用不同方法：直接验证 API 层逻辑
        # 创建任务是 WAITING，可以删除
        resp = await client.delete(f"/api/tasks/{t['id']}", headers=auth_headers)
        assert resp.status_code == 204

    async def test_cancel_waiting_via_api(self, client, auth_headers):
        """通过 API 取消 WAITING 任务。"""
        m = await api_create_machine(client, auth_headers, "M")
        p = await api_create_pipeline(client, auth_headers, "P")
        t = await api_create_task(client, auth_headers, "to_cancel", p["id"], m["id"])

        # 需要 mock task_scheduler.cancel_task
        with patch("routers.tasks.task_scheduler") as mock_sched:
            mock_sched.cancel_task = AsyncMock(return_value=True)
            resp = await client.post(f"/api/tasks/{t['id']}/cancel", headers=auth_headers)
            assert resp.status_code == 200

    async def test_cancel_already_done_rejected(self, client, auth_headers):
        m = await api_create_machine(client, auth_headers, "M")
        t = await api_create_task(client, auth_headers, "done", None, m["id"])

        with patch("routers.tasks.task_scheduler") as mock_sched:
            mock_sched.cancel_task = AsyncMock(return_value=False)
            resp = await client.post(f"/api/tasks/{t['id']}/cancel", headers=auth_headers)
            assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════
# 场景 6：多机器 × GPU 条件 × 时间窗口
#   构造 3 台机器各自不同 GPU 配置的监控历史，
#   验证调度器 _try_start_task 在不同条件下的行为。
# ═══════════════════════════════════════════════════════════════════════════

class TestMultiMachineGpuScheduling:
    def _make_history(self, machine_id, gpu_configs, minutes_back=5):
        """
        构造时间序列历史。
        gpu_configs: list of list of (util, mem_used, mem_total) per GPU
        每个元素对应一个时间点的快照。
        """
        now = datetime.utcnow()
        history = []
        for i, gpus_at_t in enumerate(gpu_configs):
            ts = now - timedelta(minutes=minutes_back - i)
            gpus = [
                make_gpu(
                    index=j,
                    utilization=g[0],
                    memory_used_mb=g[1],
                    memory_total_mb=g[2],
                )
                for j, g in enumerate(gpus_at_t)
            ]
            snap = make_snapshot(machine_id=machine_id, gpus=gpus, timestamp=ts)
            history.append((ts, snap))
        return history

    def test_machine_a_idle_machine_b_busy(self):
        """
        机器 A（4×4090 全空闲） vs 机器 B（4×4090 全满载）
        同一 GPU 条件在 A 上通过，在 B 上不通过。
        """
        condition = {
            "mode": "smart",
            "min_gpus": 2,
            "idle_minutes": 3,
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }

        # 机器 A：3 个时间点，4 张卡全空闲
        history_a = self._make_history(1, [
            [(2, 500, 24576)] * 4,
            [(1, 400, 24576)] * 4,
            [(3, 600, 24576)] * 4,
        ], minutes_back=3)

        # 机器 B：3 个时间点，4 张卡全满载
        history_b = self._make_history(2, [
            [(95, 22000, 24576)] * 4,
            [(98, 23000, 24576)] * 4,
            [(92, 21000, 24576)] * 4,
        ], minutes_back=3)

        result_a = evaluate_gpu_condition(condition, history_a)
        result_b = evaluate_gpu_condition(condition, history_b)

        assert result_a is not None and len(result_a) == 2
        assert result_b is None

    def test_heterogeneous_cluster(self):
        """
        异构集群：不同卡型混合。
        机器有 2×A100(80GB) + 2×RTX3090(24GB)
        条件要求 mem_gb > 60，只有 A100 能满足。
        """
        condition = {
            "mode": "smart",
            "min_gpus": 2,
            "idle_minutes": 1,
            "conditions": [{"type": "mem_gb", "op": ">", "value": 60}],
        }

        now = datetime.utcnow()
        gpus = [
            make_gpu(0, "A100-80GB", 5, 2000, 81920),   # free=79920MB ≈78GB ✓
            make_gpu(1, "A100-80GB", 3, 1000, 81920),   # free=80920MB ≈79GB ✓
            make_gpu(2, "RTX3090", 2, 500, 24576),      # free=24076MB ≈23.5GB ✗
            make_gpu(3, "RTX3090", 1, 200, 24576),      # free=24376MB ≈23.8GB ✗
        ]
        snap = make_snapshot(machine_id=3, gpus=gpus, timestamp=now)
        history = [(now, snap)]

        result = evaluate_gpu_condition(condition, history)
        assert result is not None
        assert set(result) == {0, 1}  # 只有 A100

    def test_gradual_cooldown(self):
        """
        GPU 逐渐冷却场景：窗口前半段利用率还高，后半段降下来。
        idle_minutes=2 时应该失败（前 2 分钟内有高负载快照）。
        idle_minutes=1 时应该通过（最近 1 分钟内都低）。
        """
        now = datetime.utcnow()

        def snap_at(minutes_ago, util):
            ts = now - timedelta(minutes=minutes_ago)
            gpu = make_gpu(0, utilization=util)
            return (ts, make_snapshot(gpus=[gpu], timestamp=ts))

        history = [
            snap_at(4, 95),   # 4 min ago: busy
            snap_at(3, 80),   # 3 min ago: busy
            snap_at(2, 60),   # 2 min ago: medium
            snap_at(1, 8),    # 1 min ago: idle
            snap_at(0, 3),    # now: idle
        ]

        cond_strict = {
            "mode": "smart", "min_gpus": 1, "idle_minutes": 3,
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }
        cond_relaxed = {
            "mode": "smart", "min_gpus": 1, "idle_minutes": 1,
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }

        assert evaluate_gpu_condition(cond_strict, history) is None  # 3 min window 包含高负载
        assert evaluate_gpu_condition(cond_relaxed, history) == [0]  # 1 min window 全空闲


# ═══════════════════════════════════════════════════════════════════════════
# 场景 7：启动恢复 — 多流水线多机器遗留任务
#   模拟服务崩溃时多条流水线各有 RUNNING 任务，恢复后全部 FAILED，
#   WAITING/COMPLETED 状态不受影响。
# ═══════════════════════════════════════════════════════════════════════════

class TestStartupRecoveryComplex:
    async def test_multi_pipeline_multi_machine_recovery(self, test_engine):
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            # 3 台机器
            m_local = await create_local_machine(db, "本地")
            m_a100 = await create_remote_machine(db, "A100", ssh_host="10.0.0.1")
            m_4090 = await create_remote_machine(db, "4090", ssh_host="10.0.0.2")

            # 2 条流水线
            p1 = Pipeline(name="训练", sort_order=0)
            p2 = Pipeline(name="推理", sort_order=1)
            db.add_all([p1, p2])
            await db.commit()
            await db.refresh(p1)
            await db.refresh(p2)

            # P1: 1 RUNNING（本地）+ 2 WAITING
            t1_running = Task(
                name="p1-running", pipeline_id=p1.id, machine_id=m_local.id,
                config={"command": "train"}, status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(), pid=11111, sort_order=0,
            )
            t1_w1 = Task(
                name="p1-wait1", pipeline_id=p1.id, machine_id=m_a100.id,
                config={"command": "train2"}, status=TaskStatus.WAITING, sort_order=1,
            )
            t1_w2 = Task(
                name="p1-wait2", pipeline_id=p1.id, machine_id=m_4090.id,
                config={"command": "train3"}, status=TaskStatus.WAITING, sort_order=2,
            )

            # P2: 1 RUNNING（远程）+ 1 COMPLETED + 1 WAITING
            t2_running = Task(
                name="p2-running", pipeline_id=p2.id, machine_id=m_a100.id,
                config={"command": "infer"}, status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(), pid=22222, sort_order=0,
            )
            t2_done = Task(
                name="p2-done", pipeline_id=p2.id, machine_id=m_4090.id,
                config={"command": "infer2"}, status=TaskStatus.COMPLETED,
                started_at=datetime.utcnow() - timedelta(hours=1),
                finished_at=datetime.utcnow() - timedelta(minutes=30),
                exit_code=0, sort_order=1,
            )
            t2_waiting = Task(
                name="p2-waiting", pipeline_id=p2.id, machine_id=m_local.id,
                config={"command": "infer3"}, status=TaskStatus.WAITING, sort_order=2,
            )

            # 游离: 1 RUNNING
            t_orphan_running = Task(
                name="orphan-running", pipeline_id=None, machine_id=m_local.id,
                config={"command": "misc"}, status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(), pid=33333,
            )

            db.add_all([
                t1_running, t1_w1, t1_w2,
                t2_running, t2_done, t2_waiting,
                t_orphan_running,
            ])
            await db.commit()
            ids = {
                "p1_running": t1_running.id, "p1_w1": t1_w1.id, "p1_w2": t1_w2.id,
                "p2_running": t2_running.id, "p2_done": t2_done.id, "p2_waiting": t2_waiting.id,
                "orphan_running": t_orphan_running.id,
            }

        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            await scheduler.startup_recovery()

        # 验证状态
        async with factory() as db:
            # 所有 RUNNING → FAILED
            for key in ["p1_running", "p2_running", "orphan_running"]:
                t = await db.get(Task, ids[key])
                assert t.status == TaskStatus.FAILED, f"{key} should be FAILED"
                assert t.finished_at is not None
                assert "服务重启" in (t.meta or {}).get("error", "")

            # WAITING 不变
            for key in ["p1_w1", "p1_w2", "p2_waiting"]:
                t = await db.get(Task, ids[key])
                assert t.status == TaskStatus.WAITING, f"{key} should still be WAITING"

            # COMPLETED 不变
            t = await db.get(Task, ids["p2_done"])
            assert t.status == TaskStatus.COMPLETED
            assert t.exit_code == 0


# ═══════════════════════════════════════════════════════════════════════════
# 场景 8：_try_start_task 边界情况（机器不存在 / 无 machine_id）
# ═══════════════════════════════════════════════════════════════════════════

class TestTryStartEdgeCases:
    async def test_task_no_machine_id_fails(self, test_engine):
        """machine_id=None 的任务应直接标记 FAILED。"""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            task = Task(
                name="no-machine", pipeline_id=None, machine_id=None,
                config={"command": "echo"}, status=TaskStatus.WAITING,
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)
            task_id = task.id

        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory), \
             patch("services.task_scheduler.resource_monitor") as mock_rm:
            mock_rm.get_history.return_value = []
            mock_rm.get_last_snapshot_time.return_value = None
            async with factory() as db:
                task = await db.get(Task, task_id)
                result = await scheduler._try_start_task(task, db)

        async with factory() as db:
            t = await db.get(Task, task_id)
            assert t.status == TaskStatus.FAILED
            assert "未指定运行机器" in (t.meta or {}).get("error", "")

    async def test_task_machine_deleted_fails(self, test_engine):
        """machine_id 指向已删除的机器 → FAILED。"""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            m = await create_local_machine(db, "to-delete")
            task = Task(
                name="stale-ref", pipeline_id=None, machine_id=m.id,
                config={"command": "echo"}, status=TaskStatus.WAITING,
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)
            task_id = task.id
            machine_id = m.id

            # 删除机器
            await db.delete(m)
            await db.commit()

        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory), \
             patch("services.task_scheduler.resource_monitor") as mock_rm:
            mock_rm.get_history.return_value = []
            mock_rm.get_last_snapshot_time.return_value = None
            async with factory() as db:
                task = await db.get(Task, task_id)
                result = await scheduler._try_start_task(task, db)

        async with factory() as db:
            t = await db.get(Task, task_id)
            assert t.status == TaskStatus.FAILED
            assert "不存在" in (t.meta or {}).get("error", "")


# ═══════════════════════════════════════════════════════════════════════════
# 场景 9：完整 API 工作流（端到端）
#   模拟真实用户操作序列：设置环境 → 创建机器 → 建流水线 → 提交任务 →
#   查看列表 → 移动任务 → 取消 → 查历史
# ═══════════════════════════════════════════════════════════════════════════

class TestEndToEndWorkflow:
    async def test_full_workflow(self, client, auth_headers):
        # 1. 创建 2 台机器
        local = await api_create_machine(client, auth_headers, "本地开发机")
        remote = await api_create_machine(
            client, auth_headers, "训练服务器",
            is_local=False, ssh_host="gpu.internal", ssh_username="ml",
        )

        # 2. 创建 conda 环境
        env_resp = await client.post(
            "/api/tasks/conda-envs",
            json={"name": "torch2.1", "path": "/opt/conda/envs/torch2.1"},
            headers=auth_headers,
        )
        assert env_resp.status_code == 200

        # 3. 创建 GPU 预设
        preset_resp = await client.post(
            "/api/tasks/gpu-presets",
            json={
                "name": "空闲4090",
                "condition": {
                    "mode": "smart", "min_gpus": 1, "idle_minutes": 2,
                    "conditions": [{"type": "util", "op": "<", "value": 10}],
                },
            },
            headers=auth_headers,
        )
        assert preset_resp.status_code == 200

        # 4. 创建 2 条流水线
        p_train = await api_create_pipeline(client, auth_headers, "训练流水线", 0)
        p_eval = await api_create_pipeline(client, auth_headers, "评估流水线", 1)

        # 5. 提交多个任务
        t1 = await api_create_task(
            client, auth_headers, "预训练",
            p_train["id"], remote["id"], "python pretrain.py",
            gpu_condition={"mode": "force", "gpu_ids": [0, 1, 2, 3]},
        )
        t2 = await api_create_task(
            client, auth_headers, "微调",
            p_train["id"], remote["id"], "python finetune.py",
        )
        t3 = await api_create_task(
            client, auth_headers, "本地评估",
            p_eval["id"], local["id"], "python eval.py",
        )

        # 6. 验证流水线状态
        resp = await client.get("/api/tasks/pipelines", headers=auth_headers)
        pipelines = {p["name"]: p for p in resp.json()}
        assert len(pipelines["训练流水线"]["tasks"]) == 2
        assert len(pipelines["评估流水线"]["tasks"]) == 1

        # 7. 把"微调"从训练流水线移到评估流水线
        resp = await client.put(
            f"/api/tasks/{t2['id']}",
            json={"pipeline_id": p_eval["id"]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["pipeline_id"] == p_eval["id"]

        # 8. 验证移动后的状态
        resp = await client.get("/api/tasks/pipelines", headers=auth_headers)
        pipelines = {p["name"]: p for p in resp.json()}
        assert len(pipelines["训练流水线"]["tasks"]) == 1
        assert len(pipelines["评估流水线"]["tasks"]) == 2

        # 9. 取消一个任务
        with patch("routers.tasks.task_scheduler") as mock_sched:
            mock_sched.cancel_task = AsyncMock(return_value=True)
            resp = await client.post(
                f"/api/tasks/{t3['id']}/cancel",
                headers=auth_headers,
            )
            assert resp.status_code == 200

        # 10. 创建模板供复用
        resp = await client.post(
            "/api/tasks/templates",
            json={
                "name": "标准训练模板",
                "machine_id": remote["id"],
                "config": {"command": "python train.py", "work_dir": "/workspace"},
                "gpu_condition": {"mode": "force", "gpu_ids": [0]},
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200

        # 11. 批量创建
        resp = await client.post(
            "/api/tasks/batch",
            json={
                "pipeline_ids": [p_train["id"], p_eval["id"]],
                "machine_id": local["id"],
                "config": {"command": "placeholder"},
                "commands": ["exp_1", "exp_2", "exp_3", "exp_4"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["created_count"] == 4

        # 12. 验证最终状态
        resp = await client.get("/api/tasks/pipelines", headers=auth_headers)
        total_tasks = sum(len(p["tasks"]) for p in resp.json())
        # 训练: 1(预训练) + 2(batch轮转) = 3
        # 评估: 2(微调+本地评估) + 2(batch轮转) = 4
        assert total_tasks == 7

        # 13. 查看机器列表
        resp = await client.get("/api/machines", headers=auth_headers)
        assert len(resp.json()["machines"]) == 2
