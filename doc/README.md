# PurpleHaze 开发文档

> 面向开发者的持续维护文档。聚焦"理解代码意图 + 安全扩展"，不重复代码注释中的实现细节。

---

## 文档索引

| 文件 | 内容 |
|------|------|
| [architecture.md](architecture.md) | 整体架构、数据流、关键设计决策 |
| [data-models.md](data-models.md) | 数据库模型、字段含义、关系与约束 |
| [services.md](services.md) | 服务层：SSHManager、ResourceMonitor、TaskScheduler、GpuCondition |
| [api.md](api.md) | REST API 路由参考（路径、方法、鉴权、输入/输出） |
| [deployment.md](deployment.md) | 部署报告：本地环境配置、一键启动、远程机器要求 |

---

## 项目速览

**PurpleHaze** 是一个基于 Web 的多机器任务调度与 GPU 资源管理平台，面向深度学习 / 数据科学工作流。

- **后端（Xxium）**：Python 3.11+，FastAPI，SQLAlchemy 2（SQLite/aiosqlite），Paramiko SSH
- **前端（PurpleHaze）**：React 18，TypeScript，Vite，Ant Design 5，Zustand
- **数据库**：单文件 SQLite，路径 `$PPH_DATA_DIR/pph.db`（默认 `backend/data/pph.db`）
- **认证**：单用户密码 + JWT Bearer Token（无多用户设计）

核心能力：

1. 本地/远程机器管理（SSH 密钥/密码双认证）
2. 实时资源监控（CPU/内存/GPU，WebSocket 推送 → 定时轮询实现）
3. 多流水线并发任务调度（GPU 抢卡条件评估，`force` / `smart` 两种模式）
4. 任务日志采集（本地 stdout/stderr 文件；远程 SSH 回传后存本地）
5. 任务模板 & GPU 条件预设管理

---

## 约定

- 所有路由均以 `/api/` 为前缀，除 SPA 回退路由外均为 JSON 接口。
- 除 `GET /api/auth/status`、`POST /api/auth/setup`、`POST /api/auth/login` 外，所有接口需要 `Authorization: Bearer <token>` 请求头。
- 时间字段均为 UTC ISO-8601，前端负责转换为本地时区显示。
- `config` / `gpu_condition` 等 JSON 字段：数据库存储为 Python `dict`（SQLAlchemy `JSON` 类型），API 层通过 Pydantic Schema 结构化校验后以 `model_dump()` 写入。
