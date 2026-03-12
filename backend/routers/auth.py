"""
认证路由：登录、密码设置、修改密码、获取/修改配置
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from deps import get_current_user
from models.auth import Setting
from schemas.auth import (
    SetupRequest, LoginRequest, LoginResponse, ChangePasswordRequest,
    AuthStatus, SettingsResponse, UpdateSettingsRequest, SettingItem,
)
from services.auth_service import AuthService

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── 公开接口（无需鉴权）──────────────────────────────────────────────────────


@router.get("/status", response_model=AuthStatus)
async def auth_status(db: AsyncSession = Depends(get_db)):
    return AuthStatus(is_setup=await AuthService.is_setup(db))


@router.post("/setup", status_code=status.HTTP_201_CREATED)
async def setup(req: SetupRequest, db: AsyncSession = Depends(get_db)):
    """首次设置密码（已设置后调用此接口会被拒绝）"""
    if await AuthService.is_setup(db):
        raise HTTPException(status_code=400, detail="密码已设置，请通过修改密码接口操作")
    if not req.password or len(req.password) < 6:
        raise HTTPException(status_code=400, detail="密码长度至少 6 位")
    await AuthService.setup_password(db, req.password)
    return {"message": "密码设置成功"}


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    if not await AuthService.authenticate(db, req.password):
        raise HTTPException(status_code=401, detail="密码错误")
    token = AuthService.create_access_token()
    return LoginResponse(access_token=token)


# ── 需要鉴权的接口 ────────────────────────────────────────────────────────────


@router.post("/change-password", dependencies=[Depends(get_current_user)])
async def change_password(req: ChangePasswordRequest, db: AsyncSession = Depends(get_db)):
    ok = await AuthService.change_password(db, req.old_password, req.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail="旧密码错误")
    return {"message": "密码修改成功，请重新登录"}


@router.get("/settings", response_model=SettingsResponse, dependencies=[Depends(get_current_user)])
async def get_settings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting))
    rows = result.scalars().all()
    return SettingsResponse(settings=[
        SettingItem(key=r.key, value=r.value, description=r.description) for r in rows
    ])


@router.put("/settings", dependencies=[Depends(get_current_user)])
async def update_settings(req: UpdateSettingsRequest, db: AsyncSession = Depends(get_db)):
    for item in req.settings:
        result = await db.execute(select(Setting).where(Setting.key == item.key))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = item.value
            if item.description is not None:
                setting.description = item.description
        else:
            db.add(Setting(key=item.key, value=item.value, description=item.description))
    await db.commit()
    return {"message": "配置已更新"}
