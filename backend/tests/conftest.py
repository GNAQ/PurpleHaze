"""
PurpleHaze backend test fixtures.

Provides:
- Isolated async SQLite DB per test session
- httpx AsyncClient wired to the FastAPI app
- Auth token (auto-setup password + login)
- Fake machine factories (local + remote)
- Mocked SSH manager and resource monitor
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
from datetime import datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Ensure backend package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import Base, get_db
from main import app
from models import User, Machine, Pipeline, Task, CondaEnv, TaskTemplate, GpuConditionPreset  # noqa: F401
from models.task import TaskStatus
from services.auth_service import AuthService
from schemas.monitor import GpuInfo, GpuProcess, ResourceSnapshot


# ---------------------------------------------------------------------------
# Database fixtures
# ---------------------------------------------------------------------------

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(test_engine):
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def override_db(test_engine):
    """Override FastAPI's get_db dependency to use test DB."""
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async def _get_test_db():
        async with session_factory() as session:
            try:
                yield session
            finally:
                await session.close()

    app.dependency_overrides[get_db] = _get_test_db
    yield session_factory
    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# Auth fixtures
# ---------------------------------------------------------------------------

TEST_PASSWORD = "test123456"


@pytest_asyncio.fixture(scope="function")
async def auth_token(override_db) -> str:
    """Setup password and return a valid JWT token."""
    async with override_db() as db:
        await AuthService.ensure_user(db)
        await AuthService.setup_password(db, TEST_PASSWORD)
    return AuthService.create_access_token()


@pytest_asyncio.fixture(scope="function")
async def auth_headers(auth_token) -> dict:
    return {"Authorization": f"Bearer {auth_token}"}


# ---------------------------------------------------------------------------
# HTTP client fixture
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="function")
async def client(override_db) -> AsyncClient:
    """httpx AsyncClient bound to the FastAPI app (no real network)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(scope="function")
async def authed_client(client, auth_headers) -> tuple[AsyncClient, dict]:
    """Returns (client, headers) with auth already set up."""
    return client, auth_headers


# ---------------------------------------------------------------------------
# Mock SSH & resource monitor (prevent real connections)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_ssh_manager():
    with patch("routers.machines.ssh_manager") as m:
        m.is_connected.return_value = False
        m.add.return_value = MagicMock()
        m.connect.return_value = True
        m.disconnect.return_value = None
        m.remove.return_value = None
        m.get.return_value = None
        m.all_statuses.return_value = {}
        yield m


@pytest.fixture(autouse=True)
def mock_resource_monitor():
    with patch("routers.machines.resource_monitor") as m:
        m.start_polling.return_value = None
        m.stop_polling.return_value = None
        m.get_history.return_value = []
        m.get_last_snapshot_time.return_value = None
        yield m


# ---------------------------------------------------------------------------
# Fake machine factories
# ---------------------------------------------------------------------------

async def create_local_machine(db: AsyncSession, name: str = "本地机器", **kwargs) -> Machine:
    defaults = dict(name=name, is_local=True, sort_order=0)
    defaults.update(kwargs)
    m = Machine(**defaults)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


async def create_remote_machine(
    db: AsyncSession,
    name: str = "远程GPU服务器",
    ssh_host: str = "192.168.1.100",
    ssh_username: str = "user",
    ssh_password: str = "pass",
    **kwargs,
) -> Machine:
    defaults = dict(
        name=name,
        is_local=False,
        ssh_host=ssh_host,
        ssh_port=22,
        ssh_username=ssh_username,
        ssh_password=ssh_password,
        auto_connect=False,
        auto_reconnect=True,
        sort_order=0,
    )
    defaults.update(kwargs)
    m = Machine(**defaults)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


# ---------------------------------------------------------------------------
# GPU snapshot factory
# ---------------------------------------------------------------------------

def make_gpu(
    index: int = 0,
    name: str = "NVIDIA RTX 4090",
    utilization: float = 0.0,
    memory_used_mb: float = 0.0,
    memory_total_mb: float = 24576.0,
    power_draw_w: float | None = 50.0,
    power_limit_w: float | None = 450.0,
    temperature_c: float | None = 35.0,
    processes: list | None = None,
) -> GpuInfo:
    return GpuInfo(
        index=index,
        name=name,
        utilization=utilization,
        memory_used_mb=memory_used_mb,
        memory_total_mb=memory_total_mb,
        power_draw_w=power_draw_w,
        power_limit_w=power_limit_w,
        temperature_c=temperature_c,
        processes=processes or [],
    )


def make_snapshot(
    machine_id: int = 1,
    gpus: list[GpuInfo] | None = None,
    cpu_percent: float = 10.0,
    memory_used_mb: float = 8000.0,
    memory_total_mb: float = 64000.0,
    timestamp: datetime | None = None,
) -> ResourceSnapshot:
    return ResourceSnapshot(
        machine_id=machine_id,
        timestamp=timestamp or datetime.utcnow(),
        cpu_percent=cpu_percent,
        memory_used_mb=memory_used_mb,
        memory_total_mb=memory_total_mb,
        gpus=gpus or [],
    )
