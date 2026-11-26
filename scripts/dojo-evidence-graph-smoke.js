'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectGraph,promotion,validateEdges,graphHasCycle,POLICY,binomialTail}=require('../functions/dojoEvidenceGraph');

const base={id:'test-dojo',method:{version:'v20',bodyRef:{kind:'chat_skill',location:'skill-abc',versionNumber:20}}};
const h=(id,module='unknown',extras={})=>({id,kind:'hypothesis',title:id+' title',statement:'A testable claim',
  pipelineStage:module,polarity:'positive',status:'open',createdAt:'2026-10-01',...extras});
const rated=(id,verdict,hids,overrides={})=>({
  id,kind:'trial',runId:'R-001',status:'rated',verdict,hypothesisIds:hids,
  label:'Original '+id,body:'Original text '+id,userWords:verdict,
  ratedAt:'2026-10-02',...overrides,
});

test('migration creates a graph from existing H/T IDs with no changes to source data or fake Skill rules',()=>{
  const hypotheses=[h('H-001','voice'),h('H-002','unknown',{polarity:'negative'}),h('H-003','source',{
    researchLineage:[{runId:'R-003',action:'synthesize',priorHypothesisIds:['H-001'],
      comparedFeedbackIds:['T-001','T-002']}],
  })];
  const trials=[
    rated('T-001','pass',['H-001','H-003']),
    rated('T-002','fail',['H-001']),
    rated('T-003','partial',['H-003'],{runId:'R-002'}),
  ];
  const feedback=[{haulId:'A-001',decision:'confirmed',comment:'really good'}];
  const original=JSON.stringify({hypotheses,trials,feedback});
  const graph=projectGraph({base,items:hypotheses,trials,feedbackLog:feedback,view:'full'});
  assert.equal(JSON.stringify({hypotheses,trials,feedback}),original,'graph read must not mutate the source');
  assert.equal(graph.migration.historicalTrialsRewritten,0);
  assert.equal(graph.migration.historicalVerdictsRewritten,0);
  assert.equal(graph.migration.historicalHypotheses,3);
  assert.deepEqual(graph.hypotheses.map(x=>x.id),['H-001','H-002','H-003']);
  assert.deepEqual(graph.trials.map(x=>x.id),['T-001','T-002','T-003']);
  assert.deepEqual(graph.modules.find(m=>m.id==='voice').hypothesisIds,['H-001']);
  assert.deepEqual(graph.modules.find(m=>m.id==='root').hypothesisIds,['H-002']);
  assert.equal(graph.hypothesisEdges.length,1);
  assert.equal(graph.hypothesisEdges[0].relation,'synthesizes');
  assert.equal(graph.externalFeedback[0].verdict,'pass');
  assert.equal(graph.externalFeedback[0].hypothesisIds.length,0,'old unlinked haul feedback must not be assigned to a guessed H');
  assert.equal(graph.skillRules.status,'unmapped_legacy_skill_body');
  assert.equal(graph.promotions.find(p=>p.hypothesisId==='H-002').state,'negative_risk_review');
  assert.equal(graph.promotions.find(p=>p.hypothesisId==='H-001').eligibleForMerge,false);
  assert.equal(graph.target.releasedVersion,20);
});

test('semantic relation proposals have deterministic IDs and cannot create a lineage cycle',()=>{
  const hs=[h('H-001'),h('H-002'),h('H-003')];
  const one=validateEdges([{sourceId:'H-001',targetId:'H-002',relation:'narrows',
    rationale:'H-002 has a narrower, separately testable condition.'}],hs,[]);
  assert.equal(one.length,1);
  assert.deepEqual(validateEdges([{sourceId:'H-001',targetId:'H-002',relation:'narrows',
    rationale:'H-002 has a narrower, separately testable condition.'}],hs,[])[0].id,one[0].id);
  assert.equal(one[0].status,'proposed');
  assert.throws(()=>validateEdges([{sourceId:'H-002',targetId:'H-001',relation:'derives_from',
    rationale:'This would create a backwards causal ancestry cycle.'}],hs,one),/cycle/);
  assert.throws(()=>validateEdges([{sourceId:'H-099',targetId:'H-001',relation:'derives_from',
    rationale:'This node does not exist in the canonical historical ledger.'}],hs,[]),/existing hypotheses/);
  const contradiction=validateEdges([{sourceId:'H-002',targetId:'H-001',relation:'contradicts',
    rationale:'These may predict opposite outcomes under matched situations.'}],hs,one);
  assert.equal(graphHasCycle([...one,...contradiction]),false);
});

test('historical or multi-hypothesis co-occurrence never becomes an auto-merge decision',()=>{
  const items=[h('H-001','voice')];
  const trials=Array.from({length:24},(_,i)=>rated('T-'+i,'pass',['H-001','H-002'],{
    backfilled:true,runId:'R-'+(i%3+1),evaluationPhase:'validation',
    segmentKey:'specific_motive',materialKey:'material'+i,comparisonKey:'legacy',
    experimentArm:'treatment',
  }));
  const result=promotion(items[0],trials,trials);
  assert.equal(result.eligibleForMerge,false);
  assert.ok(result.reasonCodes.includes('cooccurrence_not_causal_support'));
});

