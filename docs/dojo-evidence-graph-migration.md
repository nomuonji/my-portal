# 錬成道場：Skill → Hypothesis → Trial/Feedback 証拠グラフ移行（v0.2）

更新: 2026-11-23。対象: `nomuonji/my-portal`。

## レビュー結果（旧設計v0.1への修正）

1. **過去の評価は正本のまま**: 旧 `explorationBaseItems`、`explorationBaseTrials`、`explorationBaseRuns`、`explorationBases.feedbackLog`、Skill/Packの版を上書きせず、読取時にグラフへ投影する。H/T番号、本人コメント、改訂履歴、負仮説、方法論リリース情報を維持。
2. **事後の付け替え禁止**: 既存の `pipelineStage` から文体/情報源等のモジュールを暫定対応付けする。意味的に曖昧なら `root` とする。既存Skill本文を自動分解して「採用済みルール」と断定しない。新しい明示モジュール指定は追加フィールド `targetModuleIds` に保存できる。
3. **部分支持と惜しいは別**: `Trial.verdict=partial` は本人評価。「仮説が特定セグメントで部分支持」は計測から導出する別状態で、探索データだけでは `validated_scope` に昇格しない。
4. **過去の合格を原因証明に使わない**: 一つのTrialが複数仮説に付く場合は、仮説の実績には表示するが独立した因果寄与には数えない。旧Trialには事前登録の比較条件がないため、スキル採用資格には使わない。
5. **Skillへのマージは安全に段階移行**: 実証計算はサーバーの純粋関数で行うが、現在は `evidence-shadow-v1`。Skill本文の自動変更、既存 `exploration_method_version_set` のリリース権限や基準変更、公開・配信・ユーザー所有契約の書換えは行わない。独立検証と実装確認後に機械的なMerge Controllerを有効化する。

## 新旧のマッピング

| 旧来の正本 | 新しい投影 | 既存レコード変更 |
|---|---|---|
| `explorationBases.method.bodyRef` | `SkillTarget`（現行実行版の参照） | なし |
| `explorationBaseItems.kind=hypothesis` | `Hypothesis` | なし |
| `pipelineStage` | `SkillModule`（固定7部位の互換投影） | なし |
| `researchLineage` | 提案系譜エッジ（元のrun/本人評価IDも保持） | なし |
| `explorationBaseTrials` | `Trial` と `HumanFeedback` | なし |
| `explorationBases.feedbackLog` | 紐付けなしの外部本人FB | なし |
| `hypothesisRefinement.js` | 参考診断（従来通り） | なし |
| 新規の `explorationHypothesisEdges` | 追加の関係候補 `HypothesisEdge` | 新規だけ |
| 新規Trialの事前登録メタデータ | `segmentKey / plannedFactors / materialKey / comparisonKey / experimentArm` | 新規だけ |

### モジュールの暫定対応

`root`（不明・Skill全体）、`source`（情報源）、`selection`（選別）、`transform`（発想・加工）、`voice`（文体）、`gate`（審査）、`audience`（読者/市場）。

意図の異なる現行の `pipelineStage` を勝手に細分化しない。必要な仮説だけ、新しい `exploration_item_upsert.targetModuleIds` で明示的に修正する。

## 新API

- `exploration_skill_graph_get(baseId, view=summary|full)`: 既存H/T/FBを直接参照して、その時点のグラフと機械判定を再計算。移行用の一括書込みは不要。`full` は本人評価・原文・修正履歴まで参照可能。新しいSkill規則IDは空欄 `unmapped_legacy_skill_body` とし、旧Skill内容を自動採用ルールと偽らない。
- `exploration_hypothesis_relation_upsert`: 実在するHを結ぶ `derives_from / narrows / contradicts / complements / synthesizes / supersedes`。書き込みは `status=proposed` のみ、系譜DAGの循環・架空Trial根拠を拒否。既存のresearchLineageは削除しない。
- `exploration_item_upsert`: 仮説の追加属性 `targetModuleIds` を受付（任意）。
- `exploration_trial_record`: **新規**Trialのみ任意で事前の `evaluationPhase / segmentKey / plannedFactors / materialKey / comparisonKey / experimentArm` を受付。本人評価後の事後セグメント分割ではない。

