"""
认证相关 Pydantic 模式
"""
from pydantic import BaseModel


class SetupRequest(BaseModel):
    password: str


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class AuthStatus(BaseModel):
    is_setup: bool  # 是否已设置密码


class SettingItem(BaseModel):
    key: str
    value: str
    description: str | None = None


class SettingsResponse(BaseModel):
    settings: list[SettingItem]


class UpdateSettingsRequest(BaseModel):
    settings: list[SettingItem]
