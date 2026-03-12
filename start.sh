#!/usr/bin/env bash
# PurpleHaze 一键启动脚本
# 用法：
#   ./start.sh          启动开发模式（后端 + 前端 dev server）
#   ./start.sh --prod   生产模式（构建前端，通过后端服务静态文件）
#   ./start.sh --stop   停止所有后台进程

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$ROOT_DIR/.pph.pid"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[PPH]${NC} $*"; }
warn()  { echo -e "${YELLOW}[PPH]${NC} $*"; }
error() { echo -e "${RED}[PPH]${NC} $*" >&2; }

# ── 停止 ────────────────────────────────────────────────────────────────────
stop_all() {
    if [[ -f "$PID_FILE" ]]; then
        while IFS= read -r pid; do
            kill "$pid" 2>/dev/null && info "已停止进程 $pid" || true
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    else
        warn "未找到 PID 文件，尝试按端口杀死进程..."
        fuser -k 34356/tcp 2>/dev/null || true
        fuser -k 34357/tcp 2>/dev/null || true
    fi
    info "PurpleHaze 已停止"
    exit 0
}

[[ "$1" == "--stop" ]] && stop_all

# ── 环境准备 ────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

# Python 虚拟环境
if [[ ! -f "$VENV_DIR/bin/activate" ]]; then
    info "创建 Python 虚拟环境..."
    python3 -m venv "$VENV_DIR"
fi

info "安装/更新后端依赖..."
"$VENV_DIR/bin/pip" install -q --upgrade pip
"$VENV_DIR/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"

# 前端依赖
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    info "安装前端依赖（npm install）..."
    cd "$FRONTEND_DIR" && npm install --silent
    cd "$ROOT_DIR"
fi

# ── 生产模式 ────────────────────────────────────────────────────────────────
if [[ "$1" == "--prod" ]]; then
    info "构建前端..."
    cd "$FRONTEND_DIR" && npm run build
    cd "$ROOT_DIR"
    info "启动后端（生产模式）..."
    cd "$BACKEND_DIR"
    nohup "$VENV_DIR/bin/python" -m uvicorn main:app \
        --host 0.0.0.0 --port 34357 --workers 1 \
        > "$LOG_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$PID_FILE"
    info "后端已在后台启动 (PID=$BACKEND_PID)"
    info "访问 http://localhost:34356 (需通过反向代理或直接访问 34357)"
    info "日志: $LOG_DIR/backend.log"
    info "停止: $0 --stop"
    exit 0
fi

# ── 开发模式 ────────────────────────────────────────────────────────────────
info "启动后端开发服务器（端口 34357）..."
cd "$BACKEND_DIR"
"$VENV_DIR/bin/python" -m uvicorn main:app \
    --host 0.0.0.0 --port 34357 --reload \
    > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

info "启动前端开发服务器（端口 5173）..."
cd "$FRONTEND_DIR"
npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

echo -e "$BACKEND_PID\n$FRONTEND_PID" > "$PID_FILE"

info ""
info "PurpleHaze 开发模式已启动！"
info "  前端:  http://localhost:5173"
info "  后端:  http://localhost:34357"
info "  日志:  $LOG_DIR/"
info "  停止:  $0 --stop"
info ""
info "按 Ctrl+C 停止所有服务..."

# 等待，Ctrl+C 时清理
trap "stop_all" INT TERM
wait
