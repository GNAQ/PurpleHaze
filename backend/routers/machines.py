"""
机器管理路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from database import get_db
from deps import get_current_user
from models.machine import Machine
from models.task import TaskTemplate
from schemas.machine import (
    MachineCreate, MachineUpdate, MachineResponse,
    ConnectionStatus, MachineListResponse,
)
from services.ssh_manager import ssh_manager
from services.resource_monitor import resource_monitor
from config import DEFAULT_MONITOR_INTERVAL

router = APIRouter(prefix="/api/machines", tags=["machines"],
                   dependencies=[Depends(get_current_user)])


def _to_response(m: Machine) -> MachineResponse:
    return MachineResponse(
        id=m.id,
        name=m.name,
        is_local=m.is_local,
        ssh_host=m.ssh_host,
        ssh_port=m.ssh_port,
        ssh_username=m.ssh_username,
        has_password=bool(m.ssh_password),
        has_private_key=bool(m.ssh_private_key),
        proxy_jump_host=m.proxy_jump_host,
        proxy_jump_port=m.proxy_jump_port,
        proxy_jump_username=m.proxy_jump_username,
        has_proxy_jump_password=bool(m.proxy_jump_password),
        has_proxy_jump_private_key=bool(m.proxy_jump_private_key),
        auto_connect=m.auto_connect,
        auto_reconnect=m.auto_reconnect,
        monitor_config=m.monitor_config,
        sort_order=m.sort_order,
        created_at=m.created_at,
        updated_at=m.updated_at,
        connected=ssh_manager.is_connected(m.id) if not m.is_local else True,
    )


@router.get("", response_model=MachineListResponse)
async def list_machines(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Machine).order_by(Machine.sort_order, Machine.id))
    machines = result.scalars().all()
    return MachineListResponse(machines=[_to_response(m) for m in machines])


@router.post("", response_model=MachineResponse, status_code=201)
async def create_machine(req: MachineCreate, db: AsyncSession = Depends(get_db)):
    if not req.is_local and not req.ssh_host:
        raise HTTPException(status_code=400, detail="远程机器需提供 SSH 主机地址")
    machine = Machine(**req.model_dump())
    db.add(machine)
    await db.commit()
    await db.refresh(machine)

    # 非本地机器：注册到 SSH 管理器
    if not machine.is_local:
        ssh_manager.add(
            machine.id, machine.ssh_host, machine.ssh_port, machine.ssh_username,
            password=machine.ssh_password,
            private_key=machine.ssh_private_key,
            proxy_host=machine.proxy_jump_host,
            proxy_port=machine.proxy_jump_port,
            proxy_username=machine.proxy_jump_username,
            proxy_password=machine.proxy_jump_password,
            proxy_private_key=machine.proxy_jump_private_key,
            auto_reconnect=machine.auto_reconnect,
        )
        if machine.auto_connect:
            ssh_manager.connect(machine.id)

    # 启动资源监控轮询（interval 最小 1s，防止 interval=0 导致忙等循环）
    interval = max(1, int((machine.monitor_config or {}).get("interval", DEFAULT_MONITOR_INTERVAL)))
    resource_monitor.start_polling(machine.id, machine.is_local, interval)

    return _to_response(machine)


@router.get("/{machine_id}", response_model=MachineResponse)
async def get_machine(machine_id: int, db: AsyncSession = Depends(get_db)):
    machine = await db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="机器不存在")
    return _to_response(machine)


@router.put("/{machine_id}", response_model=MachineResponse)
async def update_machine(machine_id: int, req: MachineUpdate, db: AsyncSession = Depends(get_db)):
    machine = await db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="机器不存在")

    update_data = req.model_dump(exclude_none=True)
    for key, val in update_data.items():
        setattr(machine, key, val)
    await db.commit()
    await db.refresh(machine)

    # 更新 SSH 连接配置（重新注册）
    if not machine.is_local:
        ssh_manager.remove(machine.id)
        ssh_manager.add(
            machine.id, machine.ssh_host, machine.ssh_port, machine.ssh_username,
            password=machine.ssh_password,
            private_key=machine.ssh_private_key,
            proxy_host=machine.proxy_jump_host,
            proxy_port=machine.proxy_jump_port,
            proxy_username=machine.proxy_jump_username,
            proxy_password=machine.proxy_jump_password,
            proxy_private_key=machine.proxy_jump_private_key,
            auto_reconnect=machine.auto_reconnect,
        )

    # 重启监控轮询（间隔可能改变；最小 1s，防止 interval=0 导致忙等循环）
    resource_monitor.stop_polling(machine.id)
    interval = max(1, int((machine.monitor_config or {}).get("interval", DEFAULT_MONITOR_INTERVAL)))
    resource_monitor.start_polling(machine.id, machine.is_local, interval)

    return _to_response(machine)


@router.delete("/{machine_id}", status_code=204)
async def delete_machine(machine_id: int, db: AsyncSession = Depends(get_db)):
    machine = await db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="机器不存在")
    resource_monitor.stop_polling(machine_id)
    if not machine.is_local:
        ssh_manager.remove(machine_id)
    # B-2: 删除机器唤将引用该机器的模板 machine_id 清空，避免模板内悬空引用
    await db.execute(
        update(TaskTemplate)
        .where(TaskTemplate.machine_id == machine_id)
        .values(machine_id=None)
    )
    await db.delete(machine)
    await db.commit()


@router.post("/{machine_id}/connect", response_model=ConnectionStatus)
async def connect_machine(machine_id: int, db: AsyncSession = Depends(get_db)):
    machine = await db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="机器不存在")
    if machine.is_local:
        return ConnectionStatus(machine_id=machine_id, connected=True)

    conn = ssh_manager.get(machine_id)
    if conn is None:
        conn = ssh_manager.add(
            machine.id, machine.ssh_host, machine.ssh_port, machine.ssh_username,
            password=machine.ssh_password,
            private_key=machine.ssh_private_key,
            auto_reconnect=machine.auto_reconnect,
        )
    success = ssh_manager.connect(machine_id)
    error = None if success else (conn.last_error or "连接失败")
    return ConnectionStatus(machine_id=machine_id, connected=success, error=error)


@router.post("/{machine_id}/disconnect", response_model=ConnectionStatus)
async def disconnect_machine(machine_id: int, db: AsyncSession = Depends(get_db)):
    machine = await db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="机器不存在")
    if machine.is_local:
        return ConnectionStatus(machine_id=machine_id, connected=True)
    ssh_manager.disconnect(machine_id)
    return ConnectionStatus(machine_id=machine_id, connected=False)
