# 前端数据流

## 状态同步模型

前端没有单一的业务状态中心。任务、机器、历史记录等业务数据仍由各页面维护自己的本地 state，并按页面职责各自轮询或主动刷新。Zustand 目前承担三类跨页面状态：持久化 JWT token（`authStore`）、跨组件共享运行中任务计数（`tasksStore`）、以及持久化主题模式（`themeStore`）。

`App.tsx` 在应用入口读取 `themeStore.mode`，并同时完成三件事：

- 调用 `getAntdTheme(mode)` 生成当前 Ant Design 主题
- 将 `document.documentElement.dataset.theme` 设为 `light` / `dark`，驱动全局 CSS 覆盖
- 让所有页面与组件通过 `useTheme()` 读取语义化 token（`t.*`）和主题切换函数

这意味着主题切换是**纯前端状态切换**，不会请求后端；主题偏好保存在浏览器本地，刷新页面后仍然生效。

`TasksPage` 是数据流最复杂的页面，它的主要状态来自每 5 秒一次的全量拉取：

```
useEffect → setInterval(5s)
    → tasksApi.listPipelines()          # 返回流水线树（含嵌套 tasks）
    → tasksApi.listOrphanedTasks()      # 返回孤立任务
    → setPipelines(...) + setOrphanTasks(...)
    → React re-render
```

但它也不是“完全等下一轮轮询才变化”：

- 任务和机器拖拽排序会先更新本地 state，再异步持久化到后端
- 机器连接状态、机器新增/编辑/删除会直接修改本地 state
- 任务创建、编辑、取消、删除在 API 返回后会主动 `load()`，而不是被动等待 5 秒轮询

---

## 机器页看板与滚动模型

`MachinesPage` 当前采用**单行横向机器看板**而不是 grid。核心结构是一个 `HorizontalScrollArea`：上方是完全自绘的粗横向滚动条，下方是真正承载机器卡片的滚动 viewport。

```
HorizontalScrollArea
    → custom track/thumb              # 顶部自绘滚动条
    → scroll viewport                 # 保留原生 wheel / touchpad 横向滚动
        → flex row of MachineCard     # 固定宽度卡片，单行排列
```

这里有两个实现细节容易被误判：

- 顶部滚动条不是浏览器原生 scrollbar 样式覆盖，而是用 `div + pointer events` 自绘的轨道和 thumb
- 底部原生横向滚动条并没有参与视觉展示，而是通过额外 gutter 被裁掉，仅保留顶部自定义滚动条给用户操作

拖拽层面，机器卡片使用 `@dnd-kit` 的 `horizontalListSortingStrategy`，并额外启用了 `DragOverlay`：

- 拖拽开始后，原卡片降为半透明占位
- 一个独立的 overlay 卡片跟随鼠标移动，形成“卡片浮起并吸附到指针”的反馈
- 排序结束后先本地 `arrayMove(...)`，再批量 `PUT /api/machines/{id}` 持久化 `sort_order`
- 若持久化失败，前端会提示错误并重新 `load()`，回滚到后端真实顺序

---

## 任务列表的展示逻辑

`TasksPage` 对从 API 收到的任务列表做了两层转换，这里容易踩坑：

**1. 排序反转**

API 返回的任务按 `sort_order` 升序（队列头在前），前端在渲染前做 `.reverse()` 变成降序（最新任务在顶），让用户看到“最近加入的任务在上面”。

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

`activeTasks` 直接渲染（含拖拽支持）。`archivedTasks` 默认不显示，用 `archivedVisibleCount[pipeline.id]` 控制“加载更多”展开数量。这是**纯前端状态**，不存入后端；切换页面或刷新后已折叠状态会重置。

---

## 拖拽排序的数据持久化

机器卡片拖拽（`MachinesPage`）和任务拖拽（`TasksPage`）都用 `@dnd-kit`，但持久化策略不同：

- **机器卡片**：拖拽结束后，对所有机器按新顺序批量调用 `PUT /api/machines/{id}` 更新 `sort_order`
- **任务**：只对同一条流水线内的 WAITING 任务支持拖拽，拖拽结束后循环调用 `PUT /api/tasks/{id}` 并写入新的 `sort_order`

两者都是**先更新本地 state（立即生效）再异步持久化**，但失败后并非静默：会显示错误消息，并重新拉取后端数据回滚 UI。

---

## 完整命令粘贴解析

`TaskCreateModal` 支持在弹窗里直接粘贴一整条 shell 命令，前端会先本地解析，再把结果填回结构化表单。这个解析完全发生在浏览器内，不请求后端。

数据流如下：

```
用户粘贴完整命令
    → handleParseCommand()
    → parseCommand(raw)
        → 识别 cd 前缀            → work_dir
        → 识别前导 KEY=VALUE     → env_vars
        → 识别主命令             → command
        → 识别剩余 flags / args  → args[]
    → form.setFieldsValue(...)
    → setEnvVars(...) + setArgs(...)
```

当前解析器支持的几类输入：

- `cd /workspace && ...` 或 `cd /workspace; ...` 前缀
- 命令名前的环境变量，如 `CUDA_VISIBLE_DEVICES=0,1`
- `python train.py`、`python -m module.name`、`python -c ...` 这类需要连在一起理解的主命令
- 带引号的参数，以及 `--flag value`、`--flag=value`、`-f value`、位置参数

解析后的结果会回填到普通表单字段，所以后续提交 API 时，仍然走原有的结构化 payload，而不是把原始 shell 字符串直接发给后端。

---

## GPU 条件配置的数据流

`GpuConditionDialog` 是一个受控组件，不直接写 API。它的完整数据流：

```
TaskCreateModal 或 TaskBatchModal
    → 用户点击“设置抢卡条件”
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
tasksApi.createBatchTasks({commands, pipeline_id, machine_id, base_config, gpu_condition})
```

文件格式：每行一条完整命令（如 `python train.py --lr 0.001`），CSV 和 TXT 用同一套解析逻辑（按行读取），CSV 的列结构被忽略。
