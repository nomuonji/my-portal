'use strict';

// Durable post-feedback work orders. The human's verdict is a fact; assigning a
// defect to any specialist Skill is still an unverified agent hypothesis.
// This queue shares the existing Exploration Base document and H/T ledger.
const {planSkillTransfers}=require('./dojoSkillTransfer');

const MAX_INBOX=50;
const MAX_IDS=50;
const ACTIONS=new Set(['compare_more','rule_candidate','not_a_skill_defect']);
const VALID_TARGET=/^[a-z][a-z0-9-]{1,89}$/;

function enqueueFeedback({base, hypotheses, ratedTrials, timestamp}) {
  const current=(base.skillImprovementInbox||[]).map(x=>({...x}));
  if(!ratedTrials?.length)return current;
  const routes=planSkillTransfers({
    base,items:hypotheses.filter(Boolean),
    trials:ratedTrials.filter(x=>x.status==='rated'&&['pass','partial','fail'].includes(x.verdict)),
  }).routes;
  for(const route of routes){
    if(!VALID_TARGET.test(route.targetSkillId))continue;
    const id=route.targetSkillId+':'+route.moduleId;
    const index=current.findIndex(x=>x.id===id);
    const prior=index<0?null:current[index];
    const pending=[...new Set([...(prior?.pendingTrialIds||[]),...(route.trialIds||[])])].slice(-MAX_IDS);
    const entry={
      id,sourceBaseId:base.id,targetSkillId:route.targetSkillId,moduleId:route.moduleId,
      status:'pending_review',
      pendingTrialIds:pending,
      hypothesisIds:[...new Set([...(prior?.hypothesisIds||[]),...route.hypothesisIds])].slice(-MAX_IDS),
      lastRatedAt:timestamp,
      reviewedAt:prior?.reviewedAt||null,
      lastReviewAction:prior?.lastReviewAction||null,
      note:'Review real user-rated cases and alternatives; no Skill body or released version is changed by this queue.',
    };
    if(index<0)current.push(entry);else current[index]=entry;
  }
  return current.sort((a,b)=>String(b.lastRatedAt).localeCompare(String(a.lastRatedAt))||a.id.localeCompare(b.id)).slice(0,MAX_INBOX);
}

function validateReview(review, entry, trials) {
  if(!entry||!entry.pendingTrialIds?.length||entry.status!=='pending_review')
    throw Error('No newly rated evidence awaits review for that target/module');
  const action=String(review.action||'');
  if(!ACTIONS.has(action))throw Error('Unknown specialist Skill review action');
  const ids=review.trialIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>MAX_IDS
    ||ids.some(id=>!entry.pendingTrialIds.includes(id))||new Set(ids).size!==ids.length)
    throw Error('Review must cite existing unreviewed, real user-rated trial IDs');
  const byId=new Map(trials.map(t=>[t.id,t]));
  const selected=ids.map(id=>byId.get(id));
  if(selected.some(t=>!t||t.status!=='rated'||!['pass','partial','fail'].includes(t.verdict)))
    throw Error('Only original human-rated trials can justify a specialist Skill review');
  const text=(value,min,max,label)=>{
    const s=String(value||'').trim();
    if(s.length<min||s.length>max)throw Error(label+' must be '+min+'-'+max+' chars');
    return s;
  };
  const rationale=text(review.rationale,45,1800,'Review rationale');
  const alternatives=text(review.competingExplanations,45,1800,'Competing explanations');
  const nextExperiment=text(review.nextDiscriminatingExperiment,45,1600,'Discriminating experiment');
  const candidateRule=review.candidateRule===undefined?null:
    text(review.candidateRule,35,1200,'Proposed Skill rule');
  if(action==='rule_candidate'&&!candidateRule)
    throw Error('rule_candidate requires a concrete, falsifiable Skill rule candidate');
  if(action==='rule_candidate'&&
    (!selected.some(t=>t.verdict==='pass')||!selected.some(t=>t.verdict==='fail')))
    throw Error('A rule candidate needs at least one genuine positive and negative human-rated case');
  return {action,trialIds:ids,rationale,competingExplanations:alternatives,
    nextDiscriminatingExperiment:nextExperiment,candidateRule,
    evidence:{pass:selected.filter(t=>t.verdict==='pass').length,
      partial:selected.filter(t=>t.verdict==='partial').length,
      fail:selected.filter(t=>t.verdict==='fail').length},
    evidenceStatus:'agent_hypothesis_not_causal_proof',
    releaseStatus:'no_skill_revision_or_release'};
}

