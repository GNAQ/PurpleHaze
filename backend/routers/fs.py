"""
文件系统浏览路由（供前端路径选择器使用）

GET /api/fs/browse?path=/some/path&machine_id=1
  - machine_id 不传或为 0 时浏览本地路径
  - machine_id 传入时通过 SSH 浏览远端路径
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from deps import get_current_user
from services.ssh_manager import ssh_manager

router = APIRouter(
    prefix="/api/fs",
    tags=["fs"],
    dependencies=[Depends(get_current_user)],
)


class FsItem(BaseModel):
    name: str
    path: str
    is_dir: bool


class BrowseResponse(BaseModel):
    path: str
    parent: str | None
    items: list[FsItem]


@router.get("/browse", response_model=BrowseResponse)
async def browse(
    path: str = Query(default="/", description="目标路径"),
    machine_id: int = Query(default=0, description="机器 ID，0 表示本地"),
):
    """浏览目录内容，返回当前路径下的文件和文件夹列表"""
    if machine_id and machine_id > 0:
        return await _browse_remote(path, machine_id)
    return _browse_local(path)


def _browse_local(path: str) -> BrowseResponse:
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"路径不存在或不是目录: {path}")

    try:
        entries = os.scandir(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该目录")

    items: list[FsItem] = []
    for entry in sorted(entries, key=lambda e: (not e.is_dir(), e.name.lower())):
        items.append(FsItem(name=entry.name, path=entry.path, is_dir=entry.is_dir()))

    parent = os.path.dirname(path) if path != "/" else None
    return BrowseResponse(path=path, parent=parent, items=items)


async def _browse_remote(path: str, machine_id: int) -> BrowseResponse:
    import asyncio
    # 使用 ls -1ApF 列出目录内容
    cmd = f"ls -1Ap {_quote(path)} 2>&1 && echo __EXIT0__ || echo __EXIT1__"
    try:
        out, _err = await asyncio.get_running_loop().run_in_executor(
            None, ssh_manager.exec_command, machine_id, cmd
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"SSH 执行失败: {e}")

    if "__EXIT1__" in out:
        raise HTTPException(status_code=404, detail=f"路径不存在: {path}")

    lines = [l for l in out.replace("__EXIT0__", "").strip().splitlines() if l.strip()]
    items: list[FsItem] = []
    for line in lines:
        name = line.rstrip("/")
        is_dir = line.endswith("/")
        item_path = path.rstrip("/") + "/" + name
        items.append(FsItem(name=name, path=item_path, is_dir=is_dir))

    parent = path.rstrip("/").rsplit("/", 1)[0] or "/"
    if path in ("/", ""):
        parent = None
    return BrowseResponse(path=path, parent=parent, items=items)


def _quote(s: str) -> str:
    """简单单引号转义（远端路径）"""
    return "'" + s.replace("'", "'\\''") + "'"


@router.post("/open")
async def open_path(path: str = Query(..., description="要在系统文件管理器中打开的本地目录路径")):
    """
    D-5: 在系统文件管理器中打开本地目录。
    仅在后端运行于本地机器时有效；不支持纯远端部署。
    """
    import subprocess
    import sys

    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"目录不存在: {path}")
    try:
        if sys.platform.startswith("linux"):
            subprocess.Popen(["xdg-open", path])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        elif sys.platform == "win32":
            subprocess.Popen(["explorer", path])
        else:
            raise HTTPException(status_code=400, detail="不支持当前操作系统")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"打开失败: {e}")
    return {"ok": True}