test('mechanical promotion demands new, matched, preregistered comparisons from distinct runs',()=>{
  const items=[h('H-001'),h('H-002')];
  const samples=[];
  for(let i=0;i<7;i++){
    const runId=i%2?'R-001':'R-002';
    samples.push(rated('T-treatment-'+i,'pass',['H-001'],{
      runId,evaluationPhase:'validation',segmentKey:'reversal',comparisonKey:'C-001',
      materialKey:'material-'+i,experimentArm:'treatment',
    }));
    samples.push(rated('T-control-'+i,'fail',['H-002'],{
      runId,evaluationPhase:'validation',segmentKey:'reversal',comparisonKey:'C-001',
      materialKey:'material-'+i,experimentArm:'control',
    }));
  }
  const score=promotion(items[0],samples.filter(t=>t.hypothesisIds.includes('H-001')),samples);
  assert.equal(score.state,'validated_scope');
  assert.equal(score.eligibleForMerge,true);
  assert.deepEqual(score.validatedSegments,['reversal']);
  assert.equal(score.segments[0].pairs,7);
  assert.ok(score.segments[0].signTestP<0.05);
  assert.ok(binomialTail(7,7)<0.05);
  const onlyOneRun=samples.map(s=>({...s,runId:'R-001'}));
  assert.equal(promotion(items[0],onlyOneRun.filter(t=>t.hypothesisIds.includes('H-001')),onlyOneRun).eligibleForMerge,false);
  const allImported=samples.map(s=>({...s,backfilled:true}));
  assert.equal(promotion(items[0],allImported.filter(t=>t.hypothesisIds.includes('H-001')),allImported).eligibleForMerge,false);
});

test('exploratory partial success from old data is not considered independent confirmation',()=>{
  const data=[
    ...Array.from({length:7},(_,i)=>rated('T-A'+i,'pass',['H-001'],{
      runId:i%2?'R-010':'R-011',segmentKey:'motive_present'})),
    ...Array.from({length:7},(_,i)=>rated('T-B'+i,'fail',['H-001'],{
      runId:i%2?'R-010':'R-011',segmentKey:'metaphor_only'})),
  ];
  const result=promotion(h('H-001'),data,data);
  assert.equal(result.state,'exploratory_partial');
  assert.equal(result.eligibleForMerge,false);
  assert.ok(result.reasonCodes.includes('segment_association_requires_new_independent_trials'));
});

test('long paired samples cannot cause sign-test underflow to falsely certify success',()=>{
  const v=binomialTail(1500,3000);
  assert.ok(v>0.45&&v<0.55);
});

test('tree steward allocates research across distinct Skill modules and caps user artifacts',()=>{
  const h1=h('H-001','voice');
  const h2=h('H-002','source');
  const h3=h('H-003','transform');
  const h4=h('H-004','voice');
  const g=projectGraph({base,items:[h1,h2,h3,h4],trials:[]});
  assert.equal(g.stewardship.policyVersion,'tree-steward-v2');
  assert.deepEqual(g.stewardship.portfolio.selectedBranches.map(x=>x.hypothesisId),
    ['H-001','H-002','H-003']);
  assert.deepEqual(g.stewardship.portfolio.selectedBranches.map(x=>x.moduleId),
    ['voice','source','transform']);
  assert.equal(g.stewardship.userReview.suggestedVisibleBatchSize,3);
  assert.equal(g.stewardship.guardrails.autoMergeSkill,false);
  assert.equal(g.stewardship.portfolio.untestedBranches,4);
});
test('tree steward reviews existing unscored artifacts before proposing more human-facing ones',()=>{
  const hs=[h('H-001','voice'),h('H-002','source')];
  const waiting=Array.from({length:5},(_,i)=>({
    id:'T-0'+i,status:'awaiting',hypothesisIds:[i%2?'H-001':'H-002'],
    label:'Waiting evaluation #'+i,
  }));
  const g=projectGraph({base,items:hs,trials:waiting});
  assert.equal(g.stewardship.userReview.awaiting,5);
  assert.equal(g.stewardship.userReview.suggestedVisibleBatchSize,0);
  assert.equal(g.stewardship.userReview.constraint,'review_existing_before_creating_more');
  assert.equal(g.stewardship.portfolio.selectedBranches.length,2,
    'research branch selection may continue when user-facing output is blocked');
});
test('tree steward distinguishes exploratory partial evidence from user partial verdicts',()=>{
  const hs=[h('H-001','voice'),h('H-002','source')];
  const trial=[
    ...Array.from({length:7},(_,i)=>rated('T-A'+i,'pass',['H-001'],{
      runId:i%2?'R-010':'R-011',segmentKey:'specific'})),
    ...Array.from({length:7},(_,i)=>rated('T-B'+i,'fail',['H-001'],{
      runId:i%2?'R-010':'R-011',segmentKey:'generic'})),
    rated('T-partial','partial',['H-002']),
  ];
  const g=projectGraph({base,items:hs,trials:trial});
  const p=g.stewardship.portfolio.selectedBranches.find(x=>x.hypothesisId==='H-001');
  assert.equal(p.state,'exploratory_partial');
  assert.equal(p.intent,'split_and_independently_retest');
  assert.equal(p.eligibleForMerge,false);
  const s=g.stewardship.portfolio.selectedBranches.find(x=>x.hypothesisId==='H-002');
  assert.equal(s.state,'collecting');
  assert.equal(s.pass,0);
});

