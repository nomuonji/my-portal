'use strict';

// A creative quality gate must never pretend to know whether a joke is funny.
// It can, however, detect WHEN the existing quality gate has no predictive
// value, when the author admits the sample is weaker than the user's base rate,
// and when a trial cannot distinguish hypotheses or lacks its primary material.
const FAILURE_STREAK=8;
const MIN_QUARANTINE_RATINGS=3;

function unreliableNegativeReviews(trials=[]){
  const grouped=new Map();
  for(const t of trials){
    if(t.status!=='rated'||!['pass','fail','partial'].includes(t.verdict))continue;
    for(const check of t.negativeReview?.checks||[]){
      if(check.decision!=='cleared')continue;
      const row=grouped.get(check.hypothesisId)||{hypothesisId:check.hypothesisId,clearedRated:0,clearedPassed:0,clearedRejected:0};
      row.clearedRated++;
      if(t.verdict==='pass')row.clearedPassed++;else row.clearedRejected++;
      grouped.set(row.hypothesisId,row);
    }
  }
  return [...grouped.values()].filter(x=>x.clearedRated>=MIN_QUARANTINE_RATINGS&&x.clearedPassed===0)
    .sort((a,b)=>b.clearedRejected-a.clearedRejected||a.hypothesisId.localeCompare(b.hypothesisId));
}

function sourceHasPrimaryText(source){
  const p=source?.originalProof;
  if(!p||p.verification!=='direct_original'||!p.originalUrl||!p.excerpt||p.excerpt.length<16)return false;
  let url;
  try{url=new URL(p.originalUrl)}catch{return false}
  if(url.protocol!=='https:')return false;
  // Provenance must point at the source record, not a new URL inserted only
  // during trial submission. Content authenticity still requires agent review.
  const known=[source.locator,...(source.evidence||[]).map(e=>e.source)].filter(Boolean);
  return known.some(s=>s===p.originalUrl);
}

function checkBuzzSubmissionRecovery({base,trial,run,existing=[],sources=[],loop,negativeReview}){
  const failStreak=Number(loop?.failStreak)||0;
  const quarantined=unreliableNegativeReviews(existing);
  const bad=new Map(quarantined.map(x=>[x.hypothesisId,x]));
  const positiveH=trial.hypothesisIds||[];
  if(positiveH.length!==1)
    throw Error('Buzz quality recovery: one completed artifact must test exactly one primary H. Use a new H for a synthesized mechanism and compare separate artifacts for competing branches; old multi-H cases remain archived.');
  const tested=(run?.negativeTargets||[]).map(x=>x.hypothesisId);
  for(const id of tested){
    if(bad.has(id)){
      const x=bad.get(id);
      throw Error('Buzz quality recovery: negative preflight '+id+' is QUARANTINED ('+x.clearedRejected+'/'+x.clearedRated+
        ' human-rated samples rejected after clearance). Research/revise the failure check and test a different negative arm; do not keep self-clearing with its old rule.');
    }
  }
  if(failStreak<FAILURE_STREAK)return {recoveryRequired:false,quarantined};
  if(!(run?.negativeTargets||[]).length)
    throw Error('Buzz quality recovery: during prolonged non-passes, compare at least one still-usable negative hypothesis; internal rejection is not a human fail.');
  const pool=trial.editorialScreen?.pool||[];
  const lanes=new Set(pool.map(x=>x.hypothesisId).filter(Boolean));
  if(pool.some(x=>!x.hypothesisId)||lanes.size<2)
    throw Error('Buzz quality recovery: editorial candidates must show at least two distinct hypothesis arms, not three wordings of the same idea. Supply pool[].hypothesisId from real H records.');
  const primary=pool.find(x=>x.decision==='selected');
  if(primary?.hypothesisId!==positiveH[0])
    throw Error('Buzz quality recovery: selected candidate hypothesisId must match the trial\'s single primary H.');

  if(!run?.experimentDesign)throw Error('Buzz quality recovery: '+failStreak+
    ' consecutive non-passes require a preregistered discriminating experimentDesign, not another one-shot variant of a broad positive hypothesis.');
  const eligible=(run.targets||[]).some(t=>t.hypothesisId===positiveH[0])
    ||(run.researchReview?.appliedHypothesisIds||[]).includes(positiveH[0]);
  if(!eligible)throw Error('Buzz quality recovery: primary hypothesis must be precommitted or explicitly derived during this research run.');
  const selected=primary;
  if(!selected)throw Error('Buzz quality recovery: selected candidate and source must be recorded in editorialScreen.');
  const source=sources.find(x=>x.id===selected.sourceId);
  if(!sourceHasPrimaryText(source))throw Error('Buzz quality recovery: selected source '+selected.sourceId+
    ' has no direct-original URL + >=16-character original excerpt recorded in source.originalProof. Rankings, AI trend summaries and unverified paraphrases cannot substantiate a new standalone joke.');
  const forecast=Number(trial.predictedPass);
  // This is a one-sided escalation/veto after persistent rejection, NOT an
  // automatic PASS based on an AI score. Do not require inflation to 0.60.
  // Without evidence that the candidate exceeds the user's baseline chance,
  // preserve it as an INTERNAL exploration hypothesis instead.
  const baseline=Number(loop?.overall?.passRate);
  if(Number.isFinite(baseline)&&baseline>0&&forecast<baseline)
    throw Error('Buzz quality recovery: the model predicts only '+forecast+
      ' chance of user acceptance, below the real historical base rate '+baseline+
      '. Keep this weak candidate internal; change the material/mechanism and preflight before user submission. Never inflate the prediction to satisfy this check.');
  return {recoveryRequired:true,quarantined,selectedOriginalUrl:source.originalProof.originalUrl,
    note:'Eligibility is a conservative provenance/experiment filter, not a human prediction of humor or guaranteed quality.'};
}
module.exports={FAILURE_STREAK,MIN_QUARANTINE_RATINGS,unreliableNegativeReviews,sourceHasPrimaryText,checkBuzzSubmissionRecovery};
