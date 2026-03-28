"""
Tests for task scheduler service.

Tests _build_command (pure function) and startup_recovery (DB state transitions).
Uses virtual machines with various conda/GPU configurations.
"""
import pytest
import pytest_asyncio
from datetime import datetime
from unittest.mock import patch

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy import select

from services.task_scheduler import _build_command, TaskScheduler
from models.task import Task, TaskStatus, Pipeline
from tests.conftest import create_local_machine

pytestmark = pytest.mark.asyncio


# ══���════════════════════════���═══════════════════════════════════════════════
# _build_command
# ══════��════════════════════════════════════════════════════════════════════

class TestBuildCommand:
    def test_simple_command(self):
        config = {"command": "python train.py"}
        result = _build_command(config, None, None, [])
        assert result == "python train.py"

    def test_command_with_args(self):
        config = {
            "command": "python train.py",
            "args": [
                {"name": "--lr", "value": "0.001"},
                {"name": "--epochs", "value": "100"},
            ],
        }
        result = _build_command(config, None, None, [])
        assert "--lr" in result
        assert "0.001" in result
        assert "--epochs" in result
        assert "100" in result

    def test_gpu_ids_set_cuda_visible(self):
        config = {"command": "python train.py"}
        result = _build_command(config, None, None, [0, 2])
        assert "CUDA_VISIBLE_DEVICES=0,2" in result

    def test_env_vars(self):
        config = {
            "command": "python train.py",
            "env_vars": {"MASTER_PORT": "29500", "NCCL_DEBUG": "INFO"},
        }
        result = _build_command(config, None, None, [])
        assert "MASTER_PORT" in result
        assert "29500" in result

    def test_conda_path_activation(self):
        config = {"command": "python train.py"}
        result = _build_command(config, "/opt/conda/envs/torch2", None, [])
        assert "PATH=" in result
        assert "/opt/conda/envs/torch2/bin" in result

    def test_conda_name_activation(self):
        config = {"command": "python train.py"}
        result = _build_command(config, None, "torch2", [])
        assert "conda run -n" in result
        assert "torch2" in result

    def test_conda_path_takes_precedence_over_name(self):
        config = {"command": "python train.py"}
        result = _build_command(config, "/opt/conda/envs/torch2", "torch2", [])
        assert "PATH=" in result
        assert "conda run" not in result

    def test_combined_gpu_env_conda(self):
        config = {
            "command": "torchrun",
            "args": [
                {"name": "--nproc_per_node", "value": "2"},
                {"name": "", "value": "train.py"},
            ],
            "env_vars": {"MASTER_PORT": "29500"},
        }
        result = _build_command(config, "/opt/conda/envs/torch2", None, [0, 1])
        assert "CUDA_VISIBLE_DEVICES=0,1" in result
        assert "MASTER_PORT" in result
        assert "PATH=" in result
        assert "torchrun" in result
        assert "--nproc_per_node" in result

    def test_empty_command_raises(self):
        config = {"command": ""}
        with pytest.raises(ValueError, match="命令不能为空"):
            _build_command(config, None, None, [])

    def test_whitespace_command_raises(self):
        config = {"command": "   "}
        with pytest.raises(ValueError, match="命令不能为空"):
            _build_command(config, None, None, [])

    def test_args_with_spaces_are_quoted(self):
        config = {
            "command": "python train.py",
            "args": [{"name": "--output", "value": "/path/with spaces/output"}],
        }
        result = _build_command(config, None, None, [])
        assert "with spaces" in result


# ══════════════���══════════════════════════════════���═════════════════════════
# Startup recovery
# ═══════════���════════════════════════════════��══════════════════════════════