## Evidence Aggregator / 機械判定

`functions/dojoEvidenceGraph.js` の純粋関数で、本人採否を集計する。正仮説と負仮説を分離し、採否に含まれる `partial` を `pass` へ変換しない。Wilson区間を公開し、参考の数字には従来のAI自己判定を含めない。

- 旧Trialは `legacy_unclassified`。原則 `collecting` / `promising` など**観察上の状態**のみ。既存データから成績がよい条件を発見できた場合でも `exploratory_partial`。
- `validated_scope` に上がる条件は **新規に本人が判定した、事前登録済み同一素材の treatment/control 比較**、独立した素材キーが5組以上、2run以上、独立比較の優勢が片側二項検定で `p ≤ 0.05`。異なる仮説が同じ投稿に同居しているtreatmentは除外。過去のtrusted backfillには事前登録フィールドを付けても、検証済みにはできない。
- 上の閾値は**暫定ポリシー** `evidence-shadow-v1`。モデルがタグを事前に書いただけで真の無作為化・因果比較が保証されるわけではない。`validated_scope` は自動リリースではなく、まず採用候補への入力である。
- 判定入力とポリシーは投影応答に `evidenceDigest`、`policyVersion`、`reasonCodes` として保持。旧仮説の `stage=observed/reproduced` を勝手に書き換えない。

## フィードバックイベントからの運用

1. Agentは現行 `exploration_research_read / exploration_research_synthesize` によって全仮説・全本人FBをレビューし、仮説や事前登録条件を作成する。
2. `exploration_trial_record` に対象と検証のメタデータを固定する（省略した旧クライアントのTrialは互換保存）。現行のlearningAudit、recall、negativeReview、未評価数などのゲートを保持。
3. 本人が `exploration_trial_rate` で評価すると、今まで通り正本が更新される。
4. `exploration_skill_graph_get` で正本から**最新の判定が同期再計算**される。LLM実行も新しいChatGPT定期ジョブも不要。トラフィックに応じて後日、再構築可能なEvidenceSnapshotキャッシュを追加できる。
5. システムが `exploratory_partial` / `promising` を返せば、AIが子仮説・対立仮説・次の評価物を生成する。採用資格があってもSkill本文の書換え・本番リリースは現行ゲートのまま。

## 既存データに対する移行の意味

この段階の移行は**互換投影（virtual migration）**。既存DBの一括コピー、上書き、再評価、人工的な合格ラベル追加は行わない。新APIで全既存道場を即座に新しい関係モデルとして閲覧できる。書込みが必要なのは新しい明示的な仮説エッジや今後のTrialの事前登録条件だけ。

残課題：Skillの本文から実際のルール境界を特定する手作業/AI提案と本人承認に準ずる確認、RuleMergeProposalの保存、Skill Merge Controllerの採用ゲート・回帰比較、FigJam型の完全な自由配置エディタ。**未実装の範囲を本番移行済みと報告しない。**

## Web画面での移行ビュー

`/exploration` の道場詳細に「仮説の系譜」タブを追加し、認証済み `GET /api/agent-ideas?resource=exploration_skill_graph&id=<dojoId>&view=full` を利用する。

- 左から実行Skill参照 → 部位別モジュール → 仮説・関連エッジ → 元の投稿等・本人評価、の4列を横スクロール可能な選択式で表示する。
- 表示される機械状態は「観察上の有望」「部分支持の候補」「事前登録比較の採用候補」等で区別する。旧 `stage=observed/reproduced` と混同しない。
- 本人の採用原文、完成した評価物への参照、仮説間の関係が表示される。意味が確認されていない提案エッジには「提案」と明記する。
- Skill本文ルールの正規IDマップは未整備であり、グラフ上で誤った「正式採用ルール」を表示しない。
- 評価物の登録・本人評価・Skill版更新は従来の画面/APIに残す。今回追加のビューは読取専用。