test('evidence audit rejects cross-run faux pairs and repeated material IDs',()=>{
 const hi=h('H-001');
 const x=(id,arm,run,mat,key,verdict)=>rated(id,verdict,arm==='treatment'?['H-001']:['H-002'],{
   runId:run,materialKey:mat,comparisonKey:key,experimentArm:arm,
   evaluationPhase:'validation',segmentKey:'s'});
 const misleading=[];
 for(let i=0;i<8;i++){
  misleading.push(x('A'+i,'treatment','R-001','same-source','C-'+i,'pass'));
  misleading.push(x('B'+i,'control','R-002','same-source','C-'+i,'fail'));
 }
 const tested=promotion(hi,misleading.filter(t=>t.hypothesisIds.includes('H-001')),misleading);
 assert.equal(tested.eligibleForMerge,false);
 assert.equal(tested.segments[0].pairs,0,'comparators in different runs are not matched samples');
 const duplicates=misleading.map(t=>({...t,runId:'R-'+(Number(t.id.slice(1))%2+1)}));
 const repeated=promotion(hi,duplicates.filter(t=>t.hypothesisIds.includes('H-001')),duplicates);
 assert.equal(repeated.segments[0].pairs,1,'same source is not eight independent pieces of evidence');
 assert.equal(repeated.eligibleForMerge,false);
});

test('multiple hypothesis and segment comparisons increase the evidentiary bar',()=>{
 const xs=[];
 for(let i=0;i<7;i++){
  const runId=i%2?'R-001':'R-002';
  xs.push(rated('T-pos'+i,'pass',['H-001'],{
    runId,materialKey:'matter'+i,comparisonKey:'C',segmentKey:'s',
    evaluationPhase:'validation',experimentArm:'treatment'}));
  xs.push(rated('T-neg'+i,'fail',[],{
    runId,materialKey:'matter'+i,comparisonKey:'C',segmentKey:'s',
    evaluationPhase:'validation',experimentArm:'control'}));
 }
 const h1=h('H-001');
 const single=promotion(h1,xs.filter(t=>t.hypothesisIds.includes(h1.id)),xs,1);
 assert.equal(single.eligibleForMerge,true);
 const twenty=promotion(h1,xs.filter(t=>t.hypothesisIds.includes(h1.id)),xs,20);
 assert.equal(twenty.eligibleForMerge,false,'seven favorable pairs cannot clear the bar for 20 searched claims');
 assert.equal(twenty.segments[0].multipleComparisons,20);
 assert.ok(twenty.segments[0].adjustedSignTestP>=0.05);
});

test('Rule merge proposals require exact pinned text, real human verdicts and independent validation',()=>{
 const {makeRuleProposal,assessRuleProposal}=require('../functions/dojoRuleMerge');
 const rule='Use a concrete motivation rather than a generic label.';
 const method={version:'v68'};
 const hs=[h('H-001','voice')];
 const trials=[
  rated('T-100','pass',['H-001']),
  rated('T-101','fail',['H-001'])
 ];
 const input={sourceMethodVersion:'v68',moduleId:'voice',action:'replace',
  existingRuleAnchor:rule,replacementText:'Build a motivated reversal grounded in an actual observed behavior.',
  hypothesisIds:['H-001'],supportingTrialIds:['T-100'],counterexampleTrialIds:['T-101'],
  rationale:'Historical passing cases may depend on concrete motive, rather than simple novelty alone.',
  refutingObservation:'If independently rated motive variants fail against a generic control, this claim is false.'};
 const record=makeRuleProposal(input,{method,body:'## Voice\n'+rule+'\n',hypotheses:hs,trials});
 assert.equal(record.status,'proposed');
 assert.ok(record.sourceRuleId.startsWith('rule-'));
 assert.throws(()=>makeRuleProposal({...input,existingRuleAnchor:'invented rule text not here'},
  {method,body:rule,hypotheses:hs,trials}),/unique exact/);
 assert.throws(()=>makeRuleProposal({...input,supportingTrialIds:['T-101']},
  {method,body:rule,hypotheses:hs,trials}),/real human pass/);
 const blocked=assessRuleProposal(record,{
  method,graph:{hypotheses:hs,promotions:[{hypothesisId:'H-001',eligibleForMerge:false}]},trials});
 assert.equal(blocked.evidenceEligible,false);
 const ready=assessRuleProposal(record,{
  method,graph:{hypotheses:hs,promotions:[{hypothesisId:'H-001',eligibleForMerge:true}]},trials});
 assert.equal(ready.evidenceEligible,true);
 assert.equal(ready.automaticRelease,false);
 const stale=assessRuleProposal(record,{
  method:{version:'v69'},graph:{hypotheses:hs,promotions:[{hypothesisId:'H-001',eligibleForMerge:true}]},trials});
 assert.equal(stale.evidenceEligible,false);
});

