"""
任务调度器

负责：
- 定时轮询各流水线的待运行任务
- 评估 GPU 抢卡条件
- 启动满足条件的任务（本地用 asyncio subprocess，远程用 nohup SSH）
- 监控运行中任务的状态
- 任务完成后收集日志、更新状态
"""
import asyncio
import logging
import os
import shlex
import signal
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import select, update

from config import LOGS_DIR, REMOTE_LOGS_BASE, SCHEDULER_INTERVAL, MONITOR_OFFLINE_THRESHOLD_MINUTES
from database import AsyncSessionLocal
from models.task import Task, TaskStatus, Pipeline, CondaEnv
from models.machine import Machine
from services.gpu_condition import evaluate_gpu_condition
from services.resource_monitor import resource_monitor
from services.ssh_manager import ssh_manager

logger = logging.getLogger(__name__)


def _build_command(config: dict, conda_path: str | None, conda_name: str | None, gpu_ids: list[int]) -> str:
    """
    根据任务 config 构建 shell 命令字符串。
    config keys: work_dir, command, args, env_vars, conda_env_id
    conda 激活策略：
      - conda_path 非空：设置 PATH={conda_path}/bin:$PATH（直接指定环境目录）
      - conda_path 为空且 conda_name 非空：使用 conda run -n <name>（不依赖 shell init）
    """
    parts: list[str] = []

    # CUDA_VISIBLE_DEVICES
    if gpu_ids:
        parts.append(f"CUDA_VISIBLE_DEVICES={','.join(str(g) for g in gpu_ids)}")

    # 用户自定义环境变量（inline export）
    for k, v in (config.get("env_vars") or {}).items():
        parts.append(f"{shlex.quote(k)}={shlex.quote(str(v))}")

    # conda 激活（使用环境目录 PATH 方式）
    if conda_path:
        parts.append(f"PATH={shlex.quote(conda_path + '/bin')}:$PATH")

    # 环境变量前缀和 cd 合并为一个 sh -c
    cmd = config.get("command", "").strip()
    if not cmd:
        raise ValueError("命令不能为空")

    arg_parts: list[str] = []
    for arg in (config.get("args") or []):
        name = str(arg.get("name", "")).strip()
        value = str(arg.get("value", "")).strip()
        if name:
            arg_parts.append(name)  # 参数名（如 --lr）通常无需 quote
        if value:
            arg_parts.append(shlex.quote(value))  # 参数值可能含空格或特殊字符，需 quote

    full_cmd = cmd
    if arg_parts:
        full_cmd = cmd + " " + " ".join(arg_parts)

    env_prefix = " ".join(parts)

    # conda run -n <name>：未指定路径时使用，将完整命令包裹在 bash -c 中
    if not conda_path and conda_name:
        inner = f"{env_prefix} {full_cmd}" if env_prefix else full_cmd
        return f"conda run -n {shlex.quote(conda_name)} bash -c {shlex.quote(inner)}"

    if env_prefix:
        return f"{env_prefix} {full_cmd}"
    return full_cmd


