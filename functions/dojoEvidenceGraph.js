'use strict';

// Additive, reproducible projection of existing Exploration Base records.
// The historical H/T IDs, human verdicts, skill pointer and revision history
// remain canonical. No writes, guessed classifications or historical backfill.
const { createHash } = require('node:crypto');

const MODULES = Object.freeze([
  { id:'root',name:'Skill全体',pipelineStages:['unknown'] },
  { id:'source',name:'情報源',pipelineStages:['source'] },
  { id:'selection',name:'候補選定',pipelineStages:['selection'] },
  { id:'transform',name:'発想・加工',pipelineStages:['transform'] },
  { id:'voice',name:'文体・表現',pipelineStages:['voice'] },
  { id:'gate',name:'品質審査',pipelineStages:['gate'] },
  { id:'audience',name:'受け手・市場',pipelineStages:['audience'] },
]);
const MODULE_IDS = new Set(MODULES.map(x=>x.id));
const LINEAGE = new Set(['derives_from','narrows','synthesizes','supersedes']);
const RELATIONS = new Set([...LINEAGE,'contradicts','complements']);
const POLICY = Object.freeze({ version:'evidence-shadow-v1', minObservations:5,
  minRuns:2, minPairedComparisons:5, minDiscordant:5, maxSignTestP:0.05,
  minSegmentLift:0.20 });
