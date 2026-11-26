'use strict';

// A deterministic coordination hint for the agent that maintains a whole Skill tree.
// It never writes hypotheses, manufactures feedback, certifies a merge or schedules work.
// Every proposed artifact still requires the existing research / trial gates and human rating.
const { unreliableNegativeReviews,FAILURE_STREAK } = require('./dojoBuzzRecovery');
const { learningBudget } = require('./dojoLearningBudget');
const MAX_USER_BATCH = 3;
const CONSERVATIVE_AWAITING_LIMIT = 5;

const PRIORITY = Object.freeze({
  exploratory_partial: 90,
  promising: 75,
  validated_scope: 65,
  collecting: 55,
  unexamined: 50,
  negative_risk_review: 35,
});

function describe(hypothesis) {
  const p = hypothesis.promotion || {};
  const n = p.historical?.n || 0;
  const moduleId = hypothesis.targetModuleIds?.[0] || 'root';
  let intent;
  switch (p.state) {
    case 'exploratory_partial': intent='split_and_independently_retest'; break;
    case 'promising': intent='design_controlled_contrast'; break;
    case 'validated_scope': intent='draft_rule_change_for_merge_review'; break;
    case 'negative_risk_review': intent='stress_test_failure_mechanism'; break;
    case 'collecting': intent=n>=3?'analyze_counterexamples_and_refine':'collect_independent_examples'; break;
    default: intent='form_testable_claim_and_generate_examples';
  }
  const priority=PRIORITY[p.state] ?? 30;
  return {
    hypothesisId:hypothesis.id,moduleId,
    state:p.state||'unexamined',
    polarity:hypothesis.polarity||'positive',
    priority,
    intent,
    rated:n,pass:p.historical?.pass||0,fail:p.historical?.fail||0,
    reasonCodes:p.reasonCodes||[],
    // This is for selecting a research branch; never a merge certificate.
    eligibleForMerge:p.eligibleForMerge===true,
  };
}

