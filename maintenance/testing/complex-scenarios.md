# 复杂场景测试（test_complex_scenarios.py）

模拟真实生产环境中多用户、多机器、多任务并行的场景，覆盖各组件在复合条件下的交互正确性。

---

## 场景 1：多流水线隔离性（TestMultiPipelineIsolation）

**环境**：3 条流水线（训练 / 评估 / 部署）+ 1 台本地机器

| 测试 | 操作 | 验证 |
|---|---|---|
| `test_tasks_isolated_per_pipeline` | 训练 3 个任务、评估 2 个、部署 1 个 | `GET /pipelines` 各流水线 task count 正确 |
| `test_sort_order_independent` | 两条流水线各创建 2 个任务 | 每条流水线内 sort_order 都从 0 开始 |
| `test_delete_task_no_cross_pipeline_effect` | 删除训练流水线的任务 | 评估流水线的任务不受影响 |

---

## 场景 2：多机器任务分发（TestMultiMachineDispatch）

**环境**：本地机 + A100 远程集群 + 4090 远程节点

| 测试 | 操作 | 验证 |
|---|---|---|
| `test_tasks_bound_to_different_machines` | 3 个任务分别绑定 3 台机器 | 各 `machine_id` 正确 |
| `test_migrate_task_between_machines` | `PUT /tasks/{id}` 改 `machine_id` | 任务成功移到另一台机器 |
| `test_delete_machine_clears_template_ref` | 删除 A100 机器 | 引用该机器的模板 `machine_id` 变为 null |
| `test_list_machines_returns_all` | `GET /machines` | 返回全部 3 台 |

---

## 场景 3：调度器 _tick 逻辑（TestSchedulerTick）

直接操作数据库构造混合状态，通过 mock `_try_start_task` 记录哪些任务被尝试启动，验证 `_tick` 的核心选择逻辑。

| 测试 | 初始状态 | 验证 |
|---|---|---|
| `test_pipeline_serial_blocks_next` | P1: 1 RUNNING + 1 WAITING | WAITING 不被尝试启动 |
| `test_multiple_pipelines_independent` | P1: RUNNING 阻塞 / P2: 只有 WAITING | P2 的 WAITING 被尝试，P1 的不被 |
| `test_tick_picks_lowest_sort_order` | 同一流水线 sort_order=5 和 sort_order=1 | 只尝试 sort_order=1 |
| `test_orphan_tasks_all_attempted` | 4 个 pipeline_id=null 的 WAITING | 全部 4 个都被尝试启动 |

**这组测试直接验证了调度器的核心不变量**：

- 流水线内严格串行（有 RUNNING 则阻塞后续）
- 流水线间完全并行
- 同一流水线按 sort_order 升序选择（FIFO）
- 游离任务不受流水线约束，每个独立调度

---

## 场景 4：批量任务多流水线轮转（TestBatchMultiPipeline）

| 测试 | 操作 | 验证 |
|---|---|---|
| `test_round_robin_distribution` | 6 条命令 → 3 条流水线 | cmd_0→P1, cmd_1→P2, cmd_2→P3, cmd_3→P1, ... |
| `test_batch_sort_order_continuous` | 先创建 2 个任务再批量追加 3 个 | 批量任务 sort_order 从 2 开始连续递增 |
| `test_batch_nonexistent_pipeline_rejected` | pipeline_ids 含无效 ID | 返回 404 |
| `test_batch_nonexistent_machine_rejected` | machine_id 无效 | 返回 404 |

---

## 场景 5：任务生命周期与边界操作（TestTaskLifecycle）

| 测试 | 操作 | 验证 |
|---|---|---|
| `test_running_task_immutable_fields` | 对 RUNNING 任务 PUT name + sort_order | name 不变（被忽略），sort_order 变了（唯一可改字段） |
| `test_cannot_delete_running_task` | DELETE WAITING 任务 | 返回 204（WAITING 可删；RUNNING 不可删的约束由路由层保证） |
| `test_cancel_waiting_via_api` | POST cancel | 返回 200 |
| `test_cancel_already_done_rejected` | POST cancel 对已完成任务 | 返回 400 |

---

## 场景 6：多机器 × GPU 条件 × 时间窗口（TestMultiMachineGpuScheduling）

构造多台虚拟机器各自不同的 GPU 监控历史，验证 GPU 条件评估在复杂场景下的正确性。

| 测试 | 环境 | 验证 |
|---|---|---|
| `test_machine_a_idle_machine_b_busy` | A: 4×4090 全空闲 3 分钟 / B: 全满载 | 同一条件在 A 通过、B 不通过 |
| `test_heterogeneous_cluster` | 2×A100(80GB) + 2×RTX3090(24GB)，条件 `mem_gb > 60` | 只有 A100 满足，3090 被排除 |
| `test_gradual_cooldown` | 5 个时间点：95→80→60→8→3 利用率 | `idle_minutes=3` 失败，`idle_minutes=1` 通过 |

---

## 场景 7：启动恢复 — 多流水线多机器（TestStartupRecoveryComplex）

**环境**：3 台机器 + 2 条流水线 + 7 个任务（混合状态）

```
训练流水线:  1×RUNNING(本地,PID=11111) + 2×WAITING(分布在A100和4090)
推理流水线:  1×RUNNING(A100,PID=22222) + 1×COMPLETED(4090) + 1×WAITING(本地)
游离:        1×RUNNING(本地,PID=33333)
```

恢复后验证：
- 3 个 RUNNING 全部 → FAILED，`meta.error` 含"服务重启"
- 3 个 WAITING 状态不变
- 1 个 COMPLETED 状态不变、`exit_code=0` 不变

---

## 场景 8：_try_start_task 边界（TestTryStartEdgeCases）

| 测试 | 初始状态 | 验证 |
|---|---|---|
| `test_task_no_machine_id_fails` | `machine_id=None` | 直接标记 FAILED，`error="未指定运行机器"` |
| `test_task_machine_deleted_fails` | 创建任务后删除机器 | 直接标记 FAILED，`error` 含"不存在" |

---

## 场景 9：端到端工作流（TestEndToEndWorkflow）

模拟一个完整的用户操作序列，在单个测试中走完 13 步：

1. 创建 2 台机器（本地 + 远程）
2. 注册 conda 环境
3. 创建 GPU 条件预设
4. 创建 2 条流水线（训练 + 评估）
5. 提交 3 个任务（预训练→远程 4 卡、微调→远程、本地评估）
6. 验证流水线任务分布
7. 跨流水线移动任务（微调从训练移到评估）
8. 验证移动后分布变化
9. 取消一个任务
10. 创建任务模板
11. 批量创建 4 个实验任务（轮转到 2 条流水线）
12. 验证最终任务总数 = 7
13. 验证机器列表完整
