# ululu

プロフィールサイト（About / Favorites / Video / Contact）。

## ローカルリンク

起動後にブラウザで開くURL:

- **サイト**: [http://localhost:8080](http://localhost:8080)
- **Sora API キー設定**: [http://localhost:3001/setup](http://localhost:3001/setup)
- **Sora API サーバー**: [http://localhost:3001](http://localhost:3001)

## 動画の自動生成（Sora）

**手順はすべてアプリ内で完結します。.env を手で編集する必要はありません。**

### 1. バックエンドを起動（ワンクリック）

- **Cursor / VS Code**: **ターミナル** → **タスクの実行** → **「Sora バックエンドを起動」**
- **ターミナル**: `npm run start:sora`

初回だけ「API キーを貼り付けて Enter」と出たら、[OpenAI API キー](https://platform.openai.com/api-keys) を取得して貼り付けるだけ。自動で `.env` に保存され、以降は聞かれません。スキップした場合は次の 2 の方法で設定できます。

### 2. キーをまだ設定していない場合

サイトで「Sora で生成」を押すと「API キーを設定する」ボタンが表示されます。クリックすると設定ページが開くので、キーを貼り付けて「保存して使う」を押すだけで完了（再起動不要）。

### 3. フロントの表示と使い方

- `npm run start:site` または `python3 -m http.server 8080` で `http://localhost:8080` を開く
- Video セクションでプロンプトを入力し「Sora で生成」→ 数分で動画が一覧に追加されます
