<!-- 功能缺口 / 规划中 -->

<!-- [已完成] 实现历史页面点击条目就展开的功能（HistoryPage expandedRowRender） -->

历史任务详情展开后缺少 PID（进程号）显示，GPUID 已有但 PID 仍缺失（HistoryPage.tsx expandedRowRender）

实现临时阻塞流水线的按钮/功能

实现全局起任务的cooldown time

抢卡条件的进程部分需要测试

实现task retry & retry uplimit

文本条件表达式缺少独立的语法说明页面（dev_plan 要求"需要提供一个说明文本式条件表达式语法的页面"，当前仅有 GpuConditionDialog 内的内联提示文本）

批量任务名称固定为"批量任务 N"，缺少用户自定义命名或使用命令摘要作为名称的能力（tasks.py create_batch_tasks）



<!-- 已知的技术缺陷 -->

<!-- [已修复] 远端任务取消现已通过 SSH 发送 kill -15/-9（cancel_task） -->

孤立任务（pipeline_id=NULL）之间没有 GPU 冲突检测，force 模式下多个孤立任务可以被分配到同一张卡（_tick 孤立任务段）

跨流水线之间也没有 GPU 冲突检测——两个不同流水线 force 到同一张卡的任务可以被同时调度（_tick 流水线段无全局 GPU 占用追踪）

系统刚启动时 _history 积累不足，若此时有 smart 模式任务，idle_minutes 的实际评估窗口短于设定值，可能过早触发（resource_monitor + gpu_condition）

远端日志回收使用 cat 整文件通过 SSH stdout 传输，大日志文件可能导致内存暴涨或 SSH 通道超时（task_scheduler._exec_remote 末尾收集段）

CondaEnv 删除检查只拦截了 WAITING 状态的引用任务，RUNNING 状态引用同一 conda_env_id 的任务不会被阻止删除（routers/tasks.py delete_conda_env）