## Agentの仕事を「ツリー全体の手入れ」に移行（v0.3）

`exploration_skill_graph_get` の `stewardship` は、本人による評価を待つ間にも研究できる「枝のポートフォリオ」と、追加評価物を提出してよい件数の保守的な目安を返す。

**分業：**
- AI Agent — 全既存仮説と本人合否の原文を読み、別モジュールや対立枝を横断して仮説を修正・分岐・統合提案し、独立条件の評価物を制作する。選ばれた一枝にだけ固執せず、異なるSkill部位から最大3枝を研究候補として選ぶ。本人の判断後にツリーを再点検する。
- システム — 旧H/Tレコードに触れず、条件別合格率と参照関係・評価待ち数から参考の研究優先順位を算出。正式な昇格・Skill規則マージを行ったとは報告しない。
- 本人 — これまでどおり提示された評価物の合格・惜しい・ボツを決めるだけ。

**エージェントが毎run行う手順：**
1. `exploration_research_read` 全ページ → `exploration_research_synthesize`（既存の強制ゲート）。
2. `exploration_skill_graph_get(view=full)` で `stewardship.portfolio` と `promotions`、反例、負仮説、本人評価の実際の文章を読む。異なる枝を横断的に検討し、データ量・今後の反証可能性・根拠の強さを比較して研究対象を選ぶ。
3. 必要な研究仮説を `exploration_item_upsert`、親子・対立・補完関係を `exploration_hypothesis_relation_upsert`（提案状態）で保存。仮説の意味的な改訂・統合を宣言した場合は新しい本文や派生Hを台帳へ実際に反映する。
4. 事前条件・原典・期待値・対立試験を用意し、`exploration_trial_record` で**複数の独立した評価物**を登録可能。人間が比較できるものを2〜3作ることは自然だが、品質と提出上限を優先し、数合わせはしない。複数枝の成果を1つに混ぜて因果判定できなくしない。
5. 本人評価が返ったら `exploration_trial_rate` の実際の言葉を正本に保存し、グラフを再読込。全枝で支持・部分支持・反例・重複を点検し、必要なら新しい子仮説や研究runの比較を起こす。
6. Systemが `validated_scope` を返してもこれはSkillへの自動マージではない。AIは差分案を作れるが、Skill Rule IDマッピングとMerge Controllerが未実装のため正式Skill更新は既存の版管理・リリースゲートを経る。

**容量制御**：`stewardship.userReview` の控えめな上限は未評価5件、最大3件の提案。既存サーバーの登録上限・recall・negativeReview・learningAudit等を変更しない。本人評価が必要な枝と、評価を待たずにできる内部研究を明確に区別し、勝手に人間の合否を推測しない。チャット終了後の継続実行は保証されず、別のScheduled Taskは新設しない。

**意図的に未実装**：複数runの同時実行・並列サブエージェントの制御、仮説間の意味内容をプログラムが自動合成する機能、Skill規則を無条件で自動マージする機能。既存runは1道場につき同時に1件であり、そのrun内では複数Trialを作れる。

## 検証

`npm run test:exploration-base` に新しいグラフ検証を追加。既存H/Tを変更せず読めること、負仮説の合格率誤用を防ぐこと、対立仮説と系譜DAGの検証、偽Trial証拠の拒否、マッチド検証がない旧試作品から自動採用しないこと、事前登録された新しい本人FBに限定して暫定昇格することを確認する。

## v0.4: Skill規則の証拠連鎖、本人評価後のツリー再審査、比較の保守性（2026-11-23）

### 1. Post-rating Tree Maintenance

