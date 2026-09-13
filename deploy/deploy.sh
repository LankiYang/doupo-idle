#!/usr/bin/env bash
# 焚炎异录 · 一键部署脚本
# 用法：改好下面 4 个变量后，在 doupo-idle 目录下跑：bash deploy/deploy.sh
# 本机没有 rsync（纯 Windows + Git Bash 环境），改用 tar + scp + ssh 做增量替换，
# 用一个新目录名解压后原子切换软链，避免部署过程中网站出现半新半旧的文件。
set -euo pipefail

# ── 改这 4 项 ──────────────────────────────────────────────
SERVER_USER="root"                        # TODO: 你的 SSH 用户名
SERVER_HOST="your-server-ip-or-domain"    # TODO: 服务器 IP 或域名
SERVER_PORT="22"                          # TODO: SSH 端口，默认 22
DEPLOY_ROOT="/var/www/doupo-idle"         # TODO: 服务器上要部署到的目录（要和 nginx.conf 里的 root 一致）
# ──────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."

echo "▶ 本地构建..."
npm run build

TS=$(date +%Y%m%d%H%M%S)
ARCHIVE="/tmp/doupo-idle-${TS}.tar.gz"
RELEASE_DIR="${DEPLOY_ROOT}/releases/${TS}"

echo "▶ 打包 dist/..."
tar -czf "$ARCHIVE" -C dist .

echo "▶ 上传到服务器..."
scp -P "$SERVER_PORT" "$ARCHIVE" "${SERVER_USER}@${SERVER_HOST}:/tmp/"

echo "▶ 服务器端解压并原子切换..."
ssh -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" bash -s <<EOF
set -e
mkdir -p "$RELEASE_DIR"
tar -xzf "/tmp/$(basename "$ARCHIVE")" -C "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "${DEPLOY_ROOT}/current"
# current 是 nginx root 真正指向的软链，切换是原子操作，不会有半新半旧的窗口期
rm -f "/tmp/$(basename "$ARCHIVE")"
# 只保留最近 5 个版本，防止 releases 目录无限堆积
cd "${DEPLOY_ROOT}/releases" && ls -1t | tail -n +6 | xargs -r rm -rf
EOF

rm -f "$ARCHIVE"
echo "✅ 部署完成：https://${SERVER_HOST}"
echo "   如果这是第一次部署，记得改 nginx.conf 的 root 指向 ${DEPLOY_ROOT}/current"
