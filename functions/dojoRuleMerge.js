'use strict';

const {createHash}=require('node:crypto');
const ACTIONS=new Set(['add','replace','retire']);
const MODULES=new Set(['root','source','selection','transform','voice','gate','audience']);
const fingerprint=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
const val=v=>String(v||'').trim();
const list=v=>Array.isArray(v)?[...new Set(v.map(val).filter(Boolean))]:[];
const uniqueCount=(haystack,needle)=>needle?haystack.split(needle).length-1:0;

/**
 * A Skill rule is not a known entity in legacy prose.
 * Binding requires an exact quote from the pinned, immutable target version;
 * no LLM may invent a canonical rule boundary or claim automatic adoption.
 */
function makeRuleProposal(raw,{method,body='',hypotheses=[],trials=[]}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Rule change proposal object required');
  const action=val(raw.action),moduleId=val(raw.moduleId),sourceVersion=val(raw.sourceMethodVersion);
  if(!ACTIONS.has(action))throw Error('Rule action must be add, replace or retire');
  if(!MODULES.has(moduleId))throw Error('Unknown Skill module');
  if(sourceVersion!==val(method?.version))throw Error('Rule proposal must target the currently released method version');
  const hids=list(raw.hypothesisIds);
  if(!hids.length||hids.length>4)throw Error('Rule proposal needs 1-4 real hypotheses');
  const map=new Map(hypotheses.filter(h=>h.kind==='hypothesis').map(h=>[h.id,h]));
  for(const hid of hids)if(!map.has(hid)||map.get(hid).polarity==='negative')
    throw Error('Rule proposal must cite real positive hypotheses');
  const oldText=val(raw.existingRuleAnchor),newText=val(raw.replacementText);
  const reason=val(raw.rationale),falsifier=val(raw.refutingObservation);
  if(reason.length<30||reason.length>1200||falsifier.length<30||falsifier.length>900)
    throw Error('Rule proposal needs specific rationale and falsifying condition');
  if(action!=='retire'&&(newText.length<16||newText.length>1200))
    throw Error('New rule text needs 16-1200 characters');
  if(action==='retire'&&newText)throw Error('Retire does not accept replacement rule text');
  if(action!=='add'){
    if(oldText.length<16||oldText.length>600||uniqueCount(body,oldText)!==1)
      throw Error('Existing rule anchor must be a unique exact 16-600-character passage in the pinned Skill body');
  }else if(oldText)throw Error('Add does not replace an existing rule anchor');
  if(hids.some(id=>{
    const h=map.get(id);
    const target=h.targetModuleIds||[];
    return target.length&&!target.includes(moduleId)&&!target.includes('root')&&moduleId!=='root';
  }))throw Error('Proposed module does not match its linked hypotheses');
  const evidenceIds=list(raw.supportingTrialIds);
  const counterIds=list(raw.counterexampleTrialIds);
  if(evidenceIds.length<1||evidenceIds.length>20||counterIds.length<1||counterIds.length>20)
    throw Error('Rule proposal needs rated supporting and counterexample trial IDs');
  const byId=new Map(trials.map(t=>[t.id,t]));
  for(const id of evidenceIds){
    const t=byId.get(id);
    if(!t||t.status!=='rated'||t.verdict!=='pass'||!hids.some(h=>(t.hypothesisIds||[]).includes(h)))
      throw Error('Supporting trial ID must be a real human pass linked to this hypothesis');
  }
  for(const id of counterIds){
    const t=byId.get(id);
    if(!t||t.status!=='rated'||!['fail','partial'].includes(t.verdict))
      throw Error('Counterexample trial ID must be a real human non-pass');
  }
  const sourceRuleId=action==='add'?null:'rule-'+fingerprint([sourceVersion,oldText]);
  const id='MR-'+fingerprint([sourceVersion,moduleId,action,sourceRuleId,newText,hids]);
  return {id,sourceMethodVersion:sourceVersion,sourceRuleId,action,moduleId,
    existingRuleAnchor:oldText,replacementText:newText,hypothesisIds:hids,
    supportingTrialIds:evidenceIds,counterexampleTrialIds:counterIds,
    rationale:reason,refutingObservation:falsifier,
    proposedBy:'agent',status:'proposed',provenance:'pinned_skill_text_and_human_ratings',
    caution:'The rule text and causal explanation are agent proposals. Human-rated examples verify the verdicts, not the cause.'};
}

/** Pure evaluation; does not modify the Skill, its release pointer or human ratings. */
function assessRuleProposal(proposal,{method,graph,trials=[]}){
  const reasons=[],found=new Set((graph?.hypotheses||[]).map(h=>h.id));
  if(val(method?.version)!==proposal.sourceMethodVersion)reasons.push('base_method_version_changed');
  for(const id of proposal.hypothesisIds||[]){
    if(!found.has(id))reasons.push('missing_hypothesis:'+id);
    const p=(graph?.promotions||[]).find(x=>x.hypothesisId===id);
    if(!p?.eligibleForMerge)reasons.push('hypothesis_not_independently_validated:'+id);
  }
  const byId=new Map(trials.map(t=>[t.id,t]));
  for(const id of proposal.supportingTrialIds||[])
    if(byId.get(id)?.verdict!=='pass'||byId.get(id)?.status!=='rated')reasons.push('supporting_trial_no_longer_pass:'+id);
  for(const id of proposal.counterexampleTrialIds||[])
    if(!['fail','partial'].includes(byId.get(id)?.verdict)||byId.get(id)?.status!=='rated')
      reasons.push('counterexample_no_longer_valid:'+id);
  const validated=!(reasons.length);
  return {id:proposal.id,sourceMethodVersion:proposal.sourceMethodVersion,
    action:proposal.action,moduleId:proposal.moduleId,linkedHypothesisIds:proposal.hypothesisIds,
    state:validated?'evidence_eligible_for_rule_review':'evidence_incomplete',
    evidenceEligible:validated,automaticRelease:false,blockingReasons:reasons,
    nextAction:validated?'Check candidate Skill text against the complete historical acceptance/rejection regression and an independent new-sample evaluation before a version release.':'Run independent, corrected, preregistered comparisons; do not release the rule.',
    note:'This is eligibility for drafting/review. It is never a Skill release authorization or independent quality approval.'};
}

module.exports={ACTIONS,makeRuleProposal,assessRuleProposal};
