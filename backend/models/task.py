"""
任务管理数据模型
"""
from datetime import datetime

from sqlalchemy import String, Integer, DateTime, Text, JSON, ForeignKey, Boolean
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from database import Base


class TaskStatus(str, enum.Enum):
    WAITING = "waiting"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CondaEnv(Base):
    """Conda 环境管理"""
    __tablename__ = "conda_env"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TaskTemplate(Base):
    """任务模板"""
    __tablename__ = "task_template"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    # 模板关联的默认运行机器（可选）
    machine_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("machine.id"), nullable=True)
    # 任务配置：{conda_env_id, env_vars, work_dir, command, args: [{name, value}]}
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 抢卡条件：{mode, gpu_ids, min_gpus, idle_minutes, conditions, condition_expr}
    gpu_condition: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GpuConditionPreset(Base):
    """抢卡条件预设"""
    __tablename__ = "gpu_condition_preset"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    condition: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Pipeline(Base):
    """
    流水线——独立的任务队列 worker。
    各流水线间异步并发，流水线内任务顺序执行（FIFO）。
    """
    __tablename__ = "pipeline"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, default="默认流水线")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="pipeline", order_by="Task.sort_order"
    )


class Task(Base):
    """任务"""
    __tablename__ = "task"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False, default="未命名任务")
    pipeline_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pipeline.id"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 运行目标机器
    machine_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("machine.id"), nullable=True)
    # 任务配置：{conda_env_id, env_vars:{}, work_dir, command, args:[{name,value}]}
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 抢卡条件：{mode, gpu_ids, min_gpus, idle_minutes, conditions, condition_expr}
    gpu_condition: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus), default=TaskStatus.WAITING)
    # 本地进程 PID
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 分配的 GPU 卡号
    assigned_gpu_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # 本地日志文件路径
    stdout_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    stderr_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 扩展元数据（错误信息或远程任务信息，如 {remote_pid, ...} / {error: ...}）
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    pipeline: Mapped["Pipeline | None"] = relationship("Pipeline", back_populates="tasks")

