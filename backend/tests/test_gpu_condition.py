"""
Tests for GPU condition evaluation service.

Constructs fake GPU snapshots from virtual machines and validates
force mode, smart mode, simple conditions, and expression evaluation.
"""
import pytest
from datetime import datetime, timedelta

from services.gpu_condition import (
    evaluate_gpu_condition,
    validate_expr,
    _get_gpu_metrics,
    _eval_simple_condition,
    _eval_expr,
    ConditionError,
)
from tests.conftest import make_gpu, make_snapshot


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _history(snapshots, minutes_ago_list=None):
    """Build a history list: [(datetime, snapshot), ...]"""
    now = datetime.utcnow()
    if minutes_ago_list is None:
        minutes_ago_list = list(range(len(snapshots) - 1, -1, -1))
    return [
        (now - timedelta(minutes=m), snap)
        for m, snap in zip(minutes_ago_list, snapshots)
    ]


def _make_4gpu_snapshot(
    utils=(0, 0, 0, 0),
    mem_used=(0, 0, 0, 0),
    mem_total=(24576, 24576, 24576, 24576),
    machine_id=1,
    **kwargs,
):
    """Create a snapshot with 4 GPUs with specified utilizations and memory."""
    gpus = [
        make_gpu(
            index=i,
            utilization=utils[i],
            memory_used_mb=mem_used[i],
            memory_total_mb=mem_total[i],
        )
        for i in range(4)
    ]
    return make_snapshot(machine_id=machine_id, gpus=gpus, **kwargs)


# ═══════════════════════════════════════════════════════════════════════════
# Force mode
# ═══════════════════════════════════════════════════════════════════════════

class TestForceMode:
    def test_force_returns_specified_gpus(self):
        condition = {"mode": "force", "gpu_ids": [0, 2]}
        history = _history([_make_4gpu_snapshot()])
        result = evaluate_gpu_condition(condition, history)
        assert result == [0, 2]

    def test_force_empty_gpu_ids_returns_none(self):
        condition = {"mode": "force", "gpu_ids": []}
        history = _history([_make_4gpu_snapshot()])
        result = evaluate_gpu_condition(condition, history)
        assert result is None

    def test_force_ignores_utilization(self):
        """Force mode doesn't care about GPU load."""
        condition = {"mode": "force", "gpu_ids": [0, 1]}
        snap = _make_4gpu_snapshot(utils=(100, 100, 100, 100))
        history = _history([snap])
        result = evaluate_gpu_condition(condition, history)
        assert result == [0, 1]


# ═══════════════════════════════════════════════════════════════════════════
# Smart mode — simple conditions
# ═══════════════════════════════════════════════════════════════════════════

class TestSmartSimple:
    def test_all_idle_gpus_pass(self):
        """4 idle GPUs, need 2 with util < 10."""
        condition = {
            "mode": "smart",
            "min_gpus": 2,
            "idle_minutes": 1,
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }
        snap = _make_4gpu_snapshot(utils=(0, 0, 0, 0))
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result is not None
        assert len(result) == 2

    def test_insufficient_idle_gpus(self):
        """Only 1 idle GPU but need 2."""
        condition = {
            "mode": "smart",
            "min_gpus": 2,
            "idle_minutes": 1,
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }
        snap = _make_4gpu_snapshot(utils=(0, 90, 85, 95))
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result is None

    def test_memory_condition(self):
        """Free memory > 20000 MB check."""
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "conditions": [{"type": "mem", "op": ">", "value": 20000}],
        }
        # GPU 0: 24576 - 1000 = 23576 free (pass)
        # GPU 1: 24576 - 20000 = 4576 free (fail)
        snap = _make_4gpu_snapshot(mem_used=(1000, 20000, 20000, 20000))
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result == [0]

    def test_candidate_gpu_ids_filter(self):
        """Only consider specified candidate GPUs."""
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "gpu_ids": [2, 3],  # only consider GPU 2 and 3
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }
        snap = _make_4gpu_snapshot(utils=(0, 0, 0, 95))
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        # GPU 2 is idle (util=0), GPU 3 is busy (util=95)
        assert result == [2]

    def test_multiple_conditions_and(self):
        """All simple conditions must pass (AND logic)."""
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "conditions": [
                {"type": "util", "op": "<", "value": 10},
                {"type": "mem", "op": ">", "value": 20000},
            ],
        }
        # GPU 0: util=5 (pass), free=23576 (pass) → pass
        # GPU 1: util=5 (pass), free=4576 (fail) → fail
        snap = _make_4gpu_snapshot(utils=(5, 5, 90, 90), mem_used=(1000, 20000, 1000, 20000))
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result == [0]

    def test_condition_must_hold_across_all_snapshots(self):
        """GPU must be idle in ALL snapshots within idle_minutes window."""
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 2,
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }
        # Snapshot 1 (1 min ago): GPU 0 idle
        snap1 = _make_4gpu_snapshot(utils=(0, 90, 90, 90))
        # Snapshot 2 (now): GPU 0 suddenly busy
        snap2 = _make_4gpu_snapshot(utils=(80, 90, 90, 90))
        history = _history([snap1, snap2], [1, 0])
        result = evaluate_gpu_condition(condition, history)
        assert result is None  # GPU 0 was busy in snap2

    def test_no_history_returns_none(self):
        condition = {"mode": "smart", "min_gpus": 1, "idle_minutes": 1}
        result = evaluate_gpu_condition(condition, [])
        assert result is None

    def test_empty_condition_returns_empty_list(self):
        """No condition at all: task can run immediately."""
        result = evaluate_gpu_condition({}, [])
        assert result == []

    def test_none_condition_returns_empty_list(self):
        result = evaluate_gpu_condition(None, [])
        assert result == []


