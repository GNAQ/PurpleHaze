# TODO

## 3. 前后端类型同步

后端 Pydantic schema（`backend/schemas/`）和前端 TypeScript interface（`frontend/src/api/`）是手动维护的两份副本，随 API 演化容易漂移。
需要决定方向：引入 openapi-generator / orval 自动生成前端类型，或约定手动同步的规范。

## 4. 运维 runbook

在 `maintenance/` 下补充一份运维排查文档，覆盖常见问题：
- 调度器卡住 / 任务一直 WAITING 怎么排查
- SSH 连接断开的恢复流程
- 手动重置异常状态任务
- 查看后端日志、确认服务健康

## 5. 测试策略

项目目前零测试。起步方向建议从成本低、价值高的纯逻辑模块开始：
- `backend/services/gpu_condition.py`：纯函数，无 IO，最适合单元测试
- `backend/services/task_scheduler.py`：核心调度逻辑，集成测试
- 前端：用 Playwright 覆盖主要用户流程（任务创建、流水线操作）

## 6. 迭代记录

建立轻量的迭代记录，帮助 agent 在做功能演化决策时理解设计上下文。
形式待定：`CHANGELOG.md` 或在 `dev_plan/` 里做版本标注均可。
