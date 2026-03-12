"""
任务管理路由
"""
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import LOGS_DIR
from database import get_db
from deps import get_current_user
from models.task import (
    Pipeline, Task, TaskStatus, TaskTemplate,
    GpuConditionPreset, CondaEnv,
)
from schemas.task import (
    PipelineCreate, PipelineUpdate, PipelineResponse, TaskBrief,
    TaskCreate, TaskUpdate,
    TemplateCreate, TemplateUpdate, TemplateResponse,
    GpuPresetCreate, GpuPresetUpdate, GpuPresetResponse,
    CondaEnvCreate, CondaEnvUpdate, CondaEnvResponse,
    TaskLogsResponse,
)
from services.task_scheduler import task_scheduler

router = APIRouter(
    prefix="/api/tasks",
    tags=["tasks"],
    dependencies=[Depends(get_current_user)],
)


# ── 流水线 ───────────────────────────────────────────────────────────────────

@router.get("/pipelines", response_model=list[PipelineResponse])
async def list_pipelines(db: AsyncSession = Depends(get_db)):
    # selectinload 一次性加载关联任务，避免 N+1 查询
    result = await db.execute(
        select(Pipeline)
        .options(selectinload(Pipeline.tasks))
        .order_by(Pipeline.sort_order)
    )
    pipelines = result.scalars().all()
    return [
        PipelineResponse(
            id=p.id, name=p.name, sort_order=p.sort_order, created_at=p.created_at,
            tasks=[
                TaskBrief.model_validate(t)
                for t in sorted(p.tasks, key=lambda t: t.sort_order)
            ],
        )
        for p in pipelines
    ]


@router.post("/pipelines", response_model=PipelineResponse)
async def create_pipeline(data: PipelineCreate, db: AsyncSession = Depends(get_db)):
    pipeline = Pipeline(name=data.name, sort_order=data.sort_order)
    db.add(pipeline)
    await db.commit()
    await db.refresh(pipeline)
    return PipelineResponse(
        id=pipeline.id, name=pipeline.name, sort_order=pipeline.sort_order,
        created_at=pipeline.created_at, tasks=[],
    )


@router.put("/pipelines/{pid}", response_model=PipelineResponse)
async def update_pipeline(pid: int, data: PipelineUpdate, db: AsyncSession = Depends(get_db)):
    pipeline = await db.get(Pipeline, pid)
    if not pipeline:
        raise HTTPException(status_code=404, detail="流水线不存在")
    if data.name is not None:
        pipeline.name = data.name
    if data.sort_order is not None:
        pipeline.sort_order = data.sort_order
    await db.commit()
    await db.refresh(pipeline)
    tasks_result = await db.execute(
        select(Task).where(Task.pipeline_id == pipeline.id).order_by(Task.sort_order)
    )
    tasks = tasks_result.scalars().all()
    return PipelineResponse(
        id=pipeline.id, name=pipeline.name, sort_order=pipeline.sort_order,
        created_at=pipeline.created_at,
        tasks=[TaskBrief.model_validate(t) for t in tasks],
    )


@router.delete("/pipelines/{pid}", status_code=204)
async def delete_pipeline(pid: int, db: AsyncSession = Depends(get_db)):
    pipeline = await db.get(Pipeline, pid)
    if not pipeline:
        raise HTTPException(status_code=404, detail="流水线不存在")
    tasks_result = await db.execute(
        select(Task).where(Task.pipeline_id == pid).limit(1)
    )
    if tasks_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="流水线不为空，请先删除所有任务")
    await db.delete(pipeline)
    await db.commit()


