# CLAUDE.md — PurpleHaze 项目工作规范

## 项目概览

PurpleHaze 是一个 GPU 任务调度和机器资源管理工具，面向深度学习工作流。

- 前端：React + TypeScript + Ant Design，运行在 34356 端口
- 后端：Python FastAPI + SQLite，运行在 34357 端口
- 详细架构见 `maintenance/`

---

## 必读原则

- 任何涉及多个文件修改、或需要分步骤推进的任务，必须在动手之前先用 `TaskCreate` 列出 TODO 步骤，每完成一步立即 `TaskUpdate` 标记完成。列出任务时，需要遵循以下原则：
- 任何开发工作开始前先快速检查最近 10 个 git commit messages 的 first line，了解近期迭代方向和已完成的工作
  - 如有必要，继续深入查看相关 commit 的 diff 和 PR 描述，避免与刚完成的工作冲突或重复
  - 如果涉及 git 维护，先查 git log，并且查最近 commit messages 的完整内容
  - 如果不理解某段代码，先用 git log -S "关键代码片段" 定位引入该代码的 commit，理解当时的动机和上下文，再修改
- 任何涉及前端交互的改动（UI、表单、流程）都必须用 Playwright MCP 验证，不能只靠代码审查推断行为是否正确
  - 具体流程见下文“前端测试使用 Playwright MCP”
- 任何涉及后端的任务，改完需要跑测试
- 任何设计功能添加、修改的任务，需要同步维护 `maintainance/` 下的文档，保持文档与代码的同步更新

## 工作规范

### 1. 前端测试使用 Playwright MCP

标准流程：
1. 启动服务（前后端均需运行，参考下方启动命令）
2. 用 `mcp__playwright__browser_navigate` 打开页面
3. 用 `mcp__playwright__browser_snapshot` 观察当前状态
4. 模拟用户操作（`browser_click`, `browser_fill_form`, `browser_type` 等）
5. 截图确认结果（`browser_take_screenshot`）
6. 清理产生的临时截图，然后关闭 Playwright 调起的浏览器的整个窗口


### 2. Git 历史即项目记忆

本项目不维护 CHANGELOG，**git history 是唯一的迭代记录和决策上下文来源**。在开发过程中必须积极利用。

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

