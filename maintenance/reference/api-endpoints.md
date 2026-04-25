# API 端点速查

所有端点需 `Authorization: Bearer <token>`（auth 端点除外）。

## 认证 `/api/auth`
```
GET  /status          检查是否已设密码
POST /setup           首次设置密码
POST /login           登录，返回 token
POST /change-password 修改密码
GET  /settings        获取 KV 设置
PUT  /settings        批量更新设置
```

## 任务 `/api/tasks`
```
GET  /pipelines             流水线列表（含嵌套任务）
POST /pipelines             创建流水线
PUT  /pipelines/{id}        更新流水线（name/sort_order）
DEL  /pipelines/{id}        删除（非空时 400）
GET  /orphaned              孤立任务列表
POST /                      创建任务
POST /batch                 批量创建（body: {commands[], pipeline_ids, machine_id, config, gpu_condition}）
PUT  /{id}                  更新任务（RUNNING 时 400）
DEL  /{id}                  删除任务（RUNNING 时 400）
POST /{id}/cancel           取消任务
PUT  /{id}/reorder          调整流水线内顺序
GET  /{id}/logs             获取日志（?type=stdout|stderr&tail=200）
GET  /{id}/logs/download    下载完整日志文件
GET  /templates             模板列表（?q=搜索）
POST /templates             创建模板
PUT  /templates/{id}        更新模板
DEL  /templates/{id}        删除模板
GET  /gpu-presets            抢卡条件预设列表
POST /gpu-presets            创建预设
PUT  /gpu-presets/{id}       更新预设
DEL  /gpu-presets/{id}       删除预设
GET  /conda-envs             conda 环境列表（可带 ?machine_id=...，返回该机器环境 + 全局兼容环境）
POST /conda-envs             创建
PUT  /conda-envs/{id}        更新
DEL  /conda-envs/{id}        删除
```

## 机器 `/api/machines`
```
GET  /                  列出所有机器（含连接状态）
POST /                  注册机器
GET  /{id}              获取详情
GET  /{id}/conda-envs   获取该机器已登记的 Conda 环境
POST /{id}/conda-envs   手动登记该机器的 Conda 环境
POST /{id}/conda-envs/probe  探测并同步该机器的 Conda 环境列表
PUT  /{id}              更新配置
DEL  /{id}              删除机器
POST /{id}/connect      建立 SSH 连接
POST /{id}/disconnect   断开 SSH 连接
```

## 监控 `/api/monitor`
```
GET  /{id}/resources      获取最新资源快照（?include_processes=false）
POST /{id}/poll/start     启动轮询（body: {interval: 10}）
POST /{id}/poll/stop      停止轮询
```

## 文件系统 `/api/fs`
```
GET  /browse    浏览目录（?machine_id=1&path=/workspace）
```
