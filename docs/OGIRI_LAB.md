# Ogiri Lab

My Portal に、大喜利を使って発想を拡散しながら、ユーザー自身の「何を面白いと判断したか」を観測データとして蓄積する機能。

## 目的

完成したアイデアだけでなく、1ラウンドごとに以下を残す。\n\nお題は「発想課題」ではなく、日本語の大喜利として成立する短い問いに限定する。

- 何をお題として与えられたか
- Portal 内のどのネタを seed にしたか
- 最初にどう答えたか
- どの変異方向を選んだか
- 変異後にどう発想を広げたか
- 元案 / 変異案のどちらを残したいと判断したか
- 自分の発想をどの方向だと認識したか
- その回答をどれだけ「自分っぽい」と感じたか
- 判断理由の短いメモ

重要なのは、早期に「あなたはこういう人」と人格ラベルへ固定しないこと。
回答内容と選択ログを raw evidence として蓄積し、十分な件数が溜まってから Agent が仮説化する。

## UI

Route: `/ogiri`

1ラウンド:

Portal seed / ランダムお題
→ 最初の回答
→ 任意の変異レンズ
→ 変異回答
→ 元案 / 変異案 / 両方 / どちらもボツ の比較選択
→ 発想シグナル
→ 1〜5自己評価
→ 任意の判断メモ
→ 永続保存

保存後は、
- 次のお題へ進む
- 同じお題で別案を作る

の2方向に分岐する。

「保存済み回答を編集して再保存」は採用しない。
同じデータを二重計上するより、別案として新しい観測値を作る。

## 保存データ

### `ogiri_responses`

1ラウンドごとの生データ。schemaVersion 2。

- `schemaVersion`
- `sessionRound`
- `prompt`
- `source`
- `answer`
- `mutation`
- `mutationPrompt`
- `mutationAnswer`
- `preferredVersion`
- `signals`
- `selfRating`
- `tasteNote`
- `createdAt`

`preferredVersion`:
- `original`
- `mutation`
- `both`
- `neither`

### `creative_profile/primary`

長期集計用の軽量プロファイル。

- `schemaVersion`
- `totalRounds`
- `ratingSum`
- `signalCounts`
- `lensCounts`
- `preferenceCounts`
- `lastResponseId`
- `lastSignals`
- `lastUpdatedAt`

creative_profile は人格診断ではなく集計キャッシュ。
正本は `ogiri_responses` の生データとする。

## Atomic write

回答本体と creative_profile の集計更新は Firestore `writeBatch` で一括コミットする。

これにより、

1. 回答だけ保存された
2. profile 更新に失敗した
3. ユーザーが再保存して回答が重複する

という部分成功を避ける。

## Portal seed

お題生成時は `ideas / stocks / hobbies` をランダム順で探索する。

- 1つ目が空でも即フォールバックせず次の collection を試す
- `createdAt` で取得できない legacy collection は orderBy なしで再試行する
- 保存する source snapshot は文字数とタグ数を制限し、Firestore document size を無駄に圧迫しない

3 collection 全てから取得できなければ静的なお題 deck を使う。

## Creative signals

初期シグナル:

- unexpected / 意外性
- inversion / 逆転
- absurd / 不条理
- useful / 実用性
- specific / 具体性
- metaphor / 比喩
- extreme / 極端化
- wordplay / 言葉遊び
- dark / ブラック
- cute / かわいさ
- social / 社会観察
- minimal / 引き算

この分類は後から追加・再分類できる観測ラベルとして扱う。

## Agent利用

Portal MCP から `ogiri_responses` と `creative_profile` を参照できる。

将来的な分析ループ:

1. 生の `ogiri_responses` を読む
2. 高自己評価 / 低自己評価を比較する
3. `preferredVersion` から「何を残したか」を見る
4. `tasteNote` から判断理由を抽出する
5. 回答構造をクラスタリングする
6. 十分な観測数がある仮説だけ Context Store の `profileFacts` に昇格する
7. その仮説を次のお題・アイデア生成に弱くフィードバックする

profileFacts へ昇格するときも、断定ではなく evidence count と confidence を持つ推定として扱う。

## Firestore security

既存 My Portal と同じく、ログイン済みユーザーのみ読み書き可能。

- `ogiri_responses`
- `creative_profile`


## お題設計 v3

大喜利ラボのお題は、アイデア発想ワークではなく「ボケるための問い」にする。

主カテゴリ:
- こんなの嫌だ
- なぜ？
- 一言
- 架空ニュース
- 最悪
- 穴埋め
- 謎ルール
- 人物

標準お題を約70%、Portalの既存ネタを大喜利形式に変換した「自分ネタ」を約30%で出す。

Portal seed を使う場合も、
「新商品を考えて」
「別用途に変えて」
のような発想課題にはしない。

例:
- こんな「資格試験」は嫌だ。どんなの？
- 「英語学習」を完全に勘違いしている人の一言。
- 「SNS」界隈で史上最もしょうもない事件。何？

回答後の2周目も「発想を拡散」ではなく、同じボケを磨く操作に変更。

- 削る
- 具体化
- 裏切る
- 視点変更
- 真顔

schemaVersion 3 では `promptType` と `promptLabel` を保存し、どのお題形式で本人らしい回答が出やすいかも後から分析できる。


## センス帳（schemaVersion 1）

大喜利ラボ内の「センス帳」では、自分の過去ネタ・AIの案・参考投稿を手で登録し、好き / 普通 / ボツの評価、笑いのシグナル、理由を一緒に保存する。これはプロフィールで性格を決めつけるためではなく、具体例と判断理由を後の生成・分析で参照するための evidence である。

### `humor_examples`

- `text`: ネタ本文（最大5000文字）
- `source`: 自分のネタ / AIの案 / 参考投稿
- `rating`: like / neutral / skip
- `reason`: 刺さった・滑った理由（最大1000文字）
- `signals`: 既存の creative signals
- `createdAt`, `updatedAt`

MCP の `portal_search` / `portal_get` から参照できるようにコレクション許可リストに含める。大喜利ラボからの保存・評価変更はログイン中のユーザーに限定する。