- ユーザーが `exploration_trial_rate` で実際に評価したら、そのT番号と影響するH番号を `base.treeMaintenance` に保存（既存H/Tを上書きしない）。
- `exploration_skill_graph_get.stewardship.feedbackReview` とWeb「仮説の系譜」タブにレビュー待ちを表示。次のrunで **全ページの履歴確認＋新しい本人評価の全件照合＋影響する全Hの方針** が必要。
- `exploration_research_synthesize.treeReview` に `reviewedTrialIds`、`branchDecisions` （維持・再定義・分割・統合候補・引退・保留）、反証計画、枝横断の要約を保存しないと旧研究の合否だけ引用して進めない。完了時に待ちを消す。意味的な判断はAgent、実在ID・欠落の拒否はServer。
- 既存データのバックフィルは新しい待ちを発生させないが、全履歴readの対象には残る。新しい本人評価を使ってSkillを自動で書き換えない。複数run同時実行は引き続き不可。

### 2. Evidence audit: matched-pair reproducibility

- 評価物の `comparisonKey` と `materialKey` を別々のrunへ再利用したものは同一比較とみなさない。比較するtreatment/controlは**同じrun**で収集すること。
- 同一 `materialKey` は同一仮説・同一条件の統計内で1回のみ数える。agentの同一素材ラベルの使い回しでは統計上の独立性を水増しできない。
- 検証対象の仮説×事前登録セグメント数を補正したBonferroniの `adjustedSignTestP` を計算。事後探索の多数の仮説から都合の良い少数のみを採用候補にしない。
- `validated_scope` は「同一素材に対する人間の対応ある採否が複数runで差を見せた」という参考判定。無作為化、評価者の独立性、作者/学習データからの情報漏洩や真の因果までは担保できない。

### 3. Skill Rule Merge（提案・審査まで）

- `exploration_skill_rule_proposal_upsert` は、現在リリースされている正本Skill/Pack本文の**一意の完全一致引用**（既存の規則を置換/撤回する場合）、対象モジュール、関連する実在する正仮説、本人による合格・非合格の評価物を検査して**不変の `MR-...` 候補**として新collection `explorationSkillRuleProposals` に保存する。昔のSkill本文を曖昧に自動分割・採用ルール扱いしない。
- 追加・置換・撤回の区別がある。機械審査は `graph.skillRules.rules[].eligibility` として動的に再計算し、独立の対応比較が実証不足なら `evidence_incomplete`。別の版へ切り替われば旧候補は `base_method_version_changed` となる。
- `exploration_method_version_set.ruleProposalIds` を任意指定したとき、サーバーは候補の本体引用と新Skill/Pack本文への実際の差分（追加/置換/撤回）を検査。普通のAIによる版更新では `evidenceEligible=true` を要求。本人がその変更を**明示的に指示**したときだけ非実証の変更を許可し、methodHistoryへoverrideと未検証を残す。従来のrun・版別評価数・ベンチマーク・公開ゲートを弱めない。
- **自動で本番リリースはしない。** 旧Skill/Packの全規則の正本化、独立した候補版の回帰検証、本人評価で改善が確認された後の段階的なリリースとロールバックは今後の未完了範囲。コンポーネントが `eligible=true` と返すことはSkillの品質保証ではない。

### 4. 実データとの照合（読取のみ）

`exploration_base_get(view=full)` で、バズ投稿・ユーモア・マネタイズの3道場を読み取って確認。既存Hレコードの `targetModuleIds` 明示設定数は現時点でいずれもゼロで、これらのSkill規則は**自動同定できない**。旧コードの `pipelineStage` 互換投影を維持する。ユーザーが合格と評価した過去の本文を含めて全て再利用するが、機械的な因果証明や新規の本人評価は発生させない。

### 5. 継続中の重要課題

旧Hの全てを一括で機械昇格させることはできない。独立した比較の事前登録を今後積み上げる。既存のhistory取得数上限と失われた古い汎用feedbackについては、全件保証を表明しない。RuleMergeは提案/ゲート段階で、Agentが生成する新規Trialの自動起床や公開後の自動ロールバックは別途検証が必要。クライアントのMCPスキーマに新ツールが出ない場合は接続の再読み込みを行う。

## v0.5：T-128事故からの品質ゲート是正（2026-11-23）

### 調査記録（本人に新たに評価を求めない）

