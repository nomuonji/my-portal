# Social Archive

My Portal 内で、自分の過去SNS投稿を検索・分類・見返すための個人アーカイブ。

初期対象は X (Twitter) 公式データアーカイブ。

## 方針

第一段階では「AI分析基盤」にしすぎない。

目的は以下。

- 過去投稿を全文検索する
- 年月・投稿種別・カテゴリで絞り込む
- 気に入った投稿をお気に入りにする
- カテゴリ・タグを後から整理する
- 自分用メモを残す
- ChatGPT から公式アーカイブを一括importする

インポートUIは作らない。
ユーザーがX公式アーカイブZIPをChatGPTへ渡し、ChatGPTが必要ファイルを抽出・正規化してMCPから投入する。

## Firestore

### social_posts

正本となる投稿データ。

Document ID:
`x_<postId>`

主フィールド:

- platform
- postId
- accountId
- username
- text
- postedAt
- url
- type: post / reply / quote / repost
- replyToPostId
- replyToUsername
- quotedPostId
- language
- sourceClient
- hashtags
- mentions
- links
- media
- metrics
- category
- tags
- starred
- note
- classificationSource
- source
- importedAt
- updatedAt
- schemaVersion

投稿本文やX由来メタデータと、My Portal上の整理用メタデータは同じdocumentに保存するが、再import時は原則として category / tags / starred / note を上書きしない。

### social_accounts

アーカイブ元アカウント。

メールアドレス等、閲覧用途に不要な個人情報は保存しない。

### social_import_runs

ChatGPT経由のimport履歴。

- importKey
- archiveName
- accountId
- username
- status
- batches
- received
- created
- updated
- lastImportedAt
- completedAt

## MCP

### social_archive_status

件数と接続状態。

### social_posts_search

投稿検索。

filters:
- query
- account
- category
- tag
- type
- year
- starred

### social_post_get

1件取得。

### social_import_posts

ChatGPTから最大200件ずつupsert。

postIdから決定的Document IDを作るため、同じアーカイブを再投入しても重複しない。

同じ importKey を複数batchで使い、最後のbatchだけ complete=true にする。

### social_post_update_metadata

1件の分類情報だけ更新。

### social_posts_update_metadata

最大200件の分類情報を一括更新。
ChatGPTによる後付け分類に使う。

## X archive import

X公式ZIPから、初期実装では `data/tweets.js` を投稿正本として利用する。

利用する補助ファイル:
- `data/account.js`
- `data/profile.js`

初期対象外:
- DM
- 広告関連
- フォロー/フォロワー履歴
- 検索履歴
- account email
- deleted tweets

Xアーカイブに含まれる画像については、初期版では投稿内の media URL と archivePath のみ保存する。
バイナリ自体のMy Portalへの複製は行わない。

## UI

Route:
`/social-archive`

初期UI:
- 全文検索
- category filter
- type filter
- year filter
- starred only
- 投稿本文
- 投稿日
- reaction counts
- media preview
- category / tags / note editor
- starred toggle
- X original URL

最大5000件をブラウザへ読み込み、ローカルで高速filterする。
個人アーカイブの初期規模を優先したシンプルな実装であり、件数が増えたらpagination/search indexへ移行する。
