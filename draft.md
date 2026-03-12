Memory Usage filter (together with G/C)

Machine (Local / Remote / ...)

GPU monitor (meta / resource / process / memory)

task scheduler (conda env / env var / cmd / param) + (queue mode / run condition)
+task history
+task group (multiple tasks in order) + async groups pipelining
+param template save/load/search
抢卡触发条件: 时长、百分比、计数+利用率、功耗%、显存、python 进程，or、and，支持输入文本式子去解析复杂的条件，支持保存为预设

task典型工作流：
    - 选机器
    - 选template / 自己写好base command（支持get conda env）
    - 填入参数，路径类参数支持集成的文件选择器
    - 提交任务，选卡选抢卡条件，塞进 queue

more: I/O file watcher (image / video / mesh?)

