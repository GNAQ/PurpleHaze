# 调度器测试（test_scheduler.py）

## 命令构建（TestBuildCommand）

`_build_command` 是纯函数，输入 config dict + conda 信息 + GPU 列表，输出 shell 命令字符串。

| 测试 | 输入 | 验证 |
|---|---|---|
| `test_simple_command` | `python train.py` | 原样输出 |
| `test_command_with_args` | `--lr 0.001 --epochs 100` | 参数名和值都在结果中 |
| `test_gpu_ids_set_cuda_visible` | `gpu_ids=[0, 2]` | 含 `CUDA_VISIBLE_DEVICES=0,2` |
| `test_env_vars` | `MASTER_PORT=29500` | 环境变量出现在命令前缀 |
| `test_conda_path_activation` | `conda_path=/opt/conda/envs/torch2` | 含 `PATH=...torch2/bin:$PATH` |
| `test_conda_name_activation` | `conda_name=torch2` | 含 `conda run -n torch2` |
| `test_conda_path_takes_precedence_over_name` | 同时提供 path 和 name | 使用 PATH 方式，不含 `conda run` |
| `test_combined_gpu_env_conda` | GPU + env + conda + args | 全部正确组合 |
| `test_empty_command_raises` | `""` | 抛出 `ValueError` |
| `test_whitespace_command_raises` | `"   "` | 抛出 `ValueError` |
| `test_args_with_spaces_are_quoted` | `/path/with spaces/output` | 值被 shell-quote |

## 启动恢复（TestStartupRecovery）

通过 `patch("services.task_scheduler.AsyncSessionLocal", test_factory)` 将调度器的数据库会话替换为测试会话。

| 测试 | 初始状态 | 验证 |
|---|---|---|
| `test_running_tasks_marked_failed` | 1 个 RUNNING 任务（PID=99999） | 状态→FAILED，`meta.error` 含"服务重启" |
| `test_waiting_tasks_unaffected` | 1 个 WAITING 任务 | 状态保持 WAITING |

## 任务取消（TestCancelTask）

| 测试 | 操作 | 验证 |
|---|---|---|
| `test_cancel_waiting_task` | 取消 WAITING 任务 | 状态→CANCELLED，返回 True |
| `test_cancel_completed_task_returns_false` | 取消 COMPLETED 任务 | 返回 False |
| `test_cancel_nonexistent_task` | 取消 ID=99999 | 返回 False |

## 虚拟机器命令场景（TestVirtualMachineCommands）

| 测试 | 场景 | 关键验证 |
|---|---|---|
| `test_local_single_gpu_training` | 本地机，单卡，conda 路径激活 | `CUDA_VISIBLE_DEVICES=0`、`PATH=` |
| `test_remote_multi_gpu_distributed` | 远程机，4 卡 torchrun，conda name 激活 | `CUDA_VISIBLE_DEVICES=0,1,2,3`、`conda run -n`、torchrun 参数 |
| `test_eval_script_no_gpu` | CPU-only 评估 | 不含 `CUDA_VISIBLE_DEVICES` |
