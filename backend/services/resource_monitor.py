"""
资源监控服务：获取本地/远程机器的 CPU、内存、GPU 信息

采集策略：
- 只传输"算力指标"：CPU 利用率、内存用量/总量、每张 GPU 的利用率/显存/功耗。
- 不遍历全量系统进程；仅对 GPU 上各运行进程的 PID 做单独查询以获取其系统信息。
- 本地：psutil + pynvml
- 远程：SSH 执行内嵌 Python 脚本（pynvml 优先；无 pynvml 时回退 nvidia-smi）
"""
import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timedelta
from typing import Optional

import psutil

from config import DEFAULT_MONITOR_INTERVAL, MONITOR_HISTORY_RETAIN_MINUTES
from schemas.monitor import ResourceSnapshot, GpuInfo, GpuProcess
from services.ssh_manager import ssh_manager

logger = logging.getLogger(__name__)

# 本地 CPU 采样是否已完成首次预热（interval=None 模式需要先 prime 计数器基线）
_local_cpu_primed: bool = False

# ── 远程内嵌采集脚本 ─────────────────────────────────────────────────────────
# 只采集：CPU%、内存、GPU 算力指标、GPU 进程（含对应 PID 的系统信息）
# pynvml 优先；不可用时回退到 nvidia-smi。
_REMOTE_COLLECT_SCRIPT = r"""python3 -c "
import json, subprocess, os
result = {}

# ── CPU & 内存 ──────────────────────────────────────────────────────────────
try:
    import psutil as _p
    _p.cpu_percent(interval=None)            # 触发计数器基线（非阻塞）
    import time as _t; _t.sleep(0.2)         # 让内核积累 200ms 差值窗口
    result['cpu_percent'] = _p.cpu_percent(interval=None)
    result['cpu_count']   = _p.cpu_count(logical=True)
    vm = _p.virtual_memory()
    result['memory_used_mb']  = vm.used  / 1048576
    result['memory_total_mb'] = vm.total / 1048576
except Exception as e:
    result.update({'error': str(e), 'cpu_percent': 0,
                   'memory_used_mb': 0, 'memory_total_mb': 0})

# CPU 名称（Linux）
try:
    with open('/proc/cpuinfo') as _f:
        for _l in _f:
            if _l.startswith('model name'):
                result['cpu_name'] = _l.split(':', 1)[1].strip()
                break
except Exception:
    pass

# ── GPU 进程详情辅助（按 PID 查询）────────────────────────────────────────
def _proc_info(pid):
    try:
        import psutil as _p
        p = _p.Process(pid)
        return {
            'username':    p.username(),
            'cmdline':     ' '.join(p.cmdline())[:300],
            'cpu_percent': p.cpu_percent(),
            'memory_mb':   p.memory_info().rss / 1048576,
            'name':        p.name(),
        }
    except Exception:
        return {'username': None, 'cmdline': None, 'cpu_percent': 0.0, 'memory_mb': 0.0, 'name': ''}

# ── GPU（pynvml 优先）──────────────────────────────────────────────────────
gpus = []
try:
    import pynvml as n
    n.nvmlInit()
    for i in range(n.nvmlDeviceGetCount()):
        h   = n.nvmlDeviceGetHandleByIndex(i)
        u   = n.nvmlDeviceGetUtilizationRates(h)
        mem = n.nvmlDeviceGetMemoryInfo(h)
        raw = n.nvmlDeviceGetName(h)
        gname = raw.decode() if isinstance(raw, bytes) else raw
        try:    pwr_d = n.nvmlDeviceGetPowerUsage(h) / 1000
        except: pwr_d = None
        try:    pwr_l = n.nvmlDeviceGetPowerManagementLimit(h) / 1000
        except: pwr_l = None
        try:    temp  = float(n.nvmlDeviceGetTemperature(h, 0))
        except: temp  = None
        gprocs = []
        try:
            for gp in n.nvmlDeviceGetComputeRunningProcesses(h):
                info = _proc_info(gp.pid)
                gprocs.append({'pid': gp.pid,
                                'used_memory_mb': gp.usedGpuMemory / 1048576,
                                **info})
        except Exception:
            pass
        gpus.append({'index': i, 'name': gname,
                     'utilization': float(u.gpu),
                     'memory_used_mb': mem.used/1048576, 'memory_total_mb': mem.total/1048576,
                     'power_draw_w': pwr_d, 'power_limit_w': pwr_l, 'temperature_c': temp,
                     'processes': gprocs})
    result['gpus'] = gpus
except Exception:
    # ── 回退：nvidia-smi ────────────────────────────────────────────────────
    try:
        # 第 1 次调用：含 gpu_bus_id，消除原先的第 3 次独立 bus-map 查询
        fields = 'index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu,gpu_bus_id'
        raw = subprocess.check_output(
            ['nvidia-smi', '--query-gpu=' + fields, '--format=csv,noheader,nounits'],
            timeout=10, stderr=subprocess.DEVNULL).decode()
        def _f(v):
            try: return float(v)
            except: return None
        bus_map = {}
        for line in raw.strip().splitlines():
            p = [x.strip() for x in line.split(',')]
            bus_id = p[8].lower() if len(p) > 8 else ''
            g = {'index': int(p[0]), 'name': p[1],
                 'utilization': _f(p[2]) or 0, 'memory_used_mb': _f(p[3]) or 0,
                 'memory_total_mb': _f(p[4]) or 0, 'power_draw_w': _f(p[5]),
                 'power_limit_w': _f(p[6]), 'temperature_c': _f(p[7]),
                 'processes': []}
            if bus_id:
                bus_map[bus_id] = g
            gpus.append(g)
        # 第 2 次调用：GPU 进程（bus_id 已由第 1 次查询内联获得）
        try:
            pr = subprocess.check_output(
                ['nvidia-smi', '--query-compute-apps=gpu_bus_id,pid,used_memory',
                 '--format=csv,noheader,nounits'], timeout=10,
                stderr=subprocess.DEVNULL).decode()
            for pl in pr.strip().splitlines():
                pp = [x.strip() for x in pl.split(',')]
                if len(pp) < 3: continue
                g = bus_map.get(pp[0].lower())
                if g is None: continue
                pid = int(pp[1])
                used = _f(pp[2]) or 0
                info = _proc_info(pid)
                g['processes'].append({'pid': pid, 'used_memory_mb': used, **info})
        except Exception:
            pass
        result['gpus'] = gpus
    except Exception:
        result['gpus'] = []

print(json.dumps(result))
" 2>/dev/null
"""


