# Linear Integration

My PortalのAgent Control PlaneからLinearを外部タスクソースとして扱うための統合。

## Architecture

```text
ChatGPT / Agent
      |
      v
My Portal MCP
      |
      +-- Work Items / Spaces / Runs (Firestore)
      |
      +-- Linear bridge
              |
              v
      Linear official Remote MCP
      https://mcp.linear.app/mcp
              |
              v
          Linear workspace
```

My PortalがLinear GraphQL APIのスキーマを独自再実装するのではなく、Linear公式Remote MCPを中継する。これによりLinear側のMCP機能追加を `linear_tool_catalog` / `linear_tool_call` 経由で利用できる。

Linearの秘密鍵はFirestore、ブラウザ、Work Item本文には保存しない。Netlify Functionsの秘密環境変数だけに置く。

## One-time setup

1. Linearで **Settings > Account > Security & Access** を開く。
2. Personal API keyを作成する。
3. My Portalから広く操作する場合は、必要な範囲で Read / Write / Create issues / Create comments を許可する。Admin権限は通常不要。
4. Team scopeを制限する場合は `My space` を対象にする。
5. Netlify site `my-portal-agent` の環境変数に以下を設定する。
   - `LINEAR_API_KEY=<secret>`
   - `LINEAR_TEAM_KEY=MY`（任意。未設定時も `MY`）
   - `LINEAR_MCP_URL=https://mcp.linear.app/mcp`（通常は不要）
6. 必要ならNetlifyを再デプロイし、My Portal MCPを再接続する。
7. `linear_status` を実行し、workspaceとtoolCountが取得できることを確認する。

**API keyをチャットへ貼らない。** My PortalはAPI key自体をMCPレスポンスへ返さない。

## Agent Control Plane integration

`control_plane_overview` はLinear連携が有効なら、未完了Linear Issueを `linear.issues` として返す。

- `linkedWorkItemId` があるIssue: すでにMy Portal Work Itemと連携済み
- `linear.unlinkedIssues`: まだWork Item化されていない外部タスク候補

Agentが実行するLinear Issueは、原則として先に `linear_issue_import_to_work_item` でWork Item化してから `work_item_claim` する。これにより、複数Agentの重複実行防止・lease・Run・Human Task handoffをLinearタスクにも適用できる。

### Linear -> Work Item

```text
linear_issue_import_to_work_item({
  issue: "MY-29",
  executionMode: "agent"
})
```

同じLinear Issueがすでにリンクされていれば新規作成せず更新する。Agentがclaim済みで `running` のWork Itemは、Linear側の状態変更でローカルのリアルタイム実行状態を上書きしない。

状態の基本マッピング:

- Linear backlog / triage -> Work Item backlog
- Linear unstarted / started -> Work Item ready
- Linear completed -> Work Item done
- Linear canceled -> Work Item cancelled

LinearのstartedはWork Item `in_progress` に同期できる。My Portalの `running` だけがAgent claim/leaseとセットのリアルタイム実行状態だから。

### Work Item -> Linear

```text
work_item_push_to_linear({
  id: "<work-item-id>",
  syncStatus: true
})
```

未リンクならLinear Issueを作成し、リンク済みなら同じIssueを更新する。Linear側のID/URL/statusは `metadata.linear` に保存される。

Work Item状態はLinear workflow state typeへ以下のように同期する。

- backlog -> backlog
- ready -> unstarted
- in_progress / blocked / review -> started
- done -> completed
- cancelled -> canceled

## Generic Linear MCP proxy

My Portal固有のbridgeにないLinear操作は公式MCPへそのまま中継できる。

1. `linear_tool_catalog` で現在のLinear tool schemaを検索
2. `linear_tool_call` でtool名とargumentsを渡す

例:

- Issueの検索・更新
- Comment作成
- Project / Initiative / Document操作
- Cycle / Label / Milestone参照
- Release関連

delete / merge / share / unshare等の破壊的または機密性の高いtoolは `confirm=true` が必要。

## Human Task bootstrap

`LINEAR_API_KEY` が未設定の状態で `control_plane_overview` を呼ぶと、以下のsystem Work ItemをidempotentにHuman Tasksへ作成する。

- title: `Linear連携: APIキーをNetlifyへ設定`
- executionMode: `human`
- sourceType: `system_integration`
- sourceId: `linear`

API keyが検出されると、このsetup taskは自動的にdoneになる。

これにより、人間にしかできないsecret発行・登録作業がチャット内の口頭依頼で消えず、Human Tasks箱に残る。
