# Frontend Redesign Plan

> 核心原则：**最高效率的信息传递、最清晰的交互**，设计是这两者的附属品。
> 设计语言：Dark cyberpunk-lite — 克制的 glow、有层次的毛玻璃、信息密度优先。

---

## 现状问题

当前 UI 完成了暗色换肤，但本质上是 Ant Design 默认组件 + 换色。四个维度的问题：

| 维度 | 现状 | 问题 |
|------|------|------|
| **Layout** | 180px 固定侧边栏 + 全宽内容区；机器卡片水平滚动；流水线 320px 固定列 | 侧边栏浪费空间（只有4个菜单项）；机器卡片无法一览多台；流水线列宽固定不适应屏幕 |
| **Coloring** | 已换暗色，但层次单一 | surface0/surface1/surface2 之间对比度不够，卡片和背景融为一体；状态色（running/completed/failed）辨识度低 |
| **Animation** | 仅 fade-in + running-glow | 无路由切换动画；无 hover 反馈动画；无加载骨架屏；resource bar 首次加载无动画感；拖拽无视觉反馈 |
| **Visual Style** | Ant Design 默认组件形态 | "DRAG" 文字丑陋；GPU 信息是平铺文字无视觉层次；空状态用 antd 默认 Empty；表格是标准 antd Table 无个性 |

---

## Phase 1: Layout 重构

### 1.1 侧边栏 → 收缩式导航轨 (Icon Rail)

**改动文件**: `AppLayout.tsx`, `index.css`

- 默认态：**64px 宽 icon-only 竖条**，只显示图标 + 选中指示条
- Hover/展开态：**200px 宽**，图标 + 文字 + 运行状态徽标
- 过渡动画：`width 0.25s cubic-bezier(0.4,0,0.2,1)`
- 选中项左边缘有 **3px 紫色竖条指示器**（替代背景高亮）
- 底部放退出按钮（从 header 移走），header 只保留 logo + 全局状态

**效果**: 内容区从 `calc(100% - 180px)` 增长到 `calc(100% - 64px)`，多出 116px 给卡片和流水线。

### 1.2 机器页 → 响应式 Grid

**改动文件**: `MachinesPage.tsx`, `MachineCard.tsx`

- 替换水平滚动为 **CSS Grid**: `grid-template-columns: repeat(auto-fill, minmax(420px, 1fr))`
- 卡片高度自适应内容（不再固定）
- 移除同步双滚动条逻辑（不再需要）
- 连接的机器卡片稍高（展示 GPU 详情），离线卡片压缩为 mini 摘要态

### 1.3 流水线列 → 弹性宽度

**改动文件**: `TasksPage.tsx`

- 列宽从固定 320px 改为 `minmax(300px, 1fr)`，但保持水平滚动（流水线数量可能很多）
- 当只有 1-2 条流水线时，列宽自动拉伸填满
- 新建流水线的 "+" 区域从一整列变为尾部 **小按钮**

### 1.4 Header 精简

**改动文件**: `AppLayout.tsx`

- 高度从 52px 降到 **48px**
- 移除退出按钮（移到侧边栏底部）
- 右侧改为显示 **全局运行状态概览**：`● 2 running · 3 waiting · 5 machines` 一行 mono 小字

---

## Phase 2: Visual Style 重构

### 2.1 拖拽手柄 → 微妙的抓手点

**改动文件**: `MachineCard.tsx`, `TasksPage.tsx`, `index.css`

- 移除 ":: DRAG ::" 文字
- 替换为 **6 个小圆点 (grip dots)** 排列成 2×3 网格，灰色半透明
- CSS class `.ph-grip`: `display: grid; grid-template: repeat(3, 4px) / repeat(2, 4px); gap: 3px`
- 每个点: `width: 4px; height: 4px; border-radius: 50%; background: rgba(188,115,173,0.3)`
- Hover 时点亮到 0.6 opacity

### 2.2 GPU 信息 → 数据仪表盘风格

**改动文件**: `MachineCard.tsx`

- GPU 概览格子：增加 **圆环进度指示器** 替代横条（利用率）
  - 环形用 SVG `<circle>` + `stroke-dashoffset`
  - 颜色阈值不变：green → amber → red
  - 圆环内居中显示百分比数字
- 温度显示：用 **渐变色数字**（低温蓝绿 → 高温红）替代纯文字
- 显存横条保持（适合宽数据），但加 **刻度标记**（25%/50%/75% 细竖线）

### 2.3 状态标签 → 带图标的 Pill Badge

**改动文件**: `TasksPage.tsx`, `HistoryPage.tsx`, `index.css`

- RUNNING: 绿色 pill + 旋转的小圆环 icon + pulse 边框
- WAITING: 紫色 pill + 时钟 icon
- COMPLETED: 灰绿 pill + check icon（无动画，低调）
- FAILED: 红色 pill + x icon + 微弱红色 glow
- CANCELLED: 灰色 pill + slash icon

### 2.4 空状态 → 自定义插图

**改动文件**: `TasksPage.tsx`, `index.css`

- 替换 antd `<Empty>` 为自定义的 **ASCII art 风格空状态**
- 流水线空态：用 CSS 绘制的虚线框 + "No active tasks" 渐隐文字
- 整体更 geeky，而不是 antd 的灰色图标

