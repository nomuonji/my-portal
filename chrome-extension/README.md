# My Portal ボード保存（Chrome拡張）

選択したテキストやページを、My Portal の3つのボード（ネタ・表現 / 企画・ビジネス / 興味・趣味）にタブを開かずに保存する拡張です。

## インストール（ストア非公開・自分のChromeに直接読み込む）

1. このフォルダ（`chrome-extension/`）をPCに置く
2. Chromeで `chrome://extensions` を開き、右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択
4. 自動で開く設定画面に **My Portal MCP と同じアクセスキー** を入力 →「保存して接続テスト」

## 使い方

- 文字を選んで右クリック →「My Portal に保存」
- ツールバーのアイコン、または `Alt+Shift+S`（`chrome://extensions/shortcuts` で変更可）
- 保存先ボードを選び、タグを付けて `⌘/Ctrl+Enter`
- 「ページのリンクを付ける」がONなら、本文の末尾にページタイトルとURLを付けて保存（`sourceUrl` / `sourceTitle` にも記録）
- 最後に選んだボードを記憶。保存前にポップアップが閉じても入力は復元されます

## 仕組み

- 保存先API: `POST /api/board-capture`（`netlify/functions/board-capture-api.mts`）
  - 認証は MCP と同じアクセスキー（`Authorization: Bearer <key>`、`AGENT_IDEAS_MCP_ACCESS_KEY_HASH` と照合）
  - ボードUIと同じ形 `{ content, tags, createdAt, updatedAt }`（ideas は `owner: 'portal'`）で保存し、新しいタグは各タグコレクションに登録
- タグ候補: `GET /api/board-capture`（各ボードのタグを使用頻度順）
- アクセスキーは `chrome.storage.local`（このChromeのみ・同期なし）に保存
