'use strict';
// Deterministic, advisory allocation based on human outcomes, not AI ratings.
// Inspired by SkillAdam and GEPA; not a reproduction of either algorithm.
const rated=t=>t.status==='rated'&&['pass','partial','fail'].includes(t.verdict);
const newest=(a,b)=>String(b.ratedAt||b.createdAt||'').localeCompare(String(a.ratedAt||a.createdAt||''))||String(b.id).localeCompare(String(a.id),undefined,{numeric:true});
function learningBudget({hypotheses=[],trials=[],base,headroom,validationPlan}){
  const rows=trials.filter(rated).slice().sort(newest);
  const ref=base?.method?.bodyRef;
  const isCurrent=t=>ref?.versionNumber!=null?t.version===ref.versionNumber:t.methodVersion===base?.method?.version;
  const current=rows.filter(t=>!t.backfilled&&isCurrent(t));
  const exploration=current.filter(t=>t.evaluationPhase==='exploration');
  const capability=current.filter(t=>t.evaluationPhase==='capability'&&t.capabilityEvidence);
  const validation=current.filter(t=>t.evaluationPhase==='validation');
  const pendingCapability=trials.some(t=>t.status==='awaiting'&&isCurrent(t)&&t.evaluationPhase==='capability');
  const measurementMode=base?.outcome?.confirmedBy==='measurement';
  const needCapability=!measurementMode&&exploration.length>=8&&capability.length<8&&!pendingCapability;
  const visible=Math.min(3,Math.max(0,headroom));
  const pairSlots=validationPlan&&visible>=2?2:0;
  const capabilitySlots=needCapability&&visible>pairSlots?1:0;
  const memory=hypotheses.filter(h=>h.status==='open'&&h.polarity!=='negative').map(h=>{
    // Only exclusive, explicitly identified H cases; control arms exclude H by design.
    // Repeated material and missing material identities cannot prove independent repetition.
    const candidates=rows.filter(t=>!t.backfilled&&t.materialKey&&t.hypothesisIds?.length===1&&t.hypothesisIds[0]===h.id&&t.experimentArm!=='control');
    const seen=new Set(),cases=[];
    for(const t of candidates){if(seen.has(t.materialKey))continue;seen.add(t.materialKey);cases.push(t);}
    const recent=cases.slice(0,6);
    const recentPass=recent.filter(t=>t.verdict==='pass').length;
    const recentFail=recent.filter(t=>t.verdict==='fail').length;
    const pairedWins=(h.promotion?.segments||[]).some(s=>s.treatmentBetter>s.controlBetter);
    const priorPass=cases.slice(6).filter(t=>t.verdict==='pass');
    const repeatedFailure=recent.length>=4&&recentFail===recent.length&&!pairedWins;
    return {hypothesisId:h.id,independentMaterialKeys:cases.length,recentPass,recentFail,
      recentTrialIds:recent.map(t=>t.id),priorPassIds:priorPass.slice(0,3).map(t=>t.id),
      direction:repeatedFailure?'change_operation_not_wording':recentPass&&recentFail?'isolate_scope_before_edit':'retain_and_compare',
      editBudget:repeatedFailure?'one_changed_operation':recentPass&&recentFail?'one_scoped_rule':'no_evidence_for_large_edit',
      advisoryOnly:true};
  }).filter(x=>x.independentMaterialKeys>0);
  return {policyVersion:'evidence-budget-v1',currentPinnedVersion:{explorationRated:exploration.length,
    validationRated:validation.length,capabilityRated:capability.length,capabilityTarget:8,pendingCapability},
    suggestedAllocation:{validation:pairSlots,capability:capabilitySlots,exploration:visible-pairSlots-capabilitySlots},
    directionMemory:memory,measurementMode,
    note:'Pinned-version counts are planning signals only, not producing-version attribution or causal evidence. Review actual trial bodies and receipts. Never submit weak controls or bypass gates. A capability slot uses fresh preregistered material and the approved version; do not credit candidate versions. If a slot cannot produce a quality artifact, leave it unused.'};
}
module.exports={learningBudget};