### 2.5 历史表格 → 紧凑数据视图

**改动文件**: `HistoryPage.tsx`

- 移除 antd Table 展开行箭头列（收窄浪费）
- 改为 **行点击展开详情面板**（在行下方 slide-down 展开）
- 退出码列：数字改为 **带颜色的圆形徽标**（0=绿圆, 非0=红圆, 无=灰圆）
- 添加行内 **微型进度时间线**（显示任务在哪天运行了多久，横向小条）

---

## Phase 3: Animation 系统

### 3.1 路由切换动画

**改动文件**: `App.tsx`, `index.css`

- 页面切换使用 **fade + 轻微 translateY**
- 进入: `opacity 0→1, translateY(12px→0)`, 200ms ease-out
- 退出: `opacity 1→0`, 100ms（快进快出）
- 使用 CSS class toggle，不引入额外库

### 3.2 卡片交互动画

**改动文件**: `MachineCard.tsx`, `TasksPage.tsx`, `index.css`

- **Hover lift**: `transform: translateY(-2px); box-shadow` 增强 — 0.2s ease
- **Click ripple**: 点击时短暂的 border-glow flash（0.3s）
- **拖拽态**: 卡片 scale(1.02) + 更强的 glow shadow + 背景变亮
- **放下动画**: spring-like 回弹（用 CSS `cubic-bezier(0.34, 1.56, 0.64, 1)`)

### 3.3 数据加载动画

**改动文件**: `MachineCard.tsx`, `ResourceBar.tsx`, `index.css`

- Resource bar 首次渲染：**宽度从 0 动画到目标值**，stagger delay（第2个 bar delay 50ms，第3个 100ms...）
- GPU 圆环：`stroke-dashoffset` 从满到目标值动画，0.8s ease-out
- 机器卡片首次加载：stagger fade-in（每张卡片间隔 80ms）
- 数值变化时：数字用 CSS `transition` 平滑过渡（利用率、温度）

### 3.4 状态转换动画

**改动文件**: `TasksPage.tsx`, `index.css`

- 任务 WAITING → RUNNING: border 从紫色渐变到绿色 + glow 渐入
- 任务完成: glow 渐出 0.5s，border 回归默认
- 新任务加入队列: slide-in from right + fade-in

### 3.5 微交互

**改动文件**: `index.css`

- 按钮 hover: 轻微 scale(1.02) + shadow 增强
- Icon 按钮 hover: icon 颜色从 textTer → purple400，0.15s
- 侧边栏菜单项: 选中指示条 slide-in 动画（height transition）
- 刷新按钮点击: icon 旋转 360° 一次（0.6s）

---

## Phase 4: Coloring 优化

### 4.1 层次对比度增强

**改动文件**: `tokens.ts`, `antdTheme.ts`

- `dark.bg`: 保持 `#0b0811`（最深）
- `dark.surface0`: 调整为 `#0f0c18`（与 bg 更明显区分）
- `dark.surface1`: 调整为 `#171222`（卡片表面更突出）
- `dark.surface2`: 调整为 `#1f1930`（hover 态更明显）
- 增加 `dark.surface3`: `#2a2240`（弹窗、浮层）

### 4.2 状态色增强

- ONLINE 状态: 不只是文字绿，增加 **卡片左边缘 3px 绿色竖条**
- RUNNING 任务: 绿色 glow 从 `0.20→0.40` 增强到 `0.25→0.50`
- FAILED: 退出码和行背景加 **极微弱的红色调** (`rgba(224,83,99,0.04)`)

### 4.3 数据色阶

- GPU 利用率/温度: 引入 **5 档色阶** 替代 3 档
  - 0-30%: `#75c181` (cool green)
  - 30-50%: `#a8d86c` (warm green)
  - 50-70%: `#e8a838` (amber)
  - 70-85%: `#e07838` (orange)
  - 85-100%: `#e05363` (red)

---

## 实施顺序

| Step | Phase | 影响范围 | 预估改动量 |
|------|-------|---------|-----------|
| 1 | 4.1 | tokens.ts, antdTheme.ts | 小 — 调参数 |
| 2 | 2.1 | MachineCard, TasksPage, index.css | 小 — 替换 DRAG 文字 |
| 3 | 3.5 + 3.1 | index.css, App.tsx | 中 — 加 CSS 动画类 |
| 4 | 1.1 + 1.4 | AppLayout.tsx, index.css | 中 — 重写侧边栏 |
| 5 | 1.2 | MachinesPage.tsx | 中 — 改 grid 布局 |
| 6 | 2.2 + 4.3 | MachineCard.tsx | 大 — GPU 仪表盘 |
| 7 | 2.3 + 2.4 | TasksPage, HistoryPage, index.css | 中 — 状态标签 + 空态 |
| 8 | 3.2 + 3.3 + 3.4 | 多文件 | 中 — 交互动画 |
| 9 | 1.3 | TasksPage.tsx | 小 — 列宽调整 |
| 10 | 2.5 | HistoryPage.tsx | 中 — 表格重构 |

---

## 不改的东西

- 所有业务逻辑、API 调用、状态管理 — 零改动
- 模态框内部表单结构 — 保持不变（TaskCreateModal, GpuConditionDialog 等）
- 后端 — 零改动
- 路由结构 — 保持不变