- Run `R-167` は過去83仮説・127本人評価を7ページ読み、本人合否を伏せた4件の履歴分類も4/4正解していた。履歴を読む工程は欠けていなかった。
- それでも `T-128` は H-003/H-075/H-084 の3仮説を**一つの本文**に紐付け、独立に検証できない状態だった。2情報源 `S-296` と `S-297` はともにミスドのおかわりの**二次集計・X AI要約**で、原投稿本文は未取得。
- 提出したAI自身の `predictedPass=0.29` は実際の基礎合格率を下回り、`editorialScreen.strongestObjection` も「50円の逆転も普通の『有料なら気楽』という説明でしかなく笑いが弱い可能性」をすでに挙げていた。にもかかわらず作者自身の説明で `cleared` にした。
- 本人が今回「こうなった。全然うまくいってない」と明言したため `T-128` は原文を保持して正式 `fail` とした。通過した負審査の後で本人不採用になった件数は8件、連続非合格13件。これは負仮説そのものが誤りという意味でなく、**AIによる安全宣言・自己審査が機能していない**ことの実測。

### 修正したサーバー契約

1. `dojoBuzzRecovery.unreliableNegativeReviews`：実際の本人評価で、ひとつの負審査チェックに対し3件以上「clearedなのに本人不採用」かつcleared後の合格が0件なら、その**審査の有効性を隔離**する。自動選択はその審査を使わず、明示使用してuser-facing稿を登録しようとしても拒否。古い評価を改ざんしない。仮説は研究・改訂可能。
2. Buzzの新規評価物は**正仮説を1件だけ主仮説に指定**。複数の親仮説を統合したのなら新たなHを登録し、それ1件を評価物の主仮説とする。別の枝の成果物は別々のTrialにし、必要なら事前比較を設計する。
3. 連続非合格が8件以上なら **回復モード**：runに比較すべき対立仮説・介入・統制・反証を固定した `experimentDesign` が必要。編集候補の `pool[].hypothesisId` は最低2つの異なる正仮説を含む（3つの言い換えを枝横断研究と呼ばない）。非隔離の負仮説を同runに置く。
4. 選択候補の情報源には `source.originalProof`（元投稿の直接URLと16字以上の原文抜粋、`verification=direct_original`）が必要。`source.locator` または過去のsource evidence.sourceに元URLが一致しなければ無効。ランキング一覧・二次要約・AIトレンド要約だけでは提出不可。**元文の真偽をサーバーが独立照合したという意味ではなく、エージェントは直接原典を実際に開いて確認する義務を負う。** URLと引用を捏造しても合格にはならない。
5. AI自らの合格確率が実際の道場基礎合格率より低いとき、回復モードでは本人への提示を拒否して内部候補に戻す。以前の固定0.60閾値を再導入しない。**高い自己確率が品質保証になるわけではない**。予測値を審査通過のために水増しすることを禁じる。

### 今後のエージェント作業

1. 過去の合否の全読込・枝の再審査を既存ゲートどおり完了。
2. 当該道場 `exploration_skill_graph_get.stewardship.qualityReview` の `quarantinedNegativeReviews` を最初に読む。H-078/H-081など、通過後の本人不採用が集中する旧審査はそのまま使わない。過去不合格を新しい不合格として捏造しない。
3. 実際の原典（直接投稿本文）に戻り、同じ題材の言い換えではない**異なる発想機序**の複数枝を試す。必要ならそれぞれの案を個別に実在原典・読者報酬・自己矛盾と照らして内部棄却する。
4. 採用可能な異なる枝が2〜3出来た場合だけ別々の評価物として提出する。質の低い候補で枠を埋めず、本人の時間・既存の最大提出数を守る。
5. 本人の新しい採否で各枝の結果を更新し、全体の支持/反例/合流/退場を再整理する。

### 限界と保証しない事項

この修正は**T-128を通した具体的な逃げ道を塞ぐ**もので、LLMが面白さを確実に理解するようになるわけではない。単一の新Trialの合格を保証しない。対立仮説を最低2つ命名すること自体が内容の独立性の証明でもない。実際の改善効果は将来の本人評価で別に検証する。推測した不採用原因はAI仮説であり、本人が明言した理由としては扱わない。
