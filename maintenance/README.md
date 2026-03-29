# Maintenance — 开发速查

## 核心文档

| 文档 | 内容重点 |
|---|---|
| [architecture.md](architecture.md) | 三个核心服务的职责边界与交互模式，启动顺序，并发模型 |
| [scheduling.md](scheduling.md) | Tick 循环设计，GPU 条件门控，流水线串行化，离线检测，取消机制 |
| [task-execution.md](task-execution.md) | 命令构建（config→shell），本地/远程执行路径差异，状态转换，崩溃恢复 |
| [monitoring.md](monitoring.md) | cache vs history 双数据结构，采集并发安全，本地/远程采集差异 |
| [frontend.md](frontend.md) | 前端状态同步模型、主题系统、命令粘贴解析、机器页滚动与拖拽实现 |
| [frontend_redesign.md](frontend_redesign.md) | 前端重设计方向、已采用的交互思路与后续视觉演进计划 |
| [light-theme-workbench.md](light-theme-workbench.md) | 浅色主题工作台化复盘：层级规则、顶栏移除原因、后续迭代禁忌与精修顺序 |
| [known_issues.md](known_issues.md) | 当前功能缺口、已知技术缺陷与待修复风险 |
## 测试

| 文档 | 内容重点 |
|---|---|
| [testing/README.md](testing/README.md) | 测试体系概览、基础设施（conftest.py）、fixture 依赖关系 |
| [testing/api-integration.md](testing/api-integration.md) | API 集成测试：认证、机器、流水线、任务等全部 CRUD 端点 |
| [testing/gpu-condition.md](testing/gpu-condition.md) | GPU 条件评估：强制/智能模式、表达式、虚拟机器场景 |
| [testing/scheduler.md](testing/scheduler.md) | 调度器：命令构建、启动恢复、任务取消、虚拟机器命令 |
| [testing/complex-scenarios.md](testing/complex-scenarios.md) | 复杂场景：多流水线×多任务×多机器、调度器 tick、端到端工作流 |
| [testing/guide.md](testing/guide.md) | 编写新测试的指引、已发现 Bug 记录 |

## 参考

| 文档 | 内容 |
|---|---|
| [reference/api-endpoints.md](reference/api-endpoints.md) | 所有 API 端点列表 |
| [reference/db-schema.md](reference/db-schema.md) | 数据库表结构 |
