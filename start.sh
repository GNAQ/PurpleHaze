#!/usr/bin/env bash
# PurpleHaze 启动脚本
# 用法：
#   ./start.sh                     开发模式，启动前后端
#   ./start.sh --backend           开发模式，仅启动后端
#   ./start.sh --frontend          开发模式，仅启动前端
#   ./start.sh --prod              生产模式，构建前端并启动后端
#   ./start.sh --stop              停止后台进程
#
# 说明：
# - 环境准备已拆分至 ./setup.sh
# - 开发模式日志每次启动会清空
# - 生产模式日志按日期命名

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$ROOT_DIR/.pph.pid"
BACKEND_PORT="34357"
FRONTEND_PORT="5173"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[PPH]${NC} $*"; }
warn()  { echo -e "${YELLOW}[PPH]${NC} $*"; }
error() { echo -e "${RED}[PPH]${NC} $*" >&2; }

usage() {
    cat <<EOF
用法:
  ./start.sh [--prod] [--backend|--frontend]
  ./start.sh --stop

选项:
  --prod       生产模式（构建前端并启动后端）
  --backend    仅启动后端（开发模式）
  --frontend   仅启动前端（开发模式）
  --stop       停止后台进程
  -h, --help   显示帮助

提示:
  请先运行 ./setup.sh 完成依赖安装。
EOF
}

prune_pid_file() {
    [[ -f "$PID_FILE" ]] || return 0
    local tmp
    tmp="$(mktemp)"
    while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        if kill -0 "$pid" 2>/dev/null; then
            echo "$pid" >> "$tmp"
        fi
    done < "$PID_FILE"
    mv "$tmp" "$PID_FILE"
}

add_pid() {
    local pid="$1"
    mkdir -p "$LOG_DIR"
    prune_pid_file
    touch "$PID_FILE"
    grep -qx "$pid" "$PID_FILE" 2>/dev/null || echo "$pid" >> "$PID_FILE"
}

# ── 停止 ────────────────────────────────────────────────────────────────────
stop_all() {
    prune_pid_file
    if [[ -f "$PID_FILE" ]]; then
        local stopped=0
        while IFS= read -r pid; do
            [[ -n "$pid" ]] || continue
            if kill "$pid" 2>/dev/null; then
                info "已停止进程 $pid"
                stopped=1
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
        [[ "$stopped" -eq 0 ]] && warn "PID 文件存在，但没有可停止的存活进程"
    else
        warn "未找到 PID 文件，尝试按端口杀死进程..."
        fuser -k "${FRONTEND_PORT}/tcp" 2>/dev/null || true
        fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true
        # 兼容旧默认端口
        fuser -k 34356/tcp 2>/dev/null || true
    fi
    info "PurpleHaze 已停止"
    exit 0
}

ensure_backend_ready() {
    if [[ ! -x "$VENV_DIR/bin/python" ]]; then
        error "未检测到后端虚拟环境: $VENV_DIR/bin/python"
        error "请先运行 ./setup.sh"
        exit 1
    fi
}

ensure_frontend_ready() {
    if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
        error "未检测到前端依赖: $FRONTEND_DIR/node_modules"
        error "请先运行 ./setup.sh"
        exit 1
    fi
}

prepare_dev_log() {
    local log_file="$1"
    mkdir -p "$LOG_DIR"
    : > "$log_file"
}

reset_dev_logs() {
    mkdir -p "$LOG_DIR"
    : > "$LOG_DIR/backend.dev.log"
    : > "$LOG_DIR/frontend.dev.log"
}

start_backend_dev() {
    local log_file="$LOG_DIR/backend.dev.log"
    prepare_dev_log "$log_file"
    info "启动后端开发服务器（端口 $BACKEND_PORT）..."
    (
        cd "$BACKEND_DIR"
        "$VENV_DIR/bin/python" -m uvicorn main:app \
            --host 0.0.0.0 --port "$BACKEND_PORT" --reload \
            > "$log_file" 2>&1
    ) &
    BACKEND_PID=$!
    add_pid "$BACKEND_PID"
    info "后端已启动 (PID=$BACKEND_PID, log=$(basename "$log_file"))"
}

