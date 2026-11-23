# 道場から個別Skillへの横断錬成（2026-11-23）

## 認知負荷を減らす呼び方

- **Pack＝複数Skillの統括**。目的・工程・専門Skillの参照と使い分けを持つ。バズ投稿Packは `viral-post-pack` で、旧 `buzz-content-ideation` を実行入口に利用する（正本や版は複製しない）。
- **Intelligence＝Skill／Packの一種**。市場・顧客・文化の判断も個別Skillの能力。MCC（`marketing-creative-cognition`）はIntelligence型Skill Pack。旧Registry名 `intelligencePacks` / `intelligence_pack_get` は履歴互換のためだけに残す。
- **Skill＝技術／手順**。独立したSkill本文と版を持つ。従来「統括Skill」と呼んだ `buzz-content-ideation` は、バズ投稿Packの入口を実装する互換Skillとして残す。
- **道場＝訓練・評価・版リリース**。道場は所有対象Skillを持つが、実験で観察した能力上の問題は別の専門Skillにも波及し得る。

```text
             MCC Intelligence型Skill Pack（判断のレンズ）
                            ↕ 必要時に参照
バズ投稿道場 → バズ投稿Pack（Skill群の統括）
                            └─ buzz-content-ideation（旧入口Skill）
     │             ├─ creative-thinking（発想）
     │             ├─ text-native-social-copywriting（文章）
     │             ├─ humor-craft（ユーモア）
     │             └─ social-post-quality-gate（品質）
     └─ 本人評価 → 仮説を診断 → 該当する「専門Skill」側の改訂候補にも反映
```

## 実装契約：横断改善候補の自動ルーティング

`exploration_skill_graph_get` の `stewardship.skillImprovement` に、**既存の本人評価と仮説に基づく改善検討先**を読み取り専用で投影する。

- 各仮説の `targetSkillIds` を指定している場合、その明示的なSkill IDを優先する。どの道場でも利用可。
- バズ投稿道場 `viral-post-method-discovery` に限り、既存の `targetModuleIds` / `pipelineStage` から既知の専門Skillへフォールバックする。source → creative-market-discovery、selection → idea-resonance-lab、transform → creative-thinking、voice → text-native-social-copywriting / human-web-voice、gate → social-post-quality-gate、audience → baka-culture-content-engine。
- モジュールが `root` / `unknown` の場合は、対象Skillを推測で決めない。別道場の汎用モジュールをこの対応表に無断で適用しない。
- 各改善候補には元の道場、H番号、本人の合否T番号、正例/反例数を紐づける。未評価・withdrawn・AI審査は根拠数に含めない。本人が理由を言わない限り「ボツの原因はこのSkill」と確定しない。
- 履歴の書き換えや追加コレクションへの重複コピーはしない。新しい評価が入ると次のグラフ取得時に候補が更新される。

## 反映手順（AIエージェントの責任）

1. 本人の合否を現行 `exploration_trial_rate` で保存し、`exploration_skill_graph_get` の `stewardship.skillImprovement.routes` を読む。
2. 対象専門Skillの原文を `chat_skill_get` で読む。特に本人採用・不採用の原文と他道場の対照を見て、どの規則が不適切かを**仮説として**切り分ける。推測だけの改訂はしない。
3. 十分な独立した対照試験・反証・具体的差分が揃って初めて、対象Skillに `chat_skill_upsert` で改訂を保存する。Packの抽象的な判断原則に本来Skill側の手順を複製しない。変更前のSkill原文は版履歴に保存される。
4. 対象Skillが道場で錬成されていれば、その道場の `exploration_method_version_set` を使い、**その対象Skill自身の**評価・ベンチマーク・公開ゲートに従ってリリースする。Packの構成情報とSkill本文・版履歴は別の正本なので、リリースを自動的に上書きしない。別道場の合格例を移植先の合格例として混算しない。
5. 現行の `exploration_skill_rule_proposal_upsert` は「自道場の固定された主Skill/Pack」の規則候補用であり、専門Skillへの横断書込みを勝手に許可するものではない。移植先の新規対照が不足する場合は改訂せず、検証対象として保持する。

### 既知の限界

今回の自動化範囲は**改善候補のルーティングと根拠表示まで**。サーバーがAIを呼んで勝手に別Skillの原文を編集したり、本人評価を生成したり、共通Skillのリリース条件を緩めたりはしない。実際の改訂・リリースは、評価を扱うAIが対象道場を調べて行う。人間の新規評価や独立対照が不足しているときは未検証として継続する。

## Tool・Consumer Model・Skillの実行依存契約（2026-11-24）

依存を**本文の文章にだけ書く運用は禁止**。責務を二つに分ける。

