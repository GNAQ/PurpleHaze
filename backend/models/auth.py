"""
认证与配置相关数据模型
"""
from datetime import datetime

from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class User(Base):
    """单用户模型，存储密码哈希"""
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    # bcrypt 哈希后的密码，为空代表尚未设置密码（首次登陆）
    password_hash: Mapped[str | None] = mapped_column(String(256), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Setting(Base):
    """键值对配置表"""
    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