test('release regression monitor warns only after enough human ratings and disjoint intervals',()=>{
 const {loopView}=require('../functions/explorationLoop');
 const r=(id,version,verdict)=>rated(id,verdict,['H-001'],{version,methodVersion:version===2?'v2':'v1'});
 const prior=Array.from({length:28},(_,i)=>r('T-old-'+i,1,'pass'));
 const newer=Array.from({length:28},(_,i)=>r('T-new-'+i,2,'fail'));
 const baseNow={method:{version:'v2',bodyRef:{versionNumber:2}},outcome:{confirmedBy:'user'}};
 const full=loopView({trials:[...prior,...newer],feedbackLog:[],base:baseNow,hypotheses:[h('H-001')]});
 assert.equal(full.releaseHealth.status,'regression_alert');
 assert.equal(full.releaseHealth.automaticRollback,false);
 assert.ok(full.releaseHealth.currentCI.high<full.releaseHealth.previousCI.low);
 const early=loopView({trials:[...prior,...newer.slice(0,2)],feedbackLog:[],base:baseNow,hypotheses:[h('H-001')]});
 assert.equal(early.releaseHealth.status,'too_few_human_ratings');
 const positive=loopView({trials:[...prior.map(x=>({...x,verdict:'fail'})),
   ...newer.map(x=>({...x,verdict:'pass'}))],feedbackLog:[],base:baseNow,hypotheses:[h('H-001')]});
 assert.equal(positive.releaseHealth.status,'improvement_signal');
});

test('T-128 regression: self-cleared repeatedly failing gate, unverified source, three Hs, missing contrast and low confidence are not user-ready',()=>{
 const {checkBuzzSubmissionRecovery,unreliableNegativeReviews}=require('../functions/dojoBuzzRecovery');
 const historical=Array.from({length:6},(_,i)=>rated('T-prior'+i,'fail',['H-003'],{
   negativeReview:{checks:[{hypothesisId:'H-081',decision:'cleared'}]},
 }));
 const quarantined=unreliableNegativeReviews(historical);
 assert.equal(quarantined[0].hypothesisId,'H-081');
 assert.equal(quarantined[0].clearedRejected,6);
 const base={id:'viral-post-method-discovery'};
 const loop={failStreak:13,overall:{passRate:0.32}};
 const run={targets:[{hypothesisId:'H-084'}],
   negativeTargets:[{hypothesisId:'H-081'}]};
 const draft={hypothesisIds:['H-003','H-075','H-084'],predictedPass:0.29,
   editorialScreen:{pool:[{sourceId:'S-296',hypothesisId:'H-084',decision:'selected'},
    {sourceId:'S-297',hypothesisId:'H-075',decision:'rejected'},
    {sourceId:'S-298',hypothesisId:'H-003',decision:'rejected'}]}};
 const sources=[{id:'S-296',locator:'https://imabazu.com/funny/',
   coverage:'二次ランキングで要約。原典未取得。'}];
 const check=(trial=draft,r=run,src=sources)=>checkBuzzSubmissionRecovery({
   base,trial,run:r,existing:historical,sources:src,loop});
 assert.throws(()=>check(),/exactly one primary H/);
 const one={...draft,hypothesisIds:['H-084']};
 assert.throws(()=>check(one),/QUARANTINED/);
 const newRisk={...run,negativeTargets:[{hypothesisId:'H-077'}]};
 assert.throws(()=>check(one,newRisk),/experimentDesign/);
 const designed={...newRisk,experimentDesign:{
   contrastedHypothesisIds:['H-003'],changedStage:'source',
   intervention:'Compare a verified new material',comparison:'Less original summary',
   controls:'same audience',expectedDifference:'distinct real observation',
   refutingObservation:'Human rejects an independently observable version',
 }};
 assert.throws(()=>check(one,designed),/no direct-original/);
 const original=[{id:'S-296',locator:'https://x.com/actualwriter/status/123456789',
   originalProof:{originalUrl:'https://x.com/actualwriter/status/123456789',
     excerpt:'The direct original report is independently observed here.',
     verification:'direct_original'}}];
 assert.throws(()=>check(one,designed,original),/below the real historical base rate/);
 const plausible={...one,predictedPass:0.45};
 const result=check(plausible,designed,original);
 assert.equal(result.recoveryRequired,true);
 assert.equal(result.quarantined[0].hypothesisId,'H-081');
 assert.match(result.note,/not a human prediction/);
});
test('negative preflight warnings distinguish systematic false clearances from a single recent miss',()=>{
 const {unreliableNegativeReviews}=require('../functions/dojoBuzzRecovery');
 const cases=[
   rated('T-a','fail',['H-001'],{negativeReview:{checks:[{hypothesisId:'H-010',decision:'cleared'}]}}),
   rated('T-b','pass',['H-001'],{negativeReview:{checks:[{hypothesisId:'H-010',decision:'cleared'}]}}),
   rated('T-c','fail',['H-001'],{negativeReview:{checks:[{hypothesisId:'H-010',decision:'cleared'}]}}),
   rated('T-d','fail',['H-001'],{negativeReview:{checks:[{hypothesisId:'H-011',decision:'cleared'}]}}),
 ];
 assert.deepEqual(unreliableNegativeReviews(cases),[],
   'a rule with genuine cleared pass or only one missed case is not quarantined');
});

