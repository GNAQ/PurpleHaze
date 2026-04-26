"""
数据模型包，统一导出所有模型以确保 SQLAlchemy 能正确初始化表结构
"""
from models.auth import User, Setting
from models.machine import Machine
from models.task import (  # noqa: F401
    Pipeline, Task, CondaEnv, RuntimeEnvBindingHint,
    TaskTemplate, GpuConditionPreset,
)

__all__ = [
    "User", "Setting", "Machine",
    "Pipeline", "Task", "CondaEnv", "RuntimeEnvBindingHint", "TaskTemplate", "GpuConditionPreset",
]