# ── 按 PID 单独查询系统进程信息 ───────────────────────────────────────────────

def _query_pid(pid: int) -> dict:
    """对单个 PID 做 psutil 查询，不涉及全量遍历"""
    try:
        proc = psutil.Process(pid)
        return {
            "name": proc.name(),
            "username": proc.username(),
            "cmdline": " ".join(proc.cmdline())[:300],
            "cpu_percent": proc.cpu_percent(),
            "memory_mb": proc.memory_info().rss / 1048576,
        }
    except Exception:
        return {"name": "", "username": None, "cmdline": None,
                "cpu_percent": 0.0, "memory_mb": 0.0}


def _collect_local() -> dict:
    """采集本地资源——只采集算力指标和 GPU 进程"""
    result: dict = {}

    # CPU
    global _local_cpu_primed
    if _local_cpu_primed:
        result["cpu_percent"] = psutil.cpu_percent(interval=None)
    else:
        # 首次调用：触发计数器基线，短暂 sleep 后可得到有效差值
        psutil.cpu_percent(interval=None)
        import time as _time; _time.sleep(0.2)
        result["cpu_percent"] = psutil.cpu_percent(interval=None)
        _local_cpu_primed = True
    result["cpu_count"] = psutil.cpu_count(logical=True)
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    result["cpu_name"] = line.split(":", 1)[1].strip()
                    break
    except Exception:
        result["cpu_name"] = None

    # 内存
    vm = psutil.virtual_memory()
    result["memory_used_mb"] = vm.used / 1048576
    result["memory_total_mb"] = vm.total / 1048576

    # GPU（pynvml 优先）
    gpus = []
    try:
        import pynvml  # type: ignore
        pynvml.nvmlInit()
        for i in range(pynvml.nvmlDeviceGetCount()):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            raw_name = pynvml.nvmlDeviceGetName(h)
            name = raw_name.decode() if isinstance(raw_name, bytes) else raw_name
            try:
                pwr_draw: float | None = pynvml.nvmlDeviceGetPowerUsage(h) / 1000
            except Exception:
                pwr_draw = None
            try:
                pwr_lim: float | None = pynvml.nvmlDeviceGetPowerManagementLimit(h) / 1000
            except Exception:
                pwr_lim = None
            try:
                temp: float | None = float(pynvml.nvmlDeviceGetTemperature(h, 0))
            except Exception:
                temp = None

            # GPU 进程：pynvml 获取 PID + 显存，psutil 单独查询系统信息
            gprocs = []
            try:
                for gp in pynvml.nvmlDeviceGetComputeRunningProcesses(h):
                    info = _query_pid(gp.pid)
                    gprocs.append({
                        "pid": gp.pid,
                        "used_memory_mb": gp.usedGpuMemory / 1048576,
                        **info,
                    })
            except Exception:
                pass

            gpus.append({
                "index": i,
                "name": name,
                "utilization": float(util.gpu),
                "memory_used_mb": mem.used / 1048576,
                "memory_total_mb": mem.total / 1048576,
                "power_draw_w": pwr_draw,
                "power_limit_w": pwr_lim,
                "temperature_c": temp,
                "processes": gprocs,
            })
    except ImportError:
        # 无 pynvml：尝试 nvidia-smi
        import subprocess
        try:
            # 第 1 次调用：含 gpu_bus_id，内联获取 bus-map，无需第 3 次独立查询
            fields = "index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu,gpu_bus_id"
            raw = subprocess.check_output(
                ["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
                timeout=10, stderr=subprocess.DEVNULL,
            ).decode()
            def _f(v: str) -> float | None:
                try: return float(v)
                except: return None
            bus_map: dict[str, dict] = {}
            for line in raw.strip().splitlines():
                parts = [x.strip() for x in line.split(",")]
                bus_id = parts[8].lower() if len(parts) > 8 else ""
                g: dict = {
                    "index": int(parts[0]), "name": parts[1],
                    "utilization": _f(parts[2]) or 0,
                    "memory_used_mb": _f(parts[3]) or 0,
                    "memory_total_mb": _f(parts[4]) or 0,
                    "power_draw_w": _f(parts[5]),
                    "power_limit_w": _f(parts[6]),
                    "temperature_c": _f(parts[7]),
                    "processes": [],
                }
                if bus_id:
                    bus_map[bus_id] = g
                gpus.append(g)
            # 第 2 次调用：GPU 进程（bus_id 已由首次查询获得）
            try:
                pr = subprocess.check_output(
                    ["nvidia-smi", "--query-compute-apps=gpu_bus_id,pid,used_memory",
                     "--format=csv,noheader,nounits"],
                    timeout=10, stderr=subprocess.DEVNULL,
                ).decode()
                for pl in pr.strip().splitlines():
                    pp = [x.strip() for x in pl.split(",")]
                    if len(pp) < 3:
                        continue
                    g = bus_map.get(pp[0].lower())
                    if g is None:
                        continue
                    pid = int(pp[1])
                    used = _f(pp[2]) or 0.0
                    info = _query_pid(pid)
                    g["processes"].append({"pid": pid, "used_memory_mb": used, **info})
            except Exception:
                pass
        except Exception:
            pass
    except Exception:
        pass

    result["gpus"] = gpus
    return result


def _parse_snapshot(machine_id: int, data: dict) -> ResourceSnapshot:
    gpus = [GpuInfo(
        index=g["index"],
        name=g.get("name", ""),
        utilization=g.get("utilization", 0),
        memory_used_mb=g.get("memory_used_mb", 0),
        memory_total_mb=g.get("memory_total_mb", 0),
        power_draw_w=g.get("power_draw_w"),
        power_limit_w=g.get("power_limit_w"),
        temperature_c=g.get("temperature_c"),
        processes=[GpuProcess(**p) for p in g.get("processes", [])],
    ) for g in data.get("gpus", [])]

    return ResourceSnapshot(
        machine_id=machine_id,
        timestamp=datetime.utcnow(),
        cpu_percent=data.get("cpu_percent", 0),
        cpu_name=data.get("cpu_name"),
        cpu_count=data.get("cpu_count"),
        memory_used_mb=data.get("memory_used_mb", 0),
        memory_total_mb=data.get("memory_total_mb", 0),
        gpus=gpus,
        error=data.get("error"),
    )


class ResourceMonitorService:
    """资源监控服务（全局单例）"""

    def __init__(self):
        # machine_id -> ResourceSnapshot (最近一次)
        self._cache: dict[int, ResourceSnapshot] = {}
        self._tasks: dict[int, asyncio.Task] = {}
        # 正在采集中的 machine_id 集合（防止并发重入）
        self._in_flight: set[int] = set()
        # machine_id -> deque[(timestamp, snapshot)]，保留最近 HISTORY_RETAIN_MINUTES 分钟
        self._history: dict[int, deque[tuple[datetime, ResourceSnapshot]]] = {}
        # 最近成功采集时间，供调度器检测机器是否已离线
        self._last_success_time: dict[int, datetime] = {}

    # 滚动历史保留时长（分钟）——通过 config 读取，可用环境变量 PPH_HISTORY_RETAIN_MIN 覆盖
    HISTORY_RETAIN_MINUTES = MONITOR_HISTORY_RETAIN_MINUTES

    async def get_snapshot(self, machine_id: int, is_local: bool) -> ResourceSnapshot:
        """立即采集并返回快照；若同机器已有采集在途则等待其完成并返回缓存，避免并发重入。"""
        if machine_id in self._in_flight:
            # 等待已在途的采集完成（最多 5s，每 100ms 轮询一次）
            cached = self.get_cached(machine_id)
            if cached:
                return cached
            for _ in range(50):
                await asyncio.sleep(0.1)
                cached = self.get_cached(machine_id)
                if cached:
                    return cached
            # 超时后仍无缓存，降级走一次独立采集（不再等待）

        self._in_flight.add(machine_id)
        try:
            if is_local:
                data = await asyncio.get_running_loop().run_in_executor(None, _collect_local)
            else:
                out, err = await asyncio.get_running_loop().run_in_executor(
                    None, ssh_manager.exec_command, machine_id, _REMOTE_COLLECT_SCRIPT.strip()
                )
                if not out.strip():
                    raise RuntimeError(err or "远程脚本无输出")
                data = json.loads(out.strip())

            snap = _parse_snapshot(machine_id, data)
            self._cache[machine_id] = snap
            # 追加到滚动历史，清理过期条目
            if machine_id not in self._history:
                self._history[machine_id] = deque()
            self._history[machine_id].append((datetime.utcnow(), snap))
            # 记录最近成功时间，供调度器离线检测
            self._last_success_time[machine_id] = datetime.utcnow()
            cutoff = datetime.utcnow() - timedelta(minutes=self.HISTORY_RETAIN_MINUTES)
            while self._history[machine_id] and self._history[machine_id][0][0] < cutoff:
                self._history[machine_id].popleft()
            return snap
        except Exception as e:
            snap = ResourceSnapshot(
                machine_id=machine_id,
                timestamp=datetime.utcnow(),
                cpu_percent=0,
                memory_used_mb=0,
                memory_total_mb=0,
                error=str(e),
            )
            return snap
        finally:
            self._in_flight.discard(machine_id)

    def get_cached(self, machine_id: int) -> Optional[ResourceSnapshot]:
        return self._cache.get(machine_id)

    def get_history(
        self, machine_id: int, minutes: float = 5.0
    ) -> list[tuple[datetime, ResourceSnapshot]]:
        """返回最近 minutes 分钟内的历史快照列表（按时间升序）"""
        buf = self._history.get(machine_id)
        if not buf:
            return []
        cutoff = datetime.utcnow() - timedelta(minutes=minutes)
        return [(ts, snap) for ts, snap in buf if ts >= cutoff]

    def get_last_snapshot_time(self, machine_id: int) -> "datetime | None":
        """返回最近一次成功采集的时间戳，尚未采集时返回 None。"""
        return self._last_success_time.get(machine_id)

    def start_polling(self, machine_id: int, is_local: bool, interval: int = DEFAULT_MONITOR_INTERVAL):
        """启动后台轮询任务"""
        if machine_id in self._tasks and not self._tasks[machine_id].done():
            return  # 已在运行

        async def _poll():
            while True:
                t0 = asyncio.get_running_loop().time()
                try:
                    await self.get_snapshot(machine_id, is_local)
                except Exception as e:
                    logger.warning(f"[Monitor] machine {machine_id} 采集失败: {e}")
                # 精确间隔：从 interval 中扣除本次采集耗时，保持期望的观测频率
                elapsed = asyncio.get_running_loop().time() - t0
                await asyncio.sleep(max(0.0, interval - elapsed))

        self._tasks[machine_id] = asyncio.create_task(_poll())
        logger.info(f"[Monitor] 启动机器 {machine_id} 的轮询任务, interval={interval}s")

    def stop_polling(self, machine_id: int):
        task = self._tasks.pop(machine_id, None)
        if task:
            task.cancel()


# 全局单例
resource_monitor = ResourceMonitorService()
