"""
Backend API integration tests.

Tests exercise the real FastAPI app with a test SQLite DB,
mocked SSH/monitor services, and fake machines.
"""
import asyncio
import json
import os

import pytest
import pytest_asyncio
from httpx import AsyncClient

from models.task import CondaEnv
from services.runtime_env_service import runtime_env_service
from services.runtime_env_service import _PROBE_SCRIPT
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
    
    async def test_probe_script_limits_to_common_dirs(self, tmp_path):
        home_dir = tmp_path / "home"
        common_root = home_dir / "mambaforge"
        common_env = common_root / "envs" / "torch2"
        hidden_common_env = home_dir / ".conda" / "envs" / "cache-env"
        custom_env = home_dir / "custom" / "envs" / "custom-env"

        common_env.mkdir(parents=True)
        hidden_common_env.mkdir(parents=True)
        custom_env.mkdir(parents=True)

        proc = await asyncio.create_subprocess_exec(
            "bash",
            "-lc",
            _PROBE_SCRIPT,
            env={**os.environ, "HOME": str(home_dir)},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        assert proc.returncode == 0, stderr.decode("utf-8", errors="replace")
        payload = json.loads(stdout.decode("utf-8", errors="replace"))
        assert str(common_root) in payload["envs"]
        assert str(common_env) in payload["envs"]
        assert str(hidden_common_env) in payload["envs"]
        assert str(custom_env) not in payload["envs"]
        assert "自定义路径请在设置页手动登记到对应机器" in payload["probe_warning"]

    async def test_machine_scoped_probe_and_register(self, client, auth_headers, monkeypatch):
        machine_resp = await client.post(
            "/api/machines",
            json={"name": "ProbeMachine", "is_local": True},
            headers=auth_headers,
        )
        assert machine_resp.status_code == 201
        machine_id = machine_resp.json()["id"]

        async def fake_local_probe():
            return '{"envs": ["/opt/conda", "/opt/conda/envs/torch2"]}', ""

        monkeypatch.setattr(runtime_env_service, "_run_local_probe", fake_local_probe)

        async def fake_inspect(machine, path):
            env_name = "base" if path == "/opt/conda" else "torch2"
            version = "3.10.12" if env_name == "base" else "3.10.13"
            return {
                "python_version": version,
                "python_path": f"{path}/bin/python",
                "fingerprint_hash": f"fp-{env_name}",
                "package_count": 123 if env_name == "base" else 80,
                "key_packages": {
                    "python": version,
                    **({"torch": "2.4.0"} if env_name == "torch2" else {}),
                },
                "status": "ready",
            }

        monkeypatch.setattr(runtime_env_service, "_inspect_conda_env", fake_inspect)

        resp = await client.post(
            f"/api/machines/{machine_id}/conda-envs/probe",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["machine_id"] == machine_id
        assert data["created_count"] == 2
        assert {env["name"] for env in data["envs"]} == {"base", "torch2"}
        assert all(env["machine_id"] == machine_id for env in data["envs"])
        assert all(env["source"] == "probe" for env in data["envs"])
        base_env = next(env for env in data["envs"] if env["name"] == "base")
        assert base_env["fingerprint_hash"] == "fp-base"
        assert base_env["python_version"] == "3.10.12"
        assert base_env["fingerprint_info"]["package_count"] == 123
        assert base_env["fingerprint_info"]["key_packages"]["python"] == "3.10.12"

        register_resp = await client.post(
            f"/api/machines/{machine_id}/conda-envs",
            json={"name": "manual-env", "path": "/srv/conda/envs/manual-env"},
            headers=auth_headers,
        )
        assert register_resp.status_code == 201
        assert register_resp.json()["machine_id"] == machine_id
        assert register_resp.json()["source"] == "manual"

        name_only_register_resp = await client.post(
            f"/api/machines/{machine_id}/conda-envs",
            json={"name": "manual-name-only", "path": ""},
            headers=auth_headers,
        )
        assert name_only_register_resp.status_code == 201
        assert name_only_register_resp.json()["machine_id"] == machine_id
        assert name_only_register_resp.json()["source"] == "manual"
        assert name_only_register_resp.json()["path"] == ""

        async def fake_local_probe_second_round():
            return '{"envs": ["/opt/conda"]}', ""

        monkeypatch.setattr(runtime_env_service, "_run_local_probe", fake_local_probe_second_round)
        resp = await client.post(
            f"/api/machines/{machine_id}/conda-envs/probe",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["removed_count"] == 1
        names = {env["name"] for env in data["envs"]}
        assert names == {"base", "manual-env", "manual-name-only"}

    async def test_resolve_conda_env_recommendation_from_binding_hint(
        self,
        client,
        auth_headers,
        monkeypatch,
    ):
        machine_resp = await client.post(
            "/api/machines",
            json={"name": "HintMachine", "is_local": True},
            headers=auth_headers,
        )
        assert machine_resp.status_code == 201
        machine_id = machine_resp.json()["id"]

        async def fake_local_probe():
            return '{"envs": ["/opt/conda/envs/torch2"]}', ""

        monkeypatch.setattr(runtime_env_service, "_run_local_probe", fake_local_probe)

        async def fake_inspect(machine, path):
            return {
                "python_version": "3.10.12",
                "python_path": f"{path}/bin/python",
                "fingerprint_hash": "fp-torch2",
                "package_count": 80,
                "key_packages": {"python": "3.10.12", "torch": "2.4.0"},
                "status": "ready",
            }

        monkeypatch.setattr(runtime_env_service, "_inspect_conda_env", fake_inspect)

        probe_resp = await client.post(
            f"/api/machines/{machine_id}/conda-envs/probe",
            headers=auth_headers,
        )
        assert probe_resp.status_code == 200
        env_id = probe_resp.json()["envs"][0]["id"]

        create_task_resp = await client.post(
            "/api/tasks",
            json={
                "name": "hint-task",
                "machine_id": machine_id,
                "config": {
                    "command": "python train.py",
                    "work_dir": "/workspace/project-a",
                    "conda_env_id": env_id,
                    "env_vars": {},
                    "args": [],
                },
            },
            headers=auth_headers,
        )
        assert create_task_resp.status_code == 200

        resolve_resp = await client.post(
            f"/api/machines/{machine_id}/conda-envs/resolve",
            json={"work_dir": "/workspace/project-a/src"},
            headers=auth_headers,
        )
        assert resolve_resp.status_code == 200
        data = resolve_resp.json()
        assert data["recommended_env"]["id"] == env_id
        assert data["reason"] == "binding_hint"
        assert data["binding_hint"]["work_dir_pattern"] == "/workspace/project-a"

    async def test_migration_plan_detects_same_name_different_fingerprint(
        self,
        client,
        auth_headers,
        override_db,
    ):
        source_machine = await client.post(
            "/api/machines",
            json={"name": "Source", "is_local": True},
            headers=auth_headers,
        )
        target_machine = await client.post(
            "/api/machines",
            json={"name": "Target", "is_local": True},
            headers=auth_headers,
        )
        assert source_machine.status_code == 201
        assert target_machine.status_code == 201
        source_machine_id = source_machine.json()["id"]
        target_machine_id = target_machine.json()["id"]

        source_env_resp = await client.post(
            f"/api/machines/{source_machine_id}/conda-envs",
            json={"name": "torch2", "path": "/opt/conda/envs/torch2"},
            headers=auth_headers,
        )
        target_env_resp = await client.post(
            f"/api/machines/{target_machine_id}/conda-envs",
            json={"name": "torch2", "path": "/srv/conda/envs/torch2"},
            headers=auth_headers,
        )
        assert source_env_resp.status_code == 201
        assert target_env_resp.status_code == 201
        source_env_id = source_env_resp.json()["id"]
        target_env_id = target_env_resp.json()["id"]

        async with override_db() as db:
            source_env = await db.get(CondaEnv, source_env_id)
            target_env = await db.get(CondaEnv, target_env_id)
            source_env.fingerprint_hash = "fp-source"
            source_env.fingerprint_info = {
                "status": "ready",
                "package_count": 80,
                "key_packages": {"python": "3.10.12", "torch": "2.4.0"},
            }
            target_env.fingerprint_hash = "fp-target"
            target_env.fingerprint_info = {
                "status": "ready",
                "package_count": 82,
                "key_packages": {"python": "3.10.12", "torch": "2.5.1"},
            }
            await db.commit()

        resp = await client.get(
            f"/api/machines/{target_machine_id}/conda-envs/migration-plan",
            params={"source_env_id": source_env_id},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "name_conflict"
        assert data["reason"] == "same_name_different_fingerprint"
        assert data["source_env"]["id"] == source_env_id
        assert data["conflicts"][0]["id"] == target_env_id

    async def test_generic_conda_crud_keeps_machine_fingerprint_in_sync(
        self,
        client,
        auth_headers,
        monkeypatch,
    ):
        machine_resp = await client.post(
            "/api/machines",
            json={"name": "CrudMachine", "is_local": True},
            headers=auth_headers,
        )
        assert machine_resp.status_code == 201
        machine_id = machine_resp.json()["id"]

        async def fake_inspect(machine, path):
            env_name = path.rstrip("/").split("/")[-1]
            version = "3.10.12" if env_name == "env-a" else "3.11.9"
            return {
                "python_version": version,
                "python_path": f"{path}/bin/python",
                "fingerprint_hash": f"fp-{env_name}",
                "package_count": 80 if env_name == "env-a" else 96,
                "key_packages": {"python": version},
                "status": "ready",
            }

        monkeypatch.setattr(runtime_env_service, "_inspect_conda_env", fake_inspect)

        create_resp = await client.post(
            "/api/tasks/conda-envs",
            json={
                "name": "env-a",
                "path": "/opt/conda/envs/env-a",
                "machine_id": machine_id,
            },
            headers=auth_headers,
        )
        assert create_resp.status_code == 200
        created_env = create_resp.json()
        assert created_env["machine_id"] == machine_id
        assert created_env["fingerprint_hash"] == "fp-env-a"
        assert created_env["python_version"] == "3.10.12"
        assert created_env["source"] == "manual"

        update_resp = await client.put(
            f"/api/tasks/conda-envs/{created_env['id']}",
            json={
                "name": "env-b",
                "path": "/opt/conda/envs/env-b",
            },
            headers=auth_headers,
        )
        assert update_resp.status_code == 200
        updated_env = update_resp.json()
        assert updated_env["name"] == "env-b"
        assert updated_env["path"] == "/opt/conda/envs/env-b"
        assert updated_env["fingerprint_hash"] == "fp-env-b"
        assert updated_env["python_version"] == "3.11.9"
        assert updated_env["fingerprint_info"]["package_count"] == 96

    async def test_task_rejects_conda_env_from_other_machine(self, client, auth_headers):
        source_machine = await client.post(
            "/api/machines",
            json={"name": "M1", "is_local": True},
            headers=auth_headers,
        )
        target_machine = await client.post(
            "/api/machines",
            json={"name": "M2", "is_local": True},
            headers=auth_headers,
        )
        assert source_machine.status_code == 201
        assert target_machine.status_code == 201

        source_machine_id = source_machine.json()["id"]
        target_machine_id = target_machine.json()["id"]

        env_resp = await client.post(
            f"/api/machines/{source_machine_id}/conda-envs",
            json={"name": "torch2", "path": "/opt/conda/envs/torch2"},
            headers=auth_headers,
        )
        assert env_resp.status_code == 201
        env_id = env_resp.json()["id"]

        resp = await client.post(
            "/api/tasks",
            json={
                "name": "bad-task",
                "machine_id": target_machine_id,
                "config": {
                    "command": "python train.py",
                    "conda_env_id": env_id,
                    "env_vars": {},
                    "work_dir": "",
                    "args": [],
                },
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "不属于当前机器" in resp.json()["detail"]


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

    async def test_template_persists_machine_scoped_conda_env(self, client, auth_headers):
        machine_resp = await client.post(
            "/api/machines",
            json={"name": "TplMachine", "is_local": True},
            headers=auth_headers,
        )
        assert machine_resp.status_code == 201
        machine_id = machine_resp.json()["id"]

        env_resp = await client.post(
            f"/api/machines/{machine_id}/conda-envs",
            json={"name": "torch2", "path": "/opt/conda/envs/torch2"},
            headers=auth_headers,
        )
        assert env_resp.status_code == 201
        env_id = env_resp.json()["id"]

        resp = await client.post(
            "/api/tasks/templates",
            json={
                "name": "模板机环境",
                "machine_id": machine_id,
                "config": {
                    "conda_env_id": env_id,
                    "command": "python train.py",
                    "env_vars": {},
                    "work_dir": "",
                    "args": [],
                },
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        tid = data["id"]
        assert data["machine_id"] == machine_id
        assert data["config"]["conda_env_id"] == env_id

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