test('retired trial-specific hypotheses preserve human feedback but cannot accrue merge eligibility',()=>{
  const retired=h('H-084','transform',{status:'retired',polarity:'positive'});
  const row=rated('T-128','fail',['H-084'],{body:'A failed speculative 50-yen service post.',
    userWords:'こうなった。全然うまくいってない'});
  const g=projectGraph({base,items:[retired],trials:[row],view:'full'});
  const result=g.promotions[0];
  assert.equal(result.state,'retired');
  assert.equal(result.eligibleForMerge,false);
  assert.equal(result.historical.fail,1);
  assert.deepEqual(g.trials.map(x=>x.userWords),['こうなった。全然うまくいってない']);
  assert.deepEqual(g.stewardship.portfolio.selectedBranches,[]);
});

test('the evidence graph retains operational protocols without upgrading legacy H or human ratings', () => {
  const plan = {
    acquisition: 'Direct first-party sources with a repeatable query and observation window.',
    selection: 'A real choice must produce an observable cost, no hypothetical character.',
    transformation: 'Reframe only a recorded act and its consequence, without invented role labels.',
    control: 'Compare the same original material with a neutral factual retelling.',
    prediction: 'Human acceptance rate should exceed the factual retelling under matched conditions.',
    falsification: 'Repeated rejection or better control results refute this hypothesis.',
  };
  const items = [h('H-101', 'selection', { researchProtocol: plan }), h('H-102', 'unknown')];
  const trials = [rated('T-101', 'fail', ['H-101'])];
  const snapshot = JSON.stringify({ items, trials });
  const graph = projectGraph({ base, items, trials, feedbackLog: [], view: 'full' });
  assert.equal(JSON.stringify({ items, trials }), snapshot);
  assert.deepEqual(graph.hypotheses.find(x => x.id === 'H-101').researchProtocol, plan);
  assert.equal(graph.hypotheses.find(x => x.id === 'H-102').researchProtocol, null);
  assert.equal(graph.hypotheses.find(x => x.id === 'H-101').promotion.historical.fail, 1);
  assert.equal(graph.hypotheses.find(x => x.id === 'H-101').promotion.eligibleForMerge, false);
});


test('rule inventory preserves exact Markdown including fenced code and nested prose',()=>{
  const {partition,inventoryView}=require('../functions/dojoRuleInventory');
  const body='# Heading\r\n\r\n- First rule.\r\n  continued.\r\n- Second rule.\n\n```js\n# not a heading\n- not a list item\n```\n\nFinal text';
  assert.equal(partition(body).map(x=>x.text).join(''),body);
  const view=inventoryView(body,'v1',null,true);
  assert.equal(view.status,'legacy_projection');
  assert.equal(view.count,4);
  assert.equal(view.rules[2].text,'```js\n# not a heading\n- not a list item\n```\n');
});

test('stable rule IDs survive metadata releases; explicit replacement carries human evidence',()=>{
  const {buildInventory,inventoryView}=require('../functions/dojoRuleInventory');
  const old='# Source\n- Collect a real observed source.\n- Reject a source with no original evidence.\n';
  const revised='# Source\n- Collect two independent real observed sources.\n- Reject a source with no original evidence.\n';
  const legacy=inventoryView(old,'v1',null,true);
  const p={id:'MR-1',action:'replace',moduleId:'source',existingRuleAnchor:'Collect a real observed source.',
    replacementText:'Collect two independent real observed sources.',hypothesisIds:['H-001'],supportingTrialIds:['T-001'],counterexampleTrialIds:['T-002']};
  const inv=buildInventory({body:revised,version:'v2',priorBody:old,priorVersion:'v1',proposals:[p]});
  assert.equal(inv.entries[0].id,legacy.rules[0].id);
  assert.equal(inv.entries[0].revision,2);
  assert.deepEqual(inv.entries[0].supportingTrialIds,['T-001']);
  assert.equal(inv.entries[1].id,legacy.rules[1].id);
  assert.deepEqual(inv.changes,[{id:legacy.rules[0].id,action:'replace',proposalId:'MR-1'}]);
  const next=buildInventory({body:revised,version:'v3',priorBody:revised,priorVersion:'v2',prior:inv});
  assert.deepEqual(next.entries,inv.entries);
  assert.deepEqual(next.changes,[]);
  const removed=buildInventory({body:'# Source\n- Reject a source with no original evidence.\n',version:'v4',
    priorBody:revised,priorVersion:'v3',prior:next});
  assert.equal(removed.entries[0].id,legacy.rules[1].id);
  assert.deepEqual(removed.changes,[{id:legacy.rules[0].id,action:'retire',proposalId:null}]);
});

test('unlinked edits and ambiguous repeated text never inherit proof',()=>{
  const {buildInventory}=require('../functions/dojoRuleInventory');
  const old='- Identical old rule.\n- Identical old rule.\n';
  const prior=buildInventory({body:old,version:'v1'});
  prior.entries[0].hypothesisIds=['H-001'];
  const result=buildInventory({body:'- Identical old rule.\n- A new text rule.\n',version:'v2',priorBody:old,priorVersion:'v1',prior});
  assert.ok(result.entries.every(r=>r.hypothesisIds.length===0));
  assert.ok(result.changes.every(x=>x.proposalId===null));
});


