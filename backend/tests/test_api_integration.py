"""
Backend API integration tests.

Tests exercise the real FastAPI app with a test SQLite DB,
mocked SSH/monitor services, and fake machines.
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.conftest import (
    TEST_PASSWORD,
    create_local_machine,
    create_remote_machine,
)

pytestmark = pytest.mark.asyncio


# ═══════════════════════════════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════════════════════════════

class TestAuth:
    async def test_status_not_setup(self, client: AsyncClient, override_db):
        """Fresh DB: password not set up yet."""
        resp = await client.get("/api/auth/status")
        assert resp.status_code == 200
        assert resp.json()["is_setup"] is False

    async def test_setup_and_login(self, client: AsyncClient, override_db):
        resp = await client.post("/api/auth/setup", json={"password": TEST_PASSWORD})
        assert resp.status_code == 201

        resp = await client.get("/api/auth/status")
        assert resp.json()["is_setup"] is True

        resp = await client.post("/api/auth/login", json={"password": TEST_PASSWORD})
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_setup_rejects_short_password(self, client: AsyncClient, override_db):
        resp = await client.post("/api/auth/setup", json={"password": "123"})
        assert resp.status_code == 400

    async def test_login_wrong_password(self, client: AsyncClient, auth_headers):
        resp = await client.post("/api/auth/login", json={"password": "wrong_password"})
        assert resp.status_code == 401

    async def test_change_password(self, client: AsyncClient, auth_headers):
        resp = await client.post(
            "/api/auth/change-password",
            json={"old_password": TEST_PASSWORD, "new_password": "newpass789"},
            headers=auth_headers,
        )
        assert resp.status_code == 200

        # Login with new password
        resp = await client.post("/api/auth/login", json={"password": "newpass789"})
        assert resp.status_code == 200

    async def test_protected_endpoint_without_token(self, client: AsyncClient, override_db):
        resp = await client.get("/api/machines")
        assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════
# Machines CRUD
# ═══════════════════════════════════════════════════════════════════════════

class TestMachines:
    async def test_create_local_machine(self, client: AsyncClient, auth_headers):
        resp = await client.post(
            "/api/machines",
            json={"name": "本地测试机", "is_local": True},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "本地测试机"
        assert data["is_local"] is True
        assert data["connected"] is True  # local machines are always connected

    async def test_create_remote_machine(self, client: AsyncClient, auth_headers):
        resp = await client.post(
            "/api/machines",
            json={
                "name": "GPU Server A",
                "is_local": False,
                "ssh_host": "10.0.0.1",
                "ssh_port": 22,
                "ssh_username": "root",
                "ssh_password": "secret",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "GPU Server A"
        assert data["is_local"] is False
        assert data["has_password"] is True
        # Password should NOT be returned in response
        assert "ssh_password" not in data

    async def test_create_remote_without_host_fails(self, client: AsyncClient, auth_headers):
        resp = await client.post(
            "/api/machines",
            json={"name": "bad machine", "is_local": False},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    async def test_list_machines(self, client: AsyncClient, auth_headers):
        # Create two machines
        await client.post("/api/machines", json={"name": "M1", "is_local": True}, headers=auth_headers)
        await client.post(
            "/api/machines",
            json={"name": "M2", "is_local": False, "ssh_host": "1.2.3.4", "ssh_username": "u"},
            headers=auth_headers,
        )
        resp = await client.get("/api/machines", headers=auth_headers)
        assert resp.status_code == 200
        machines = resp.json()["machines"]
        assert len(machines) == 2

    async def test_update_machine(self, client: AsyncClient, auth_headers):
        create_resp = await client.post(
            "/api/machines",
            json={"name": "OldName", "is_local": True},
            headers=auth_headers,
        )
        mid = create_resp.json()["id"]

        resp = await client.put(
            f"/api/machines/{mid}",
            json={"name": "NewName"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "NewName"

    async def test_delete_machine(self, client: AsyncClient, auth_headers):
        create_resp = await client.post(
            "/api/machines",
            json={"name": "ToDelete", "is_local": True},
            headers=auth_headers,
        )
        mid = create_resp.json()["id"]

        resp = await client.delete(f"/api/machines/{mid}", headers=auth_headers)
        assert resp.status_code == 204

        resp = await client.get(f"/api/machines/{mid}", headers=auth_headers)
        assert resp.status_code == 404

    async def test_get_nonexistent_machine(self, client: AsyncClient, auth_headers):
        resp = await client.get("/api/machines/9999", headers=auth_headers)
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# Pipelines
# ═══════════════════════════════════════════════════════════════════════════

class TestPipelines:
    async def test_create_and_list_pipeline(self, client: AsyncClient, auth_headers):
        resp = await client.post(
            "/api/tasks/pipelines",
            json={"name": "训练流水线", "sort_order": 0},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        pid = resp.json()["id"]

        resp = await client.get("/api/tasks/pipelines", headers=auth_headers)
        assert resp.status_code == 200
        names = [p["name"] for p in resp.json()]
        assert "训练流水线" in names

    async def test_update_pipeline(self, client: AsyncClient, auth_headers):
        resp = await client.post(
            "/api/tasks/pipelines",
            json={"name": "Old", "sort_order": 0},
            headers=auth_headers,
        )
        pid = resp.json()["id"]

        resp = await client.put(
            f"/api/tasks/pipelines/{pid}",
            json={"name": "Updated"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated"

    async def test_delete_empty_pipeline(self, client: AsyncClient, auth_headers):
        resp = await client.post(
            "/api/tasks/pipelines",
            json={"name": "ToDelete"},
            headers=auth_headers,
        )
        pid = resp.json()["id"]

        resp = await client.delete(f"/api/tasks/pipelines/{pid}", headers=auth_headers)
        assert resp.status_code == 204

    async def test_delete_nonempty_pipeline_fails(self, client: AsyncClient, auth_headers):
        # Create pipeline
        resp = await client.post(
            "/api/tasks/pipelines",
            json={"name": "Busy"},
            headers=auth_headers,
        )
        pid = resp.json()["id"]

        # Create machine for task
        m_resp = await client.post(
            "/api/machines",
            json={"name": "M", "is_local": True},
            headers=auth_headers,
        )
        mid = m_resp.json()["id"]

        # Add a task to the pipeline
        await client.post(
            "/api/tasks",
            json={
                "name": "task1",
                "pipeline_id": pid,
                "machine_id": mid,
                "config": {"command": "echo hi"},
            },
            headers=auth_headers,
        )

        resp = await client.delete(f"/api/tasks/pipelines/{pid}", headers=auth_headers)
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════
# Tasks
# ═══════════════════════════════════════════════════════════════════════════

class TestTasks:
    @pytest_asyncio.fixture
    async def setup_machine_and_pipeline(self, client, auth_headers):
        m = await client.post("/api/machines", json={"name": "TestMachine", "is_local": True}, headers=auth_headers)
        p = await client.post("/api/tasks/pipelines", json={"name": "TestPipeline"}, headers=auth_headers)
        return m.json()["id"], p.json()["id"]

    async def test_create_task(self, client, auth_headers, setup_machine_and_pipeline):
        mid, pid = setup_machine_and_pipeline
        resp = await client.post(
            "/api/tasks",
            json={
                "name": "训练任务",
                "pipeline_id": pid,
                "machine_id": mid,
                "config": {"command": "python train.py", "args": [{"name": "--lr", "value": "0.001"}]},
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "训练任务"
        assert data["status"] == "waiting"
        assert data["machine_id"] == mid
        assert data["pipeline_id"] == pid

    async def test_create_task_with_gpu_condition(self, client, auth_headers, setup_machine_and_pipeline):
        mid, pid = setup_machine_and_pipeline
        resp = await client.post(
            "/api/tasks",
            json={
                "name": "GPU任务",
                "pipeline_id": pid,
                "machine_id": mid,
                "config": {"command": "python train.py"},
                "gpu_condition": {
                    "mode": "force",
                    "gpu_ids": [0, 1],
                },
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["gpu_condition"]["gpu_ids"] == [0, 1]

    async def test_update_task(self, client, auth_headers, setup_machine_and_pipeline):
        mid, pid = setup_machine_and_pipeline
        create_resp = await client.post(
            "/api/tasks",
            json={"name": "Old", "pipeline_id": pid, "machine_id": mid, "config": {"command": "echo 1"}},
            headers=auth_headers,
        )
        tid = create_resp.json()["id"]

        resp = await client.put(
            f"/api/tasks/{tid}",
            json={"name": "New"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New"

    async def test_delete_task(self, client, auth_headers, setup_machine_and_pipeline):
        mid, pid = setup_machine_and_pipeline
        create_resp = await client.post(
            "/api/tasks",
            json={"name": "Del", "pipeline_id": pid, "machine_id": mid, "config": {"command": "echo 1"}},
            headers=auth_headers,
        )
        tid = create_resp.json()["id"]

        resp = await client.delete(f"/api/tasks/{tid}", headers=auth_headers)
        assert resp.status_code == 204

    async def test_task_sort_order_auto_increment(self, client, auth_headers, setup_machine_and_pipeline):
        mid, pid = setup_machine_and_pipeline
        t1 = await client.post(
            "/api/tasks",
            json={"name": "T1", "pipeline_id": pid, "machine_id": mid, "config": {"command": "echo 1"}},
            headers=auth_headers,
        )
        t2 = await client.post(
            "/api/tasks",
            json={"name": "T2", "pipeline_id": pid, "machine_id": mid, "config": {"command": "echo 2"}},
            headers=auth_headers,
        )
        assert t1.json()["sort_order"] < t2.json()["sort_order"]

    async def test_orphaned_tasks(self, client, auth_headers, setup_machine_and_pipeline):
        mid, _ = setup_machine_and_pipeline
        await client.post(
            "/api/tasks",
            json={"name": "Orphan", "machine_id": mid, "config": {"command": "echo orphan"}},
            headers=auth_headers,
        )
        resp = await client.get("/api/tasks/orphaned", headers=auth_headers)
        assert resp.status_code == 200
        names = [t["name"] for t in resp.json()]
        assert "Orphan" in names


# ═══════════════════════════════════════════════════════════════════════════
# Batch tasks
# ═══════════════════════════════════════════════════════════════════════════

class TestBatchTasks:
    async def test_batch_create(self, client, auth_headers):
        m = await client.post("/api/machines", json={"name": "M", "is_local": True}, headers=auth_headers)
        mid = m.json()["id"]
        p = await client.post("/api/tasks/pipelines", json={"name": "P"}, headers=auth_headers)
        pid = p.json()["id"]

        resp = await client.post(
            "/api/tasks/batch",
            json={
                "pipeline_ids": [pid],
                "machine_id": mid,
                "config": {"command": "placeholder"},
                "commands": ["echo a", "echo b", "echo c"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["created_count"] == 3
        assert len(data["tasks"]) == 3


# ═══════════════════════════════════════════════════════════════════════════
# Conda envs
# ═══════════════════════════════════════════════════════════════════════════

class TestCondaEnvs:
    async def test_conda_env_crud(self, client, auth_headers):
        # Create
        resp = await client.post(
            "/api/tasks/conda-envs",
            json={"name": "torch2", "path": "/opt/conda/envs/torch2"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        eid = resp.json()["id"]

        # List
        resp = await client.get("/api/tasks/conda-envs", headers=auth_headers)
        assert any(e["name"] == "torch2" for e in resp.json())

        # Update
        resp = await client.put(
            f"/api/tasks/conda-envs/{eid}",
            json={"name": "torch2.1"},
            headers=auth_headers,
        )
        assert resp.json()["name"] == "torch2.1"

        # Delete
        resp = await client.delete(f"/api/tasks/conda-envs/{eid}", headers=auth_headers)
        assert resp.status_code == 204


# ═══════════════════════════════════════════════════════════════════════════
# GPU presets
# ═══════════════════════════════════════════════════════════════════════════

class TestGpuPresets:
    async def test_gpu_preset_crud(self, client, auth_headers):
        resp = await client.post(
            "/api/tasks/gpu-presets",
            json={"name": "4090空闲", "condition": {"mode": "smart", "min_gpus": 1}},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        pid = resp.json()["id"]

        resp = await client.get("/api/tasks/gpu-presets", headers=auth_headers)
        assert any(p["name"] == "4090空闲" for p in resp.json())

        resp = await client.delete(f"/api/tasks/gpu-presets/{pid}", headers=auth_headers)
        assert resp.status_code == 204


# ═══════════════════════════════════════════════════════════════════════════
# Task templates
# ═══════════════════════════════════════════════════════════════════════════

class TestTemplates:
    async def test_template_crud(self, client, auth_headers):
        resp = await client.post(
            "/api/tasks/templates",
            json={
                "name": "训练模板",
                "config": {"command": "python train.py", "work_dir": "/workspace"},
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        tid = resp.json()["id"]

        resp = await client.get("/api/tasks/templates", headers=auth_headers)
        assert any(t["name"] == "训练模板" for t in resp.json())

        resp = await client.put(
            f"/api/tasks/templates/{tid}",
            json={"name": "训练模板v2"},
            headers=auth_headers,
        )
        assert resp.json()["name"] == "训练模板v2"

        resp = await client.delete(f"/api/tasks/templates/{tid}", headers=auth_headers)
        assert resp.status_code == 204


# ═══════════════════════════════════════════════════════════════════════════
# History
# ═══════════════════════════════════════════════════════════════════════════

class TestHistory:
    async def test_history_empty(self, client, auth_headers):
        resp = await client.get("/api/tasks/history", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_history_count(self, client, auth_headers):
        resp = await client.get("/api/tasks/history/count", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["count"] == 0


# ═══════════════════════════════════════════════════════════════════════════
# Health check (no auth required)
# ═══════════════════════════════════════════════════════════════════════════

class TestHealth:
    async def test_health(self, client, override_db):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