- **Skill本文**：なぜ必要か、どの場面で参照し、情報をどう判断・反証するかを書く（価値判断、失敗時の扱いを含む）。観測資料・本人の評価原文・個別試作の全文はここに増やさない。
- **版管理されたRelation Policy**：`relations` が他SkillのID/必要度/タスク意図を、`resources` がMCPツールや消費者モデルの解決要件を宣言する。道場承認済みSkill本文に名前のない資源への参照は拒否する。既存の `chat_skill_relation_policy_publish` で保存し、旧クライアントによる部分更新でも `resources` は消去しない。
- **実行時**：`chat_skill_get` は関連Skillを最新の道場承認版からロードし、resourceDependenciesに必要なToolの未実行状態を示す。`consumerModelId`/必要なら`consumerModelVersion`が指定された場合にのみ該当モデルのデータをMy Portal正本から取得する。対象未指定なら勝手に大衆モデルへ固定しない。Tool宣言自体を実際のTool呼出しや成功とは報告しない。
- **Trial時**：`exploration_trial_record.trials[].executionResources` に実際使用したTool/Consumer Model/SkillのID、モデル/Skill版、実行結果の参照、使った目的を保存。データはエージェント申告であり、サーバーが検証したTool成功・人間の評価ではない。実際の合否は別途 `exploration_trial_rate` に原文で保存する。
- **学習時**：`exploration_skill_graph_get` では各評価物のexecutionResourcesと、専門Skill別の資源・版別正例/反例を確認する。モデルやToolを使った群の合格率差は観測相関であり、選別・素材・作者・時期などの交絡を制御していない限り改善効果と断定しない。

現行では本人評価→仮説の振り返り→改善候補ルーティング→対象Skillの改訂→対象道場でのリリース、という一連の**実行可能な操作**を既存APIで行う。AIが具体的な編集案と対照検証を行う責任を持つ。評価物の合否、データ改変、公開権限、版の自動昇格はシステムが勝手に補完・緩和しない。

## 2026-11-24: 評価→専門Skill→再検証の実働キュー

`exploration_trial_rate` は、ユーザーの本当の合否を H/T に保存する同じFirestoreトランザクション内で、`targetSkillIds` または監査済みバズ工程対応表から **Skill改善の未診断キュー** を作る。キーは `targetSkillId:moduleId`、正本は元道場の `skillImprovementInbox` と `skillImprovementReviews`。元のTrial/Hypothesisの本人評価は移動・複製・修正しない。

- `exploration_skill_graph_get.stewardship.skillImprovement.inbox` と道場状態の `skillImprovement` で未処理の枝を確認する。道場Workspaceのツリーにも表示する。
- 過去の既存評価は `exploration_skill_improvement_seed({baseId,confirm:true})` で**一度だけ**初期投入する。既に診断済みのキューを再オープンしない。
- 新しい評価を受けたら、AIは関連Hの原文・実際の合否を読み、少なくとも2つの競合原因を提示する。 `exploration_skill_improvement_review` に Trial ID、診断、対立説明、識別可能な次実験、必要なら具体的な候補ルールを保存する。
- 正例・反例の両方がない限り `rule_candidate` として保存できない。仮に両方あっても、**対応ルールは単なるAI仮説**。比較の独立性・交絡・自分の予測の外れ方を検証する。レビューの保存ではChat Skill本文を変えず、版リリースもしない。未診断のTrialだけが残る部分的レビューも可能。
- `compare_more` で事前登録した素材・選定・加工の対照を試し、後続の本人評価で差分を測定する。 `not_a_skill_defect` で調べた結果は履歴に残し、同じ無根拠な修正案を繰り返さない。
- 本文更新の根拠が揃った場合だけ **変更対象の専門Skill** を `chat_skill_upsert` で改訂し、**対象Skillの道場**で従来の `exploration_method_version_set` を使い承認版にする。対象の道場がない場合は、承認済み現行版を固定した専門道場を先に紐付ける。未承認のdraftを「効果が上がった」と呼ばない。

この仕組みは計算・保管・追跡を強化するものであり、人間の採否をモデルが肩代わりするものでも、裏でAIワーカーが自律稼働するものでもない。本人は成果を評価するだけで、エージェントが同一の道場作業内で未診断の改善キューを処理する。Tool / Consumer Model 使用状態は `executionResources` で区別し、Tool宣言が成功済みという偽報告をしない。

### Skill Pack と共有改善

技能が共有される場所を正本とする。バズPackが `creative-thinking` を使用する場合、`creative-thinking` を改訂するのはその専門Skillの道場であり、バズPack本文に同じ規則をコピペしない。同じSkillを参照する動画・収益化Packは次の実行で**専門Skillの承認済み版**を読む。工程やSkillの組み合わせそのものを変える必要があるときだけ、独立したPack候補版を検証・承認する。
