"""Machine-scoped runtime environment inventory and Conda probing."""
import asyncio
import json
import os
import shlex
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.machine import Machine
from models.task import CondaEnv
from services.ssh_manager import ssh_manager

_PROBE_SCRIPT = r'''
set -eu
for candidate in \
  conda \
  mamba \
  micromamba \
  "$HOME/miniconda3/bin/conda" \
  "$HOME/anaconda3/bin/conda" \
  "$HOME/miniforge3/bin/conda" \
  "$HOME/mambaforge/bin/conda" \
  "/opt/conda/bin/conda"
do
  if [ "$candidate" = "conda" ] || [ "$candidate" = "mamba" ] || [ "$candidate" = "micromamba" ]; then
    if command -v "$candidate" >/dev/null 2>&1; then
      "$candidate" env list --json
      exit 0
    fi
  elif [ -x "$candidate" ]; then
    "$candidate" env list --json
    exit 0
  fi
done
printf '{"envs": [], "probe_warning": "conda executable not found"}\n'
'''.strip()

_BASE_DIR_NAMES = {
    "anaconda3",
    "miniconda3",
    "miniforge3",
    "mambaforge",
    "conda",
}


@dataclass(slots=True)
class CondaEnvProbeSummary:
    machine_id: int
    created_count: int
    updated_count: int
    removed_count: int
    warning: str | None
    envs: list[CondaEnv]