start_frontend_dev() {
    local log_file="$LOG_DIR/frontend.dev.log"
    prepare_dev_log "$log_file"
    info "启动前端开发服务器（端口 $FRONTEND_PORT）..."
    (
        cd "$FRONTEND_DIR"
        npm run dev > "$log_file" 2>&1
    ) &
    FRONTEND_PID=$!
    add_pid "$FRONTEND_PID"
    info "前端已启动 (PID=$FRONTEND_PID, log=$(basename "$log_file"))"
}

start_backend_prod() {
    local ts log_file
    ts="$(date +%Y%m%d-%H%M%S)"
    log_file="$LOG_DIR/backend.prod.${ts}.log"
    mkdir -p "$LOG_DIR"

    info "构建前端..."
    (
        cd "$FRONTEND_DIR"
        npm run build
    )

    info "启动后端（生产模式）..."
    cd "$BACKEND_DIR"
    nohup "$VENV_DIR/bin/python" -m uvicorn main:app \
        --host 0.0.0.0 --port "$BACKEND_PORT" --workers 1 \
        > "$log_file" 2>&1 &
    BACKEND_PID=$!
    cd "$ROOT_DIR"
    add_pid "$BACKEND_PID"

    info "后端已在后台启动 (PID=$BACKEND_PID)"
    info "服务地址: http://localhost:$BACKEND_PORT"
    info "日志文件: $log_file"
    info "停止命令: $0 --stop"
}

MODE="dev"
START_BACKEND=1
START_FRONTEND=1

if [[ $# -eq 0 ]]; then
    :
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stop)
            stop_all
            ;;
        --prod)
            MODE="prod"
            shift
            ;;
        --backend)
            START_BACKEND=1
            START_FRONTEND=0
            shift
            ;;
        --frontend)
            START_BACKEND=0
            START_FRONTEND=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            error "未知参数: $1"
            usage
            exit 1
            ;;
    esac
done

mkdir -p "$LOG_DIR"

if [[ "$MODE" == "prod" ]]; then
    if [[ "$START_FRONTEND" -eq 1 && "$START_BACKEND" -eq 0 ]]; then
        error "生产模式不支持仅启动前端。请使用开发模式: ./start.sh --frontend"
        exit 1
    fi
    START_BACKEND=1
    START_FRONTEND=0
fi

if [[ "$START_BACKEND" -eq 1 ]]; then
    ensure_backend_ready
fi
if [[ "$START_FRONTEND" -eq 1 || "$MODE" == "prod" ]]; then
    ensure_frontend_ready
fi

if [[ "$MODE" == "prod" ]]; then
    start_backend_prod
    exit 0
fi

reset_dev_logs

if [[ "$START_BACKEND" -eq 1 ]]; then
    start_backend_dev
fi
if [[ "$START_FRONTEND" -eq 1 ]]; then
    start_frontend_dev
fi

info ""
if [[ "$START_BACKEND" -eq 1 && "$START_FRONTEND" -eq 1 ]]; then
    info "PurpleHaze 开发模式已启动（前后端）"
elif [[ "$START_BACKEND" -eq 1 ]]; then
    info "PurpleHaze 开发模式已启动（仅后端）"
elif [[ "$START_FRONTEND" -eq 1 ]]; then
    info "PurpleHaze 开发模式已启动（仅前端）"
fi
[[ "$START_FRONTEND" -eq 1 ]] && info "  前端:  http://localhost:$FRONTEND_PORT"
[[ "$START_BACKEND" -eq 1 ]] && info "  后端:  http://localhost:$BACKEND_PORT"
info "  日志:  $LOG_DIR/ (dev 日志已按本次启动重置)"
info "  停止:  $0 --stop"
info ""
info "按 Ctrl+C 停止所有服务..."

# 等待，Ctrl+C 时清理
trap "stop_all" INT TERM
wait
