# PurpleHaze

> Web-based task scheduling and machine resource management tool, designed for Deep Learning and bare-metal GPU server nodes. 
> 基于 Web 的任务调度与计算资源管理工具，专为深度学习和 GPU 裸机集群设计。

---

## IMPORTANT

**此项目是一个 Vibe coding 项目。由 [GNAQ](https://github.com/GNAQ) 与他的 Claude Coding Agent 构想、构建、审阅与维护。**

### TODOs

- [] 修整 `README.md`
- [] 完善 API/代码函数文档

---

## 功能状态

| 模块 | 状态 |
|------|------|
| 0. 基础功能（认证、设置、启动） | ✅ 已实现 |
| 1. 本地/远程机器管理与资源监控 | ✅ 已实现 - 🔂 迭代中 |
| 2. 任务管理与资源调度 | ✅ 已实现 - 🔂 迭代中 |
| 3. 历史任务记录与分析 | ✅ 已实现 - 🔂 迭代中 |

---

## 技术栈

**后端（Xxium）：**
- Python 3.11+, FastAPI, SQLAlchemy 2.0, SQLite (aiosqlite)
- Paramiko（SSH 连接）, psutil + pynvml（资源监控）
- passlib[bcrypt]（密码哈希）, python-jose（JWT）

**前端（PurpleHaze/PPH）：**
- React 18, TypeScript, Vite
- Ant Design 5, Zustand, Axios

---

## 快速启动

### 开发模式

前后端分别运行，支持热重载：

```bash
./start.sh
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:34357

### 生产模式

构建前端后，通过后端统一提供服务：

```bash
./start.sh --prod
```

- 服务：http://localhost:34357（同时提供 API 和前端静态文件）

### 停止

```bash
./start.sh --stop
```

### 以 systemd 服务运行

1. 将项目部署到 `/opt/purplehaze/`
2. 构建前端：`cd frontend && npm install && npm run build`
3. 安装 Python 依赖：`cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
4. 安装 systemd 服务：

```bash
sudo cp purplehaze@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable purplehaze@$USER
sudo systemctl start purplehaze@$USER
```

---

## 项目结构

```
PurpleHaze/
├── start.sh                  # 一键启动脚本
├── purplehaze@.service        # systemd 服务模板
├── backend/                   # Xxium 后端
│   ├── main.py                # FastAPI 入口
│   ├── config.py              # 配置
│   ├── database.py            # SQLite 数据库
│   ├── deps.py                # FastAPI 公共依赖
│   ├── models/                # SQLAlchemy 数据模型
│   │   ├── auth.py            # 用户、配置模型
│   │   ├── machine.py         # 机器模型
│   │   └── task.py            # 任务模型（存根）
│   ├── schemas/               # Pydantic 请求/响应模式
│   │   ├── auth.py
│   │   ├── machine.py
│   │   └── monitor.py
│   ├── routers/               # API 路由
│   │   ├── auth.py            # 认证、配置
│   │   ├── machines.py        # 机器管理
│   │   ├── monitor.py         # 资源监控
│   │   └── tasks.py           # 任务管理（存根）
│   └── services/              # 业务逻辑
│       ├── auth_service.py    # 密码 + JWT
│       ├── ssh_manager.py     # SSH 连接管理器
│       └── resource_monitor.py # 资源采集服务
└── frontend/                  # PurpleHaze 前端
    ├── src/
    │   ├── api/               # API 客户端
    │   ├── store/             # Zustand 状态管理
    │   ├── components/        # 可复用组件
    │   │   ├── AppLayout.tsx  # 主布局
    │   │   ├── MachineCard.tsx # 机器卡片（含资源监控）
    │   │   ├── MachineFormModal.tsx # 添加/编辑机器弹窗
    │   │   └── ResourceBar.tsx # 资源进度条
    │   └── pages/             # 页面
    │       ├── LoginPage.tsx
    │       ├── MachinesPage.tsx
    │       ├── TasksPage.tsx  # 存根
    │       ├── HistoryPage.tsx # 存根
    │       └── SettingsPage.tsx
    └── package.json
```

---

## API 文档

启动后访问：http://localhost:34357/docs

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PPH_DATA_DIR` | `backend/data` | 数据存储目录 |
| `PPH_SECRET_KEY` | 内置默认值 | JWT 签名密钥（生产环境请修改！） |
| `PPH_BACKEND_PORT` | `34357` | 后端端口 |
| `PPH_FRONTEND_PORT` | `34356` | 前端端口 |