class RuntimeEnvService:
    async def list_conda_envs(self, db: AsyncSession, machine_id: int) -> list[CondaEnv]:
        result = await db.execute(
            select(CondaEnv)
            .where(CondaEnv.machine_id == machine_id)
            .order_by(CondaEnv.name, CondaEnv.id)
        )
        return list(result.scalars().all())

    async def register_conda_env(
        self,
        db: AsyncSession,
        machine: Machine,
        *,
        name: str,
        path: str,
    ) -> CondaEnv:
        normalized_path = path.strip()
        normalized_name = name.strip() or self._infer_env_name(normalized_path)
        if not normalized_name:
            raise ValueError("手动注册机器环境时至少需要环境名称或环境路径")

        stmt = select(CondaEnv).where(CondaEnv.machine_id == machine.id)
        if normalized_path:
            stmt = stmt.where(CondaEnv.path == normalized_path)
        else:
            stmt = stmt.where(CondaEnv.name == normalized_name, CondaEnv.path == "")

        result = await db.execute(stmt.limit(1))
        env = result.scalar_one_or_none()
        if env is None:
            env = CondaEnv(
                machine_id=machine.id,
                name=normalized_name,
                path=normalized_path,
                source="manual",
            )
            db.add(env)
        else:
            env.name = normalized_name
            env.source = "manual"
            env.path = normalized_path
            env.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(env)
        return env

    async def probe_conda_envs(
        self,
        db: AsyncSession,
        machine: Machine,
    ) -> CondaEnvProbeSummary:
        discovered_envs, warning = await self._probe_machine(machine)
        existing_result = await db.execute(
            select(CondaEnv).where(CondaEnv.machine_id == machine.id)
        )
        existing_envs = list(existing_result.scalars().all())
        existing_by_path = {env.path: env for env in existing_envs if env.path}

        created_count = 0
        updated_count = 0
        removed_count = 0
        now = datetime.utcnow()
        discovered_paths: set[str] = set()

        for item in discovered_envs:
            path = item["path"]
            name = item["name"]
            discovered_paths.add(path)

            env = existing_by_path.get(path)
            if env is None:
                env = CondaEnv(
                    machine_id=machine.id,
                    name=name,
                    path=path,
                    source="probe",
                    last_seen_at=now,
                )
                db.add(env)
                created_count += 1
                continue

            changed = False
            if env.name != name:
                env.name = name
                changed = True
            if env.last_seen_at != now:
                env.last_seen_at = now
                changed = True
            if env.source != "manual":
                env.source = "probe"
                changed = True
            if changed:
                env.updated_at = now
                updated_count += 1

        for env in existing_envs:
            if env.source == "probe" and env.path not in discovered_paths:
                await db.delete(env)
                removed_count += 1

        await db.commit()
        envs = await self.list_conda_envs(db, machine.id)
        return CondaEnvProbeSummary(
            machine_id=machine.id,
            created_count=created_count,
            updated_count=updated_count,
            removed_count=removed_count,
            warning=warning,
            envs=envs,
        )

    async def _probe_machine(self, machine: Machine) -> tuple[list[dict[str, str]], str | None]:
        if machine.is_local:
            stdout, stderr = await self._run_local_probe()
        else:
            stdout, stderr = await self._run_remote_probe(machine)
        return self._parse_probe_payload(stdout, stderr)

    async def _run_local_probe(self) -> tuple[str, str]:
        proc = await asyncio.create_subprocess_exec(
            "bash",
            "-lc",
            _PROBE_SCRIPT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(stderr.decode("utf-8", errors="replace") or "本地 Conda probe 执行失败")
        return (
            stdout.decode("utf-8", errors="replace"),
            stderr.decode("utf-8", errors="replace"),
        )

    async def _run_remote_probe(self, machine: Machine) -> tuple[str, str]:
        self._ensure_remote_connection(machine)
        cmd = f"bash -lc {shlex.quote(_PROBE_SCRIPT)}"
        try:
            stdout, stderr = await asyncio.get_running_loop().run_in_executor(
                None,
                ssh_manager.exec_command,
                machine.id,
                cmd,
            )
        except Exception as exc:
            raise RuntimeError(f"远程 Conda probe 执行失败: {exc}") from exc
        return stdout, stderr

    def _ensure_remote_connection(self, machine: Machine) -> None:
        conn = ssh_manager.get(machine.id)
        if conn is None:
            conn = ssh_manager.add(
                machine.id,
                machine.ssh_host,
                machine.ssh_port,
                machine.ssh_username,
                password=machine.ssh_password,
                private_key=machine.ssh_private_key,
                proxy_host=machine.proxy_jump_host,
                proxy_port=machine.proxy_jump_port,
                proxy_username=machine.proxy_jump_username,
                proxy_password=machine.proxy_jump_password,
                proxy_private_key=machine.proxy_jump_private_key,
                auto_reconnect=machine.auto_reconnect,
            )
        if ssh_manager.is_connected(machine.id):
            return
        if not ssh_manager.connect(machine.id):
            raise RuntimeError(conn.last_error or "SSH 连接失败")

    def _parse_probe_payload(self, stdout: str, stderr: str) -> tuple[list[dict[str, str]], str | None]:
        payload_text = stdout.strip()
        if not payload_text:
            raise RuntimeError(stderr.strip() or "Conda probe 没有返回任何输出")

        json_blob = self._extract_json_blob(payload_text)
        try:
            data = json.loads(json_blob)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Conda probe 输出不是合法 JSON: {payload_text[:200]}") from exc

        warning = data.get("probe_warning")
        normalized: list[dict[str, str]] = []
        seen_paths: set[str] = set()
        for raw_path in data.get("envs") or []:
            path = str(raw_path).strip()
            if not path or path in seen_paths:
                continue
            seen_paths.add(path)
            normalized.append({
                "name": self._infer_env_name(path),
                "path": path,
            })

        return normalized, warning

    @staticmethod
    def _extract_json_blob(raw: str) -> str:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1 or end < start:
            raise RuntimeError(f"Conda probe 输出缺少 JSON 负载: {raw[:200]}")
        return raw[start:end + 1]

    @staticmethod
    def _infer_env_name(path: str) -> str:
        normalized = path.rstrip("/")
        env_marker = f"{os.sep}envs{os.sep}"
        if env_marker in normalized:
            suffix = normalized.rsplit(env_marker, 1)[1]
            if suffix and os.sep not in suffix:
                return suffix

        base = os.path.basename(normalized)
        if base in _BASE_DIR_NAMES:
            return "base"
        return base or "base"


runtime_env_service = RuntimeEnvService()