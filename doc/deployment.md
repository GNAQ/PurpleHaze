# 部署报告

本文档描述从零开始配置 PurpleHaze 所需的完整步骤，以及对远程被管机器的要求。

---

## 一、宿主机前置要求

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Python | 3.11 | 后端运行环境 |
| Node.js | 18 LTS | 前端构建/开发服务器 |
| npm | 9 | 前端包管理（随 Node.js 附带） |
| Git | 任意 | 拉取代码 |

验证：

```bash
python3 --version   # >= 3.11
node --version      # >= 18
npm --version       # >= 9
```

---

## 二、获取代码

```bash
git clone <repo-url> purplehaze
cd purplehaze
```

> 项目根目录后续以 `$ROOT` 表示（即 `purplehaze/`）。

---

## 三、后端环境配置

后端使用 Python 虚拟环境（`venv`），安装在 `backend/.venv/`。

```bash
cd $ROOT/backend

# 创建虚拟环境
python3 -m venv .venv

# 激活（每次手动启动时需要；start.sh 脚本会自动处理）
source .venv/bin/activate

# 安装依赖
pip install --upgrade pip
pip install -r requirements.txt
```

**依赖说明**（`requirements.txt`）：

| 包 | 用途 |
|----|------|
| fastapi / uvicorn | Web 框架 + ASGI 服务器 |
| sqlalchemy / aiosqlite | ORM + 异步 SQLite 驱动 |
| pydantic（随 fastapi 安装） | 数据校验 |
| paramiko | SSH 连接远程机器 |
| psutil | 本机 CPU/内存监控 |
| pynvml | 本机 GPU 监控（需要 NVIDIA 驱动）；不可用时降级 |
| passlib[bcrypt] | 密码哈希 |
| python-jose[cryptography] | JWT 签发/验证 |
| python-multipart | 表单数据解析 |
| websockets | WebSocket 支持（uvicorn 依赖） |
| python-dotenv | `.env` 文件支持（可选） |
| httpx | 异步 HTTP 客户端（测试用途） |

---

## 四、前端环境配置

```bash
cd $ROOT/frontend

# 安装依赖
npm install
```

**首次 `npm install` 会下载约 200MB 依赖**，完成后 `node_modules/` 本地缓存，后续启动直接复用。

---

## 五、一键启动脚本

完成上述配置后，后续只需通过根目录的 `start.sh` 启动：

```bash
cd $ROOT

# 开发模式（前端热重载 + 后端自动重启）
./start.sh

# 生产模式（构建前端静态文件，后端统一提供服务）
./start.sh --prod

# 停止所有服务
./start.sh --stop
```

### 脚本行为说明

`start.sh` 每次运行时会自动：
1. 检查 `backend/.venv/` 是否存在，不存在则重新创建。
2. 执行 `pip install -q -r requirements.txt`（已安装则无操作）。
3. 检查 `frontend/node_modules/` 是否存在，不存在则执行 `npm install`。
4. 以后台方式启动后端/前端，PID 写入 `$ROOT/.pph.pid`。

### 访问地址

| 模式 | 前端 | 后端 API |
|------|------|---------|
| 开发模式 | http://localhost:5173 | http://localhost:34357 |
| 生产模式 | http://localhost:34357（后端同时服务静态文件） | http://localhost:34357 |

### 运行日志

进程日志写入 `$ROOT/logs/`：
- `logs/backend.log`：uvicorn 输出
- `logs/frontend.log`：Vite dev server 输出（开发模式）

---

## 六、环境变量（可选覆盖）

所有配置均有合理默认值，生产部署建议至少覆盖 `PPH_SECRET_KEY`。

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `PPH_DATA_DIR` | `backend/data/` | SQLite 数据库和任务日志的存储目录 |
| `PPH_SECRET_KEY` | `pph-secret-change-in-production-please` | **⚠️ 生产必改**，用于 JWT 签名 |
| `PPH_BACKEND_HOST` | `0.0.0.0` | 后端监听地址 |
| `PPH_BACKEND_PORT` | `34357` | 后端监听端口 |
| `PPH_FRONTEND_PORT` | `34356` | CORS 白名单中的前端端口（开发时为 5173） |
| `PPH_HISTORY_RETAIN_MIN` | `30` | 内存中保留的资源监控历史时长（分钟） |
| `PPH_OFFLINE_THRESHOLD_MIN` | `5` | 机器多少分钟无快照视为离线（smart 任务超时失败） |

设置方式（任选其一）：

```bash
# 方式1：shell 导出
export PPH_SECRET_KEY="my-production-secret-key"
./start.sh --prod

# 方式2：项目根目录创建 .env 文件（python-dotenv 会自动读取）
echo 'PPH_SECRET_KEY=my-production-secret-key' > backend/.env
echo 'PPH_DATA_DIR=/opt/purplehaze/data'     >> backend/.env
```

---

## 七、数据持久化目录结构

首次运行后 `PPH_DATA_DIR`（默认 `backend/data/`）的内容：

```
data/
├── pph.db            # SQLite 数据库（包含 SSH 明文密码，权限应为 600）
└── task_logs/
    ├── 1/
    │   ├── stdout.txt
    │   └── stderr.txt
    └── 2/
        └── ...
```

**安全建议**：

```bash
chmod 700 backend/data/         # 只有当前用户可访问
chmod 600 backend/data/pph.db   # 保护 SSH 密码
```