function applyReviews(inbox, existingReviews, reviewRecords, timestamp) {
  const next=inbox.map(x=>({...x}));
  const history=[...(existingReviews||[])];
  for(const record of reviewRecords){
    const index=next.findIndex(x=>x.id===record.inboxId);
    if(index<0)throw Error('Specialist Skill queue target changed during review');
    const entry=next[index];
    if(entry.status!=='pending_review'
      ||record.trialIds.some(id=>!entry.pendingTrialIds.includes(id)))
      throw Error('New feedback arrived or review no longer matches the pending cases');
    // A partial review stays pending, and unreviewed cases are not discarded.
    const remaining=entry.pendingTrialIds.filter(id=>!record.trialIds.includes(id));
    next[index]={...entry,pendingTrialIds:remaining,
      status:remaining.length?'pending_review':
        record.action==='rule_candidate'?'candidate_needs_independent_test':
        record.action==='compare_more'?'awaiting_new_comparison':'closed_no_skill_defect',
      reviewedAt:timestamp,lastReviewAction:record.action};
    history.unshift({...record,reviewedAt:timestamp});
  }
  return {inbox:next,reviews:history.slice(0,120)};
}


// Production is distinct from research: an open run may inspect case history,
// but no new evaluation artifact can be registered before all *new* feedback is
// metabolized. Prior reviews with awaiting_new_comparison are not blockers.
function cyclePreflight(base={}) {
  const pendingSkillReviews=(base.skillImprovementInbox||[])
    .filter(x=>x.status==='pending_review'&&(x.pendingTrialIds||[]).length)
    .map(x=>({id:x.id,targetSkillId:x.targetSkillId,
      pendingTrialIds:[...x.pendingTrialIds]}));
  const pendingTrialIds=[...(base.treeMaintenance?.pendingTrialIds||[])];
  const pendingExternalRefs=[...(base.treeMaintenance?.pendingExternalRefs||[])];
  const requiredActions=[];
  if(pendingSkillReviews.length)
    requiredActions.push('Review each pending specialist Skill work order via exploration_skill_improvement_review, with actual human-rated evidence and competing explanations. Do not force a Skill revision when evidence is weak.');
  if(pendingTrialIds.length||pendingExternalRefs.length)
    requiredActions.push('Read all historical H/T/user feedback pages and complete exploration_research_synthesize.treeReview for every newly rated trial and external reaction before creating another artifact.');
  return {
    stage:requiredActions.length?'internal_metabolism_required':'ready_for_trial_gates',
    readyForTrialRegistration:requiredActions.length===0,
    pendingSkillReviews,pendingTrialIds,pendingExternalRefs,requiredActions,
    note:'This is a preflight only. Existing research, recall, negative-control, pending-user-rating and release gates still apply. A ready preflight does not certify output quality.',
  };
}

function assertCyclePrepared(base) {
  const status=cyclePreflight(base);
  if(!status.readyForTrialRegistration) {
    const skills=status.pendingSkillReviews.map(x=>x.id).join(', ');
    throw Error('Internal metabolism required before registering new evaluation artifacts: '
      +(skills?'pending specialist Skill reviews ['+skills+']. ':'')
      +(status.pendingTrialIds.length||status.pendingExternalRefs.length
        ? 'new human feedback requires a complete hypothesis-tree research synthesis. ':'')
      +'Review evidence and approved Skill versions first; then create new trials.');
  }
  return status;
}

module.exports={enqueueFeedback,validateReview,applyReviews,cyclePreflight,assertCyclePrepared};
