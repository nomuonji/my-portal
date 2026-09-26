# My Portal Context Store + Thinking Workspace

## 役割

My Portalは、単なるメモ・Idea DBではなく、**ユーザーの思考・嗜好・判断・長期テーマを蓄積し、AIエージェントが次回以降のセッションで再利用する Context Store + Thinking Workspace** を目指す。

短い思いつきの保存場所と、長期的な思考コンテキストを混ぜないことが基本方針。

## Entityの役割

### Space

長期間「考え続けるテーマ」。

**UI上の「長期テーマ」と内部Entityの `Space` は同じ概念・同じデータであり、別Entityではない。** 保存先は `spaces` collectionを唯一の正本とする。「長期テーマ」は人間向け表示名、`Space` はコード/MCP上の名称として使い分けるだけ。

Thinking WorkspaceとAgent HQは、Space一覧をContext Store API / `control_plane_overview` 経由で取得する。画面ごとにFirestoreを別経路で直接読む実装は避け、同じ正本・同じ取得レイヤーを使う。


例:

- お金を稼ぐ方法を探す
- 英語学習
- 東京で住みたい街を探す
- 新しいアプリ構想

Spaceは `currentBrief`, `goal`, `nextActions` を持ち、次回セッションの再開地点になる。


### Method / Protocol

複数のRunやProjectから再利用され、実行結果を見ながら改善していく**方法論**。

Spaceが「考え続けるテーマ」であるのに対して、Methodは「どう実行するか」を定義する。

例:

- Space: YouTubeコンテンツ制作方法論
- Method: Tweet → Intellectual YouTube Essay
- MethodVersion: v0.1 / v0.2 / v1.0
- Run: あるtweetをv0.2で調査・脚本化した1回の制作セッション

Method本体はメタデータとactive versionへのポインタを持ち、実行内容はmethodVersionsへimmutableに保存する。改善時は旧versionを書き換えず新versionを作り、レビュー後にactivateする。

RunはmethodId, methodVersionId, methodVersionNumberを保存する。これにより、どの方法論で作った成果物かを後から評価・比較できる。

Agent側は原則として:

1. method_search
2. method_get_context
3. idea_run_start({ methodId, ... })
4. Research / Sources / Ideas / Artifactsを保存
5. idea_run_finish
6. 評価からMethod改善案を作る
7. method_version_create
8. 十分レビューしたversionだけmethod_version_activate

という循環を使う。

### Project

**実装資産を束ねる開発ワークスペース**。Ideaの昇格先ではあるが、単なる企画メモ置き場にはしない。

Projectは単一repoにも、複数repoをまたぐ上位フォルダ的な単位にもできる。

例:

- Space: SNS運用・収益化について長期的に考える
- Project: Affiliate Distribution Platform
  - GitHub: `nomuonji/tweets`, `nomuonji/sites`, `nomuonji/my-portal`
  - MCP: Tweets Operator, Sites Operator, GitHub
  - Work Items: 各repoをまたぐ実装・検証タスク

canonical fields:

- `name`
- `description`: Projectの目的・境界
- `status`: `active | paused | completed | archived`
- `projectType: "implementation_workspace"`
- `schemaVersion: 2`
- `repositories[]`
  - `fullName`: `owner/repo`
  - `url`
  - `role`: frontend / operator / infra / data など
- `mcpTools[]`
  - `name`
  - `purpose`
- `spaceIds[]`: 関連する長期思考Space
- `tags[]`

実際の作業はProject本体にTODO文字列として埋め込まず、`projectId` を持つ Work Item として管理する。

Agentは `control_plane_overview` でactive Projectを取得でき、Projectのrepo/MCP情報を実行コンテキストとして使う。個別Projectの詳細は `portal_get(collection="projects")`、関連作業は `work_item_search({ projectId })` で取得できる。

2026-09-25以前の旧Project 9件は企画Ideaに近かったため、`プロジェクト候補` タグ付きで `ideas` collectionへ移行し、旧Project collectionからは削除した。

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
- Active Methods
- Recent Sources
- Recent Runs
- Artifacts
- linked Projects
- Next Actions

`idea_get_context` は残し、graph探索のために使う。

Opportunityの `sourceUrl` がlegacy migration由来で空の場合、Context Pack生成時にorigin Ideaの一次情報Sourceから補完する。保存済みlegacyデータ自体は破壊的に書き換えない。

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
6. Methods / Protocols
7. Decisions
8. Evidence / Sources
9. Recent Sessions
10. Next Actions

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


## MCP schema互換

Thinking SpaceのIdea（`ideas`）と、短文ボード補充用Agent Ideas（`agent_ideas`）は保存層を分離したまま維持する。ただしAgent側が保存層の差を毎回意識しなくて済むよう、`idea_*` MCP toolsにはinterop routingを持たせる。

