"""
机器管理相关 Pydantic 模式
"""
from datetime import datetime
from pydantic import BaseModel


class MachineCreate(BaseModel):
    name: str
    is_local: bool = False
    ssh_host: str | None = None
    ssh_port: int = 22
    ssh_username: str | None = None
    ssh_password: str | None = None
    ssh_private_key: str | None = None
    # 跳板机配置
    proxy_jump_host: str | None = None
    proxy_jump_port: int = 22
    proxy_jump_username: str | None = None
    proxy_jump_password: str | None = None
    proxy_jump_private_key: str | None = None
    auto_connect: bool = False
    auto_reconnect: bool = True
    monitor_config: dict | None = None
    sort_order: int = 0


class MachineUpdate(BaseModel):
    name: str | None = None
    ssh_host: str | None = None
    ssh_port: int | None = None
    ssh_username: str | None = None
    ssh_password: str | None = None
    ssh_private_key: str | None = None
    # 跳板机配置
    proxy_jump_host: str | None = None
    proxy_jump_port: int | None = None
    proxy_jump_username: str | None = None
    proxy_jump_password: str | None = None
    proxy_jump_private_key: str | None = None
    auto_connect: bool | None = None
    auto_reconnect: bool | None = None
    monitor_config: dict | None = None
    sort_order: int | None = None


class MachineResponse(BaseModel):
    id: int
    name: str
    is_local: bool
    ssh_host: str | None
    ssh_port: int
    ssh_username: str | None
    # 不返回密码/密钥明文
    has_password: bool
    has_private_key: bool
    # 跳板机配置（明文字段不含密码/密钥）
    proxy_jump_host: str | None
    proxy_jump_port: int
    proxy_jump_username: str | None
    has_proxy_jump_password: bool
    has_proxy_jump_private_key: bool
    auto_connect: bool
    auto_reconnect: bool
    monitor_config: dict | None
    sort_order: int
    created_at: datetime
    updated_at: datetime
    # 连接状态（运行时注入）
    connected: bool = False

    model_config = {"from_attributes": True}


class ConnectionStatus(BaseModel):
    machine_id: int
    connected: bool
    error: str | None = None


class MachineListResponse(BaseModel):
    machines: list[MachineResponse]