test('texture casebook retains the actual original and prioritizes linked contrast without inventing causal support',()=>{
 const {selectCasebook,validateTextureReview}=require('../functions/dojoTextureEvidence');
 const base={id:'sample',method:{version:'v2',bodyRef:{versionNumber:2}},
   ruleInventory:{methodVersion:'v2',entries:[{id:'SR-1',supportingTrialIds:['T-001'],counterexampleTrialIds:['T-002']}]}};
 const trial=(id,verdict,body,at)=>({id,status:'rated',verdict,body,ratedAt:at,methodVersion:'v2',hypothesisIds:['H-001'],userWords:verdict});
 const trials=[trial('T-001','pass','Actually...\n\n  one more word.','2026-01-01'),
   trial('T-002','fail','Actually, one more word.','2026-01-02'),
   trial('T-003','pass','Another recent example.','2026-01-03')];
 const review={cases:[
   {caseId:'T-001',anchor:'Actually...\n\n  one more word.',observation:'A pause and extra indentation separate the final phrase.',context:'The original wording and line spacing are preserved.'},
   {caseId:'T-002',anchor:'Actually, one more word.',observation:'The comma keeps the sentence in a single steady phrase.',context:'The near-neighbor example lacks the abrupt visual pause.'}
 ],distinction:'Line spacing and punctuation create a different reading rhythm.',
 transfer:'Test the pause without copying the wording on an independent artifact.',
 boundary:'Extra whitespace could become artificial when the speaker would not pause.',
 uncertainty:'This contrast is not proof of the reason for the human rating.'};
 const textureReview=validateTextureReview(review,{trials});
 assert.equal(textureReview.cases[0].anchor,review.cases[0].anchor);
 assert.equal(textureReview.cases[0].provenance,'agent_observation_not_user_reason');
 assert.throws(()=>validateTextureReview({...review,cases:[review.cases[0],{...review.cases[1],anchor:'unrecorded text'}]},{trials}),/anchor must quote exact/);
 const items=[{id:'H-001',kind:'hypothesis',statement:'Pausing may matter',textureReview}];
 const book=selectCasebook({base,items,trials,limit:2});
 assert.deepEqual(book.cases.map(x=>x.id),['T-001','T-002']);
 assert.equal(book.cases[0].body,trials[0].body);
 assert.deepEqual(book.cases[1].ruleIds,['SR-1']);
 assert.equal(book.hypotheses[0].textureReview.distinction,review.distinction);
 const legacy=selectCasebook({base:{id:'sample',method:{version:'v2'}},items,trials,limit:2});
 assert.ok(legacy.cases.every(c=>c.role==='observational_human_feedback'));
 assert.equal(selectCasebook({base,items,trials:[],limit:2}).cases.length,0);
});


test('capability is preregistered, protocol-matched and never reconstructed from old ratings',()=>{
 const e=require('../functions/dojoLearningEfficiency');
 const base={method:{version:'v2',bodyRef:{versionNumber:2}},outcome:{confirmedBy:'user'}};
 const plan=e.capabilityPlan({benchmarkKey:'same-task',materialKeys:['material-a','material-b'],task:'Compose a standalone social post',sampling:'Choose unused original observations without looking at outcome',controls:'Keep medium, audience and production resources identical',acceptance:'Same human acceptance criterion across both released methods'});
 const run={id:'R-001',methodVersion:'v2',capabilityPlan:plan};
 const raw={evaluationPhase:'capability',materialKey:'material-a',segmentKey:'same-task'};
 const ev=e.checkCapability(raw,run,[],[raw],base);
 assert.throws(()=>e.checkCapability(raw,run,[{materialKey:'material-a'}],[raw],base),/fresh/);
 assert.throws(()=>e.checkCapability(raw,{...run,capabilityPlan:null},[],[raw],base),/preregistered/);
 const trial=(id,version,evaluationPhase,extra={})=>({id,version,evaluationPhase,status:'rated',verdict:'pass',...extra});
 const trials=[trial('T-1',2,'capability',{capabilityEvidence:ev}),trial('T-2',2,'exploration'),trial('T-3',2,'validation'),trial('T-4',2,'capability'),trial('T-5',2,'capability',{backfilled:true,capabilityEvidence:ev}),trial('T-6',1,'capability',{capabilityEvidence:{...ev,protocolDigest:'different'}})];
 const lanes=e.laneView(trials,base);
 assert.equal(lanes.current.capability.rated,1);
 assert.equal(lanes.current.exploration.rated,1);
 assert.equal(lanes.current.validation.rated,1);
 assert.equal(lanes.current.legacy_unclassified.rated,2);
 const compare=e.capabilityComparison(trials,base,(current,previous)=>({status:previous?'comparison':'no_prior'}));
 assert.equal(compare.comparisons[0].previous,null);
 assert.equal(e.metaUsage(trials).length,0);
});

