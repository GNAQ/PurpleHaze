# 浅色主题工作台化复盘

日期：2026-03-29
状态：已落地，可作为后续浅色主题迭代的基线文档

## 目的

这轮改动不是单纯“把颜色调好看”，而是纠正 PurpleHaze 浅色主题的视觉权重分布，并把页面从普通浅色面板改成更像工作台的结构。

最终目标有两个：

- 可读性优先，真实工作对象始终压过背景情绪
- 艺术性来自构图、分区和节奏，而不是把壳层染得更花

## 浏览器验证后的核心结论

在真正的页面里，旧方向的问题并不是“背景偏紫偏绿”这么简单，而是层级反了：

- shell 背景和 chrome 比内容区更抢眼
- function region 太轻，像一层白纸贴在氛围背景上
- 卡片和子卡片过于接近白色，内部层级不够
- 用户第一眼会先看到气氛，而不是机器、任务、表格和表单

因此，后续浅色主题一律遵守下面这条原则：

**壳层退后，工作区前置，艺术性通过工作区构图获得。**

## 这轮最终采用的方向

采用的是 Window-First Tonal Inversion，再叠加 Section-Band Workbench 的局部做法。

翻成工程语言就是：

- 背景只保留很轻的紫绿气氛
- 页面真正的功能区获得更扎实的面量
- 卡片不再接近纯白，而是改为更密实的浅紫灰 / 浅绿灰工作表面
- 子卡片、空状态、表单分组用二级层级来建立节奏
- 顶部不再保留只承担品牌展示的全局 banner，页面自己的 toolbar 才是主要视觉入口

## 已证明有效的层级规则

### 1. Shell background

- 只能营造很轻的 atmosphere
- 不能承担信息层级
- 颜色可以有，但必须低饱和、低对比

### 2. App chrome

- 侧边栏可以有体积感，但不能变成主角
- 不再单独保留一个只写 PurpleHaze 的顶栏
- 全局状态如果必须存在，应当收进侧边栏或移动端浮层，不要占据整条页面上边缘

### 3. Function region

- 机器页、任务页、历史页、设置页都应该先有一个完整的工作区面
- 用户应该先识别“这页在操作什么”，再识别页面情绪

### 4. Primary card

- 不能是近白色纸片
- 应该比 shell 更重、比 function region 更聚焦
- 可以用轻微 seam、head strip、阴影来形成可操作感

### 5. Sub-card / detail block

- 必须与主卡形成可见的第二层级
- 不能靠白上加白
- 更适合用 semantic tint、浅渐变、弱边框建立分组

## 这轮具体落地的结构做法

### 去掉全局顶栏

这是本轮一个重要决定。

原因：

- 原顶栏主要承载的是 PurpleHaze 文案和少量状态信息
- 它并不提供真正的页面级操作
- 在浅色主题里，这条横条很容易重新把视觉重心拉回壳层

现在的做法：

- 桌面端把全局状态收进左侧边栏顶部
- 移动端只保留一个轻量浮层，放菜单按钮和状态 capsule
- 页面首屏由各自的 toolbar 直接开始

这条规则后续应该继续保持，除非顶栏承担了新的强功能，否则不要恢复。

### 页面自己的 toolbar 成为第一层入口

每个主页面都用了相同的骨架：

- page shell
- toolbar
- content body
- workbench / local surface

这样做的好处：

- 不靠大标题撑层级
- 页面顶部应该尽量只保留具体状态和具体操作；如果一段文案只是概念口号或抽象命名，就不该留在 toolbar 里
- 统计 chip、筛选和操作按钮能形成自然的入口区
- 页面的个性来自功能组织，而不是额外堆装饰

### 用 board stage 建立工作台感

Machines 和 Tasks 这类 board 页，不应该只是把卡片排在空背景上，而应该先有一个 stage。

当前有效做法：

- 外层是有轻微 atmosphere 的 board stage
- 内层是承载卡片与滚动的实际工作区
- 再往里才是机器卡、任务列、空状态等对象

这样卡片就像被安放在一个真实的控制台里，而不是浮在一张背景纸上。

### 历史页走 ledger，而不是普通 table page

历史页已经证明，表格类页面也需要构图语言，而不是只有一个 table。

有效模式：

- 页面层是 Archive Ledger
- 功能层是 Filter View
- 数据层才是记录表格

这样筛选、统计、表格不会互相抢层级，且表格更自然地成为主对象。

### 弹窗内部需要双区结构，而不是单列堆表单

TaskCreateModal 的提升来自结构，而不只是配色。

有效模式：

- 左侧放模板与执行摘要
- 右侧放主要配置内容
- tab 内继续用 panel 拆分粘贴识别、环境变量、参数区

经验：

- 一旦信息密度高，艺术性要通过“区域职责清晰”获得
- 只给表单换背景色，收益很有限

## 后续继续迭代时的禁止事项

- 不要再把 shell 或 header 做成全页最显眼的区域
- 不要让 card、function region 和 modal body 再次接近纯白
- 不要回到只有标题 + 一排按钮 + 一大块空白内容区的页面骨架
- 不要为“更有艺术性”直接提高整体饱和度，先看是不是构图问题
- 不要把空状态做成完全无结构的留白块

## 推荐的后续精修顺序

如果继续做浅色主题，不要再改大骨架，按这个顺序精修：

1. 先修小字号、kicker、chip、filter bar 的字重与对比
2. 再修设置页和次级弹窗，让它们跟主页面语言一致
3. 最后才考虑机器卡、任务卡和状态胶囊的微观质感

## 涉及文件

- frontend/src/components/AppLayout.tsx
- frontend/src/index.css
- frontend/src/theme/tokens.ts
- frontend/src/theme/antdTheme.ts
- frontend/src/pages/MachinesPage.tsx
- frontend/src/pages/TasksPage.tsx
- frontend/src/pages/HistoryPage.tsx
- frontend/src/pages/SettingsPage.tsx
- frontend/src/components/TaskCreateModal.tsx

## 一句话结论

PurpleHaze 的浅色主题后续不应该再往“更亮、更白、更像普通 dashboard”方向走，而应该继续维持：**轻壳层、重工作区、靠构图出气质。**