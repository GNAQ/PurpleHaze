# 数据库 Schema 速查

SQLite，路径 `backend/data/pph.db`。模型文件在 `backend/models/`。迁移在 `backend/migrations.py`（startup 自动执行）。

## task

核心字段：`id`, `name`, `pipeline_id`（NULL=孤立任务）, `machine_id`, `status`（waiting/running/completed/failed/cancelled）, `sort_order`, `assigned_gpu_ids`（JSON list）, `stdout_path`/`stderr_path`（相对路径）, `exit_code`, `pid`, `meta`（JSON，存 error/remote_pid）

config JSON：`{conda_env_id, env_vars: {key:val}, work_dir, command, args: [{name, value}]}`

gpu_condition JSON：`{mode: "force"|"smart", gpu_ids: [], min_gpus, idle_minutes, conditions: [{type, op, value}], condition_expr}`

condition.type 取值：`mem`（MB）, `mem_gb`, `util`（%）, `power`（%）, `procs`（python进程数）

## pipeline

`id`, `name`, `sort_order`, `created_at`。关联 tasks，按 sort_order 排序。

## machine

`id`, `name`, `is_local`, `ssh_host/port/username/password/private_key`（密码明文⚠️）, `proxy_jump_*`（跳板机同字段结构）, `auto_connect`, `auto_reconnect`, `monitor_config`（JSON，含 interval）, `sort_order`

## conda_env

`id`, `machine_id`（nullable；NULL=全局兼容环境）, `name`, `path`（conda 环境目录，空=用 conda run -n name）, `source`（manual / probe）, `last_seen_at`, `created_at`, `updated_at`

## task_template

`id`, `name`, `machine_id`（nullable）, `config`（同 task.config）, `gpu_condition`

## gpu_condition_preset

`id`, `name`, `condition`（同 task.gpu_condition）

## user / setting

user：单行（id=1），`password_hash`（bcrypt，NULL=未设置）

setting：KV 表，`key` PK, `value`, `description`