class TestStartupRecovery:
    async def test_running_tasks_marked_failed(self, test_engine):
        """On startup, leftover RUNNING tasks should be marked FAILED."""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            machine = await create_local_machine(db, "recovery-machine")
            pipeline = Pipeline(name="test-pipeline", sort_order=0)
            db.add(pipeline)
            await db.commit()
            await db.refresh(pipeline)

            task = Task(
                name="stuck-task",
                pipeline_id=pipeline.id,
                machine_id=machine.id,
                config={"command": "python long_run.py"},
                status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(),
                pid=99999,
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)
            task_id = task.id

        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            await scheduler.startup_recovery()

        async with factory() as db:
            recovered = await db.get(Task, task_id)
            assert recovered.status == TaskStatus.FAILED
            assert recovered.finished_at is not None
            assert recovered.meta.get("error") == "服务重启，运行被中断"

    async def test_waiting_tasks_unaffected(self, test_engine):
        """WAITING tasks should not be touched by startup recovery."""
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            machine = await create_local_machine(db, "m")
            pipeline = Pipeline(name="p", sort_order=0)
            db.add(pipeline)
            await db.commit()
            await db.refresh(pipeline)

            task = Task(
                name="waiting-task",
                pipeline_id=pipeline.id,
                machine_id=machine.id,
                config={"command": "echo hi"},
                status=TaskStatus.WAITING,
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)
            task_id = task.id

        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            await scheduler.startup_recovery()

        async with factory() as db:
            t = await db.get(Task, task_id)
            assert t.status == TaskStatus.WAITING


# ════���════════════════���═════════════════════════════════════��═══════════════
# Cancel task
# ═══════════════════════════════════════════════════════════════════════════

class TestCancelTask:
    async def test_cancel_waiting_task(self, test_engine):
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            machine = await create_local_machine(db, "m")
            task = Task(
                name="cancel-me",
                machine_id=machine.id,
                config={"command": "echo hi"},
                status=TaskStatus.WAITING,
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)
            task_id = task.id

        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            result = await scheduler.cancel_task(task_id)

        assert result is True
        async with factory() as db:
            t = await db.get(Task, task_id)
            assert t.status == TaskStatus.CANCELLED

    async def test_cancel_completed_task_returns_false(self, test_engine):
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

        async with factory() as db:
            machine = await create_local_machine(db, "m")
            task = Task(
                name="done",
                machine_id=machine.id,
                config={"command": "echo hi"},
                status=TaskStatus.COMPLETED,
                finished_at=datetime.utcnow(),
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)
            task_id = task.id

        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            result = await scheduler.cancel_task(task_id)
        assert result is False

    async def test_cancel_nonexistent_task(self, test_engine):
        factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
        scheduler = TaskScheduler()
        with patch("services.task_scheduler.AsyncSessionLocal", factory):
            result = await scheduler.cancel_task(99999)
        assert result is False


# ═════════════════════════════════════════════════���═════════════════════════
# Virtual machine command scenarios
# ═��═══════════════���══════════════════════════════���══════════════════════════

class TestVirtualMachineCommands:
    def test_local_single_gpu_training(self):
        config = {
            "command": "python",
            "args": [
                {"name": "", "value": "train.py"},
                {"name": "--batch-size", "value": "32"},
                {"name": "--lr", "value": "1e-4"},
            ],
            "work_dir": "/home/user/project",
        }
        cmd = _build_command(config, "/home/user/miniconda3/envs/torch", None, [0])
        assert "CUDA_VISIBLE_DEVICES=0" in cmd
        assert "PATH=" in cmd
        assert "train.py" in cmd

    def test_remote_multi_gpu_distributed(self):
        config = {
            "command": "torchrun",
            "args": [
                {"name": "--nproc_per_node", "value": "4"},
                {"name": "--master_port", "value": "29500"},
                {"name": "", "value": "train_distributed.py"},
            ],
            "env_vars": {
                "NCCL_P2P_DISABLE": "1",
                "OMP_NUM_THREADS": "4",
            },
        }
        cmd = _build_command(config, None, "torch2.1", [0, 1, 2, 3])
        assert "CUDA_VISIBLE_DEVICES=0,1,2,3" in cmd
        assert "conda run -n" in cmd
        assert "torch2.1" in cmd
        assert "torchrun" in cmd
        assert "--nproc_per_node" in cmd

    def test_eval_script_no_gpu(self):
        config = {
            "command": "python eval.py",
            "args": [{"name": "--checkpoint", "value": "/models/best.pt"}],
        }
        cmd = _build_command(config, None, None, [])
        assert "CUDA_VISIBLE_DEVICES" not in cmd
        assert "eval.py" in cmd
