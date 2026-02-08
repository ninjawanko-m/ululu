#!/bin/bash
# GitHub に push（PAT は 1回だけ入力、表示されません）
set -e
cd "$(dirname "$0")/.."
REMOTE="https://github.com/ninjawanko-m/ululu.git"
echo "GitHub に push します。"
echo -n "PAT を貼り付けて Enter（表示されません）: "
read -s TOKEN
echo ""
if [ -z "$TOKEN" ]; then
  echo "PAT が入力されていません。"
  exit 1
fi
echo "push 中...（進捗を表示します）"
git remote set-url origin "https://ninjawanko-m:${TOKEN}@github.com/ninjawanko-m/ululu.git"
git push -u origin main --progress
git remote set-url origin "$REMOTE"
echo "完了: https://ninjawanko-m.github.io/ululu/"
