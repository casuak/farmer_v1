#!/usr/bin/env bash
#
# farmer_v1 服务启动脚本 (Docker 方案, 构建产物模式)
# ------------------------------------------------------------
# 背景: 宿主 CentOS 8 的 glibc=2.28, 无法运行 Cloudflare workerd(需 ≥2.35)
#       用 node:24-slim (Debian12 / glibc 2.36) 容器绕过宿主限制
# 模式: 不再启动 vite 开发服务器, 而是用构建产物启动生产服务器:
#       1) 容器内 npm install (以 development 模式, 保证 vite/vinext 等 devDependencies 存在)
#       2) 需要时 npm run build (vinext build -> dist/)
#       3) exec vinext start 提供生产服务器 (端口 5177)
# 用法: bash dev.sh              启动(默认复用已有 dist/, 缺失时自动构建)
#       bash dev.sh --rebuild    强制重新构建 dist/ 后启动
#       bash dev.sh stop         停止(通过容器名)
# ------------------------------------------------------------

set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="farmer-v1-dev"
PORT="${PORT:-5177}"

# 浏览器可访问地址提示(纯提示, 不强制)
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

FORCE_REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) FORCE_REBUILD=1 ;;
  esac
done

start() {
  # 若已存在同名容器正在跑, 直接提示
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "✅ 服务已在运行: http://${HOST_IP:-<服务器IP>}:${PORT}"
    echo "   日志: docker logs -f $CONTAINER_NAME"
    exit 0
  fi

  # 清理可能残留的旧容器(停止状态)
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

  echo "🚀 正在启动 farmer_v1 服务 (Docker: node:24-slim, 构建产物模式) ..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    -w /app \
    -v "$APP_DIR":/app \
    -p "$PORT":5177 \
    -e NODE_ENV=production \
    -e FORCE_REBUILD="$FORCE_REBUILD" \
    -e WRANGLER_LOG_PATH=.wrangler/wrangler.log \
    -e WRANGLER_WRITE_LOGS=false \
    node:24-slim \
    bash -c "
      set -e
      # 以 development 模式安装, 确保空 node_modules 时构建依赖可用
      NODE_ENV=development npm install --silent >/dev/null 2>&1 || true
      if [ -d dist ] && [ \"\$FORCE_REBUILD\" != \"1\" ]; then
        echo '使用已有 dist/ 启动 (强制重建: bash dev.sh --rebuild)'
      else
        echo '▶ 开始构建生产包 (npm run build) ...'
        npm run build
      fi
      mkdir -p .wrangler
      exec npx vinext start --host 0.0.0.0 --port 5177
    "

  echo ""
  echo "✅ 容器已创建: $CONTAINER_NAME"
  echo "   访问地址: http://${HOST_IP:-<服务器IP>}:${PORT}"
  echo ""
  echo "查看实时日志: docker logs -f $CONTAINER_NAME"
  echo "停止服务: bash $APP_DIR/dev.sh stop"
}

stop() {
  echo "🛑 停止服务 $CONTAINER_NAME ..."
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 && echo "已停止 ✅" || echo "没有运行中的 '$CONTAINER_NAME' 容器"
}

case "${1:-start}" in
  start) start ;;
  --rebuild|rebuild) start ;;
  stop)  stop ;;
  *) echo "用法: bash dev.sh [start|stop] [--rebuild]" ;;
esac
