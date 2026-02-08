#!/bin/bash
# GitHub Pages を自動で有効化（main ブランチの / (root) から公開）
set -e
cd "$(dirname "$0")/.."

OWNER="ninjawanko-m"
REPO="ululu"
BRANCH="main"

echo "GitHub Pages を有効化します。"
echo -n "PAT を貼り付けて Enter（表示されません）: "
read -s TOKEN
echo ""

if [ -z "$TOKEN" ]; then
  echo "PAT が入力されていません。"
  exit 1
fi

echo "GitHub Pages を設定中..."

# Pages API で main ブランチの / (root) を公開
curl -s -X POST \
  -H "Authorization: token ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${OWNER}/${REPO}/pages" \
  -d '{"source":{"branch":"'"${BRANCH}"'","path":"/"}}' > /tmp/pages_response.json

# レスポンスをチェック
if grep -q '"html_url"' /tmp/pages_response.json; then
  echo "✓ GitHub Pages を有効化しました！"
  echo ""
  echo "公開URL: https://${OWNER}.github.io/${REPO}/"
  echo ""
  echo "※ 初回は反映まで数分かかることがあります。"
  rm /tmp/pages_response.json
  exit 0
elif grep -q '"message":"Conflict"' /tmp/pages_response.json || grep -q 'already enabled' /tmp/pages_response.json; then
  echo "✓ GitHub Pages はすでに有効です。"
  echo ""
  echo "公開URL: https://${OWNER}.github.io/${REPO}/"
  echo ""
  echo "※ 反映まで数分かかることがあります。"
  rm /tmp/pages_response.json
  exit 0
else
  echo "エラーが発生しました。レスポンス:"
  cat /tmp/pages_response.json
  rm /tmp/pages_response.json
  exit 1
fi
