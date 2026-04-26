"""
简单数据库迁移系统

在 startup 时调用 run_migrations() 以自动应用所有待执行的迁移。

新增迁移步骤：
  1. 在 MIGRATIONS 列表末尾追加一个元组 (version, description, sql_or_callable)
  2. version 必须严格递增（整数）
  3. sql_or_callable 可以是：
       - SQL 字符串（直接执行）
       - async callable(db: AsyncSession)（复杂迁移）
       - None（仅记录版本号，用于基线）
"""
import logging
from typing import Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal

logger = logging.getLogger(__name__)


# 幂等 ALTER TABLE 辅助：先检查字段是否已存在
async def _add_column_if_missing(
    db: AsyncSession, table: str, column: str, definition: str
) -> None:
    result = await db.execute(text(f"PRAGMA table_info({table})"))
    cols = [row[1] for row in result.fetchall()]
    if column not in cols:
        await db.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


async def _m2_add_template_machine_id(db: AsyncSession) -> None:
    await _add_column_if_missing(
        db, "task_template", "machine_id", "INTEGER REFERENCES machine(id)"
    )


async def _m3_add_proxy_jump_fields(db: AsyncSession) -> None:
    """machine 表增加跳板机 (ProxyJump) 相关字段"""
    cols = [
        ("proxy_jump_host",        "VARCHAR(256)"),
        ("proxy_jump_port",        "INTEGER DEFAULT 22"),
        ("proxy_jump_username",    "VARCHAR(128)"),
        ("proxy_jump_password",    "TEXT"),
        ("proxy_jump_private_key", "TEXT"),
    ]
    for col, definition in cols:
        await _add_column_if_missing(db, "machine", col, definition)


async def _m5_add_machine_scoped_conda_env_fields(db: AsyncSession) -> None:
    cols = [
        ("machine_id", "INTEGER"),
        ("source", "VARCHAR(32) NOT NULL DEFAULT 'manual'"),
        ("last_seen_at", "DATETIME"),
        ("updated_at", "DATETIME"),
    ]
    for col, definition in cols:
        await _add_column_if_missing(db, "conda_env", col, definition)

    await db.execute(text("UPDATE conda_env SET source = COALESCE(source, 'manual')"))
    await db.execute(text("UPDATE conda_env SET updated_at = COALESCE(updated_at, created_at, datetime('now'))"))


async def _m6_add_runtime_env_fingerprint_and_binding_hint(db: AsyncSession) -> None:
    cols = [
        ("python_version", "VARCHAR(64)"),
        ("python_path", "VARCHAR(512)"),
        ("fingerprint_hash", "VARCHAR(128)"),
        ("package_count", "INTEGER"),
        ("fingerprint_info", "JSON"),
    ]
    for col, definition in cols:
        await _add_column_if_missing(db, "conda_env", col, definition)

    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS runtime_env_binding_hint (
            id INTEGER NOT NULL PRIMARY KEY,
            machine_id INTEGER NOT NULL REFERENCES machine(id),
            conda_env_id INTEGER NOT NULL REFERENCES conda_env(id),
            work_dir_pattern VARCHAR(1024) NOT NULL,
            source VARCHAR(32) NOT NULL DEFAULT 'learned',
            priority INTEGER NOT NULL DEFAULT 100,
            last_used_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT (datetime('now')),
            updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
        )
    """))
    await db.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_runtime_env_binding_hint_machine_pattern "
        "ON runtime_env_binding_hint(machine_id, work_dir_pattern)"
    ))


# ─────────────────────────────────────────────────────────────────────────────
# 迁移列表：(version: int, description: str, sql_or_callable: str | Callable | None)
# ─────────────────────────────────────────────────────────────────────────────
MIGRATIONS: list[tuple[int, str, "str | Callable | None"]] = [
    (1, "基线版本（init_db 已通过 SQLAlchemy create_all 创建所有初始表）", None),
    (2, "task_template 表增加 machine_id 字段", _m2_add_template_machine_id),
    (3, "machine 表增加跳板机（ProxyJump）字段", _m3_add_proxy_jump_fields),
    (4, "task 表增加 rendered_command 字段",
     lambda db: _add_column_if_missing(db, "task", "rendered_command", "TEXT")),
    (5, "conda_env 表增加 machine-scoped inventory 字段", _m5_add_machine_scoped_conda_env_fields),
    (6, "conda_env 表增加 fingerprint 字段并新增 runtime_env_binding_hint 表", _m6_add_runtime_env_fingerprint_and_binding_hint),
]


async def run_migrations() -> None:
    """检查并应用所有待执行的迁移；幂等，可安全重复调用。"""
    async with AsyncSessionLocal() as db:
        # 确保版本追踪表存在（首次运行时自动创建）
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version     INTEGER NOT NULL PRIMARY KEY,
                applied_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                description TEXT
            )
        """))
        await db.commit()

        result = await db.execute(text("SELECT COALESCE(MAX(version), 0) FROM schema_version"))
        current_version: int = result.scalar_one()

        pending = [(v, d, s) for v, d, s in MIGRATIONS if v > current_version]
        if not pending:
            logger.info(f"[Migration] 数据库已是最新版本（v{current_version}）")
            return

        for version, description, sql_or_callable in pending:
            logger.info(f"[Migration] 应用迁移 v{version}: {description}")
            try:
                if sql_or_callable is not None:
                    if callable(sql_or_callable):
                        await sql_or_callable(db)
                    else:
                        await db.execute(text(sql_or_callable))
                await db.execute(
                    text("INSERT INTO schema_version (version, description) VALUES (:v, :d)"),
                    {"v": version, "d": description},
                )
                await db.commit()
                logger.info(f"[Migration] ✓ 迁移 v{version} 完成")
            except Exception as e:
                await db.rollback()
                logger.error(f"[Migration] ✗ 迁移 v{version} 失败: {e}", exc_info=True)
                raise
