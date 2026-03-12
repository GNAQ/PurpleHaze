"""
PurpleHaze 后端配置模块 (Xxium)
"""
import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).resolve().parent

# 数据存储目录
# ⚠️  安全提示：SQLite 文件内包含 SSH 密码明文，请确保 DATA_DIR 权限不对其他用户开放。
# 建议部署时执行：  chmod 700 <DATA_DIR>
DATA_DIR = Path(os.environ.get("PPH_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 数据库路径
DATABASE_URL = f"sqlite+aiosqlite:///{DATA_DIR / 'pph.db'}"

# JWT 配置
SECRET_KEY = os.environ.get("PPH_SECRET_KEY", "pph-secret-change-in-production-please")
ALGORITHM = "HS256"
# token 有效期（天）
ACCESS_TOKEN_EXPIRE_DAYS = 30

# 服务配置
BACKEND_HOST = os.environ.get("PPH_BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.environ.get("PPH_BACKEND_PORT", "34357"))
FRONTEND_PORT = int(os.environ.get("PPH_FRONTEND_PORT", "34356"))

# 默认资源监控刷新间隔（秒）
DEFAULT_MONITOR_INTERVAL = 10

# SSH 连接超时（秒）
SSH_CONNECT_TIMEOUT = 10
SSH_COMMAND_TIMEOUT = 15

# 任务日志存储目录
LOGS_DIR = DATA_DIR / "task_logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# 远程机器任务日志存储目录（在远程机器上的路径）
REMOTE_LOGS_BASE = "/tmp/pph_task_logs"

# 任务调度器轮询间隔（秒）
SCHEDULER_INTERVAL = 5

# 历史监控数据保留时长（分钟）
MONITOR_HISTORY_RETAIN_MINUTES = int(os.environ.get("PPH_HISTORY_RETAIN_MIN", "30"))

# 机器被认为离线的阈值（分钟）：超过此时长没有新的监控快照时
# 调度器会将 smart 模式 GPU 抢卡任务标记为 FAILED，避免永久等待
MONITOR_OFFLINE_THRESHOLD_MINUTES = int(os.environ.get("PPH_OFFLINE_THRESHOLD_MIN", "5"))