test('field observations and task-related original cases remain distinct from user verdicts',()=>{
 const {fieldObservation,pruningView}=require('../functions/dojoLearningEfficiency');
 const {selectCasebook}=require('../functions/dojoTextureEvidence');
 const o=fieldObservation({artifactRef:'post:1',sourceRef:'operator:post:1',observedAt:'2026-11-24T00:00:00Z',window:'24h',metrics:{views:400,likes:0},context:'Observed on one account, exposure unknown',comparison:'No comparable baseline is yet available'});
 assert.equal(o.skillVersion,null);
 assert.equal(o.metrics.likes,0);
 assert.equal(o.attribution,'unknown');
 assert.throws(()=>fieldObservation({...o,skillVersion:2}),/execution record/);
 const base={id:'sample',method:{version:'v1'}};
 const trials=[
  {id:'T-1',status:'rated',verdict:'pass',body:'電車の通勤風景',ratedAt:'2026-01-01'},
  {id:'T-2',status:'rated',verdict:'fail',body:'通勤風景の説明文',ratedAt:'2026-01-01'},
  {id:'T-3',status:'rated',verdict:'pass',body:'新しい商品紹介',ratedAt:'2026-01-02'},
 ];
 const book=selectCasebook({base,trials,topic:'電車の通勤風景',limit:2});
 assert.deepEqual(book.cases.map(x=>x.id),['T-1','T-2']);
 assert.equal(book.cases[0].body,trials[0].body);
 const p=pruningView({count:2,methodVersion:'v1',rules:[{id:'r1',digest:'same',section:'A'},{id:'r2',digest:'same',section:'B'}]},'text');
 assert.equal(p.duplicateGroupCount,1);
 assert.deepEqual(p.exactDuplicates[0].ruleIds,['r1','r2']);
});


test('tree steward reserves a matched pair for a started scope instead of spreading across new branches',()=>{
  const items=[h('H-001','voice'),h('H-002','source'),h('H-003','transform')];
  const trials=[
    rated('T-001','pass',['H-001'],{evaluationPhase:'validation',experimentArm:'treatment',segmentKey:'voice_fixed',materialKey:'m1',comparisonKey:'c1'}),
    rated('T-002','fail',['H-002'],{evaluationPhase:'validation',experimentArm:'control',segmentKey:'voice_fixed',materialKey:'m1',comparisonKey:'c1'}),
    ...Array.from({length:6},(_,i)=>rated('T-other-'+i,'pass',['H-003'],{runId:'R-'+i,segmentKey:'different_'+i})),
  ];
  const stewardship=projectGraph({base,items,trials}).stewardship;
  const plan=stewardship.portfolio.validationPlan;
  assert.equal(stewardship.portfolio.selectedBranches[0].hypothesisId,'H-001');
  assert.equal(stewardship.portfolio.selectedBranches.length,2);
  assert.equal(stewardship.userReview.suggestedVisibleBatchSize,3);
  assert.equal(plan.hypothesisId,'H-001');
  assert.equal(plan.segmentKey,'voice_fixed');
  assert.equal(plan.action,'continue_matched_scope');
  assert.equal(plan.reservedArtifacts,2);
  assert.equal(plan.pairs,1);
  const pending=Array.from({length:4},(_,i)=>({id:'T-await-'+i,status:'awaiting',hypothesisIds:['H-003']}));
  assert.equal(projectGraph({base,items,trials:[...trials,...pending]}).stewardship.portfolio.validationPlan,null);
  const reversed=trials.map(t=>t.id==='T-001'?{...t,verdict:'fail'}:t.id==='T-002'?{...t,verdict:'pass'}:t);
  const alternative=projectGraph({base,items,trials:reversed}).stewardship.portfolio.validationPlan;
  assert.equal(alternative.hypothesisId,'H-003');
  assert.equal(alternative.action,'preregister_matched_scope');
  const winless=trials.map(t=>t.id==='T-001'?{...t,verdict:'partial'}:t);
  assert.equal(projectGraph({base,items,trials:winless}).stewardship.portfolio.validationPlan.hypothesisId,'H-003');
  const twoSlots=projectGraph({base,items,trials:[...trials,...pending.slice(0,3)]}).stewardship;
  assert.equal(twoSlots.portfolio.selectedBranches.length,1);
  assert.equal(twoSlots.userReview.suggestedVisibleBatchSize,2);
});


test('meta dojo reports explicitly recorded legacy Skill usage and only unique matched downstream contrasts',()=>{
  const {metaUsage}=require('../functions/dojoLearningEfficiency');
  const receipt={kind:'skill',id:'hypothesis-formation-analysis',version:'1',receiptRef:'chat_skill_get:meta R-001'};
  const row=(id,verdict,arm,extra={})=>rated(id,verdict,['H-001'],{
    evaluationPhase:'validation',experimentArm:arm,comparisonKey:'meta-1',materialKey:'m1',segmentKey:'research_scope',
    plannedFactors:{meta_hypothesis_id:'H-002',meta_scope:'original_contrast',meta_arm:arm},
    executionResources:[receipt],...extra});
  const a=row('T-001','pass','treatment');
  const b=row('T-002','fail','control',{researchEvidence:{metaSkillVersion:1}});
  const noReceipt=row('T-003','pass','treatment',{executionResources:[]});
  const conflict=row('T-004','pass','treatment',{researchEvidence:{metaSkillVersion:2}});
  const old=row('T-005','pass','treatment',{backfilled:true});
  const duplicate=[row('T-006','pass','treatment',{comparisonKey:'meta-2'}),
    row('T-007','fail','control',{comparisonKey:'meta-2'})];
  const crossRun=[row('T-008','pass','treatment',{comparisonKey:'meta-3',materialKey:'m2'}),
    row('T-009','fail','control',{comparisonKey:'meta-3',materialKey:'m2',runId:'R-002'})];
  const untagged=row('T-010','pass','treatment',{plannedFactors:{}});
  const trials=[a,b,noReceipt,conflict,old,...duplicate,...crossRun,untagged];
  const snapshot=JSON.stringify(trials);
  const report=metaUsage(trials);
  assert.equal(JSON.stringify(trials),snapshot);
  assert.equal(report.length,1);
  assert.equal(report[0].version,1);
  assert.equal(report[0].rated,7);
  assert.deepEqual(report[0].provenance,{researchSynthesis:1,executionResourceFallback:6});
  assert.equal(report[0].researchComparisons.length,1);
  assert.equal(report[0].researchComparisons[0].pairs,1);
  assert.equal(report[0].researchComparisons[0].treatmentBetter,1);
  assert.equal(report[0].researchComparisons[0].hypothesisId,'H-002');
  assert.equal(report[0].researchComparisons[0].evidence[0].treatmentTrialId,'T-001');
});