class TaskScheduler:
    """任务调度器（全局单例）"""

    def __init__(self):
        self._loop_task: asyncio.Task | None = None
        # task_id -> asyncio.Task（正在运行的任务协程）
        self._running: dict[int, asyncio.Task] = {}
        # task_id -> subprocess 对象，消除本地进程 pid 写 DB 前的竞争窗口
        self._local_procs: dict = {}

    async def startup_recovery(self) -> None:
        """服务启动时，将遗留的 RUNNING 状态任务标记为 FAILED（服务重启恢复）"""
        async with AsyncSessionLocal() as db:
            # 先尝试终止本地遗留进程，避免孤立进程继续占用 GPU
            running_result = await db.execute(
                select(Task).where(
                    Task.status == TaskStatus.RUNNING,
                    Task.pid.isnot(None),
                )
            )
            for t in running_result.scalars().all():
                machine = await db.get(Machine, t.machine_id) if t.machine_id else None
                if machine and machine.is_local and t.pid:
                    try:
                        os.kill(t.pid, signal.SIGTERM)
                        logger.info(f"[Scheduler] 已向遗留本地进程 PID {t.pid}（任务 {t.id}）发送 SIGTERM")
                    except (ProcessLookupError, OSError):
                        pass
            await db.execute(
                update(Task)
                .where(Task.status == TaskStatus.RUNNING)
                .values(
                    status=TaskStatus.FAILED,
                    finished_at=datetime.utcnow(),
                    meta={"error": "服务重启，运行被中断"},
                )
            )
            await db.commit()
        logger.info("[Scheduler] 启动恢复：已将残留 RUNNING 任务标记为 FAILED")

    def start(self) -> None:
        if self._loop_task and not self._loop_task.done():
            return
        self._loop_task = asyncio.create_task(self._main_loop())
        logger.info("[Scheduler] 调度器已启动")

    def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
        for t in self._running.values():
            t.cancel()
        logger.info("[Scheduler] 调度器已停止")

    async def _main_loop(self) -> None:
        while True:
            try:
                await self._tick()
            except Exception as e:
                logger.error(f"[Scheduler] tick 异常: {e}", exc_info=True)
            await asyncio.sleep(SCHEDULER_INTERVAL)

    async def _tick(self) -> None:
        """每轮调度的核心逻辑"""
        # 清理已完成的 asyncio 任务引用
        done_ids = [tid for tid, t in self._running.items() if t.done()]
        for tid in done_ids:
            del self._running[tid]

        async with AsyncSessionLocal() as db:
            # ── 流水线任务（各流水线串行，互不阻塞） ─────────────────────────────
            pipelines_result = await db.execute(
                select(Pipeline).order_by(Pipeline.sort_order)
            )
            for pipeline in pipelines_result.scalars().all():
                # 流水线串行：已有运行中任务则跳过本流水线
                running_result = await db.execute(
                    select(Task).where(
                        Task.pipeline_id == pipeline.id,
                        Task.status == TaskStatus.RUNNING,
                    ).limit(1)
                )
                if running_result.scalars().first() is not None:
                    continue

                # 取流水线第一个 WAITING 任务尝试启动
                waiting_result = await db.execute(
                    select(Task).where(
                        Task.pipeline_id == pipeline.id,
                        Task.status == TaskStatus.WAITING,
                    ).order_by(Task.sort_order).limit(1)
                )
                task = waiting_result.scalar_one_or_none()
                if task is not None:
                    await self._try_start_task(task, db)

            # ── 无流水线（游离）任务，各自独立调度互不阻塞 ─────────────────────
            orphan_result = await db.execute(
                select(Task).where(
                    Task.pipeline_id.is_(None),
                    Task.status == TaskStatus.WAITING,
                ).order_by(Task.created_at, Task.id)
            )
            for task in orphan_result.scalars().all():
                await self._try_start_task(task, db)

    async def _try_start_task(self, task: "Task", db) -> bool:
        """
        检查机器/GPU 条件，满足时启动任务。
        返回 True：已处理（启动 或 FAILED）；False：条件未满足，等下轮。
        """
        if task.id in self._running:
            return False

        # 检查运行机器
        if task.machine_id is None:
            logger.error(f"[Scheduler] 任务 {task.id} 未指定运行机器，标记为失败")
            await db.execute(
                update(Task).where(Task.id == task.id).values(
                    status=TaskStatus.FAILED,
                    finished_at=datetime.utcnow(),
                    meta={"error": "未指定运行机器"},
                )
            )
            await db.commit()
            return True

        machine = await db.get(Machine, task.machine_id)
        if machine is None:
            logger.error(f"[Scheduler] 任务 {task.id} 的机器 {task.machine_id} 不存在，标记为失败")
            await db.execute(
                update(Task).where(Task.id == task.id).values(
                    status=TaskStatus.FAILED,
                    finished_at=datetime.utcnow(),
                    meta={"error": "指定的机器不存在"},
                )
            )
            await db.commit()
            return True

        # 检查 GPU 抢卡条件
        gpu_condition = task.gpu_condition or {}
        gpu_ids: list[int] = []
        if gpu_condition:
            idle_minutes = float(gpu_condition.get("idle_minutes", 1.0))
            mode = gpu_condition.get("mode", "force")
            if mode == "smart":
                # smart 模式：长时间无监控数据则认为机器已离线，标记失败避免永久等待
                last_snap = resource_monitor.get_last_snapshot_time(task.machine_id)
                if last_snap is not None:
                    offline_threshold = timedelta(minutes=MONITOR_OFFLINE_THRESHOLD_MINUTES)
                    if datetime.utcnow() - last_snap > offline_threshold:
                        logger.warning(
                            f"[Scheduler] 任务 {task.id} 机器 {task.machine_id} 已超 "
                            f"{MONITOR_OFFLINE_THRESHOLD_MINUTES} 分钟无监控数据，标记失败"
                        )
                        await db.execute(
                            update(Task).where(Task.id == task.id).values(
                                status=TaskStatus.FAILED,
                                finished_at=datetime.utcnow(),
                                meta={"error": f"机器长时间无监控数据（>{MONITOR_OFFLINE_THRESHOLD_MINUTES}分钟），可能已离线"},
                            )
                        )
                        await db.commit()
                        return True
            history = resource_monitor.get_history(task.machine_id, idle_minutes + 1)
            gpu_ids_result = evaluate_gpu_condition(gpu_condition, history)
            if gpu_ids_result is None:
                return False  # GPU 条件未满足，等待下轮
            gpu_ids = gpu_ids_result

        # 获取 conda 环境信息
        conda_path: str | None = None
        conda_name: str | None = None
        conda_env_id = (task.config or {}).get("conda_env_id")
        if conda_env_id:
            conda_env = await db.get(CondaEnv, conda_env_id)
            if conda_env:
                conda_name = conda_env.name
                conda_path = conda_env.path or None  # 空字符串转为 None

        # 更新任务状态为 RUNNING
        await db.execute(
            update(Task).where(Task.id == task.id).values(
                status=TaskStatus.RUNNING,
                started_at=datetime.utcnow(),
                assigned_gpu_ids=gpu_ids,
            )
        )
        await db.commit()

        # 异步启动任务
        coro = self._run_task(task.id, machine.is_local, machine.id,
                              task.config or {}, conda_path, conda_name, gpu_ids)
        self._running[task.id] = asyncio.create_task(coro)
        return True

    async def _run_task(
        self,
        task_id: int,
        is_local: bool,
        machine_id: int,
        config: dict,
        conda_path: str | None,
        conda_name: str | None,
        gpu_ids: list[int],
    ) -> None:
        """执行单个任务并在完成后更新数据库状态"""
        log_dir = LOGS_DIR / str(task_id)
        log_dir.mkdir(parents=True, exist_ok=True)
        # 本地文件操作使用绝对路径
        stdout_abs = str(log_dir / "stdout.txt")
        stderr_abs = str(log_dir / "stderr.txt")
        # 入库使用相对于 LOGS_DIR 的相对路径，避免迁移数据目录后路径失效
        stdout_rel = f"{task_id}/stdout.txt"
        stderr_rel = f"{task_id}/stderr.txt"

        exit_code = -1
        error_msg: str | None = None

        try:
            cmd_str = _build_command(config, conda_path, conda_name, gpu_ids)
            work_dir = (config.get("work_dir") or "").strip() or None

            if is_local:
                exit_code = await self._exec_local(task_id, cmd_str, work_dir, stdout_abs, stderr_abs)
            else:
                exit_code = await self._exec_remote(
                    task_id, machine_id, cmd_str, work_dir,
                    stdout_abs, stderr_abs
                )

            status = TaskStatus.COMPLETED if exit_code == 0 else TaskStatus.FAILED

        except asyncio.CancelledError:
            status = TaskStatus.CANCELLED
            error_msg = "任务被取消"
            exit_code = -2
        except Exception as e:
            status = TaskStatus.FAILED
            error_msg = str(e)
            logger.error(f"[Scheduler] 任务 {task_id} 运行异常: {e}", exc_info=True)
            try:
                with open(stderr_abs, "a") as f:
                    f.write(f"\n[调度器错误] {e}\n")
            except Exception:
                pass

        async with AsyncSessionLocal() as db:
            updates: dict = {
                "status": status,
                "finished_at": datetime.utcnow(),
                "stdout_path": stdout_rel,
                "stderr_path": stderr_rel,
                "exit_code": exit_code,
            }
            if error_msg:
                updates["meta"] = {"error": error_msg}
            await db.execute(update(Task).where(Task.id == task_id).values(**updates))
            await db.commit()

        logger.info(f"[Scheduler] 任务 {task_id} 完成，状态={status.value} exit_code={exit_code}")

    async def _exec_local(
        self, task_id: int, cmd_str: str, work_dir: str | None,
        stdout_path: str, stderr_path: str
    ) -> int:
        """本地执行命令，重定向输出到文件，返回 exit_code"""
        with open(stdout_path, "w") as fout, open(stderr_path, "w") as ferr:
            proc = await asyncio.create_subprocess_shell(
                cmd_str,
                cwd=work_dir,
                stdout=fout,
                stderr=ferr,
            )
            # 立即存储 proc 引用，确保 cancel_task 在 pid 写 DB 前也能安全终止
            self._local_procs[task_id] = proc
            try:
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(Task).where(Task.id == task_id).values(pid=proc.pid)
                    )
                    await db.commit()
                return await proc.wait()
            finally:
                self._local_procs.pop(task_id, None)

    async def _exec_remote(
        self, task_id: int, machine_id: int, cmd_str: str,
        work_dir: str | None, stdout_path: str, stderr_path: str
    ) -> int:
        """
        远端执行命令（nohup 方式）：
        1. 通过 SSH 在远端用 nohup 启动命令，获取远端 PID
        2. 定期检查远端进程状态
        3. 完成后收集日志到本地
        """
        remote_dir = f"{REMOTE_LOGS_BASE}/{task_id}"
        remote_stdout = f"{remote_dir}/stdout"
        remote_stderr = f"{remote_dir}/stderr"
        remote_exitcode = f"{remote_dir}/exitcode"

        # 构建远端 nohup 启动命令
        cd_part = f"cd {shlex.quote(work_dir)} && " if work_dir else ""
        launch = (
            f"mkdir -p {remote_dir} && "
            f"nohup sh -c '{cd_part}{cmd_str.replace(chr(39), chr(39)+chr(92)+chr(39)+chr(39))}"
            f" > {remote_stdout} 2> {remote_stderr}; echo $? > {remote_exitcode}'"
            f" > /dev/null 2>&1 </dev/null & echo $!"
        )

        try:
            out, err = await asyncio.get_running_loop().run_in_executor(
                None, ssh_manager.exec_command, machine_id, launch
            )
            remote_pid = int(out.strip())
        except Exception as e:
            raise RuntimeError(f"远端启动失败: {e}") from e

        # 记录远端 PID
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(Task).where(Task.id == task_id)
                .values(pid=remote_pid, meta={
                    "remote_pid": remote_pid,
                    "remote_stdout": remote_stdout,
                    "remote_stderr": remote_stderr,
                })
            )
            await db.commit()

        # 轮询远端进程状态
        check_cmd = (
            f"if [ -f {remote_exitcode} ]; then "
            f"echo done:$(cat {remote_exitcode}); "
            f"elif kill -0 {remote_pid} 2>/dev/null; then "
            f"echo running; else echo dead:-1; fi"
        )
        exit_code = -1
        _consecutive_failures = 0
        _MAX_FAILURES = 5
        try:
            while True:
                await asyncio.sleep(SCHEDULER_INTERVAL)
                try:
                    status_out, _ = await asyncio.get_running_loop().run_in_executor(
                        None, ssh_manager.exec_command, machine_id, check_cmd
                    )
                    _consecutive_failures = 0  # SSH 成功，重置计数器
                    status_out = status_out.strip()
                    if status_out.startswith("done:"):
                        try:
                            exit_code = int(status_out.split(":", 1)[1])
                        except ValueError:
                            exit_code = 0
                        break
                    elif status_out == "dead:-1" or status_out.startswith("dead"):
                        exit_code = -1
                        break
                except asyncio.CancelledError:
                    raise  # 取消信号必须向上传播
                except Exception as e:
                    _consecutive_failures += 1
                    logger.warning(
                        f"[Scheduler] 检查远端任务 {task_id} 状态失败 "
                        f"({_consecutive_failures}/{_MAX_FAILURES}): {e}"
                    )
                    if _consecutive_failures >= _MAX_FAILURES:
                        logger.error(
                            f"[Scheduler] 远端任务 {task_id} 连续 {_MAX_FAILURES} 次检查失败，放弃"
                        )
                        exit_code = -1
                        break
        except asyncio.CancelledError:
            # 取消时尝试回收远端日志，再重新抛出
            logger.info(f"[Scheduler] 远端任务 {task_id} 被取消，尝试回收日志")
            try:
                loop = asyncio.get_running_loop()
                so, _ = await loop.run_in_executor(
                    None, ssh_manager.exec_command, machine_id, f"cat {remote_stdout} 2>/dev/null"
                )
                se, _ = await loop.run_in_executor(
                    None, ssh_manager.exec_command, machine_id, f"cat {remote_stderr} 2>/dev/null"
                )
                with open(stdout_path, "w") as f:
                    f.write(so)
                with open(stderr_path, "w") as f:
                    f.write(se)
                await loop.run_in_executor(
                    None, ssh_manager.exec_command, machine_id, f"rm -rf {remote_dir}"
                )
            except Exception as collect_err:
                logger.warning(f"[Scheduler] 回收远端任务 {task_id} 日志失败: {collect_err}")
            raise

        # 收集远端日志到本地
        try:
            loop = asyncio.get_running_loop()
            stdout_out, _ = await loop.run_in_executor(
                None, ssh_manager.exec_command, machine_id, f"cat {remote_stdout} 2>/dev/null"
            )
            stderr_out, _ = await loop.run_in_executor(
                None, ssh_manager.exec_command, machine_id, f"cat {remote_stderr} 2>/dev/null"
            )
            with open(stdout_path, "w") as f:
                f.write(stdout_out)
            with open(stderr_path, "w") as f:
                f.write(stderr_out)
            # 清理远端临时文件
            await loop.run_in_executor(
                None, ssh_manager.exec_command, machine_id, f"rm -rf {remote_dir}"
            )
        except Exception as e:
            logger.warning(f"[Scheduler] 收集远端日志失败: {e}")

        return exit_code

    async def cancel_task(self, task_id: int) -> bool:
        """取消一个等待中或运行中的任务"""
        # 如果有运行中的 asyncio 任务，取消它
        if task_id in self._running:
            self._running[task_id].cancel()

        async with AsyncSessionLocal() as db:
            task = await db.get(Task, task_id)
            if task is None:
                return False
            if task.status not in (TaskStatus.WAITING, TaskStatus.RUNNING):
                return False

            if task.status == TaskStatus.RUNNING:
                # 尝试终止进程（远端 SSH kill 或本地 SIGTERM）
                meta = task.meta or {}
                remote_pid = meta.get("remote_pid")
                remote_dir = f"{REMOTE_LOGS_BASE}/{task_id}"
                if remote_pid:
                    try:
                        kill_cmd = (
                            f"kill -15 {remote_pid} 2>/dev/null; "
                            f"sleep 1; kill -9 {remote_pid} 2>/dev/null; true"
                        )
                        await asyncio.get_running_loop().run_in_executor(
                            None, ssh_manager.exec_command, task.machine_id, kill_cmd
                        )
                        logger.info(f"[Scheduler] 已发送 kill 到远端 PID {remote_pid}（任务 {task_id}）")
                    except Exception as e:
                        logger.warning(f"[Scheduler] 终止远端进程失败（任务 {task_id}）: {e}")
                else:
                    # 优先从 _local_procs 取引用，避免 pid 尚未写 DB 时的竞态
                    local_proc = self._local_procs.get(task_id)
                    if local_proc:
                        try:
                            local_proc.terminate()
                        except ProcessLookupError:
                            pass
                        except Exception as e:
                            logger.warning(f"[Scheduler] terminate 本地进程失败（任务 {task_id}）: {e}")
                    elif task.pid:
                        try:
                            import signal, os as _os
                            _os.kill(task.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        except Exception as e:
                            logger.warning(f"[Scheduler] 终止本地进程失败（任务 {task_id}）: {e}")
                # RUNNING 任务状态由 _run_task 的异常处理负责落库，此处不重复写入
                return True

            # WAITING 任务：尚未启动 asyncio task，直接更新状态
            task.status = TaskStatus.CANCELLED
            task.finished_at = datetime.utcnow()
            await db.commit()
            return True


# 全局单例
task_scheduler = TaskScheduler()
