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
  assert.equal(g.stewardship.policyVersion,'tree-steward-v1');
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
