# My Portal Context Store + Thinking Workspace

## 役割

My Portalは、単なるメモ・Idea DBではなく、**ユーザーの思考・嗜好・判断・長期テーマを蓄積し、AIエージェントが次回以降のセッションで再利用する Context Store + Thinking Workspace** を目指す。

短い思いつきの保存場所と、長期的な思考コンテキストを混ぜないことが基本方針。

## Entityの役割

### Space

長期間「考え続けるテーマ」。

例:

- お金を稼ぐ方法を探す
- 英語学習
- 東京で住みたい街を探す
- 新しいアプリ構想

Spaceは `currentBrief`, `goal`, `nextActions` を持ち、次回セッションの再開地点になる。

### Project

具体的に実行するプロジェクト。

SpaceとProjectは分離する。

例:

- Space: お金を稼ぐ方法を探す
- Project: 野良案件監視ツールを作る

既存 `projects` collectionはそのまま維持し、必要なProjectだけ将来的に `spaceId` でSpaceへ紐づける。

### Idea

仮説、発想、探索途中の候補。

Agent Idea Spaceは廃止しない。今後は **scratch / exploration layer** としてSpaceの配下で使う。

`spaceId` は任意なので、既存Ideaはmigrationなしでも読める。

### Opportunity

現実に存在する具体的な対象。

例:

- GitHub issue bounty
- microgrant
- hackathon
- 具体的な求人

「OSS bountyを狙う」はIdea、「Homebox #172 €50 bounty」はOpportunity。

### Profile Fact

AIが長期的なパーソナライズに使うUser Model。

主なフィールド:

- `statement`
- `scope`
- `category`
- `evidenceType`
- `confidence`
- `stability`
- `source`
- `sourceRunId`
- `lastConfirmedAt`

`evidenceType`:

- `explicit`: ユーザー本人の明言
- `inferred`: AIの推測
- `confirmed_inference`: 推測をユーザーが確認したもの

`stability`:

- `temporary`
- `contextual`
- `stable`

`scope` は過剰な一般化を防ぐため必須に近い概念として扱う。

例:

- `work`
- `learning`
- `global`
- `space:<spaceId>`

「この収益探索ではコミュニケーションを減らしたい」を「この人物は人間嫌い」と一般化しない。

### Decision

採用・却下・保留等の判断と理由。

Ideaのattributesに埋め込まず、判断履歴として独立保存する。

### Runs / Sources / Evaluations / Artifacts

既存Entityを継続利用する。

必要に応じて `spaceId` を持てるが、旧データは `spaceId` なしでも有効。

## Context Pack

新しいセッションは、Idea graph全体を読み直して現状を再構築するのではなく、原則として:

1. `space_search`
2. `space_get_context`

を使う。

`space_get_context` は以下をまとめて返す。

- Space
- Goal
- Current Brief
- Theme-local constraints
- Relevant Profile Facts
- Important Decisions
- Active Ideas
- Active Opportunities
- Recent Sources
- Recent Runs
- Artifacts
- linked Projects
- Next Actions

`idea_get_context` は残し、graph探索のために使う。

## Distillation Loop

目標とする循環:

```
Conversation
  ↓
space_distill_run
  ↓
Space / Profile Facts / Decisions / Opportunities / Ideas 更新
  ↓
次回 space_get_context
  ↓
前回よりユーザーとテーマを理解した提案
  ↓
さらに distill
```

`space_distill_run` は会話全文を自動解釈するツールではなく、Agentが会話を整理した結果を構造化して保存するためのcommit pointとして扱う。

## Agent Idea Spaceの位置付け

Agent Idea Spaceは今後も残す。

- Space: 長期思考の上位コンテキスト
- Agent Idea Space: 発散・仮説・探索
- Opportunity: 実在する対象
- Decision: 判断履歴
- Project: 実行単位

という責務分離を守る。

## 既存短文ボード

以下は今回のContext Storeとは統合しない。

- アイデアボード
- 趣味ボード
- ストックボード

これらは「短いワードや思いつきを雑に放り込む場所」として現在のUI/DB/操作感を維持する。

将来的にSpaceへのpromoteやlinkを追加する余地はあるが、保存先や利用フローを勝手に統合しない。

## UI

トップDashboardに **Continue Thinking / 思考を再開** を表示する。

Thinking WorkspaceではSpaceごとに次の順で表示する。

1. Current State / Current Brief
2. Goal
3. 自分の条件
4. Active Ideas
5. Opportunities
6. Decisions
7. Evidence / Sources
8. Recent Sessions
9. Next Actions

My Profile / User ModelではProfile Factsを確認・修正できる。

`inferred` は「AIによる推測」と明示する。

## 初回migration

root Idea `wCaYjTvbYlO55KM3kNO5`（収益化できる仕事・案件探索）を、初回のSpace migrationケースとして利用する。

方針:

- 既存Ideaは削除しない
- 関連Ideaに `spaceId` を追加
- Runも可能なら `spaceId` へ関連付け
- concrete gig / opportunity sourceはOpportunityへ抽出
- 採用・却下理由はDecisionへ抽出
- 再利用可能な条件はProfile Factsへ抽出
- 一時条件は `scope=space:income-search` + `stability=temporary`
- migrationはidempotentで、完了後の再実行では既存データを増殖させない