---

## 八、生产部署（systemd 服务）

项目提供了 systemd 模板单元 `purplehaze@.service`，适用于系统级后台运行。

```bash
# 将代码部署到 /opt/purplehaze
sudo cp -r $ROOT /opt/purplehaze
sudo chown -R youruser:youruser /opt/purplehaze

# 创建后端虚拟环境
cd /opt/purplehaze/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 构建前端
cd /opt/purplehaze/frontend
npm install && npm run build
cp -r dist/ ../backend/static/   # 后端从 backend/static/ 服务静态文件

# 安装 systemd 服务（%i 替换为实际用户名）
sudo cp /opt/purplehaze/purplehaze@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable purplehaze@youruser
sudo systemctl start  purplehaze@youruser

# 查看状态
sudo systemctl status purplehaze@youruser
journalctl -u purplehaze@youruser -f
```

`.service` 文件默认将 `PPH_DATA_DIR` 设为 `/opt/purplehaze/data`，如需修改请编辑 `Environment=` 行。

---

## 九、远程被管机器的必要配置

PurpleHaze 通过 SSH 对远程机器做两件事：**资源监控**和**任务执行**。两者所需环境不同。

### 9.1 基础连接要求

| 要求 | 说明 |
|------|------|
| SSH 服务（sshd）运行 | 默认端口 22，可自定义 |
| 被配置用户的登录权限 | 密码认证或公钥认证 |
| `nohup` 命令 | 标准 Linux 工具，用于任务后台启动 |
| `/tmp` 可写 | 远程任务日志暂存于 `/tmp/pph_task_logs/{task_id}/` |

### 9.2 资源监控所需 Python 环境

监控采集时，后端通过 SSH 执行一段内嵌 Python 3 脚本。脚本依赖：

| 依赖 | 必要性 | 安装命令 | 用途 |
|------|-------|---------|------|
| Python 3（`python3`） | **必须** | 系统自带（Ubuntu 20.04+ 默认有） | 脚本运行环境 |
| `psutil` | **必须** | `pip3 install psutil` | CPU 使用率、内存信息 |
| `pynvml` | 推荐 | `pip3 install pynvml` | GPU 详细指标（显存/利用率/功耗/进程） |
| `nvidia-smi`（命令行工具） | 可选降级 | 随 NVIDIA 驱动安装 | 无 pynvml 时的 GPU 信息备选方案 |

**psutil 安装建议**：使用系统 pip（`pip3`）或用户目录（`pip3 install --user psutil`），确保 SSH 登录后 `python3 -c "import psutil"` 可用。不需要专门为 PurpleHaze 创建虚拟环境。

```bash
# 在远程机器上验证
python3 -c "import psutil; print('psutil OK')"
python3 -c "import pynvml; pynvml.nvmlInit(); print('pynvml OK')"
```

无 pynvml 时监控会自动回退到 `nvidia-smi`，GPU 信息不含进程详情。若机器无 GPU，可忽略 pynvml 和 nvidia-smi。

### 9.3 任务执行所需环境

任务执行对远程机器几乎没有额外要求：

| 需求 | 说明 |
|------|------|
| 任务自身的运行环境 | 用户在 PurpleHaze 中登记的 Conda 环境或系统 Python 路径，由用户自行维护 |
| Conda（可选） | 若任务使用 CondaEnv 配置，需要目标机器上有对应的 Conda 环境；任务启动时通过 `PATH` 注入，无需 `conda activate` |
| GPU 驱动（可选） | 若任务需要 GPU，需要目标机器安装 CUDA 和 NVIDIA 驱动 |

任务命令以 `nohup sh -c 'CUDA_VISIBLE_DEVICES=0,1 ... python train.py ...' ...` 形式启动，shell 环境由 SSH 会话继承（`~/.bashrc` 通常不被 non-interactive SSH 加载，建议将环境配置写在 `~/.bash_profile` 或 `~/.profile` 中，或通过 `env_vars` 字段显式注入）。

### 9.4 快速验证清单

在远程机器上执行以下检查，确认 PurpleHaze 可正常使用：

```bash
# 1. Python 3 可用
python3 --version

# 2. psutil 可用
python3 -c "import psutil; m=psutil.virtual_memory(); print(f'内存: {m.total//1024//1024} MB')"

# 3. pynvml 可用（有 GPU 的机器）
python3 -c "import pynvml; pynvml.nvmlInit(); print(f'GPU 数量: {pynvml.nvmlDeviceGetCount()}')"

# 4. nohup 可用
which nohup

# 5. /tmp 可写
touch /tmp/pph_test && rm /tmp/pph_test && echo "OK"
```

---

## 十、首次使用流程

1. 启动服务（`./start.sh` 或 `./start.sh --prod`）。
2. 打开浏览器，访问前端地址。
3. 系统自动跳转至密码设置页（`/setup`），设置登录密码（至少 6 位）。
4. 登录后进入主界面。
5. 在"机器"页面添加本地机器和远程机器（远程机器配置 SSH 信息后点击"连接"测试）。
6. 在"任务"页面添加 Conda 环境（菜单 → Conda 环境管理）。
7. 创建流水线 → 在流水线内创建任务，配置命令、机器、GPU 条件。
8. 任务将在下一个调度周期（最多 5s）自动开始评估 GPU 条件并执行。
