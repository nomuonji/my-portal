#!/usr/bin/env node
'use strict';
// One-time agent DIAGNOSIS of already human-rated Buzz cases. This intentionally
// does not infer the user's reasons, revise Skill bodies, raise versions or
// fabricate comparator ratings. Each follow-up needs new human feedback.
const dojo=require('../functions/explorationBaseStore');
const baseId='viral-post-method-discovery';
const reviews=[
 {targetSkillId:'creative-thinking',moduleId:'transform',
  trialIds:['T-076','T-121','T-122','T-123','T-124','T-128','T-132','T-134'],
  action:'compare_more',
  rationale:'本人ボツ8件（T-076、121-124、128、132、134）は確定しているが、素材・機序・語り口が同時に変わっており発想Skill単体の欠陥は確定できない。同じ退職素材の別案T-133は本人合格だが、比較条件は統一されていない。',
  competingExplanations:'A: 元資料自体に独立した新しい観察・利害が欠けるため弱い。B: 一次の行動を加工する際に架空の心情や「つまり」という命名を加えて弱くした。C: 下流の文体や品質審査が悪く、発想操作は正しい可能性もある。',
  nextDiscriminatingExperiment:'S-320の元原文と同じ読者・同程度の長さ・同じ最終編集条件を固定し、実際の動作から帰結を発見する加工と、架空の願望・ラベルを追加する加工を事前登録する。両稿を冷読し、本人合否で比較する。両方ボツなら発想方法だけの責任という説を棄却する。'},
 {targetSkillId:'idea-resonance-lab',moduleId:'selection',
  trialIds:['T-075','T-128','T-134'],action:'compare_more',
  rationale:'T-075・T-128・T-134が本人ボツだった事実はある。ただし各稿の素材の強さ・発想内容・文章化が違い、選別Skillが原因だったという独立した人間の指摘はない。既存のAI品質PASSの偽陽性も比較する必要がある。',
  competingExplanations:'A: そもそも素材の第一体験に新しい報酬がなく、選別段階で落とせたはず。B: 選別時は良い核があったが、文章化で説明を増やして弱くした。C: 読者像が不明確で企画を評価できなかった。',
  nextDiscriminatingExperiment:'同じ一次資料を使い、企画候補の第一場面・固有動作・共有報酬だけを事前に比較し、独立価値のある枝と「原話紹介＋後付けラベル」枝を選別する。文章化Skillと長さは固定し、本人採否の差とAI事前PASSの偽陽性を記録する。'},
 {targetSkillId:'creative-market-discovery',moduleId:'source',
  trialIds:['T-055','T-132'],action:'compare_more',
  rationale:'本人はT-055とT-132をボツにした。どちらも外部の事実・公開反応を入口にしたが、本人が資料調達の失敗を理由として説明したわけではない。ニュース要約と題材自体の希薄さを区別して検証する。',
  competingExplanations:'A: 原典の当事者行動・利害を確認せず、説明可能な外形情報のみ選んだ。B: 原典は充分だったが転用時に作者の総評・命名に依存して独自価値を失った。C: 当該話題の読者文脈が限定されていた。',
  nextDiscriminatingExperiment:'一つの現実の出来事から当事者一次文と反応まとめを両方集め、同じ日付・事実確認・読者条件で「具体的な当事者の選択と帰結」素材と「時刻・見出し」素材の2系統を事前に用意する。発想加工は同じ手順を適用し、どちらが本人合格へ届くか測る。'},
 {targetSkillId:'baka-culture-content-engine',moduleId:'audience',
  trialIds:['T-132'],action:'compare_more',
  rationale:'T-132のNiziUファン合唱企画に対する本人ボツは一件のみで、受け手理解の不足が理由かどうかは不明。時刻推移の説明に終始したことと、ファン固有の文脈・共有動機を見落としたことは別の仮説である。',
  competingExplanations:'A: ファン以外には企画・当落の前提が分からず、即時報酬が弱い。B: ファン当事者にも単なる中止時刻の再掲で新しい発見がない。C: 読者は理解しても、作者による「企画が落選」命名が弱い。',
  nextDiscriminatingExperiment:'原典と対象読者を固定し、ファン当事者向け（状況説明を省く）と初見向け（最低限の共有前提を補う）の表現を比較する。同時に情報量を揃え、別の実際の当事者行動を核にした案を対照として試し、本人評価を収集する。'},
 {targetSkillId:'human-web-voice',moduleId:'voice',
  trialIds:['T-134'],action:'compare_more',
  rationale:'T-134は本人ボツだが、強い命令口調や「お前らはもう脱出」という結びが不自然だったか、そもそもの架空の願望が面白くなかったかは本人の原文から確定できない。声の問題と発想の問題を混同しない。',
  competingExplanations:'A: 発信者が誰なのか分からない命令口調と台詞の作為が音声・文体の違和感につながった。B: 語尾は自然でも「辞め方を教えてほしい」という着想の独立した価値自体が弱い。C: 原典を知らない読者には前提説明が不足した。',
  nextDiscriminatingExperiment:'S-320を固定し、H-090の企画核はそのままで命令口調を自然な日常口語へ置換した版と、元の口調を保持した版を比較する。次に企画核のみH-035型へ切替え、語り口を固定する2×2の対照を事前登録して本人評価を取る。'},
 {targetSkillId:'text-native-social-copywriting',moduleId:'voice',
  trialIds:['T-134'],action:'compare_more',
  rationale:'T-134は本人ボツだが文章化Skillの不適切な説明量と、上流から来た企画核の失敗を分離できない。文量や「出口を教えろ」という後段が長いこと自体の否定的本人理由は明示されていない。',
  competingExplanations:'A: 末尾の説明的な反復・強い台詞が新しい意味を加えなかった。B: 表現を削っても、後任の架空の願望という元の企画が弱い。C: 原文の一次証拠や読者の共有状況が不足していた。',
  nextDiscriminatingExperiment:'同じH-090の企画briefと一次事実を凍結し、冗長な後段だけを除く短い版と原版を比較する。企画核をH-035型へ切り替えた対照も同じ文字数・読者想定・冷読ゲートで準備し、本人の合否と具体的違和感があれば原文で記録する。'},
];
async function run(){
  const graph=await dojo.graphGet({baseId,view:'full'});
  const inbox=graph.stewardship?.skillImprovement?.inbox||[];
  let done=0,skip=0;
  for(const spec of reviews){
    const item=inbox.find(x=>x.id===spec.targetSkillId+':'+spec.moduleId);
    if(!item)throw Error('Missing seeded specialist work item: '+spec.targetSkillId);
    if(item.status!=='pending_review'){skip++;continue;}
    const ids=new Set((item.pendingTrialIds||[]));
    if(spec.trialIds.some(id=>!ids.has(id)))throw Error('Changed human-rated case set: '+spec.targetSkillId);
    const result=await dojo.reviewSkillImprovement({baseId,review:spec,actor:'agent-evidence-review-2026-11-24'});
    if(result.review?.releaseStatus!=='no_skill_revision_or_release')
      throw Error('Skill release guard changed unexpectedly: '+spec.targetSkillId);
    done++;
  }
  const updated=await dojo.graphGet({baseId,view:'summary'});
  const current=updated.stewardship?.skillImprovement?.inbox||[];
  if(current.some(x=>x.status==='pending_review'))throw Error('Unreviewed specialist feedback remains');
  console.log('[dojo-skill-learning] '+done+' reviews; '+skip+
    ' idempotent skips, no Skill edits or self-awarded human verdicts, total '+current.length);
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run,reviews};
