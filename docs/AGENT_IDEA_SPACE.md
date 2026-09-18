# Agent Idea Space

`my-portal` に、人間向けのメモや既存 `ideas` とは分離した **AI Agent 専用の発想・展開DB** を追加する。

## 目的

Agent が会話セッションをまたいで、完成案だけでなく以下も保存できるようにする。

- 思いつき / seed
- 仮説
- 派生案
- 矛盾・反証
- ボツ案
- 複数案の統合
- 調査根拠
- 評価
- 生成した仕様書・計画・記事案などの成果物
- Agent run の目的、作業履歴、次アクション

単純なノートDBではなく、**Idea Graph + Agent Run History** として扱う。

## Firestore

専用の named database を使う。

- project: `my-portal-d05fd`
- database ID: `agent-ideas`
- location: `asia-northeast1`

初回のみデータベース自体を作成する必要がある。

```bash
firebase firestore:databases:create agent-ideas \
  --location=asia-northeast1 \
  --delete-protection=ENABLED \
  --project=my-portal-d05fd
```

`firebase.json` は default DB と `agent-ideas` の両方を管理する構成になっている。

Agent DB の Security Rules は **クライアントから全面 deny**。MCP Cloud Function の Admin SDK だけが読み書きする。将来 UI から表示したくなった場合も、直接 Firestore を開放するより、用途を限定した API / callable function を追加する。

## Collections

### `ideas`

中心ノード。

主なフィールド:

```json
{
  "title": "資格試験の勉強時間データベース",
  "summary": "資格ごとの平均勉強時間を比較できるサイト",
  "content": "Markdownの自由記述",
  "type": "idea",
  "status": "active",
  "maturity": "seed",
  "tags": ["seo", "database-site"],
  "domains": ["business", "web"],
  "attributes": {},
  "createdBy": {
    "type": "agent",
    "agent": "chatgpt",
    "model": null
  },
  "createdInRunId": null,
  "revision": 1,
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

`attributes` は Agent が自由に構造化情報を追加する領域。DB schema が発想を過度に縛らないようにする。

### `relations`

Idea graph の edge。

```json
{
  "fromIdeaId": "child-id",
  "toIdeaId": "parent-id",
  "type": "derived_from",
  "description": "資格DBから職業DBへ派生",
  "createdBy": {},
  "createdInRunId": "run-id",
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

代表的な type:

- `derived_from`
- `expanded_from`
- `combined_from`
- `combined_with`
- `contradicts`
- `supports`
- `alternative_to`
- `depends_on`
- `inspired_by`
- `supersedes`
- `related_to`

type は完全固定ではない。Agent は意味のある動詞を優先する。

### `runs`

Agent の作業単位。

- objective
- instructions
- agent / model
- trigger
- seedIdeaIds
- createdIdeaIds
- updatedIdeaIds
- findings
- nextActions
- status
- revision
- startedAt / finishedAt

これにより、別の ChatGPT セッションが「前回どこまで考えたか」を復元できる。

### `sources`

Idea に付く根拠・参考資料・観察・実験結果。

### `evaluations`

Idea 本体を書き換えず、Agent / 観点ごとに独立した評価を追加する。

### `artifacts`

仕様書、記事案、prompt、コード計画、実験計画、外部ドキュメントURLなど。

## Idea lifecycle

`status` と `maturity` を分ける。

### status

- `active`
- `paused`
- `archived`
- `promoted`

### maturity

- `seed`
- `exploring`
- `developed`
- `validated`
- `execution_ready`

失敗案やボツ案は削除せず `archived` にし、後から別案と再結合できるようにする。

## MCP

本番MCPは Netlify Functions の Streamable HTTP endpoint で公開する。

```text
https://my-portal-agent.netlify.app/mcp
```

認証は OAuth 2.1 Authorization Code + PKCE。ChatGPT接続では Client ID Metadata Document (CIMD) を優先し、ChatGPTの固定クライアントメタデータを検証する。これにより再接続のたびに動的な client_id を作る必要がない。

旧Dynamic Client Registration (DCR) client_id は既存接続との後方互換のため受理するが、OAuth discoveryでは新規登録方式として広告しない。

接続時のユーザー認可は Agent Idea Space 専用アクセスキーで行う。MCP endpoint 自体を無認証公開にはしない。

### MCP tools

- `agent_ideas_status`
- `idea_create`
- `idea_get`
- `idea_search`
- `idea_update`
- `idea_expand`
- `idea_link`
- `idea_get_context`
- `idea_merge`
- `idea_archive`
- `idea_run_start`
- `idea_run_finish`
- `idea_add_source`
- `idea_evaluate`
- `idea_add_artifact`

### Recommended Agent flow

既存テーマを続ける場合:

```text
idea_search
→ idea_get_context
→ idea_run_start
→ idea_expand / idea_update / idea_link / idea_add_source / idea_evaluate
→ idea_run_finish
```

新しいテーマの場合:

```text
idea_run_start
→ idea_create
→ idea_expand
→ 必要に応じて relation / source / evaluation / artifact を追加
→ idea_run_finish
```

## Search strategy

初期版では Firestore の複雑な composite index を増やしすぎないため、`idea_search` は直近最大500件を取得して MCP 側で bounded filtering する。

データ量が増えた段階で、以下を追加できる。

- Firestore composite indexes
- embeddings
- vector search
- semantic deduplication
- cluster / theme generation

## Authentication / key rotation

平文アクセスキーはリポジトリに保存せず、Netlify環境変数の SHA-256 hash で検証する。OAuth authorization code / access token / refresh token の署名には別の server-side signing key を使う。

- `AGENT_IDEAS_MCP_ACCESS_KEY_HASH`
- `AGENT_IDEAS_MCP_SIGNING_KEY`
- `AGENT_IDEAS_DATABASE_ID`

`AGENT_IDEAS_MCP_SIGNING_KEY` を変更すると既存の署名済みトークンは無効になる。ただし新規・再接続はCIMDの固定 client_id を使うため、旧DCRのように「過去の動的 client_id 自体が失効して認可画面に入れない」状態には依存しない。

アクセスキーをローテーションする場合は、新しいキーの SHA-256 を `AGENT_IDEAS_MCP_ACCESS_KEY_HASH` に設定する。

## Deploy

`main` へのpushから Netlify の production deploy を行う。

動作確認:

```text
GET https://my-portal-agent.netlify.app/mcp/health
GET https://my-portal-agent.netlify.app/.well-known/oauth-authorization-server
GET https://my-portal-agent.netlify.app/.well-known/oauth-protected-resource/mcp
```

OAuth metadata では `client_id_metadata_document_supported: true`、PKCE `S256`、`offline_access` が確認できること。healthでは `serverVersion`、tool count、Firestore接続状態を確認する。
