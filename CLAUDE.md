# CLAUDE.md — PurpleHaze 项目工作规范

## 项目概览

PurpleHaze 是一个 GPU 任务调度和机器资源管理工具，面向深度学习工作流。

- 前端：React + TypeScript + Ant Design，运行在 34356 端口
- 后端：Python FastAPI + SQLite，运行在 34357 端口
- 详细架构见 `maintenance/`，功能需求见 `dev_plan/`

---

## 工作规范

### 1. 长程任务前先列 TODO

接到任何涉及多个文件修改、或需要分步骤推进的任务，**在动手之前**先用 `TaskCreate` 把步骤拆出来，每完成一步立即 `TaskUpdate` 标记完成。

判断是否为"长程任务"的标准：
- 需要改超过 2 个文件
- 涉及前后端联动
- 需要先读懂现有代码再修改
- 需要新增功能模块（而不是小修小补）

不需要列 TODO 的情况：单文件的局部修复、文档更新、回答问题。

### 2. 前端测试使用 Playwright MCP

凡是涉及前端交互的改动（UI、表单、流程），**验证时主动使用 Playwright MCP**，不要只靠代码审查推断行为是否正确。

标准流程：
1. 启动服务（前后端均需运行，参考下方启动命令）
2. 用 `mcp__playwright__browser_navigate` 打开页面
3. 用 `mcp__playwright__browser_snapshot` 观察当前状态
4. 模拟用户操作（`browser_click`, `browser_fill_form`, `browser_type` 等）
5. 截图确认结果（`browser_take_screenshot`）

对于以下场景必须用 Playwright 验证，不得跳过：
- 新增或修改表单字段
- 修改任务创建/提交流程
- 修改流水线展示逻辑
- 修改机器卡片或拖拽行为

---

## 开发环境

### 启动服务

```bash
# 后端（在 backend/ 目录）
cd backend && uvicorn main:app --host 0.0.0.0 --port 34357 --reload

# 前端（在 frontend/ 目录）
cd frontend && npm run dev
```

也可以直接用 `start.sh`（不带 reload）。

### 关键路径

| 场景 | 文件 |
|---|---|
| 加新 API 端点 | `backend/routers/` + `frontend/src/api/` |
| 改调度逻辑 | `backend/services/task_scheduler.py` |
| 改 GPU 条件评估 | `backend/services/gpu_condition.py` |
| 改 DB 模型 | `backend/models/` + `backend/migrations.py`（必须同步加迁移） |
| 改任务创建表单 | `frontend/src/components/TaskCreateModal.tsx` |
| 改流水线展示 | `frontend/src/pages/TasksPage.tsx` |
| 改机器卡片 | `frontend/src/components/MachineCard.tsx` + `frontend/src/pages/MachinesPage.tsx` |

---

## 项目约定

- **DB 变更必须配套迁移**：改 `backend/models/` 后，在 `backend/migrations.py` 中追加 `ALTER TABLE ADD COLUMN IF NOT EXISTS`，不要指望重建表
- **task.status 只由调度器变更**：路由层只做 cancel，不直接改 status 为 running/completed/failed
- **日志路径存相对路径**：`task.stdout_path` 存 `"{task_id}/stdout.txt"` 而非绝对路径
- **前端轮询 5 秒**：TasksPage 每 5s 全量拉取，没有 WebSocket，改了后端数据前端最多延迟 5s 可见
- **sort_order 在前端反转显示**：DB 中 sort_order 小的任务（队列头）在前端显示在列表底部，见 `maintenance/frontend.md`

## 参考文档

- 架构与数据流：`maintenance/`
- 功能需求：`dev_plan/`