# ═══════════════════════════════════════════════════════════════════════════
# Smart mode — expression conditions
# ═══════════════════════════════════════════════════════════════════════════

class TestSmartExpr:
    def test_expression_basic(self):
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "condition_expr": "util < 10 and mem_gb > 20",
        }
        # GPU 0: util=5, free=23.4 GB
        snap = _make_4gpu_snapshot(utils=(5, 90, 90, 90), mem_used=(600, 20000, 20000, 20000))
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result == [0]

    def test_expression_with_power(self):
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "condition_expr": "power < 30",
        }
        gpu = make_gpu(index=0, power_draw_w=100, power_limit_w=450)  # 22.2%
        snap = make_snapshot(gpus=[gpu])
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result == [0]

    def test_expression_combined_with_simple(self):
        """Both simple conditions and expression must pass."""
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "conditions": [{"type": "util", "op": "<", "value": 50}],
            "condition_expr": "procs == 0",
        }
        gpu = make_gpu(index=0, utilization=10, processes=[])
        snap = make_snapshot(gpus=[gpu])
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result == [0]

    def test_expression_with_procs(self):
        from schemas.monitor import GpuProcess
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "condition_expr": "procs == 0",
        }
        # GPU with a python process running
        gpu = make_gpu(
            index=0,
            utilization=5,
            processes=[GpuProcess(pid=1234, name="python", used_memory_mb=2000)],
        )
        snap = make_snapshot(gpus=[gpu])
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result is None  # procs=1, fails


# ═══════════════════════════════════════════════════════════════════════════
# Metrics extraction
# ═══════════════════════════════════════════════════════════════════════════

class TestMetrics:
    def test_get_gpu_metrics(self):
        gpu = make_gpu(
            utilization=75.0,
            memory_used_mb=10000,
            memory_total_mb=24576,
            power_draw_w=250,
            power_limit_w=450,
        )
        m = _get_gpu_metrics(gpu)
        assert m["util"] == 75.0
        assert m["mem"] == 14576.0  # 24576 - 10000
        assert abs(m["mem_gb"] - 14576.0 / 1024) < 0.01
        assert abs(m["power"] - 250 / 450 * 100) < 0.1
        assert m["procs"] == 0.0

    def test_metrics_no_power(self):
        gpu = make_gpu(power_draw_w=None, power_limit_w=None)
        m = _get_gpu_metrics(gpu)
        assert m["power"] == 0.0


# ═══════════════════════════════════════════════════════════════════════════
# Simple condition evaluation
# ═══════════════════════════════════════════════════════════════════════════

class TestSimpleCondition:
    def test_operators(self):
        metrics = {"util": 50.0}
        assert _eval_simple_condition({"type": "util", "op": "<", "value": 60}, metrics) is True
        assert _eval_simple_condition({"type": "util", "op": ">", "value": 60}, metrics) is False
        assert _eval_simple_condition({"type": "util", "op": ">=", "value": 50}, metrics) is True
        assert _eval_simple_condition({"type": "util", "op": "<=", "value": 50}, metrics) is True
        assert _eval_simple_condition({"type": "util", "op": "==", "value": 50}, metrics) is True
        assert _eval_simple_condition({"type": "util", "op": "!=", "value": 50}, metrics) is False


# ═══════════════════════════════════════════════════════════════════════════
# Expression validation & safety
# ═══════════════════════════════════════════════════════════════════════════