- `idea_create({ spaceId, ... })` → Thinking Space Idea
- `idea_create({ categoryId, ... })` → Agent Ideas board item
- `idea_get / idea_update / idea_get_context / idea_archive` → IDから保存層を自動判別
- `idea_link / idea_merge` → 同一保存層内で動作。Thinking ↔ Agent Ideasのcross-layer relationは暗黙変換せず拒否
- `idea_add_source / idea_evaluate / idea_add_artifact` → Idea IDから保存先を自動判別
- `idea_run_start({ spaceId, ... })` → Thinking Workspaceの`runs`
- `idea_run_start({ methodId, ... })` → Methodのactive versionを解決し、methodId / methodVersionId / methodVersionNumber付きでThinking Workspaceのrunsへ保存
- `idea_run_start` without spaceId / methodId / methodVersionId → Agent Ideasのagent_idea_runs
- `space_get_context` は移行期に作成された`agent_idea_runs`も`spaceId`が一致すればrecent runsへ含める

これにより、Space distillationで作ったIdeaを直後に`idea_link`や`idea_add_source`へ渡しても、`Idea not found`にならない。

ChatGPTなどのMCP hostが接続済みserverのtool schemaを一時的にcacheし、新しいContext Store toolsがまだ露出しない場合に備えて、旧Agent Idea toolsからの互換経路も維持する。

- `idea_search({ query: "space:<query>" })` → `space_search` 相当
- `idea_get_context({ id: "space:<spaceId>" })` → `space_get_context` 相当

これは移行期のfallbackであり、Context Store toolsが見える環境では `space_search` / `space_get_context` を優先する。

MCP initializeでは `tools.listChanged = true` を宣言し、host側がtool listの変更を再取得できることを示す。

この互換経路は `0.5.1-netlify` で導入した。


## Agent Control Plane / Work Item

Dashboardは人間向けのメモ一覧ではなく、エージェントが作業を開始・再開・並列実行するための **Agent Control Plane** として扱う。

### Work Item

論理的な `workItems` は `memos/agent-control/workItems` サブコレクションに保存する。既存の `memos/{document=**}` ルール配下なので、現在のPortal認証をそのまま使えて追加のRulesデプロイを要求しない。

Spaceの `nextActions` はテーマの再開地点として残すが、複数エージェントが実際に作業する対象はWork Itemへ昇格させる。

主な状態: `backlog` / `ready` / `in_progress` / `running` / `blocked` / `review` / `archived`。`backlog` は近い将来の実行対象から明示的に外して後回しにした仕事、`ready` はすぐ取得可能、`in_progress` は継続中だが現在Agentが触っていない状態、`running` は現在作業中の状態で、Agentがclaimした場合は `claimedBy` とleaseも付く。`archived` は完了・取り下げをまとめた終端状態。単に作業を中断しただけの継続タスクをbacklogへ落とさない。

さらに `executionMode = agent | human` を持つ。`human` は専用の **Human Tasks** 箱へ表示し、Agent Queueから除外する。

Work Itemは `spaceId`, `projectId`, `sourceType`, `sourceId`, `priority`, `dependencies`, `claimedBy`, `runId`, `leaseExpiresAt`, `resultSummary`, `nextActions` を持てる。`running` はUI上の「現在作業中」を表し、Agentが所有している場合だけ `claimedBy` + lease が実行所有権の正本になる。repo単位の擬似ロックは持たせない。

### Claim / Lease

並列エージェントの重複作業を避けるため、実行前に `work_item_claim` を必須に近い運用とする。Human Taskは `work_item_claim` を拒否する。claimするとstatusは `running` になり、`claimedBy` と期限付きleaseで「今どのAgentが触っているか」を表す。長時間作業は `work_item_heartbeat` で延長する。終了・review・blocked・releaseで `running` を抜ける。lease切れは別エージェントが再取得できる。

### Agent entrypoint

自律作業の開始時は原則:

1. `control_plane_overview`
2. `ready` のWork Itemを選ぶ。必要なら未キュー化のSpace next actionから `work_item_create`
3. `work_item_claim`
4. `spaceId` があれば `space_get_context`
5. 必要に応じて `idea_run_start`
6. 調査・実装・制作。長時間なら `work_item_heartbeat`
7. `idea_run_finish`
8. `work_item_finish(status=archived|review|blocked)` または中断時に `work_item_release`

`control_plane_overview` はWork Itemだけでなく、active Runs、Spaces、Projects、未キュー化のSpace next actions、従来メモの `next_action` / `inbox` / `project` も横断して返す。

Dashboard UIも同じControl Planeの人間向けビューとし、Ready / Working / Running / Blocked / Reviewを区別する。Workingは継続中、Runningはリアルタイム実行中を表す。
### Manager Jobs

Manager Jobは、**対象領域を観測し、既存Queueを整理し、その時点で必要なWork Itemを0〜N件生み出す管理Entity**。

My Portalはスケジューラではない。cron・実行時刻・timezone・nextRunAtは保存せず、ChatGPT Scheduled Tasks等の外部実行系が「いつ起動するか」を担当する。My Portalは「何を観測し、どう判断し、何をWork Item化するか」と管理履歴を担当する。

Manager Jobは実作業そのものを行うJobではない。基本ループは:

