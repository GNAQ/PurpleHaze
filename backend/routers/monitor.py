"""
资源监控路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from database import get_db
from deps import get_current_user
from models.machine import Machine
from schemas.monitor import ResourceSnapshot
from services.resource_monitor import resource_monitor
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/monitor", tags=["monitor"],
                   dependencies=[Depends(get_current_user)])


@router.get("/{machine_id}/resources", response_model=ResourceSnapshot)
async def get_resources(
    machine_id: int,
    include_processes: bool = Query(False, description="是否包含进程列表"),
    db: AsyncSession = Depends(get_db),
):
    """
    获取指定机器的最新资源快照。
    优先返回后台轮询的缓存值；若无缓存则立即采集一次。
    """
    machine = await db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="机器不存在")

    # 若有缓存且不需要进程列表，直接返回缓存
    if not include_processes:
        cached = resource_monitor.get_cached(machine_id)
        if cached is not None:
            return cached

    snap = await resource_monitor.get_snapshot(machine_id, machine.is_local, include_processes)
    return snap


@router.post("/{machine_id}/poll/start")
async def start_poll(
    machine_id: int,
    interval: int = Query(10, ge=1, le=3600, description="轮询间隔（秒）"),
    db: AsyncSession = Depends(get_db),
):
    """手动启动/重启后台轮询"""
    machine = await db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="机器不存在")
    resource_monitor.stop_polling(machine_id)
    resource_monitor.start_polling(machine_id, machine.is_local, interval)
    return {"message": f"已启动机器 {machine_id} 的轮询，间隔 {interval}s"}


@router.post("/{machine_id}/poll/stop")
async def stop_poll(machine_id: int):
    """停止后台轮询"""
    resource_monitor.stop_polling(machine_id)
    return {"message": f"已停止机器 {machine_id} 的轮询"}
