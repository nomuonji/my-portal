'use strict';

// A deterministic coordination hint for the agent that maintains a whole Skill tree.
// It never writes hypotheses, manufactures feedback, certifies a merge or schedules work.
// Every proposed artifact still requires the existing research / trial gates and human rating.
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
  const headroom=Math.max(0,CONSERVATIVE_AWAITING_LIMIT-waiting);
  const active=hypotheses.filter(h=>h.status==='open').map(describe)
    .sort((a,b)=>b.priority-a.priority||a.rated-b.rated||
      a.hypothesisId.localeCompare(b.hypothesisId));
  const selection=[],visited=new Set(),modules=new Set();
  // First allocate to different Skill modules, then to a second non-identical
  // hypothesis arm if capacity remains. Keeps the agent from polishing a single twig.
  for(const candidate of active){
    if(selection.length>=MAX_USER_BATCH)break;
    if(modules.has(candidate.moduleId))continue;
    selection.push(candidate);visited.add(candidate.hypothesisId);modules.add(candidate.moduleId);
  }
  for(const candidate of active){
    if(selection.length>=MAX_USER_BATCH)break;
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
    {kind:'review_all_evidence',responsible:'agent',required:true,
      instruction:'Read the complete past-hypothesis and exact human-feedback casebook before a new run; refresh the graph after every rating.'},
    {kind:'reconcile_hypothesis_tree',responsible:'agent',required:true,
      instruction:'Review the candidate parent/child, opposing and complementary hypotheses; propose splits, corrections, synthesizations, retirement or a falsifying test without inventing causal claims.'},
    {kind:'run_multiple_branch_experiments',responsible:'agent',required:false,
      instruction:'When research gates and user-review capacity allow, prepare distinct evaluable artifacts from up to three branch arms; do not require every batch to have three.'},
    {kind:'compute_promotion_and_merge_eligibility',responsible:'system',required:true,
      instruction:'Recompute human-rated evidence after feedback; deterministic promotion is advisory and must never release a Skill on its own.'},
  ];
  return {
    policyVersion:'tree-steward-v1',
    rootSkillId:base?.method?.bodyRef?.location||null,
    userReview:{awaiting:waiting,conservativeCapacity:headroom,
      suggestedVisibleBatchSize:Math.min(headroom,selection.length,MAX_USER_BATCH),
      constraint:waiting>=CONSERVATIVE_AWAITING_LIMIT?'review_existing_before_creating_more':'respect_existing_submission_gates'},
    portfolio:{activeHypotheses:active.length,selectedBranches:selection,
      distinctModules:branchCoverage,untestedBranches:staleBranches,
      byState,partialCandidates:byState.exploratory_partial||0,
      supportedScopesAwaitingRuleReview:eligible},
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