const keyOf = value => String(value||'').trim();
const shortHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);
const round = n => Math.round(n*10000)/10000;
const isRated = t => t?.status === 'rated' && ['pass','partial','fail'].includes(t.verdict);
const sortById = (a,b)=>String(a.id).localeCompare(String(b.id),'en');
const simple = t => ({
  id:t.id,runId:t.runId||null,methodVersion:t.methodVersion||null,
  hypothesisIds:t.hypothesisIds||[],verdict:t.verdict||null,
  ratedAt:t.ratedAt||null,userWords:t.userWords||'',label:t.label||'',
  ref:t.ref||'',materialKey:t.materialKey||null,
  evaluationPhase:t.evaluationPhase||'legacy_unclassified',
  segmentKey:t.segmentKey||'unsegmented',
  experimentArm:t.experimentArm||null,comparisonKey:t.comparisonKey||null,
});
function moduleIds(h){
  const supplied=Array.isArray(h.targetModuleIds)?[...new Set(h.targetModuleIds.filter(x=>MODULE_IDS.has(x)))]:[];
  return supplied.length?supplied:[MODULE_IDS.has(h.pipelineStage)?h.pipelineStage:'root'];
}
function wilson(k,n){
  if(!n)return null;
  const z=1.96,p=k/n,denom=1+z*z/n;
  const center=(p+z*z/(2*n))/denom;
  const d=(z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/denom;
  return {low:round(Math.max(0,center-d)),high:round(Math.min(1,center+d))};
}
function binomialTail(k,n){
  if(n<=0)return 1;
  let sum=0;
  // Stable iterative binomial probabilities for <=3000 historical entries.
  let p=Math.pow(0.5,n);
  for(let i=0;i<=n;i++){
    if(i>=k)sum+=p;
    if(i<n)p=p*(n-i)/(i+1);
  }
  return Math.min(1,sum);
}
function counts(samples){
  const n=samples.length,passed=samples.filter(t=>t.verdict==='pass').length;
  const partial=samples.filter(t=>t.verdict==='partial').length;
  return {n,pass:passed,partial,fail:n-passed-partial,
    passRate:n?round(passed/n):null,passWilson95:wilson(passed,n)};
}
// Keep explicit guesses in a separate provenance class; agent-proposed labels
// never silently become endorsed factual or causally verified edges.
function graphEdges(hypotheses,proposed=[]){
  const found=new Map(), ids=new Set(hypotheses.map(h=>h.id));
  for(const h of hypotheses){
    for(const lineage of h.researchLineage||[]){
      for(const ancestor of lineage.priorHypothesisIds||[]){
        if(ancestor===h.id||!ids.has(ancestor))continue;
        const relation=lineage.action==='synthesize'?'synthesizes':
          lineage.action==='revise'?'supersedes':'derives_from';
        const e={id:'legacy:'+shortHash([ancestor,h.id,relation,lineage.runId]),
          sourceId:ancestor,targetId:h.id,relation,provenance:'researchLineage',
          status:'historical_agent_claim',runId:lineage.runId||null,
          evidenceIds:lineage.comparedFeedbackIds||[]};
        found.set(e.id,e);
      }
    }
  }
  for(const e of proposed){
    if(!ids.has(e.sourceId)||!ids.has(e.targetId)||!RELATIONS.has(e.relation))continue;
    found.set(e.id,{...e,provenance:'proposed_edge',status:'proposed'});
  }
  return [...found.values()].sort(sortById);
}
function graphHasCycle(edges){
  const by=new Map();
  for(const e of edges.filter(x=>LINEAGE.has(x.relation))){
    by.set(e.sourceId,[...(by.get(e.sourceId)||[]),e.targetId]);
  }
  const visiting=new Set(),done=new Set();
  function visit(node){
    if(visiting.has(node))return true;
    if(done.has(node))return false;
    visiting.add(node);
    for(const next of by.get(node)||[])if(visit(next))return true;
    visiting.delete(node);done.add(node);
    return false;
  }
  return [...by.keys()].some(visit);
}
function validateEdges(rawEdges,hypotheses,known=[]){
  if(!Array.isArray(rawEdges)||!rawEdges.length||rawEdges.length>12)
    throw new Error('Relations require 1-12 proposals');
  const map=new Map(hypotheses.map(h=>[h.id,h]));
  const results=[];
  for(const raw of rawEdges){
    const from=keyOf(raw?.sourceId),to=keyOf(raw?.targetId);
    const relation=keyOf(raw?.relation);
    if(!map.has(from)||!map.has(to)||from===to)
      throw new Error('Relation endpoints must be different existing hypotheses in this dojo');
    if(!RELATIONS.has(relation))throw new Error('Relation type not supported');
    const evidenceIds=Array.isArray(raw.evidenceIds)?[...new Set(raw.evidenceIds
      .map(keyOf).filter(Boolean))].slice(0,16):[];
    const rationale=keyOf(raw.rationale);
    if(rationale.length<15||rationale.length>900)
      throw new Error('Proposed relation requires a specific 15-900 character rationale');
    const [sourceId,targetId]=LINEAGE.has(relation)?[from,to]:[from,to].sort();
    const id='E-'+shortHash([sourceId,targetId,relation]);
    results.push({id,sourceId,targetId,relation,evidenceIds,
      rationale,status:'proposed',proposedBy:'agent'});
  }
  const unique=[...new Map(results.map(e=>[e.id,e])).values()];
  if(graphHasCycle([...known,...unique]))throw new Error('Hypothesis lineage cycle is not allowed');
  return unique;
}
function matchedPairs(hypothesisId,trials,segment){
  // Only pre-rating registered validation comparisons. The comparison keys
  // are agent-declared and cannot by themselves establish randomized causality.
  const groups=new Map();
  for(const t of trials){
    if(!isRated(t)||t.evaluationPhase!=='validation'||!t.comparisonKey||
      !t.materialKey||t.segmentKey!==segment||!t.runId||!['control','treatment'].includes(t.experimentArm))continue;
    if(t.experimentArm==='treatment'&&
       (!(t.hypothesisIds||[]).includes(hypothesisId)||(t.hypothesisIds||[]).length!==1))continue;
    const group=t.comparisonKey+'|'+t.materialKey;
    const k=groups.get(group)||{control:[],treatment:[]};
    k[t.experimentArm].push(t);groups.set(group,k);
  }
  return [...groups.values()].filter(g=>g.control.length===1&&g.treatment.length===1)
    .map(g=>({control:g.control[0],treatment:g.treatment[0]}));
}
function promotion(h,trials,all){
  const observed=trials.filter(isRated);
  const historical=counts(observed);
  const runs=[...new Set(observed.map(t=>t.runId).filter(Boolean))];
  if(h.polarity==='negative')
    return {hypothesisId:h.id,state:'negative_risk_review',policyVersion:POLICY.version,
      eligibleForMerge:false,reasonCodes:['negative_hypothesis_uses_risk_audit_not_positive_pass_rate'],
      historical};
  const segments=[...new Set(observed.map(t=>t.segmentKey||'unsegmented'))];
  const segmentRows=segments.map(segment=>{
    const samples=observed.filter(t=>(t.segmentKey||'unsegmented')===segment);
    const c=counts(samples);
    const pairs=matchedPairs(h.id,all,segment);
    const treatmentBetter=pairs.filter(p=>p.treatment.verdict==='pass'&&p.control.verdict!=='pass').length;
    const controlBetter=pairs.filter(p=>p.control.verdict==='pass'&&p.treatment.verdict!=='pass').length;
    const discordant=treatmentBetter+controlBetter;
    const pValue=binomialTail(treatmentBetter,discordant);
    const pairRuns=new Set(pairs.flatMap(p=>[p.control.runId,p.treatment.runId])).size;
    const validated=pairs.length>=POLICY.minPairedComparisons
      &&discordant>=POLICY.minDiscordant&&treatmentBetter>controlBetter
      &&pairRuns>=POLICY.minRuns&&pValue<=POLICY.maxSignTestP;
    return {segmentKey:segment,...c,distinctRunCount:new Set(samples.map(x=>x.runId).filter(Boolean)).size,
      cooccurrenceCount:samples.filter(x=>(x.hypothesisIds||[]).length>1).length,
      preregisteredValidationCount:samples.filter(x=>x.evaluationPhase==='validation').length,
      pairs:pairs.length,pairRuns,treatmentBetter,controlBetter,signTestP:round(pValue),
      validated};
  }).sort((a,b)=>b.n-a.n||a.segmentKey.localeCompare(b.segmentKey));
  const validated=segmentRows.filter(s=>s.validated);
  let state='unexamined',reasonCodes=[];
  if(!observed.length){reasonCodes=['no_human_ratings'];}
  else if(validated.length){state='validated_scope';reasonCodes=['preregistered_paired_user_ratings','two_or_more_distinct_runs','one_sided_sign_test_passed'];}
  else {
    state='collecting';
    const multi=observed.some(t=>(t.hypothesisIds||[]).length>1);
    const legacy=observed.some(t=>!t.evaluationPhase||t.evaluationPhase==='legacy_unclassified');
    if(multi)reasonCodes.push('cooccurrence_not_causal_support');
    if(legacy)reasonCodes.push('historical_trials_not_preregistered_for_segment_validation');
    if(runs.length<POLICY.minRuns)reasonCodes.push('insufficient_run_diversity');
    const split=segmentRows.find(s=>s.segmentKey!=='unsegmented'
      &&s.n>=POLICY.minObservations&&s.distinctRunCount>=POLICY.minRuns
      &&s.passRate>=Math.min(1,(historical.passRate||0)+POLICY.minSegmentLift)
      &&!s.validated);
    if(split){state='exploratory_partial';reasonCodes.push('segment_association_requires_new_independent_trials');}
    else if(observed.length>=POLICY.minObservations&&historical.pass>0){state='promising';reasonCodes.push('observational_only_not_merge_eligible');}
    else reasonCodes.push('insufficient_rated_evidence');
  }
  return {hypothesisId:h.id,state,policyVersion:POLICY.version,
    eligibleForMerge:validated.length>0,validatedSegments:validated.map(x=>x.segmentKey),
    historical,segments:segmentRows,reasonCodes,
    caution:'Even validated_scope uses agent-declared comparison keys and user ratings, not a proof of causal mechanism.'};
}
function projectGraph({base,items=[],trials=[],feedbackLog=[],relations=[],view='summary'}){
  const hypotheses=items.filter(x=>x.kind==='hypothesis').sort(sortById);
  const modules=MODULES.map(m=>({...m,source:'compatibility_projection',
    hypothesisIds:hypotheses.filter(h=>moduleIds(h).includes(m.id)).map(h=>h.id)}));
  const rated=trials.filter(isRated);
  const promotions=hypotheses.map(h=>promotion(h,rated.filter(t=>(t.hypothesisIds||[]).includes(h.id)),trials));
  const edges=graphEdges(hypotheses,relations);
  const nodes=hypotheses.map(h=>({
    id:h.id,kind:'hypothesis',title:h.title,statement:h.statement||'',mechanism:h.mechanism||'',
    polarity:h.polarity||'positive',status:h.status||'open',legacyStage:h.stage||'conjecture',
    targetModuleIds:moduleIds(h),moduleAssignment:!h.targetModuleIds?.length?'compatibility_inferred':'explicit',
    limits:h.limits||'',revisionHistory:view==='full'?(h.revisionHistory||[]):undefined,
    researchLineage:view==='full'?(h.researchLineage||[]):undefined,
    promotion:promotions.find(p=>p.hypothesisId===h.id),
  }));
  const dangling=feedbackLog.filter(f=>['confirmed','declined'].includes(f.decision)).map(f=>({
    id:f.haulId||f.ref,kind:'external_haul',userWords:f.comment||f.actionLabel||'',
    verdict:f.decision==='confirmed'?'pass':'fail',hypothesisIds:[],
  }));
  const evidenceDigest=shortHash([hypotheses.map(x=>[x.id,x.status,x.revisionHistory]),
    trials.map(x=>[x.id,x.runId,x.hypothesisIds,x.status,x.verdict,x.ratedAt,x.segmentKey,x.evaluationPhase,x.materialKey,x.comparisonKey]),
    feedbackLog.map(x=>[x.haulId,x.ref,x.decision,x.comment]),relations.map(x=>x.id)]);
  return {
    baseId:base?.id,policyVersion:POLICY.version,evidenceDigest,
    target:{kind:base?.method?.bodyRef?.kind||null,
      id:base?.method?.bodyRef?.location||null,releasedVersion:base?.method?.bodyRef?.versionNumber||null,
      methodVersion:base?.method?.version||null},
    modules,hypotheses:nodes,hypothesisEdges:edges,
    trials:view==='full'?trials.map(simple):trials.filter(isRated).slice(-40).map(simple),
    externalFeedback:dangling,
    promotions,
    skillRules:{status:'unmapped_legacy_skill_body',rules:[],
      warning:'Do not infer machine-adopted rule IDs from prose or old method versions.'},
    migration:{mode:'virtual_non_destructive',historicalHypotheses:hypotheses.length,
      historicalTrials:trials.length,historicalRatedTrials:rated.length,
      externalFeedbackDangling:dangling.length,
      explicitRelations:relations.length,legacyLineage:edges.filter(e=>e.provenance==='researchLineage').length,
      historicalTrialsRewritten:0,historicalVerdictsRewritten:0,
      fullTrialNodesReturned:view==='full'},
    safeguards:{autoSkillRelease:false,causalClaimsAutomated:false,releaseGatePreserved:true,
      note:'PromotionDecision is a reproducible shadow classification until provenance and benchmark checks are calibrated.'},
  };
}
module.exports={MODULES,MODULE_IDS,RELATIONS,LINEAGE,POLICY,validateEdges,graphHasCycle,
  promotion,projectGraph,counts,wilson,binomialTail};