# ── 任务 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=TaskBrief)
async def create_task(data: TaskCreate, db: AsyncSession = Depends(get_db)):
    sort_order = 0
    if data.pipeline_id is not None:
        result = await db.execute(
            select(Task).where(Task.pipeline_id == data.pipeline_id)
            .order_by(Task.sort_order.desc()).limit(1)
        )
        last = result.scalar_one_or_none()
        sort_order = (last.sort_order + 1) if last else 0

    task = Task(
        name=data.name,
        pipeline_id=data.pipeline_id,
        machine_id=data.machine_id,
        config=data.config.model_dump() if data.config else None,
        gpu_condition=data.gpu_condition,
        sort_order=sort_order,
        status=TaskStatus.WAITING,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return TaskBrief.model_validate(task)


@router.put("/{task_id}", response_model=TaskBrief)
async def update_task(task_id: int, data: TaskUpdate, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != TaskStatus.RUNNING:
        if data.name is not None:
            task.name = data.name
        # 用 model_fields_set 区分「未传」和「显式传 null」，支持将字段清空为 None
        if "pipeline_id" in data.model_fields_set:
            task.pipeline_id = data.pipeline_id
        if "machine_id" in data.model_fields_set:
            task.machine_id = data.machine_id
        if data.config is not None:
            task.config = data.config.model_dump()
        if "gpu_condition" in data.model_fields_set:
            task.gpu_condition = data.gpu_condition
    if data.sort_order is not None:
        task.sort_order = data.sort_order
    await db.commit()
    await db.refresh(task)
    return TaskBrief.model_validate(task)


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == TaskStatus.RUNNING:
        raise HTTPException(status_code=400, detail="运行中的任务不能删除，请先取消")
    await db.delete(task)
    await db.commit()


@router.post("/{task_id}/cancel", response_model=TaskBrief)
async def cancel_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    ok = await task_scheduler.cancel_task(task_id)
    if not ok:
        raise HTTPException(status_code=400, detail="该任务已完成或无法取消")
    await db.refresh(task)
    return TaskBrief.model_validate(task)

@router.get("/orphaned", response_model=list[TaskBrief])
async def list_orphaned_tasks(db: AsyncSession = Depends(get_db)):
    """返回所有无流水线的活跃任务（pipeline_id=null），供前端展示"未分配"区域"""
    result = await db.execute(
        select(Task).where(
            Task.pipeline_id.is_(None),
            Task.status.in_([TaskStatus.WAITING, TaskStatus.RUNNING]),
        ).order_by(Task.created_at)
    )
    return [TaskBrief.model_validate(t) for t in result.scalars().all()]

# ── 日志 ─────────────────────────────────────────────────────────────────────

_LOG_INLINE_LIMIT = 512 * 1024  # 512 KB 超出则截断


def _resolve_log_path(raw: str | None) -> str | None:
    """将 DB 中存储的相对或绝对日志路径解析为绝对路径"""
    if not raw:
        return None
    p = Path(raw)
    if not p.is_absolute():
        p = LOGS_DIR / p
    return str(p)


def _read_log(path: str | None) -> tuple[str, bool]:
    resolved = _resolve_log_path(path)
    if not resolved or not os.path.exists(resolved):
        return "（日志文件不存在或尚未生成）", False
    size = os.path.getsize(resolved)
    if size > _LOG_INLINE_LIMIT:
        with open(resolved, "r", errors="replace") as f:
            content = f.read(_LOG_INLINE_LIMIT)
        return content + f"\n\n[日志过大已截断，总大小 {size // 1024} KB，可下载完整文件]", True
    with open(resolved, "r", errors="replace") as f:
        return f.read(), False


@router.get("/{task_id}/logs", response_model=TaskLogsResponse)
async def get_task_logs(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    stdout, trunc1 = _read_log(task.stdout_path)
    stderr, trunc2 = _read_log(task.stderr_path)
    return TaskLogsResponse(
        task_id=task_id, stdout=stdout, stderr=stderr,
        truncated=trunc1 or trunc2,
    )


@router.get("/{task_id}/logs/download")
async def download_task_log(
    task_id: int,
    log_type: str = "stdout",
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    path = task.stdout_path if log_type == "stdout" else task.stderr_path
    resolved = _resolve_log_path(path)
    if not resolved or not os.path.exists(resolved):
        raise HTTPException(status_code=404, detail="日志文件不存在")
    return FileResponse(resolved, filename=f"task_{task_id}_{log_type}.txt", media_type="text/plain")


# ── 任务模板 ──────────────────────────────────────────────────────────────────

@router.get("/templates", response_model=list[TemplateResponse])
async def list_templates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TaskTemplate).order_by(TaskTemplate.updated_at.desc()))
    return [TemplateResponse.model_validate(t) for t in result.scalars().all()]


@router.post("/templates", response_model=TemplateResponse)
async def create_template(data: TemplateCreate, db: AsyncSession = Depends(get_db)):
    tpl = TaskTemplate(name=data.name, config=data.config, gpu_condition=data.gpu_condition)
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return TemplateResponse.model_validate(tpl)


@router.put("/templates/{tpl_id}", response_model=TemplateResponse)
async def update_template(tpl_id: int, data: TemplateUpdate, db: AsyncSession = Depends(get_db)):
    tpl = await db.get(TaskTemplate, tpl_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    if data.name is not None:
        tpl.name = data.name
    # 用 model_fields_set 区分「未传」和「显式传 null」，支持将字段清空为 None
    if "machine_id" in data.model_fields_set:
        tpl.machine_id = data.machine_id
    if "config" in data.model_fields_set:
        tpl.config = data.config
    if "gpu_condition" in data.model_fields_set:
        tpl.gpu_condition = data.gpu_condition
    await db.commit()
    await db.refresh(tpl)
    return TemplateResponse.model_validate(tpl)


@router.delete("/templates/{tpl_id}", status_code=204)
async def delete_template(tpl_id: int, db: AsyncSession = Depends(get_db)):
    tpl = await db.get(TaskTemplate, tpl_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    await db.delete(tpl)
    await db.commit()


# ── 抢卡条件预设 ──────────────────────────────────────────────────────────────

@router.get("/gpu-presets", response_model=list[GpuPresetResponse])
async def list_gpu_presets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GpuConditionPreset).order_by(GpuConditionPreset.id))
    return [GpuPresetResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/gpu-presets", response_model=GpuPresetResponse)
async def create_gpu_preset(data: GpuPresetCreate, db: AsyncSession = Depends(get_db)):
    preset = GpuConditionPreset(name=data.name, condition=data.condition)
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return GpuPresetResponse.model_validate(preset)


@router.put("/gpu-presets/{preset_id}", response_model=GpuPresetResponse)
async def update_gpu_preset(
    preset_id: int, data: GpuPresetUpdate, db: AsyncSession = Depends(get_db)
):
    preset = await db.get(GpuConditionPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="预设不存在")
    if data.name is not None:
        preset.name = data.name
    # 用 model_fields_set 支持将 condition 清空为 null
    if "condition" in data.model_fields_set:
        preset.condition = data.condition
    await db.commit()
    await db.refresh(preset)
    return GpuPresetResponse.model_validate(preset)


@router.delete("/gpu-presets/{preset_id}", status_code=204)
async def delete_gpu_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    preset = await db.get(GpuConditionPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="预设不存在")
    await db.delete(preset)
    await db.commit()


# ── Conda 环境 ────────────────────────────────────────────────────────────────

@router.get("/conda-envs", response_model=list[CondaEnvResponse])
async def list_conda_envs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CondaEnv).order_by(CondaEnv.id))
    return [CondaEnvResponse.model_validate(e) for e in result.scalars().all()]


@router.post("/conda-envs", response_model=CondaEnvResponse)
async def create_conda_env(data: CondaEnvCreate, db: AsyncSession = Depends(get_db)):
    env = CondaEnv(name=data.name, path=data.path)
    db.add(env)
    await db.commit()
    await db.refresh(env)
    return CondaEnvResponse.model_validate(env)


@router.put("/conda-envs/{env_id}", response_model=CondaEnvResponse)
async def update_conda_env(
    env_id: int, data: CondaEnvUpdate, db: AsyncSession = Depends(get_db)
):
    env = await db.get(CondaEnv, env_id)
    if not env:
        raise HTTPException(status_code=404, detail="环境不存在")
    if data.name is not None:
        env.name = data.name
    if data.path is not None:
        env.path = data.path
    await db.commit()
    await db.refresh(env)
    return CondaEnvResponse.model_validate(env)


@router.delete("/conda-envs/{env_id}", status_code=204)
async def delete_conda_env(env_id: int, db: AsyncSession = Depends(get_db)):
    env = await db.get(CondaEnv, env_id)
    if not env:
        raise HTTPException(status_code=404, detail="环境不存在")
    # B-1: 拒绝删除仍有等待中任务引用的环境
    waiting_result = await db.execute(
        select(Task).where(Task.status == TaskStatus.WAITING)
    )
    refs = [
        t for t in waiting_result.scalars().all()
        if (t.config or {}).get("conda_env_id") == env_id
    ]
    if refs:
        raise HTTPException(
            status_code=400,
            detail=f"有3个等待中的任务引用此 Conda 环境，请先修改或删除这些任务".replace("3", str(len(refs)))
        )
    await db.delete(env)
    await db.commit()


# ── 历史任务 ──────────────────────────────────────────────────────────────────

@router.get("/history", response_model=list[TaskBrief])
async def list_history(
    limit: int = 50,
    offset: int = 0,
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    terminal_statuses = [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]
    query = select(Task).where(Task.status.in_(terminal_statuses))
    if status_filter and status_filter in [s.value for s in terminal_statuses]:
        query = select(Task).where(Task.status == status_filter)
    query = query.order_by(Task.finished_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    return [TaskBrief.model_validate(t) for t in result.scalars().all()]


@router.get("/history/count")
async def history_count(
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import func
    terminal_statuses = [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]
    query = select(func.count()).select_from(Task).where(Task.status.in_(terminal_statuses))
    if status_filter and status_filter in [s.value for s in terminal_statuses]:
        query = select(func.count()).select_from(Task).where(Task.status == status_filter)
    result = await db.execute(query)
    return {"count": result.scalar_one()}
