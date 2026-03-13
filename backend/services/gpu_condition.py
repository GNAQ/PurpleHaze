"""
GPU 抢卡条件评估器

支持两种模式：
  force: 直接指定 GPU 卡（可多选）
  smart: 设置条件，满足后自动分配

条件评估基于过去 idle_minutes 分钟内的所有历史快照，
每张候选 GPU 在所有快照中都满足条件才算通过。

支持的简单条件 type:
  mem     - 空闲显存 MB (memory_total_mb - memory_used_mb)
  mem_gb  - 空闲显存 GB (memory_total_mb - memory_used_mb) / 1024
  util    - GPU 利用率 %
  power   - 功耗占最大功耗 %
  procs   - GPU 上的 Python 进程数量

支持的文本表达式变量：同上 (mem, mem_gb, util, power, procs, used_mem, total_mem)
运算符：>  <  >=  <=  ==  !=  and  or  not  ( )
"""
import ast
import logging
from datetime import datetime, timedelta

from schemas.monitor import GpuInfo, ResourceSnapshot

logger = logging.getLogger(__name__)


class ConditionError(ValueError):
    pass


def _get_gpu_metrics(gpu: GpuInfo) -> dict:
    """提取 GPU 评估指标"""
    power_pct = 0.0
    if (gpu.power_draw_w is not None
            and gpu.power_limit_w is not None
            and gpu.power_limit_w > 0):
        power_pct = gpu.power_draw_w / gpu.power_limit_w * 100.0

    free_mem = (gpu.memory_total_mb or 0) - (gpu.memory_used_mb or 0)

    python_procs = sum(
        1 for p in (gpu.processes or [])
        if "python" in (p.name or "").lower() or "python" in (p.cmdline or "").lower()
    )

    return {
        "mem": free_mem,
        "mem_gb": free_mem / 1024.0,
        "util": gpu.utilization or 0.0,
        "power": power_pct,
        "procs": float(python_procs),
        "used_mem": gpu.memory_used_mb or 0.0,
        "total_mem": gpu.memory_total_mb or 0.0,
    }


def _eval_simple_condition(cond: dict, metrics: dict) -> bool:
    """
    评估单个简单条件
    cond: {type: "mem"|"mem_gb"|"util"|"power"|"procs", op: ">"|"<"|">="|"<=", value: float}
    """
    ctype = cond.get("type", "")
    op = cond.get("op", "<")
    value = float(cond.get("value", 0))
    actual = float(metrics.get(ctype, 0))
    ops = {
        ">":  lambda a, b: a > b,
        "<":  lambda a, b: a < b,
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
    }
    fn = ops.get(op)
    return fn(actual, value) if fn else False


# AST 白名单：只允许纯算术/逻辑表达式
_ALLOWED_AST_NODES = {
    ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Compare,
    ast.Constant, ast.Name,
    ast.And, ast.Or, ast.Not,
    ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.Eq, ast.NotEq,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod,
}


def _eval_expr(expr: str, metrics: dict) -> bool:
    """
    评估文本条件表达式
    允许变量：mem, mem_gb, util, power, procs, used_mem, total_mem
    """
    if not expr.strip():
        return True

    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise ConditionError(f"表达式语法错误: {e}") from e

    for node in ast.walk(tree):
        if type(node) not in _ALLOWED_AST_NODES:
            raise ConditionError(f"不支持的表达式节点: {type(node).__name__}")

    safe_env = {k: float(v) for k, v in metrics.items()}
    try:
        return bool(eval(compile(tree, "<condition>", "eval"), {"__builtins__": {}}, safe_env))
    except Exception as e:
        raise ConditionError(f"表达式求值失败: {e}") from e


def validate_expr(expr: str) -> str | None:
    """验证文本条件表达式语法，返回错误信息或 None（合法）"""
    dummy = {"mem": 0.0, "mem_gb": 0.0, "util": 0.0, "power": 0.0, "procs": 0.0,
             "used_mem": 0.0, "total_mem": 0.0}
    try:
        _eval_expr(expr, dummy)
        return None
    except ConditionError as e:
        return str(e)


def evaluate_gpu_condition(
    condition: dict,
    history: list[tuple[datetime, ResourceSnapshot]],
) -> list[int] | None:
    """
    评估抢卡条件，返回满足条件的 GPU 索引列表，或 None 表示条件未满足。

    history: [(timestamp, snapshot), ...] 按时间升序
    """
    if not condition:
        return []  # 无条件，立即可运行

    mode = condition.get("mode", "force")

    # ── 强制模式：直接返回指定 GPU 列表 ─────────────────────────────────────
    if mode == "force":
        gpu_ids = condition.get("gpu_ids", [])
        return gpu_ids if gpu_ids else None

    # ── 智能模式 ──────────────────────────────────────────────────────────────
    # M-6: min_gpus=0 语义不明确（永远不满足 / 返回全部？），强制最小值为 1
    min_gpus = max(1, int(condition.get("min_gpus") or 1))
    candidate_ids: list[int] | None = condition.get("gpu_ids") or None  # None = 所有卡
    idle_minutes = float(condition.get("idle_minutes", 1.0))
    simple_conditions: list[dict] = condition.get("conditions") or []
    expr: str = (condition.get("condition_expr") or "").strip()

    if not history:
        return None

    # 取时间窗口内的快照
    cutoff = datetime.utcnow() - timedelta(minutes=idle_minutes)
    recent = [(ts, snap) for ts, snap in history if ts >= cutoff]
    if not recent:
        return None

    # 从最新快照获取全部 GPU 索引
    latest_snap = recent[-1][1]
    all_gpu_idxs = {g.index for g in (latest_snap.gpus or [])}
    candidates = [g for g in (candidate_ids if candidate_ids is not None else sorted(all_gpu_idxs))]

    passing: list[int] = []
    for gidx in candidates:
        if gidx not in all_gpu_idxs:
            continue
        ok = True
        for _ts, snap in recent:
            gpu_info = next((g for g in (snap.gpus or []) if g.index == gidx), None)
            if gpu_info is None:
                ok = False
                break
            metrics = _get_gpu_metrics(gpu_info)
            # 简单条件
            if simple_conditions:
                if not all(_eval_simple_condition(c, metrics) for c in simple_conditions):
                    ok = False
                    break
            # 文本表达式
            if ok and expr:
                try:
                    if not _eval_expr(expr, metrics):
                        ok = False
                        break
                except ConditionError as e:
                    logger.warning(f"[GpuCondition] 条件表达式求值失败: {e}")
                    ok = False
                    break
        if ok:
            passing.append(gidx)

    if len(passing) >= min_gpus:
        return passing[:min_gpus] if min_gpus > 0 else passing
    return None
