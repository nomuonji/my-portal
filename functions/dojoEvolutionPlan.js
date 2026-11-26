'use strict';
const {laneView,metaUsage}=require('./dojoLearningEfficiency');
const {score}=require('./dojoProspectiveReview');
const isRated=t=>t.status==='rated'&&['pass','partial','fail'].includes(t.verdict);
const newest=(a,b)=>String(b.ratedAt||'').localeCompare(String(a.ratedAt||''))||String(b.id).localeCompare(String(a.id),undefined,{numeric:true});
const COMPONENTS={
 analyzer:'Compare competing causal diagnoses with one observable falsifier.',
 retriever:'Compare task-matched pass/fail original case retrieval against recent-only or existing retrieval; keep generation unchanged.',
 allocator:'Compare evidence-budget branch selection with existing selection under the same rating budget.',
 proposer:'Compare a new production operation with an incremental wording edit, same source and audience.',
 evolver:'Compare a scoped rule replacement with current approved rule, retain scope and counterexamples.'
};
function evolutionPlan({base,hypotheses,trials,graph}){
  const rows=trials.filter(isRated).slice().sort(newest), opt=graph.stewardship.optimization;
  const lanes=laneView(trials,base), current=base.method?.bodyRef?.versionNumber;
  const old=(lanes.production?.byActualVersion||[]).filter(x=>x.version!==current&&x.rated>=5&&x.pass>0)
    .sort((a,b)=>b.passRate-a.passRate||b.rated-a.rated).slice(0,3);
  const currentActual=lanes.production?.byActualVersion?.find(x=>x.version===current)||null;
  const historical=lanes.byVersion.filter(x=>!x.released).map(x=>{
    const bins=['exploration','validation','capability','legacy_unclassified'].map(k=>x[k]);
    const rated=bins.reduce((s,x)=>s+x.rated,0),pass=bins.reduce((s,x)=>s+x.pass,0);
    return {version:x.version,rated,pass,passRate:rated?pass/rated:null};
  }).filter(x=>x.rated>=8&&x.pass>0).sort((a,b)=>b.passRate-a.passRate||b.rated-a.rated).slice(0,3);
  const mixed=(opt.directionMemory||[]).filter(x=>x.direction==='isolate_scope_before_edit');
  // Exact references, not summaries or invented diagnoses. All historical reading still required.
  const memory=mixed.slice(0,8).map(x=>{
    const linked=rows.filter(t=>t.hypothesisIds?.length===1&&t.hypothesisIds[0]===x.hypothesisId&&t.body&&t.materialKey&&!t.backfilled&&t.experimentArm!=='control');
    const positive=linked.find(t=>t.verdict==='pass'),negative=linked.find(t=>t.verdict==='fail'&&t.materialKey!==positive?.materialKey);
    return positive&&negative?{hypothesisId:x.hypothesisId,passTrialId:positive.id,failTrialId:negative.id,priorPassIds:x.priorPassIds}:null;
  }).filter(Boolean);
  const recent=rows.slice(0,10), stalled=recent.length===10&&recent.filter(t=>t.verdict==='pass').length<=1;
  const failures=(opt.directionMemory||[]).filter(x=>x.direction==='change_operation_not_wording');
  const meta=metaUsage(trials).flatMap(m=>m.researchComparisons.map(x=>({...x,metaVersion:m.version})));
  const components=Object.entries(COMPONENTS).map(([component,instruction])=>{
    const comparisons=meta.filter(x=>x.scope.startsWith(component+':'));
    return {component,comparisons,status:comparisons.length?'downstream_comparison_available':'unmeasured',
      scopePrefix:component+':',instruction};
  });
  const chosen=graph.stewardship.portfolio.selectedBranches;
  const failed=new Set(failures.map(x=>x.hypothesisId));
  const alternative=chosen.find(x=>!failed.has(x.hypothesisId)&&x.moduleId!=='root')||chosen.find(x=>!failed.has(x.hypothesisId));
  return {policyVersion:'dojo-evolution-v2',reviewer:score(trials),memory:{contrasts:memory,
      instruction:'Open actual texts and context; test the retrieval operation itself via a retriever: meta_scope pair. No compression or promotion from labels alone.'},
    regression:{currentApprovedVersion:current??null,currentActual,olderActualCandidates:old,
      olderPinnedCandidates:historical,matchedActualComparisons:lanes.production?.matchedComparisons||[],
      instruction:'Old pinned-version counts are mixed observational leads, not actual production attribution. Resolve exact archived bodies; compare on fresh identical material with actual producing-version receipts in existing validation lane, not capability. No rollback automatically.'},
    researchComponents:components,
    breakthrough:{triggered:stalled||failures.length>0,reason:{lastTenLowPass:stalled,repeatedFailureHypotheses:failures.map(x=>x.hypothesisId)},
      branchOptions:[{kind:'incremental',hypothesisId:chosen[0]?.hypothesisId||null},
        {kind:'different_operation',hypothesisId:alternative?.hypothesisId||null},
        {kind:'older_version',version:old[0]?.version??null}],
      instruction:'On stagnation, use at least one genuinely different source/voice/selection/transformation operation in an existing branch, not a wording variation. Preserve strong prior behavior; synthesis of complementary branches is a candidate only, with explicit parent H IDs and independent comparisons. Never create low-quality extra submissions.'},
    harness:{signals:[...(stalled?['low_recent_human_pass']:[]),...(graph.stewardship.qualityReview.quarantinedNegativeReviews.length?['negative_review_false_clearance']:[]),...(opt.currentPinnedVersion.explorationRated>=8&&opt.currentPinnedVersion.capabilityRated===0?['capability_measurement_starved']:[])],
      instruction:'If the bottleneck is the system, reproduce on a fixed fixture, propose an isolated branch, verify unchanged user gates and regression suite, then explicitly review/merge; no automated code or evaluator self-modification.'},
    note:'Planning and prospective measurement only. Existing research, negative-review, human ratings and release gates remain; no new scheduler, automatic release or model calls.'};
}
module.exports={evolutionPlan};
