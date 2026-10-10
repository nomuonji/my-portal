/* Canonical agent bootstrap protocol. Seeded once into portalContextAtlas/home,
 * editable in World Home. The ChatGPT custom instruction is ONLY the pointer.
 */
const SHORT_PROMPT = '私のプロジェクトや継続的な作業では、まずMy Portalの `world_map_get` を呼び、返された `agentGuide` の指示に従ってください。';

const DEFAULT_GUIDE = Object.freeze({
  title: 'Agent Guide｜チャットの起動・参照・引き継ぎ',
  instructions: `# Agent Guide — My Portal World Home
対象: ユーザー固有のプロジェクト・調査・制作・開発・運用、および過去の決定の再利用。一般的な質問や雑談には不要なツール呼び出しを強制しない。

## 1. 入口
会話でユーザー固有の継続的な仕事に入ったら、最初に My Portal の **world_map_get({})** を読み、この agentGuide・routes・projects・contexts・chatSkills・coverage を確認する。これは最上位の案内図。SpaceやMethodを推測で最初の入口にしない。参照できないときはその旨を伝え、未確認の過去状態を推測しない。
新しい会話で取得したこの本文を、当該会話の作業ルールとして利用する。毎ターン同じ情報を無条件に再取得する必要はない。

## 2. 対象特定・正本
依頼のProjectとDomainを特定し、routesのprimary・boundary・toolsを確認する。該当が曖昧なら関係するルートを比較する。専門データの**正本**は各担当Operator/Repo/Databaseであり、World Homeは索引。必要な専門ツールだけ呼ぶ。
例: サイトSEO実測/運用はSites Operator、検索需要/SERPはKeywords Operator、My Portalはチャットの研究や経緯。SNS投稿はTweets Operator、A8契約と案件状態はFree Consult、Learning OSの学習状態はLearning OS。
Manager/WorkerのMethodは運用契約であり、チャット用Skillに流用しない。人間側のSpaceは本人の思考テーマであって会話記録の保存先ではない。

## 3. 過去の判断を読む
対象Project ID・Domainに関係する場合は **context_list({projectId})** または **context_list({domain})** で候補を絞り、必要なものだけ **context_get({id})** で目的・既決事項・現在地・次の行動・判断/訂正の経緯を読む。関連Contextが存在しないことと、過去の決定が存在しないことを同一視しない。
会話・依頼内ですでに十分明確な事実は読み直さない。履歴と現在の実測が矛盾するときは、最新の正本を検証した上で差分を説明する。

## 4. 必要なSkillを選択
執筆、発想、市場探索、デザイン、公開、World Home操作など既存のチャットSkillが該当するときは **chat_skill_list** から候補を選び、**chat_skill_get({id})** で本文を読む。実行定義の正本はMy PortalのchatSkills DB。GitHubのSKILL.mdは保存版/エクスポートで、ChatGPTへのインストールを意味しない。Agent HQ Methodsとは別。
Skill本文の手順でも、実際の作業権限・ユーザー指示・安全要件・担当システムの契約を優先する。

## 5. 実行と検証
依頼対象のシステムで作業し、変更・CI・デプロイ・画面・データの実状態を検証する。取得不能な結果を成功と報告しない。スケジュール済みManager/Workerの規則や他事業の方針を、コンテクスト取得を理由に暗黙変更しない。

## 6. コンテクスト保存の判断
確定した重要な決定、理由、明確な訂正、重大な失敗原因、引き継ぎ事項があれば対応するContextへ **context_event_create** で記録する。安定した目的・方針・現在地・次の行動の要約が変わった場合だけ **context_save** で更新する。適切なContextがなければ、Project ID / Domainを付けて新設する。一時的な会話、未確認の推測、機密情報の無用な複製、すでに記録済みの内容を機械的に保存しない。確認や改訂番号等、書き込みAPIの条件に従う。
Project/Skill/Operatorの担当や正本の所在・重要境界が変わった場合のみ **world_map_update** で地図の該当ルートを更新する。日々のログを地図に複製しない。

## 7. 責務の分離
- World Home = 最上位の案内 + このAgent Guide
- Contexts = Project/Domain別の目的・判断・訂正・作業継続
- Chat Skills = 対話中の仕事のやり方
- Projects/Operators/GitHub = 実装/運用・数値の各正本
- Thinking Spaces = 人間側の長期テーマ
- HQ Methods = Manager/Workerの運用契約
情報と運用を不用意に相互書き込みしない。新しいチャットのカスタム指示には『world_map_getを読んでagentGuideに従う』という最小限の起動ポインタだけを置く。
`,
  minimalCustomInstruction: SHORT_PROMPT,
  scope: 'chat_only',
  version: 1,
});
function validateGuide(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('agentGuide must be an object');
  const title=String(value.title??'').trim();
  const instructions=String(value.instructions??'').trim();
  const minimalCustomInstruction=String(value.minimalCustomInstruction??'').trim();
  if (!title || title.length>150) throw new Error('agentGuide.title must be 1-150 characters');
  if (instructions.length<250 || instructions.length>20000) throw new Error('agentGuide.instructions must be 250-20000 characters');
  if (!minimalCustomInstruction || minimalCustomInstruction.length>350) throw new Error('Minimal custom instruction must be 1-350 characters');
  if (!minimalCustomInstruction.includes('world_map_get')) throw new Error('Custom instruction must include world_map_get');
  return {title,instructions,minimalCustomInstruction,scope:'chat_only'};
}
module.exports={DEFAULT_GUIDE,validateGuide};