class TestExprValidation:
    def test_valid_expression(self):
        assert validate_expr("util < 10 and mem > 5000") is None

    def test_syntax_error(self):
        result = validate_expr("util <")
        assert result is not None

    def test_unsafe_expression_rejected(self):
        result = validate_expr("__import__('os').system('rm -rf /')")
        assert result is not None

    def test_empty_expression_is_valid(self):
        assert validate_expr("") is None
        assert validate_expr("   ") is None

    def test_expression_eval_error(self):
        with pytest.raises(ConditionError):
            _eval_expr("1 / 0", {"mem": 0, "mem_gb": 0, "util": 0, "power": 0, "procs": 0, "used_mem": 0, "total_mem": 0})


# ═══════════════════════════════════════════════════════════════════════════
# Multi-GPU machine scenarios (virtual machines)
# ═══════════════════════════════════════════════════════════════════════════

class TestVirtualMachineScenarios:
    """
    Simulate realistic GPU server configurations:
    - 8×A100 DGX station
    - 4×RTX 4090 workstation
    - Mixed-load cluster node
    """

    def _make_8gpu_a100_snapshot(self, utils, mem_used):
        gpus = [
            make_gpu(
                index=i,
                name="NVIDIA A100-SXM4-80GB",
                utilization=utils[i],
                memory_used_mb=mem_used[i],
                memory_total_mb=81920,
                power_draw_w=100 + utils[i] * 2.5,
                power_limit_w=400,
            )
            for i in range(8)
        ]
        return make_snapshot(machine_id=10, gpus=gpus)

    def test_dgx_find_4_idle_gpus(self):
        """DGX with 8 A100s: 4 idle, 4 busy — request 4 idle GPUs."""
        condition = {
            "mode": "smart",
            "min_gpus": 4,
            "idle_minutes": 1,
            "conditions": [
                {"type": "util", "op": "<", "value": 5},
                {"type": "mem_gb", "op": ">", "value": 70},
            ],
        }
        snap = self._make_8gpu_a100_snapshot(
            utils=(0, 0, 0, 0, 95, 98, 92, 88),
            mem_used=(500, 300, 200, 100, 70000, 75000, 68000, 60000),
        )
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result is not None
        assert len(result) == 4
        assert all(i in [0, 1, 2, 3] for i in result)

    def test_dgx_not_enough_idle(self):
        """DGX: need 4 idle but only 3 available."""
        condition = {
            "mode": "smart",
            "min_gpus": 4,
            "idle_minutes": 1,
            "conditions": [{"type": "util", "op": "<", "value": 5}],
        }
        snap = self._make_8gpu_a100_snapshot(
            utils=(0, 0, 0, 50, 95, 98, 92, 88),
            mem_used=(0,) * 8,
        )
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result is None

    def test_workstation_grab_any_idle_gpu(self):
        """4×4090 workstation: grab 1 GPU with low util and free VRAM."""
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 1,
            "condition_expr": "util < 10 and mem_gb > 20 and procs == 0",
        }
        from schemas.monitor import GpuProcess
        gpus = [
            make_gpu(0, "RTX 4090", 85, 20000, 24576, processes=[
                GpuProcess(pid=100, name="python", used_memory_mb=18000),
            ]),
            make_gpu(1, "RTX 4090", 0, 200, 24576, processes=[]),
            make_gpu(2, "RTX 4090", 92, 22000, 24576, processes=[
                GpuProcess(pid=200, name="python", used_memory_mb=20000),
            ]),
            make_gpu(3, "RTX 4090", 3, 800, 24576, processes=[]),
        ]
        snap = make_snapshot(machine_id=20, gpus=gpus)
        history = _history([snap], [0])
        result = evaluate_gpu_condition(condition, history)
        assert result is not None
        assert len(result) == 1
        assert result[0] in [1, 3]  # either GPU 1 or 3

    def test_stability_window_rejects_spike(self):
        """GPU must be consistently idle over the entire idle window."""
        condition = {
            "mode": "smart",
            "min_gpus": 1,
            "idle_minutes": 5,
            "conditions": [{"type": "util", "op": "<", "value": 10}],
        }
        # 5 snapshots over 5 minutes: GPU 0 has a spike at minute 2
        snaps = [
            _make_4gpu_snapshot(utils=(3, 90, 90, 90)),   # 4 min ago
            _make_4gpu_snapshot(utils=(2, 90, 90, 90)),   # 3 min ago
            _make_4gpu_snapshot(utils=(75, 90, 90, 90)),  # 2 min ago — spike!
            _make_4gpu_snapshot(utils=(5, 90, 90, 90)),   # 1 min ago
            _make_4gpu_snapshot(utils=(1, 90, 90, 90)),   # now
        ]
        history = _history(snaps, [4, 3, 2, 1, 0])
        result = evaluate_gpu_condition(condition, history)
        assert result is None  # spike in window → reject
