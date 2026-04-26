"""
任务管理相关 Pydantic 模式
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from models.task import TaskStatus


# ── 任务配置结构 ──────────────────────────────────────────────────────────────

class ArgItem(BaseModel):
    name: str = ""
    value: str = ""


class TaskConfigSchema(BaseModel):
    """Task.config 的结构化校验 Schema"""
    conda_env_id: int | None = None
    env_vars: dict[str, str] = {}
    work_dir: str = ""
    command: str
    args: list[ArgItem] = []

    @field_validator("command")
    @classmethod
    def command_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("命令不能为空")
        return v


# ── GPU 抢卡条件 ──────────────────────────────────────────────────────────────
# condition item: {type: "mem"|"mem_gb"|"util"|"power"|"procs", op: ">"|"<"|">="|"<=", value: float}

# ── 流水线 ───────────────────────────────────────────────────────────────────

class PipelineCreate(BaseModel):
    name: str
    sort_order: int = 0


class PipelineUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class TaskBrief(BaseModel):
    id: int
    name: str
    pipeline_id: int | None
    sort_order: int
    machine_id: int | None
    config: dict | None
    gpu_condition: dict | None
    status: TaskStatus
    assigned_gpu_ids: list | None
    pid: int | None
    exit_code: int | None
    rendered_command: str | None = None
    # 调度器写入的错误/元数据，前端据此展示失败原因
    meta: dict | None = None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class HistoryTaskResponse(TaskBrief):
    """历史任务响应，额外包含 pipeline_name 和 machine_name"""
    pipeline_name: str | None = None
    machine_name: str | None = None


class PipelineResponse(BaseModel):
    id: int
    name: str
    sort_order: int
    created_at: datetime
    tasks: list[TaskBrief] = []

    model_config = {"from_attributes": True}


# ── 任务 ─────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    name: str = "未命名任务"
    pipeline_id: int | None = None
    machine_id: int | None = None
    config: TaskConfigSchema | None = None
    gpu_condition: dict | None = None


class BatchTaskCreate(BaseModel):
    pipeline_ids: list[int] = []
    machine_id: int
    config: TaskConfigSchema
    gpu_condition: dict | None = None
    commands: list[str]

    @field_validator("commands")
    @classmethod
    def commands_not_empty(cls, values: list[str]) -> list[str]:
        cleaned = [v.strip() for v in values if v and v.strip()]
        if not cleaned:
            raise ValueError("批量命令不能为空")
        return cleaned


class BatchTaskCreateResponse(BaseModel):
    created_count: int
    tasks: list[TaskBrief]


class TaskUpdate(BaseModel):
    name: str | None = None
    pipeline_id: int | None = None
    sort_order: int | None = None
    machine_id: int | None = None
    config: TaskConfigSchema | None = None
    gpu_condition: dict | None = None


# ── 模板 ─────────────────────────────────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str
    machine_id: int | None = None
    config: dict | None = None
    gpu_condition: dict | None = None


class TemplateUpdate(BaseModel):
    name: str | None = None
    machine_id: int | None = None
    config: dict | None = None
    gpu_condition: dict | None = None


class TemplateResponse(BaseModel):
    id: int
    name: str
    machine_id: int | None = None
    config: dict | None
    gpu_condition: dict | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── 抢卡条件预设 ──────────────────────────────────────────────────────────────

class GpuPresetCreate(BaseModel):
    name: str
    condition: dict | None = None


class GpuPresetUpdate(BaseModel):
    name: str | None = None
    condition: dict | None = None


class GpuPresetResponse(BaseModel):
    id: int
    name: str
    condition: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Conda 环境 ────────────────────────────────────────────────────────────────

class CondaEnvCreate(BaseModel):
    machine_id: int | None = None
    name: str
    path: str = ""  # 空则使用 conda run -n <name>激活


class CondaEnvUpdate(BaseModel):
    name: str | None = None
    path: str | None = None


class CondaEnvResponse(BaseModel):
    id: int
    machine_id: int | None = None
    name: str
    path: str
    source: str
    python_version: str | None = None
    python_path: str | None = None
    fingerprint_hash: str | None = None
    package_count: int | None = None
    fingerprint_info: dict | None = None
    last_seen_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CondaEnvProbeResponse(BaseModel):
    machine_id: int
    created_count: int
    updated_count: int
    removed_count: int
    warning: str | None = None
    envs: list[CondaEnvResponse]

    model_config = {"from_attributes": True}


class RuntimeEnvBindingHintResponse(BaseModel):
    id: int
    machine_id: int
    conda_env_id: int
    work_dir_pattern: str
    source: str
    priority: int
    last_used_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CondaEnvResolveRequest(BaseModel):
    work_dir: str | None = None


class CondaEnvResolveResponse(BaseModel):
    machine_id: int
    work_dir: str | None = None
    reason: str | None = None
    message: str | None = None
    recommended_env: CondaEnvResponse | None = None
    binding_hint: RuntimeEnvBindingHintResponse | None = None
    conflicts: list[CondaEnvResponse] = []
    migration_action: str | None = None


class CondaEnvMigrationPlanResponse(BaseModel):
    target_machine_id: int
    source_env: CondaEnvResponse
    action: str
    reason: str
    message: str | None = None
    reuse_env: CondaEnvResponse | None = None
    conflicts: list[CondaEnvResponse] = []


# ── 日志 ─────────────────────────────────────────────────────────────────────

class TaskLogsResponse(BaseModel):
    task_id: int
    stdout: str
    stderr: str
    truncated: bool = False
