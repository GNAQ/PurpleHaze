# Maintenance — 开发速查

## 核心文档

| 文档 | 内容重点 |
|---|---|
| [architecture.md](architecture.md) | 三个核心服务的职责边界与交互模式，启动顺序，并发模型 |
| [scheduling.md](scheduling.md) | Tick 循环设计，GPU 条件门控，流水线串行化，离线检测，取消机制 |
| [task-execution.md](task-execution.md) | 命令构建（config→shell），本地/远程执行路径差异，状态转换，崩溃恢复 |
| [monitoring.md](monitoring.md) | cache vs history 双数据结构，采集并发安全，本地/远程采集差异 |
| [frontend.md](frontend.md) | 状态同步模型，任务列表展示逻辑（sort_order反转+折叠），拖拽持久化 |

## 参考

| 文档 | 内容 |
|---|---|
| [reference/api-endpoints.md](reference/api-endpoints.md) | 所有 API 端点列表 |
| [reference/db-schema.md](reference/db-schema.md) | 数据库表结构 |
