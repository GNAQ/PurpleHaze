"""
Xxium —— PurpleHaze 后端入口
"""
import asyncio
import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import select

from config import BACKEND_HOST, BACKEND_PORT, FRONTEND_PORT, DEFAULT_MONITOR_INTERVAL, BASE_DIR, SECRET_KEY
from database import init_db, AsyncSessionLocal
from models.machine import Machine
from routers import auth_router, machines_router, monitor_router, tasks_router, fs_router
from services.ssh_manager import ssh_manager
from services.resource_monitor import resource_monitor
from services.auth_service import AuthService
from services.task_scheduler import task_scheduler
from migrations import run_migrations

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("xxium")

# ── FastAPI 应用 ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="Xxium (PurpleHaze Backend)",
    version="0.1.0",
    description="PurpleHaze 任务调度与资源管理平台后端",
)

# CORS（前端开发时访问后端）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
        "http://localhost:5173",   # Vite dev server
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(auth_router)
app.include_router(machines_router)
app.include_router(monitor_router)
app.include_router(tasks_router)
app.include_router(fs_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Xxium"}


# 前端静态文件（生产构建后放在 backend/static/）
_STATIC_DIR = BASE_DIR / "static"
if _STATIC_DIR.exists():
    # 挂载 assets 子目录（Vite 构建输出）
    _assets_dir = _STATIC_DIR / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """所有非 API 路由均返回前端 index.html（SPA 路由支持）"""
        # 先尝试作为静态文件返回
        static_file = _STATIC_DIR / full_path
        if static_file.is_file():
            return FileResponse(str(static_file))
        # 回退到 index.html（客户端路由）
        index = _STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"error": "前端尚未构建，请先运行 npm run build"}


# ── 启动/关闭事件 ─────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    # JWT 密鑰安全检查（使用默认密鑰时发出警告）
    if SECRET_KEY == "pph-secret-change-in-production-please":
        logger.warning(
            "⚠️  JWT SECRET_KEY 使用默认值！"
            "部署到生产环境前请通过环境变量 PPH_SECRET_KEY 设置自定义密鑰。"
        )
    logger.info("初始化数据库...")
    await init_db()
    await run_migrations()

    # 确保用户行存在
    async with AsyncSessionLocal() as db:
        await AuthService.ensure_user(db)

        # D-1: 确保至少有一条流水线（首次运行时自动创建뭐认流水线）
        from models.task import Pipeline as _PipelineModel
        from sqlalchemy import func as _func
        pipeline_count = (await db.execute(
            select(_func.count()).select_from(_PipelineModel)
        )).scalar_one()
        if pipeline_count == 0:
            db.add(_PipelineModel(name="默认流水线", sort_order=0))
            await db.commit()
            logger.info("[Startup] 已创建默认流水线")

        # 重建 SSH 连接 & 启动监控轮询
        result = await db.execute(select(Machine))
        machines = result.scalars().all()
        for m in machines:
            interval = (m.monitor_config or {}).get("interval", DEFAULT_MONITOR_INTERVAL)
            if not m.is_local:
                ssh_manager.add(
                    m.id, m.ssh_host, m.ssh_port, m.ssh_username,
                    password=m.ssh_password,
                    private_key=m.ssh_private_key,
                    proxy_host=m.proxy_jump_host,
                    proxy_port=m.proxy_jump_port,
                    proxy_username=m.proxy_jump_username,
                    proxy_password=m.proxy_jump_password,
                    proxy_private_key=m.proxy_jump_private_key,
                    auto_reconnect=m.auto_reconnect,
                )
                if m.auto_connect:
                    logger.info(f"自动连接机器: {m.name} ({m.ssh_host})")
                    ssh_manager.connect(m.id)
            resource_monitor.start_polling(m.id, m.is_local, interval)

    logger.info(f"Xxium 后端已启动，监听 {BACKEND_HOST}:{BACKEND_PORT}")

    # 启动任务调度器
    await task_scheduler.startup_recovery()
    task_scheduler.start()
    logger.info("[Scheduler] 任务调度器已启动")


@app.on_event("shutdown")
async def shutdown():
    task_scheduler.stop()
    logger.info("关闭所有 SSH 连接...")
    for mid in list(ssh_manager.all_statuses().keys()):
        ssh_manager.disconnect(mid)


# ── 直接运行 ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=BACKEND_HOST,
        port=BACKEND_PORT,
        reload=False,
        log_level="info",
    )
