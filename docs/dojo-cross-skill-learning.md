# 道場から個別Skillへの横断錬成（2026-11-23）

## 認知負荷を減らす呼び方

- **Pack＝頭脳**。判断原則・市場や受け手の世界モデル。特定の投稿制作手順は所有しない。
- **Skill＝技術／手順**。独立したSkill本文と版を持つ。 `buzz-content-ideation` は複数の専門SkillとPackを組み立てる「統括Skill」だが、MCC Packの子ではない。
- **道場＝訓練・評価・版リリース**。道場は所有対象Skillを持つが、実験で観察した能力上の問題は別の専門Skillにも波及し得る。

```text
                       Agent Profile
                            │
                MCC Pack（判断のレンズ）
                            ↕ 必要時に解決
バズ投稿道場 → buzz-content-ideation（統括Skill）
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
4. 対象Skillが道場で錬成されていれば、その道場の `exploration_method_version_set` を使い、**その対象Skill自身の**評価・ベンチマーク・公開ゲートに従ってリリースする。別道場の合格例を移植先の合格例として混算しない。
5. 現行の `exploration_skill_rule_proposal_upsert` は「自道場の固定された主Skill/Pack」の規則候補用であり、専門Skillへの横断書込みを勝手に許可するものではない。移植先の新規対照が不足する場合は改訂せず、検証対象として保持する。

### 既知の限界

今回の自動化範囲は**改善候補のルーティングと根拠表示まで**。サーバーがAIを呼んで勝手に別Skillの原文を編集したり、本人評価を生成したり、共通Skillのリリース条件を緩めたりはしない。実際の改訂・リリースは、評価を扱うAIが対象道場を調べて行う。人間の新規評価や独立対照が不足しているときは未検証として継続する。