function planTreeStewardship({hypotheses=[],trials=[],hypothesisEdges=[],base}={}) {
  const waiting=trials.filter(t=>t.status==='awaiting').length;
  const quarantinedNegativeReviews=unreliableNegativeReviews(trials);
  const quarantinedIds=new Set(quarantinedNegativeReviews.map(x=>x.hypothesisId));
  const isBuzz=base?.id==='viral-post-method-discovery';
  const failStreak=Number(base?.loop?.failStreak)||0;
  const headroom=Math.max(0,CONSERVATIVE_AWAITING_LIMIT-waiting);
  const active=hypotheses.filter(h=>h.status==='open'&&h.polarity!=='negative').map(describe)
    .sort((a,b)=>b.priority-a.priority||a.rated-b.rated||
      a.hypothesisId.localeCompare(b.hypothesisId));
  // Validation needs repeated independent materials under ONE scope, not a
  // new segment name for each draft. Prefer a viable started comparison over
  // opening another branch. Never treat this advisory plan as approval.
  const validationScopes=hypotheses.filter(h=>h.status==='open'&&h.polarity!=='negative'
    &&!h.promotion?.eligibleForMerge).flatMap(h=>(h.promotion?.segments||[])
      .filter(s=>s.pairs>0&&!s.validated&&s.treatmentBetter>0&&s.treatmentBetter>=s.controlBetter)
      .map(s=>({hypothesisId:h.id,segmentKey:s.segmentKey,pairs:s.pairs,pairRuns:s.pairRuns,
        treatmentBetter:s.treatmentBetter,controlBetter:s.controlBetter})))
    .sort((a,b)=>b.treatmentBetter-a.treatmentBetter||b.pairs-a.pairs||
      a.hypothesisId.localeCompare(b.hypothesisId)||a.segmentKey.localeCompare(b.segmentKey));
  const viable=active.filter(h=>!h.eligibleForMerge&&h.pass>0)
    .sort((a,b)=>b.priority-a.priority||
      (b.pass+1)/(b.rated+2)-(a.pass+1)/(a.rated+2)||b.rated-a.rated||
      a.hypothesisId.localeCompare(b.hypothesisId));
  const ongoing=validationScopes[0];
  const newScope=viable[0];
  const validationPlan=headroom<2?null:ongoing?{...ongoing,action:'continue_matched_scope',reservedArtifacts:2}:
    newScope?{hypothesisId:newScope.hypothesisId,segmentKey:null,action:'preregister_matched_scope',reservedArtifacts:2}:null;
  const optimization=learningBudget({hypotheses,trials,base,headroom,validationPlan});
  // Reserve a capability measurement when it is starved, not another speculative branch.
  // Research can still continue internally on all branches.
  const selection=[],visited=new Set(),modules=new Set();
  // The paired arm consumes two visible artifacts but represents one branch.
  const branchBudget=validationPlan?Math.min(headroom-1,MAX_USER_BATCH-1):MAX_USER_BATCH;
  if(validationPlan){
    const target=active.find(h=>h.hypothesisId===validationPlan.hypothesisId);
    if(target){selection.push(target);visited.add(target.hypothesisId);modules.add(target.moduleId);}
  }
  // First allocate to different Skill modules, then to a second non-identical
  // hypothesis arm if capacity remains. Keeps the agent from polishing a single twig.
  for(const candidate of active){
    if(selection.length>=branchBudget)break;
    if(visited.has(candidate.hypothesisId)||modules.has(candidate.moduleId))continue;
    selection.push(candidate);visited.add(candidate.hypothesisId);modules.add(candidate.moduleId);
  }
  for(const candidate of active){
    if(selection.length>=branchBudget)break;
    if(visited.has(candidate.hypothesisId))continue;
    selection.push(candidate);visited.add(candidate.hypothesisId);
  }
  const byState={};
  for(const h of hypotheses){
    const state=h.promotion?.state||'unexamined';
    byState[state]=(byState[state]||0)+1;
  }
  const proposedRelations=hypothesisEdges.filter(e=>e.status==='proposed');
  const recentRated=trials.filter(t=>t.status==='rated'&&['pass','partial','fail'].includes(t.verdict))
    .slice().sort((a,b)=>String(b.ratedAt||b.createdAt||'').localeCompare(String(a.ratedAt||a.createdAt||'')));
  const touched=new Set(recentRated.slice(0,12).flatMap(t=>t.hypothesisIds||[]));
  const staleBranches=active.filter(h=>h.rated===0).length;
  const branchCoverage=modules.size;
  const eligible=active.filter(h=>h.eligibleForMerge).map(h=>h.hypothesisId);
  const nextActions=[
    {kind:'allocate_learning_evidence',responsible:'agent',required:optimization.suggestedAllocation.capability>0,
      instruction:'Use optimization.suggestedAllocation before drafting. Reserve the indicated capability slot for the pinned approved version on preregistered fresh material. Use remaining slots for the existing matched validation and exploration plan. Inspect directionMemory trial IDs and compare exact bodies; repeated failures require a changed operation or a counterexample, not another wording edit. Do not add outputs beyond capacity or lower quality gates.'},
    {kind:'review_all_evidence',responsible:'agent',required:true,
      instruction:'Read the complete past-hypothesis and exact human-feedback casebook before a new run; refresh the graph after every rating.'},
    {kind:'reconcile_hypothesis_tree',responsible:'agent',required:true,
      instruction:'Review the candidate parent/child, opposing and complementary hypotheses; propose splits, corrections, synthesizations, retirement or a falsifying test without inventing causal claims.'},
    {kind:'run_multiple_branch_experiments',responsible:'agent',required:false,
      instruction:'When a validationPlan exists, reserve two slots for one matched pair (same run, segmentKey, materialKey and comparisonKey; treatment has one target H, control excludes it). Reuse the segmentKey across independent materials and runs. Use any third slot for a distinct branch; never submit low-quality controls or bypass gates.'},
    {kind:'review_validated_scope',responsible:'agent',required:eligible.length>0,
      instruction:'For eligible scopes, prepare evidence-linked rule replacement/retirement review before expanding that hypothesis. Never automatically release.'},
    {kind:'repair_unreliable_negative_review',responsible:'agent',required:isBuzz&&quarantinedNegativeReviews.length>0,
      instruction:'Quarantine risk-clearance rules that cleared >=3 real rejected artifacts with no passes. Inspect the actual body pairs, revise the failure test, and use another negative branch; do not just clear the same old check.'},
    {kind:'compute_promotion_and_merge_eligibility',responsible:'system',required:true,
      instruction:'Recompute human-rated evidence after feedback; deterministic promotion is advisory and must never release a Skill on its own.'},
  ];
  return {
    policyVersion:'tree-steward-v2',
    rootSkillId:base?.method?.bodyRef?.location||null,
    userReview:{awaiting:waiting,conservativeCapacity:headroom,
      suggestedVisibleBatchSize:Math.min(headroom,Math.max(selection.length+(validationPlan?1:0),optimization.suggestedAllocation.capability),MAX_USER_BATCH),
      constraint:waiting>=CONSERVATIVE_AWAITING_LIMIT?'review_existing_before_creating_more':'respect_existing_submission_gates'},
    optimization,
    portfolio:{activeHypotheses:active.length,selectedBranches:selection,
      distinctModules:branchCoverage,untestedBranches:staleBranches,
      byState,partialCandidates:byState.exploratory_partial||0,validationPlan,
      supportedScopesAwaitingRuleReview:eligible},
    qualityReview:{
      recoveryMode:isBuzz&&failStreak>=FAILURE_STREAK,
      failStreak,quarantinedNegativeReviews,
      safeNegativeCandidateIds:hypotheses.filter(h=>h.status==='open'&&h.polarity==='negative'&&!quarantinedIds.has(h.id)).map(h=>h.id),
      observation:'Historical negative-rule clearance is not an independent quality judgment. The same check with repeated false clearances cannot be used to authorize a user-facing Buzz artifact.',
    },
    maintenance:{
      proposedRelationCount:proposedRelations.length,
      proposedRelationIds:proposedRelations.slice(0,15).map(e=>e.id),
      recentHumanRatedCount:recentRated.length,
      recentlyTestedHypothesisIds:[...touched].sort(),
      instruction:'Use real historical comparisons to adjust tree edges and hypothesis definitions. Proposed edges remain unverified; actual merges/revisions use the existing item research and revision workflow.',
    },
    nextActions,
    guardrails:{
      humanVerdictsOnly:true,
      agentProposesRuleEdits:true,
      systemDeterminesEvidenceStatus:true,
      autoMergeSkill:false,
      zeroNewArtifactsAllowed:true,
      noScheduledBackgroundTasks:true,
      readAllHistoricalHypothesesAndFeedback:true,
      existingRecallLearningNegativeReviewPreserved:true,
    },
  };
}
module.exports={MAX_USER_BATCH,CONSERVATIVE_AWAITING_LIMIT,PRIORITY,planTreeStewardship};
