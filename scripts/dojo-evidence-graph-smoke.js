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
