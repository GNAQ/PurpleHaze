"""
FastAPI 公共依赖
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from services.auth_service import AuthService

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> None:
    """校验 JWT Bearer Token"""
    if credentials is None or not AuthService.verify_token(credentials.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未授权，请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