1. Observe: Project / Queue / analytics / backlog /対象状態を観測
2. Reconcile: 既存Work Itemの重複、優先度、blocked、古い項目を整理
3. Decide: 今必要な仕事と、今は作らない仕事を判断
4. Delegate: `manager_run_create_work_item` で0〜N件生成、または `manager_run_reconcile_work_item` で既存項目を更新
5. `manager_run_finish` で観測・判断・生成/整理結果を保存

新しい仕事が必要ない場合、**0 Work Itemsで正常終了してよい**。

#### Manager Run

外部スケジューラが `manager_job_start` を呼ぶと、worker Work ItemではなくManager Runが作られる。

```
External Scheduler
  ↓
Manager Job
  ↓ manager_job_start
Manager Run
  ↓ claim
Observe → Reconcile → Decide → Delegate
  ├─ Work Item
  ├─ Work Item
  └─ 0件でも可
```

Manager Runは `ready | running | completed | failed` を持ち、`manager_run_claim` / `manager_run_heartbeat` で所有権を管理する。作成・更新・archiveしたWork Item ID、observations、decisions、summaryを履歴に残す。

Managerが生成したWork Itemは:

- `sourceType = manager_job`
- `sourceId = <managerJobId>`
- `metadata.managerJob.managerRunId`
- 任意の `dedupeKey`
- 生成理由 `reason`

を持つ。これにより「なぜこのタスクが生まれたか」を追跡できる。

#### Method

Manager Jobに紐づくMethodは、workerの作業手順ではなく、**Managerが何を観測し、どうQueueを整理し、どの条件でWork Itemを作るかを定義する管理方法論**として扱う。

Methodのactive versionはManager Run開始時に固定される。Methodを後から改善しても、過去のManager Runがどのversionで判断したか追跡できる。

Agent HQの詳細/編集画面では、Method名・概要・Purpose・instructions・Protocol・Quality Gates・version履歴を表示・編集する。version内容を変更した場合は旧versionを上書きせず、新MethodVersionを作成してactive化する。

UIでは認知負荷を抑えるため、Manager JobカードにはManaged Workのopen件数とRunning / Blocked / Reviewの注意状態だけを表示する。詳細/編集画面では `Job → Managed Work → Method` の順にまとめ、Managed WorkはそのManager由来の未完了Work Itemだけを最大8件まで簡潔に表示する。

Agent HQの人間向けUIは小さな会社をアナロジーとして使う。`あなた（方針・承認） → マネージャー（仕事を発見） → Worker（実行） → 確認デスク（blocked/review）` を軽いドット絵で可視化するが、保存Entity名はManager Job / Work Item / Project等のまま維持する。Portal内からManagerを実行するボタンは置かず、外部ChatGPT/Scheduled Task用の起動文コピーだけをマネージャー設定の補助操作として残す。

#### 既存rotation / receipt機能

既存の以下の情報はManager化後も維持する。

- `rotationTargets[]`: 「順番に実行する対象」ではなくManagerが優先的に観測する管理対象
- `targetProgress`: 対象ごとの最終実作業・block・公開確認等。Manager判断の材料
- `requireExecutionReceipt`: Managerが生成したworker Work Itemに実作業証跡を要求するポリシー
- `allowedActionTypes[]`: worker成果として認める作業種別

Manager自身の完了にexecutionReceiptは要求しない。証跡は生成されたworker Work Item側で保存する。

#### 保存先と正規API

Manager Jobの正本はFirestore `memos/agent-control/managerJobs`。Manager Runは `memos/agent-control/managerRuns` に保存する。

外部スケジューラ・UI・MCP・APIはすべて `manager_job_*` / `manager_run_*` を使う。旧互換Entityは持たない。


### Human Tasks

人間の操作・判断が必要な仕事はAgent Queueに残さない。

- 明示的なユーザー判断・承認
- Agentがアクセスできないログイン・本人確認・支払い・権限付与
- 物理世界での操作
- 人間本人にしか確定できない入力

この場合Agentは `work_item_delegate_to_human` を呼び、`executionMode=human`、`status=ready` にして専用箱へ引き渡す。引き渡し理由と、Agentがそこまでに完了した内容を `humanReason` / `resultSummary` に残す。Human Tasksを人間が完了したら `archived`、Agentへ戻せる状態になったら `executionMode=agent` + `ready` に戻す。

## Linear external task source

LinearはMy Portalの第二の正本DBにはしない。Linear Issueは外部タスクソース、My Portal Work ItemはAgent実行制御の正本として扱う。

- `control_plane_overview` はLinear連携が有効ならopen Issueを返す
- Agentが実行するIssueは `linear_issue_import_to_work_item` でWork Item化してからclaimする
- Work ItemからLinearへは `work_item_push_to_linear` で作成・更新する
- My Portal固有bridgeにないLinear操作は `linear_tool_catalog` → `linear_tool_call` でLinear公式Remote MCPへ中継する
- `LINEAR_API_KEY` はNetlify Functionsのsecret envにのみ保存し、Firestoreやクライアントへ出さない
- API key未設定時はsystem-generated Human Taskを作成し、設定後に自動完了する

詳細は `docs/LINEAR_INTEGRATION.md` を参照。
