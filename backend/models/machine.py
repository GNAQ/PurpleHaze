"""
机器管理数据模型
"""
from datetime import datetime

from sqlalchemy import String, Boolean, Integer, DateTime, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Machine(Base):
    """机器信息模型"""
    __tablename__ = "machine"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)

    # 是否是本地机器（本地机器无需 SSH）
    is_local: Mapped[bool] = mapped_column(Boolean, default=False)

    # SSH 连接信息（远程机器必填）
    ssh_host: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ssh_port: Mapped[int] = mapped_column(Integer, default=22)
    ssh_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # 密码验证（若使用密鑰则为空）—— ⚠️ 明文存储，请确保 DATA_DIR 权限限制为 700
    ssh_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    # SSH 私钥内容（PEM 格式）
    ssh_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 跳板机（ProxyJump）配置
    proxy_jump_host: Mapped[str | None] = mapped_column(String(256), nullable=True)
    proxy_jump_port: Mapped[int] = mapped_column(Integer, default=22)
    proxy_jump_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    proxy_jump_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    proxy_jump_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 连接配置
    auto_connect: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_reconnect: Mapped[bool] = mapped_column(Boolean, default=True)

    # 监控配置（JSON），例如 {"interval": 10}
    monitor_config: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=lambda: {"interval": 10})

    # 显示顺序
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
