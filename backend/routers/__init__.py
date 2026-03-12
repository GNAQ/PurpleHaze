from routers.auth import router as auth_router
from routers.machines import router as machines_router
from routers.monitor import router as monitor_router
from routers.tasks import router as tasks_router
from routers.fs import router as fs_router

__all__ = ["auth_router", "machines_router", "monitor_router", "tasks_router", "fs_router"]
