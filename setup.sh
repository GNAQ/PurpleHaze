#!/usr/bin/env bash
# PurpleHaze 环境准备脚本
# 用法：
#   ./setup.sh             安装/更新前后端依赖
#   ./setup.sh --backend   仅安装/更新后端依赖
#   ./setup.sh --frontend  仅安装/更新前端依赖

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"

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
  ./setup.sh [--backend|--frontend]

选项:
  --backend    仅安装/更新后端依赖
  --frontend   仅安装/更新前端依赖
  -h, --help   显示帮助
EOF
}

SETUP_BACKEND=1
SETUP_FRONTEND=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend)
            SETUP_BACKEND=1
            SETUP_FRONTEND=0
            shift
            ;;
        --frontend)
            SETUP_BACKEND=0
            SETUP_FRONTEND=1
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

if [[ "$SETUP_BACKEND" -eq 1 ]]; then
    if ! command -v python3 >/dev/null 2>&1; then
        error "未找到 python3"
        exit 1
    fi

    if [[ ! -f "$VENV_DIR/bin/activate" ]]; then
        info "创建 Python 虚拟环境..."
        python3 -m venv "$VENV_DIR"
    fi

    info "安装/更新后端依赖..."
    "$VENV_DIR/bin/pip" install -q --upgrade pip
    "$VENV_DIR/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
fi

if [[ "$SETUP_FRONTEND" -eq 1 ]]; then
    if ! command -v npm >/dev/null 2>&1; then
        error "未找到 npm"
        exit 1
    fi

    info "安装/更新前端依赖..."
    (
        cd "$FRONTEND_DIR"
        npm install --silent
    )
fi

info "环境准备完成。"
