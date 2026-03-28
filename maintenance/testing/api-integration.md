# API 集成测试（test_api_integration.py）

覆盖所有需要鉴权的 CRUD 端点，按资源分组。每个测试通过 httpx AsyncClient 发起真实 HTTP 请求，走完整的中间件→路由→依赖注入→DB 链路。

## 认证（TestAuth）

| 测试 | 验证 |
|---|---|
| `test_status_not_setup` | 新数据库 `is_setup=false` |
| `test_setup_and_login` | setup → status 变 true → login 拿到 token |
| `test_setup_rejects_short_password` | 密码 < 6 位返回 400 |
| `test_login_wrong_password` | 错误密码返回 401 |
| `test_change_password` | 改密后用新密码登录成功 |
| `test_protected_endpoint_without_token` | 无 token 访问 `/api/machines` 返回 401 |

## 机器管理（TestMachines）

| 测试 | 验证 |
|---|---|
| `test_create_local_machine` | `is_local=True`，`connected` 始终为 `True` |
| `test_create_remote_machine` | 敏感字段（`ssh_password`）不在响应中，只返回 `has_password: true` |
| `test_create_remote_without_host_fails` | 远程机器缺少 `ssh_host` 返回 400 |
| `test_list_machines` | 创建 2 台后列表返回 2 条 |
| `test_update_machine` | 改名成功 |
| `test_delete_machine` | 删除后 GET 返回 404 |
| `test_get_nonexistent_machine` | 不存在的 ID 返回 404 |

## 流水线（TestPipelines）

| 测试 | 验证 |
|---|---|
| `test_create_and_list_pipeline` | 创建后出现在列表中 |
| `test_update_pipeline` | 改名成功 |
| `test_delete_empty_pipeline` | 空流水线可删除 |
| `test_delete_nonempty_pipeline_fails` | 含任务的流水线删除返回 400 |

## 任务（TestTasks）

| 测试 | 验证 |
|---|---|
| `test_create_task` | 状态为 `waiting`，关联正确的 machine 和 pipeline |
| `test_create_task_with_gpu_condition` | GPU 条件正确存储 |
| `test_update_task` | 改名成功 |
| `test_delete_task` | 删除成功 |
| `test_task_sort_order_auto_increment` | 同一流水线内 sort_order 自动递增 |
| `test_orphaned_tasks` | `pipeline_id=null` 的任务通过 `/orphaned` 端点返回 |

## 批量任务（TestBatchTasks）

| 测试 | 验证 |
|---|---|
| `test_batch_create` | 3 条命令创建 3 个任务，`created_count=3` |

## 其他资源

| 测试类 | 覆盖 |
|---|---|
| `TestCondaEnvs` | Conda 环境 CRUD（创建、列表、更新、删除） |
| `TestGpuPresets` | GPU 条件预设 CRUD |
| `TestTemplates` | 任务模板 CRUD |
| `TestHistory` | 历史任务查询（空列表、计数为 0） |
| `TestHealth` | `/api/health` 无需鉴权，返回 `{"status": "ok"}` |
