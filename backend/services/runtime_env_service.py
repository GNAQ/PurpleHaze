"""Machine-scoped runtime environment inventory and Conda probing."""
import asyncio
import hashlib
import inspect
import json
import os
import shlex
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.machine import Machine
from models.task import CondaEnv, RuntimeEnvBindingHint
from services.ssh_manager import ssh_manager

_PROBE_SCRIPT = r'''
set -eu

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

append_env() {
    env_path="$1"
    [ -d "$env_path" ] || return 0
    if [ "$first" -eq 0 ]; then
        printf ','
    fi
    printf '"%s"' "$(json_escape "$env_path")"
    first=0
}

warning='仅扫描常见 Conda 根目录（miniconda3/anaconda3/miniforge3/mambaforge/opt/conda 及 ~/.conda/envs）；自定义路径请在设置页手动登记到对应机器。'
first=1

printf '{"envs":['
for root in \
    "$HOME/miniconda3" \
    "$HOME/anaconda3" \
    "$HOME/miniforge3" \
    "$HOME/mambaforge" \
    "/opt/conda"
do
    [ -d "$root" ] || continue
    append_env "$root"
    if [ -d "$root/envs" ]; then
        for env_dir in "$root"/envs/*; do
            [ -d "$env_dir" ] || continue
            append_env "$env_dir"
        done
    fi
done

if [ -d "$HOME/.conda/envs" ]; then
    for env_dir in "$HOME/.conda/envs"/*; do
        [ -d "$env_dir" ] || continue
        append_env "$env_dir"
    done
fi

printf '],"probe_warning":"%s"}\n' "$(json_escape "$warning")"
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


@dataclass(slots=True)
class CondaEnvResolutionSummary:
    machine_id: int
    work_dir: str | None
    reason: str | None
    message: str | None
    recommended_env: CondaEnv | None
    binding_hint: RuntimeEnvBindingHint | None
    conflicts: list[CondaEnv]
    migration_action: str | None


@dataclass(slots=True)
class CondaEnvMigrationPlan:
    target_machine_id: int
    source_env: CondaEnv
    action: str
    reason: str
    message: str | None
    reuse_env: CondaEnv | None
    conflicts: list[CondaEnv]


class RuntimeEnvService:
    async def list_conda_envs(self, db: AsyncSession, machine_id: int) -> list[CondaEnv]:
        result = await db.execute(
            select(CondaEnv)
            .where(CondaEnv.machine_id == machine_id)
            .order_by(CondaEnv.name, CondaEnv.id)
        )
        return list(result.scalars().all())

    async def list_available_conda_envs(self, db: AsyncSession, machine_id: int) -> list[CondaEnv]:
        result = await db.execute(
            select(CondaEnv)
            .where(or_(CondaEnv.machine_id == machine_id, CondaEnv.machine_id.is_(None)))
            .order_by(CondaEnv.machine_id.is_(None), CondaEnv.name, CondaEnv.id)
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

        self._apply_fingerprint_payload(
            env,
            await self._call_inspect_conda_env(machine, normalized_path),
        )

        await db.commit()
        await db.refresh(env)
        return env

    async def learn_binding_hint(
        self,
        db: AsyncSession,
        machine_id: int | None,
        work_dir: str | None,
        conda_env_id: int | None,
        *,
        source: str = "learned",
    ) -> RuntimeEnvBindingHint | None:
        normalized_work_dir = self._normalize_work_dir(work_dir)
        if machine_id is None or not normalized_work_dir or not conda_env_id:
            return None

        env = await db.get(CondaEnv, conda_env_id)
        if env is None or env.machine_id not in (None, machine_id):
            return None

        result = await db.execute(
            select(RuntimeEnvBindingHint)
            .where(
                RuntimeEnvBindingHint.machine_id == machine_id,
                RuntimeEnvBindingHint.work_dir_pattern == normalized_work_dir,
            )
            .limit(1)
        )
        hint = result.scalar_one_or_none()
        now = datetime.utcnow()
        if hint is None:
            hint = RuntimeEnvBindingHint(
                machine_id=machine_id,
                conda_env_id=conda_env_id,
                work_dir_pattern=normalized_work_dir,
                source=source,
                priority=100,
                last_used_at=now,
            )
            db.add(hint)
        else:
            hint.conda_env_id = conda_env_id
            hint.source = source
            hint.last_used_at = now
            hint.updated_at = now

        await db.commit()
        await db.refresh(hint)
        return hint

    async def resolve_conda_env(
        self,
        db: AsyncSession,
        machine_id: int,
        *,
        work_dir: str | None = None,
    ) -> CondaEnvResolutionSummary:
        normalized_work_dir = self._normalize_work_dir(work_dir)
        envs = await self.list_available_conda_envs(db, machine_id)
        binding_hint = await self._find_binding_hint(db, machine_id, normalized_work_dir)
        if binding_hint is not None:
            env = next((item for item in envs if item.id == binding_hint.conda_env_id), None)
            if env is not None:
                return CondaEnvResolutionSummary(
                    machine_id=machine_id,
                    work_dir=normalized_work_dir,
                    reason="binding_hint",
                    message="命中了当前机器上最接近的工作目录绑定提示",
                    recommended_env=env,
                    binding_hint=binding_hint,
                    conflicts=[],
                    migration_action=None,
                )

        machine_envs = [env for env in envs if env.machine_id == machine_id]
        if len(machine_envs) == 1:
            return CondaEnvResolutionSummary(
                machine_id=machine_id,
                work_dir=normalized_work_dir,
                reason="single_machine_env",
                message="当前机器只登记了一个 Conda 环境，作为默认推荐值",
                recommended_env=machine_envs[0],
                binding_hint=None,
                conflicts=[],
                migration_action=None,
            )

        return CondaEnvResolutionSummary(
            machine_id=machine_id,
            work_dir=normalized_work_dir,
            reason=None,
            message=None,
            recommended_env=None,
            binding_hint=None,
            conflicts=[],
            migration_action=None,
        )

    async def build_migration_plan(
        self,
        db: AsyncSession,
        target_machine_id: int,
        *,
        source_env_id: int,
    ) -> CondaEnvMigrationPlan:
        source_env = await db.get(CondaEnv, source_env_id)
        if source_env is None:
            raise ValueError("源 Conda 环境不存在")

        target_envs = await self.list_conda_envs(db, target_machine_id)
        if source_env.fingerprint_hash:
            exact_match = next(
                (env for env in target_envs if env.fingerprint_hash and env.fingerprint_hash == source_env.fingerprint_hash),
                None,
            )
            if exact_match is not None:
                return CondaEnvMigrationPlan(
                    target_machine_id=target_machine_id,
                    source_env=source_env,
                    action="reuse_existing",
                    reason="fingerprint_match",
                    message="目标机器存在 fingerprint 一致的环境，可直接复用",
                    reuse_env=exact_match,
                    conflicts=[],
                )

        same_name_candidates = [env for env in target_envs if env.name == source_env.name]
        if same_name_candidates:
            return CondaEnvMigrationPlan(
                target_machine_id=target_machine_id,
                source_env=source_env,
                action="name_conflict",
                reason="same_name_different_fingerprint",
                message="目标机器存在同名但 fingerprint 不一致的环境，不能按名字直接复用",
                reuse_env=None,
                conflicts=same_name_candidates,
            )

        return CondaEnvMigrationPlan(
            target_machine_id=target_machine_id,
            source_env=source_env,
            action="clone_or_rebuild",
            reason="target_missing",
            message="目标机器没有可直接复用的环境，应走 conda-pack 或 env.yaml 重建",
            reuse_env=None,
            conflicts=[],
        )

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
                self._apply_fingerprint_payload(
                    env,
                    await self._call_inspect_conda_env(machine, path),
                )
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
            changed = self._apply_fingerprint_payload(
                env,
                await self._call_inspect_conda_env(machine, path),
            ) or changed
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

    async def _call_inspect_conda_env(self, machine: Machine, path: str) -> dict:
        result = self._inspect_conda_env(machine, path)
        if inspect.isawaitable(result):
            return await result
        return result

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

    async def _inspect_conda_env(self, machine: Machine, path: str) -> dict:
        normalized_path = path.strip()
        if not normalized_path:
            return {
                "status": "name_only",
                "package_count": None,
                "key_packages": {},
                "fingerprint_hash": None,
                "python_version": None,
                "python_path": None,
            }

        conda_executable = await self._find_conda_executable(machine)
        if not conda_executable:
            return {
                "status": "conda_unavailable",
                "package_count": None,
                "key_packages": {},
                "fingerprint_hash": None,
                "python_version": None,
                "python_path": None,
                "error": "conda executable not found",
            }

        try:
            stdout, _ = await self._run_machine_command(
                machine,
                f"{shlex.quote(conda_executable)} list --json -p {shlex.quote(normalized_path)}",
            )
            packages = json.loads(stdout.strip()) if stdout.strip() else []
        except Exception as exc:
            return {
                "status": "inspect_failed",
                "package_count": None,
                "key_packages": {},
                "fingerprint_hash": None,
                "python_version": None,
                "python_path": None,
                "error": str(exc),
            }

        normalized_packages = [
            {
                "name": str(pkg.get("name") or ""),
                "version": str(pkg.get("version") or ""),
                "build_string": str(pkg.get("build_string") or pkg.get("build") or ""),
                "channel": str(pkg.get("channel") or ""),
            }
            for pkg in packages
            if pkg.get("name")
        ]
        normalized_packages.sort(key=lambda item: (item["name"], item["version"], item["build_string"], item["channel"]))
        key_package_names = [
            "python",
            "pytorch",
            "torch",
            "pytorch-cuda",
            "cudatoolkit",
            "cuda",
            "numpy",
            "pandas",
        ]
        package_lookup = {item["name"]: item["version"] for item in normalized_packages}
        key_packages = {
            name: package_lookup[name]
            for name in key_package_names
            if name in package_lookup
        }
        python_version = package_lookup.get("python")
        fingerprint_hash = hashlib.sha256(
            json.dumps(
                {
                    "python_version": python_version,
                    "packages": normalized_packages,
                },
                sort_keys=True,
                ensure_ascii=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        return {
            "status": "ready",
            "package_count": len(normalized_packages),
            "key_packages": key_packages,
            "fingerprint_hash": fingerprint_hash,
            "python_version": python_version,
            "python_path": self._infer_python_path(normalized_path),
        }

    async def _find_conda_executable(self, machine: Machine) -> str | None:
        cmd = r'''set -eu
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
      command -v "$candidate"
      exit 0
    fi
  elif [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done
exit 0'''
        stdout, _ = await self._run_machine_command(machine, cmd, tolerate_error=True)
        resolved = stdout.strip().splitlines()
        return resolved[0].strip() if resolved else None

    async def _run_machine_command(
        self,
        machine: Machine,
        command: str,
        *,
        tolerate_error: bool = False,
    ) -> tuple[str, str]:
        if machine.is_local:
            proc = await asyncio.create_subprocess_exec(
                "bash",
                "-lc",
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            stdout_text = stdout.decode("utf-8", errors="replace")
            stderr_text = stderr.decode("utf-8", errors="replace")
            if proc.returncode != 0 and not tolerate_error:
                raise RuntimeError(stderr_text or f"命令执行失败: {command}")
            return stdout_text, stderr_text

        self._ensure_remote_connection(machine)
        try:
            stdout, stderr = await asyncio.get_running_loop().run_in_executor(
                None,
                ssh_manager.exec_command,
                machine.id,
                f"bash -lc {shlex.quote(command)}",
            )
        except Exception as exc:
            if tolerate_error:
                return "", str(exc)
            raise RuntimeError(f"远程命令执行失败: {exc}") from exc
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

    async def _find_binding_hint(
        self,
        db: AsyncSession,
        machine_id: int,
        work_dir: str | None,
    ) -> RuntimeEnvBindingHint | None:
        normalized_work_dir = self._normalize_work_dir(work_dir)
        if not normalized_work_dir:
            return None

        result = await db.execute(
            select(RuntimeEnvBindingHint)
            .where(RuntimeEnvBindingHint.machine_id == machine_id)
            .order_by(RuntimeEnvBindingHint.priority.desc(), RuntimeEnvBindingHint.updated_at.desc())
        )
        candidates = list(result.scalars().all())
        best_hint: RuntimeEnvBindingHint | None = None
        best_key = (-1, -1, datetime.min)
        for hint in candidates:
            if not self._matches_work_dir_pattern(normalized_work_dir, hint.work_dir_pattern):
                continue
            current_key = (
                len(hint.work_dir_pattern),
                hint.priority,
                hint.last_used_at or hint.updated_at or hint.created_at,
            )
            if current_key > best_key:
                best_hint = hint
                best_key = current_key
        return best_hint

    def _apply_fingerprint_payload(self, env: CondaEnv, payload: dict) -> bool:
        next_status = payload.get("status") if payload else None
        next_info = {
            "status": next_status,
            "package_count": payload.get("package_count"),
            "key_packages": payload.get("key_packages") or {},
        } if payload else None
        if payload and payload.get("error"):
            next_info["error"] = payload["error"]

        changed = False
        next_values = {
            "python_version": payload.get("python_version") if payload else None,
            "python_path": payload.get("python_path") if payload else None,
            "fingerprint_hash": payload.get("fingerprint_hash") if payload else None,
            "package_count": payload.get("package_count") if payload else None,
            "fingerprint_info": next_info,
        }
        for field, value in next_values.items():
            if getattr(env, field) != value:
                setattr(env, field, value)
                changed = True
        return changed

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

    @staticmethod
    def _infer_python_path(path: str) -> str:
        return os.path.join(path.rstrip("/"), "bin", "python")

    @staticmethod
    def _normalize_work_dir(path: str | None) -> str | None:
        if not path:
            return None
        normalized = os.path.normpath(path.strip())
        return normalized if normalized and normalized != "." else None

    @staticmethod
    def _matches_work_dir_pattern(work_dir: str, pattern: str) -> bool:
        normalized_pattern = os.path.normpath(pattern)
        return work_dir == normalized_pattern or work_dir.startswith(normalized_pattern + os.sep)


runtime_env_service = RuntimeEnvService()