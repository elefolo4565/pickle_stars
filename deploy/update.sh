#!/usr/bin/env bash
# サーバー上で実行: 最新のコードを取り込んでビルドし、ゲームサーバーを再起動する
# 使い方: sudo -u pickle bash /opt/pickle-stars/deploy/update.sh && sudo systemctl restart pickle-stars
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d .git ]; then
  git pull --ff-only
fi
npm ci
npm test
npm run build
echo "ビルド完了。次を実行してください: sudo systemctl restart pickle-stars"
