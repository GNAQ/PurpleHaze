"""
资源监控相关 Pydantic 模式
只传输「算力指标」：CPU%、内存、GPU 利用率/显存/功耗，
以及 GPU 上各运行进程的详细信息（通过 PID 单独查询，不遍历全部系统进程）。
"""
from datetime import datetime
from pydantic import BaseModel


class GpuProcess(BaseModel):
    """GPU 上正在运行的进程（含从 psutil 按 PID 单独查询到的系统信息）"""
    pid: int
    name: str
    used_memory_mb: float           # 该进程占用的 GPU 显存
    username: str | None = None
    cmdline: str | None = None      # 截断至 300 字符
    cpu_percent: float = 0.0
    memory_mb: float = 0.0          # 该进程占用的系统内存


class GpuInfo(BaseModel):
    index: int
    name: str
    utilization: float          # GPU 利用率 0-100
    memory_used_mb: float
    memory_total_mb: float
    power_draw_w: float | None = None
    power_limit_w: float | None = None
    temperature_c: float | None = None
    processes: list[GpuProcess] = []


class ResourceSnapshot(BaseModel):
    machine_id: int
    timestamp: datetime
    # CPU
    cpu_percent: float
    cpu_name: str | None = None
    cpu_count: int | None = None
    # 内存（MB）
    memory_used_mb: float
    memory_total_mb: float
    # GPU 列表（含每张卡的进程）
    gpus: list[GpuInfo] = []
    # 错误信息（获取失败时填充）
    error: str | None = None
