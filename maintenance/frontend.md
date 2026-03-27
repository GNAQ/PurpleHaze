# 前端数据流

## 状态同步模型

前端没有全局状态管理中心，各页面维护自己的本地 state 并独立轮询后端。Zustand store 只承担两件事：持久化 JWT token（`authStore`），以及跨组件共享轻量级任务快照（`tasksStore`，使用范围有限）。

`TasksPage` 是数据流最复杂的页面，它的整个状态来自每 5 秒一次的全量拉取：

```
useEffect → setInterval(5s)
    → tasksApi.listPipelines()      # 返回流水线树（含嵌套 tasks）
    → tasksApi.listOrphaned()       # 返回孤立任务
    → setPipelines(...) + setOrphanTasks(...)
    → React re-render
```

没有乐观更新——用户点击"取消"或"删除"后，UI 等待下一轮轮询才会反映变化（最多 5 秒延迟）。

---

## 任务列表的展示逻辑

`TasksPage` 对从 API 收到的任务列表做了两层转换，这里容易踩坑：

**1. 排序反转**

API 返回的任务按 `sort_order` 升序（队列头在前），前端在渲染前做 `.reverse()` 变成降序（最新任务在顶），让用户看到"最近加入的任务在上面"。

```typescript
const displayedTasks = [...pipeline.tasks].reverse()
```

因此，DB 中 `sort_order` 最小的任务（最先提交、最先执行）在 UI 上显示在**最下方**。

**2. 活跃任务 / 已结束任务分离**

`displayedTasks` 被拆分为两组：

```typescript
const activeTasks   = displayedTasks.filter(t => t.status === 'waiting' || t.status === 'running')
const archivedTasks = displayedTasks.filter(t => t.status !== 'waiting' && t.status !== 'running')
```

`activeTasks` 直接渲染（含拖拽支持）。`archivedTasks` 默认不显示，用 `archivedVisibleCount[pipeline.id]` 控制"加载更多"展开数量——这是**纯前端状态**，不存入后端。切换页面或刷新后已折叠状态会重置。

---

## 拖拽排序的数据持久化

机器卡片拖拽（`MachinesPage`）和任务拖拽（`TasksPage`）都用 `@dnd-kit`，但持久化策略不同：

- **机器卡片**：拖拽结束后，对所有机器按新顺序批量调用 `PUT /api/machines/{id}` 更新 `sort_order`
- **任务**：只对 WAITING 任务支持拖拽，拖拽结束后调 `PUT /api/tasks/{id}/reorder`

两者都是**先更新本地 state（立即生效）再异步持久化**，失败时不回滚（静默失败）。

---

## GPU 条件配置的数据流

`GpuConditionDialog` 是一个受控组件，不直接写 API。它的完整数据流：

```
TaskCreateModal 或 TaskBatchModal
    → 用户点击"设置抢卡条件"
    → 打开 GpuConditionDialog（传入 gpuCount）
    → 用户配置条件
    → 点击确认 → onConfirm(gpuCondition: GpuCondition)
    → 父组件保存到 pendingGpuCondition state
    → 最终提交时合并到 task payload
```

`gpuCount` 由父组件在选择机器后调用 `machinesApi.getSnapshot(machineId)` 获取，传入对话框用于渲染 GPU 选择多选框的选项数量。

---

## 批量任务的前端处理

批量任务（`TaskBatchModal`）的文件解析完全在前端完成，不上传文件到后端：

```typescript
const raw = await file.text()           // FileReader 读取文件内容
const commands = parseBatchText(raw)    // 前端解析，过滤空行和 # 注释
// 提交时将 commands: string[] 作为 JSON body 发送
tasksApi.createBatchTasks({commands, pipeline_id, machine_id, base_config, gpu_condition})
```

文件格式：每行一条完整命令（如 `python train.py --lr 0.001`），CSV 和 TXT 用同一套解析逻辑（按行读取），CSV 的列结构被忽略。