test('actual Skill revisions remain separate from pinned releases and only unique matched pairs count',()=>{
 const e=require('../functions/dojoLearningEfficiency');
 const base={method:{version:'v72',bodyRef:{kind:'chat_skill',location:'buzz-content-ideation',versionNumber:72}},outcome:{confirmedBy:'user'}};
 const resource=v=>({kind:'skill',id:'buzz-content-ideation',version:String(v),receiptRef:'artifact-version-'+v});
 const row=(id,verdict,versions,extra={})=>({id,version:72,status:'rated',verdict,evaluationPhase:'exploration',executionResources:versions.map(resource),...extra});
 const pair={evaluationPhase:'validation',runId:'R-001',comparisonKey:'cmp-1',materialKey:'material-a',segmentKey:'same-task'};
 const a=row('T-216','pass',[80]);
 const b=row('T-217','fail',[]);
 const c=row('T-control','pass',[65],{...pair,experimentArm:'control'});
 const d=row('T-treatment','fail',[82],{...pair,experimentArm:'treatment'});
 const dupC=row('T-dup-c','fail',[65],{...pair,runId:'R-002',comparisonKey:'cmp-2',experimentArm:'control'});
 const dupT=row('T-dup-t','pass',[82],{...pair,runId:'R-002',comparisonKey:'cmp-2',experimentArm:'treatment'});
 const conflict=row('T-conflict','pass',[65,82]);
 const trials=[a,b,c,d,dupC,dupT,conflict];const original=JSON.stringify(trials);
 const report=e.laneView(trials,base);
 assert.equal(JSON.stringify(trials),original);
 assert.equal(report.current.exploration.rated,3,'pinned history remains intact');
 assert.equal(report.production.byActualVersion.find(x=>x.version===80).pass,1);
 assert.equal(report.production.unknown.rated,2);
 assert.equal(report.production.differentFromPinned.rated,5);
 const m=report.production.matchedComparisons;
 assert.equal(m.length,1);assert.deepEqual(m[0].versions,[65,82]);
 assert.equal(m[0].pairs,1);assert.equal(m[0].lowerVersionWins,1);
 const plan=e.capabilityPlan({benchmarkKey:'same-task',materialKeys:['new-material'],task:'Compose a standalone social post',sampling:'Choose unused original observations without looking at outcome',controls:'Keep medium, audience and production resources identical',acceptance:'Same human acceptance criterion across both released methods'});
 const run={id:'R-003',methodVersion:'v72',capabilityPlan:plan};
 const raw={evaluationPhase:'capability',materialKey:'new-material',segmentKey:'same-task'};
 assert.throws(()=>e.checkCapability({...raw,executionResources:[resource(80)]},run,[],[raw],base),/pinned producing Skill/);
 assert.throws(()=>e.checkCapability(raw,run,[],[raw],base),/pinned producing Skill/);
 assert.ok(e.checkCapability({...raw,executionResources:[resource(72)]},run,[],[raw],base));
});

test('learning budget preserves scarce capacity for capability evidence and a matched pair',()=>{
  const {learningBudget}=require('../functions/dojoLearningBudget');
  const base={method:{bodyRef:{versionNumber:9}}};
  const exploration=Array.from({length:12},(_,i)=>({id:'T-'+i,status:'rated',verdict:'fail',version:9,evaluationPhase:'exploration',materialKey:'m'+i,hypothesisIds:['H-001']}));
  const hypotheses=[{id:'H-001',status:'open'}];
  const plan=headroom=>learningBudget({base,hypotheses,trials:exploration,headroom,validationPlan:headroom>=2?{}:null});
  assert.deepEqual(plan(3).suggestedAllocation,{validation:2,capability:1,exploration:0});
  assert.deepEqual(plan(1).suggestedAllocation,{validation:0,capability:1,exploration:0});
  assert.deepEqual(plan(0).suggestedAllocation,{validation:0,capability:0,exploration:0});
  assert.equal(plan(3).directionMemory[0].direction,'change_operation_not_wording');
  const duplicate=exploration.map(t=>({...t,materialKey:'same'}));
  assert.notEqual(learningBudget({base,hypotheses,trials:duplicate,headroom:1}).directionMemory[0].direction,'change_operation_not_wording');
  const pending=[...exploration,{status:'awaiting',version:9,evaluationPhase:'capability'}];
  assert.equal(learningBudget({base,hypotheses,trials:pending,headroom:1}).suggestedAllocation.capability,0);
  assert.equal(learningBudget({base:{...base,outcome:{confirmedBy:'measurement'}},hypotheses,trials:exploration,headroom:1}).suggestedAllocation.capability,0);
});
