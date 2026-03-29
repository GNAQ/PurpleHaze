# Maintenance — 开发速查

## 核心文档

| 文档 | 内容 |
|---|---|
| [architecture.md](architecture.md) | 三个核心服务的职责与交互、启动顺序、并发模型 |
| [scheduling.md](scheduling.md) | Tick 循环、GPU 条件门控、流水线串行化、离线检测、取消 |
| [task-execution.md](task-execution.md) | 命令构建、本地/远程执行路径、状态转换、崩溃恢复 |
| [monitoring.md](monitoring.md) | cache vs history 双数据结构、采集并发安全、本地/远程差异 |
| [frontend.md](frontend.md) | 前端状态同步、主题系统、命令粘贴解析、机器页滚动与拖拽 |
| [frontend_redesign.md](frontend_redesign.md) | 前端重设计方向、已落地改动、待做清单 |
| [light-theme-workbench.md](light-theme-workbench.md) | 浅色主题工作台化规则：层级规则、禁止事项、精修顺序 |
| [known_issues.md](known_issues.md) | 功能缺口与已知技术缺陷 |
| [enhancement_suggests.md](enhancement_suggests.md) | 非需求的改进建议 |

## 测试

| 文档 | 内容 |
|---|---|
| [testing/README.md](testing/README.md) | 测试体系概览、基础设施（conftest.py）、fixture 依赖 |
| [testing/api-integration.md](testing/api-integration.md) | API 集成测试：认证、机器、流水线、任务 CRUD |
| [testing/gpu-condition.md](testing/gpu-condition.md) | GPU 条件评估：强制/智能模式、表达式、虚拟机器 |
| [testing/scheduler.md](testing/scheduler.md) | 调度器：命令构建、启动恢复、任务取消 |
| [testing/complex-scenarios.md](testing/complex-scenarios.md) | 复杂场景：多流水线 x 多任务 x 多机器、端到端 |
| [testing/guide.md](testing/guide.md) | 编写新测试的指引、已发现 Bug |

## 参考

| 文档 | 内容 |
|---|---|
| [reference/api-endpoints.md](reference/api-endpoints.md) | 所有 API 端点列表 |
| [reference/db-schema.md](reference/db-schema.md) | 数据库表结构 |
