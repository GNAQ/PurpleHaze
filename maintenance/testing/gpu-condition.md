# GPU 条件评估测试（test_gpu_condition.py）

## 测试策略

GPU 条件评估是**纯函数**（输入 condition dict + history list，输出 GPU 索引列表或 None），不依赖数据库或网络，可以直接调用测试。

测试围绕三种核心场景构建，另有底层函数的单元测试和表达式安全性验证。

---

## 强制模式（TestForceMode）

| 测试 | 输入 | 预期 |
|---|---|---|
| `test_force_returns_specified_gpus` | `gpu_ids: [0, 2]` | 返回 `[0, 2]` |
| `test_force_empty_gpu_ids_returns_none` | `gpu_ids: []` | 返回 None |
| `test_force_ignores_utilization` | 4 卡全 100% 利用率 | 仍返回指定卡（强制模式不检查负载） |

## 智能模式 — 简单条件（TestSmartSimple）

| 测试 | 场景 | 预期 |
|---|---|---|
| `test_all_idle_gpus_pass` | 4 卡全空闲，需 2 张 `util < 10` | 返回 2 张 |
| `test_insufficient_idle_gpus` | 只 1 卡空闲，需 2 张 | None |
| `test_memory_condition` | `mem > 20000`，GPU 0 空闲 23GB，其余 < 5GB | 返回 `[0]` |
| `test_candidate_gpu_ids_filter` | 限定 `gpu_ids: [2, 3]`，GPU 2 空闲 GPU 3 满载 | 返回 `[2]` |
| `test_multiple_conditions_and` | `util < 10 AND mem > 20000` | 两个条件都满足才通过 |
| `test_condition_must_hold_across_all_snapshots` | GPU 0 在第 2 个快照突然飙到 80% | None（窗口内不稳定） |
| `test_no_history_returns_none` | 空历史 | None |
| `test_empty_condition_returns_empty_list` | `{}` | `[]`（无条件，立即可运行） |
| `test_none_condition_returns_empty_list` | `None` | `[]` |

## 智能模式 — 表达式条件（TestSmartExpr）

| 测试 | 表达式 | 预期 |
|---|---|---|
| `test_expression_basic` | `util < 10 and mem_gb > 20` | GPU 0 通过 |
| `test_expression_with_power` | `power < 30` | 功耗 22.2% 通过 |
| `test_expression_combined_with_simple` | 简单条件 `util < 50` + 表达式 `procs == 0` | 两者都满足才通过 |
| `test_expression_with_procs` | `procs == 0`，GPU 上有 python 进程 | None |

## 虚拟机器场景（TestVirtualMachineScenarios）

模拟真实 GPU 服务器配置来验证评估逻辑：

| 测试 | 配置 | 验证点 |
|---|---|---|
| `test_dgx_find_4_idle_gpus` | 8×A100-80GB，4 张空闲 4 张满载 | 正确识别 4 张空闲卡（索引 0-3） |
| `test_dgx_not_enough_idle` | 同上但只有 3 张空闲，需 4 张 | 返回 None |
| `test_workstation_grab_any_idle_gpu` | 4×RTX 4090，含进程检查 `procs == 0` | 选中 GPU 1 或 3（无进程的空闲卡） |
| `test_stability_window_rejects_spike` | 5 分钟窗口，第 2 分钟利用率飙到 75% | 拒绝分配（尖峰检测） |

## 底层函数

### 指标提取（TestMetrics）
- `test_get_gpu_metrics`：验证空闲显存、利用率、功耗百分比、进程数的计算
- `test_metrics_no_power`：功耗字段为 None 时 `power=0.0`

### 简单条件运算符（TestSimpleCondition）
- `test_operators`：6 种运算符（`> < >= <= == !=`）全覆盖

### 表达式安全性（TestExprValidation）
- `test_valid_expression`：合法表达式返回 None
- `test_syntax_error`：语法错误被检测
- `test_unsafe_expression_rejected`：`__import__('os').system(...)` 被拒绝
- `test_empty_expression_is_valid`：空字符串合法
- `test_expression_eval_error`：除以零等运行时错误抛出 `ConditionError`
