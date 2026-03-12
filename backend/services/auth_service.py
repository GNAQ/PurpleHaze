"""
认证服务：密码管理 + JWT 令牌
"""
from datetime import datetime, timedelta

import bcrypt as _bcrypt

from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_DAYS
from models.auth import User


class AuthService:
    # ---------- 密码 ----------

    @staticmethod
    def hash_password(password: str) -> str:
        return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        try:
            return _bcrypt.checkpw(plain.encode(), hashed.encode())
        except Exception:
            return False

    # ---------- 用户 ----------

    @staticmethod
    async def get_user(db: AsyncSession) -> User | None:
        result = await db.execute(select(User).where(User.id == 1))
        return result.scalar_one_or_none()

    @staticmethod
    async def ensure_user(db: AsyncSession) -> User:
        """确保存在 id=1 的用户行，尚未设置密码时 password_hash 为 None"""
        user = await AuthService.get_user(db)
        if user is None:
            user = User(id=1, password_hash=None)
            db.add(user)
            await db.commit()
            await db.refresh(user)
        return user

    @staticmethod
    async def is_setup(db: AsyncSession) -> bool:
        """是否已设置密码"""
        user = await AuthService.get_user(db)
        return user is not None and user.password_hash is not None

    @staticmethod
    async def setup_password(db: AsyncSession, password: str) -> None:
        """首次设置密码"""
        user = await AuthService.ensure_user(db)
        user.password_hash = AuthService.hash_password(password)
        user.updated_at = datetime.utcnow()
        await db.commit()

    @staticmethod
    async def change_password(db: AsyncSession, old_password: str, new_password: str) -> bool:
        """修改密码，返回 True 表示成功"""
        user = await AuthService.get_user(db)
        if user is None or user.password_hash is None:
            return False
        if not AuthService.verify_password(old_password, user.password_hash):
            return False
        user.password_hash = AuthService.hash_password(new_password)
        user.updated_at = datetime.utcnow()
        await db.commit()
        return True

    @staticmethod
    async def authenticate(db: AsyncSession, password: str) -> bool:
        user = await AuthService.get_user(db)
        if user is None or user.password_hash is None:
            return False
        return AuthService.verify_password(password, user.password_hash)

    # ---------- JWT ----------

    @staticmethod
    def create_access_token() -> str:
        expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
        data = {"sub": "pph_user", "exp": expire}
        return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

    @staticmethod
    def verify_token(token: str) -> bool:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            return payload.get("sub") == "pph_user"
        except JWTError:
            return False
