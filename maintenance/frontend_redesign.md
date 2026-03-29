# 前端重设计

> 设计语言：Dark cyberpunk-lite — 克制的 glow、有层次的毛玻璃、信息密度优先。
> 核心原则：最高效率的信息传递、最清晰的交互。设计是这两者的附属品。

---

## 已落地

以下改动已合入 main，不要重复实现或回退：

- **侧边栏**：收缩式 icon rail（54px），hover 展开到 188px。选中项左边缘 3px 紫色竖条。
- **顶栏已移除**：桌面端状态摘要收进 sidebar 顶部，移动端用浮层。除非顶栏有新的强功能需求，不要恢复。
- **主题切换**：深色/浅色，Zustand 持久化，同步 Ant Design + CSS。浅色主题走工作台化方向，详见 `light-theme-workbench.md`。
- **机器页**：横向单行看板，顶部自绘粗滚动条，底部原生 scrollbar 被裁掉。dnd-kit `DragOverlay` 跟手悬浮。
- **拖拽手柄**：grip dots（2x3 小圆点），替代旧的 `:: DRAG ::` 文字。
- **GPU 仪表盘**：圆环进度指示器（SVG stroke-dashoffset）、渐变色温度数字、显存横条带刻度。5 档色阶（green → amber → red）。
- **状态标签**：pill badge + 语义色 + pulsing dot（per-status icon 未落地）。
- **命令粘贴解析**：TaskCreateModal 支持粘贴完整 shell 命令，前端本地解析回填表单。
- **路由切换动画**：fade + translateY，CSS class toggle。
- **卡片交互**：hover lift、drag overlay 跟手、放下回弹。
- **页面骨架统一**：toolbar + workbench/surface，不靠大标题撑层级。

## 待做

按优先级排序：

### 布局

- 流水线列宽从固定 320px 改为 `minmax(300px, 1fr)`，1-2 条时自动拉伸
- 新建流水线的 "+" 区域从整列缩为尾部小按钮

### 视觉

- 状态标签补齐 per-status icon（时钟/check/slash 等）
- 顶层"暂无流水线"空状态换成自定义风格，替换 antd `<Empty>`
- 历史表格：行点击展开（替代箭头列）、行内微型时间线
- surface 分层继续拉开对比度；部分状态色对比度偏保守

### 动画

- 加载动画：resource bar 宽度从 0 动画到目标、GPU 圆环 stroke 动画、卡片 stagger fade-in
- 状态转换动画：WAITING→RUNNING border 渐变 + glow、完成后 glow 渐出、新任务 slide-in
- 刷新按钮点击旋转 360 度

### 配色

- dark surface 层级可继续调整（bg/surface0/surface1/surface2 间距不够）
- ONLINE 机器左边缘加绿色竖条
- FAILED 行背景加极微弱红色调

## 不改的东西

- 所有业务逻辑、API、状态管理 — 零改动
- GpuConditionDialog 内部表单结构
- 后端、路由结构
