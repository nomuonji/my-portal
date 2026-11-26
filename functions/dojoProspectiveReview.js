'use strict';
const {createHash}=require('node:crypto');
const {measureCalibration}=require('./dojoCalibration');
const {trialArtifactStatus}=require('./dojoArtifactReadiness');
const digest=t=>createHash('sha256').update(JSON.stringify([t.body||''])).digest('hex');
// Text only: URL-only or mutable remote images/media cannot establish identical artifacts.
const eligible=t=>t.status==='awaiting'&&!t.backfilled&&!t.ratedAt&&!t.verdict&&!(t.ratingHistory||[]).length
  &&typeof t.body==='string'&&t.body.trim().length>=8&&!t.imageUrl&&!t.mediaUrl&&trialArtifactStatus(t).ready;
const protocolId=raw=>{const id=String(raw||'').trim();if(!/^[a-z][a-z0-9._-]{2,79}$/.test(id))throw Error('Stable reviewer protocol ID required (3-80 lowercase characters)');return id;};
function packet(trials,protocol){
  const id=protocolId(protocol);
  return trials.filter(t=>eligible(t)&&!(t.prospectiveReviews||[]).some(r=>r.protocolId===id)&&(t.prospectiveReviews||[]).length<4)
    .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id)))
    .slice(0,10).map(t=>({trialId:t.id,artifactDigest:digest(t),body:t.body}));
}
function record(t,raw,protocol,at){
  const id=protocolId(protocol);
  if(!eligible(t))throw Error('Prospective review requires a still-unrated text artifact with no rating history');
  if(raw.artifactDigest!==digest(t))throw Error('Artifact digest changed or invalid');
  const old=t.prospectiveReviews||[];
  if(old.some(r=>r.protocolId===id)||old.length>=4)throw Error('Review already committed or protocol capacity reached');
  if(typeof raw.predictedPass!=='number'||!Number.isFinite(raw.predictedPass)||raw.predictedPass<0||raw.predictedPass>1)
    throw Error('Review probability must be between 0 and 1');
  const reason=String(raw.reason||'').trim(),quote=String(raw.quote||'').trim(),reviewer=String(raw.reviewer||'').trim();
  if(quote.length<4||quote.length>160||!t.body.includes(quote)||reason.length<20||reason.length>1000||reviewer.length<3||reviewer.length>120)
    throw Error('Review requires exact text anchor, concrete reason and reviewer identity/model label');
  return {...t,prospectiveReviews:[...old,{protocolId:id,artifactDigest:digest(t),predictedPass:raw.predictedPass,
    reason,quote,reviewer,recordedAt:at,provenance:'agent_reported_reviewer_not_verified'}]};
}
function score(trials){
  const groups=new Map(), common=new Map();
  for(const t of trials){
    // Exclude corrections, backfills, changed artifacts and media; never reconstruct a prospective label.
    const actual=t.status==='rated'&&!t.backfilled&&!t.imageUrl&&!t.mediaUrl&&!(t.ratingHistory||[]).length&&
      ['pass','partial','fail'].includes(t.verdict)&&t.ratedAt;
    for(const r of t.prospectiveReviews||[]){
      const g=groups.get(r.protocolId)||{protocolId:r.protocolId,committed:0,pending:0,excluded:0,rows:[],reviewers:new Set()};
      g.committed++;g.reviewers.add(r.reviewer);
      if(eligible(t)&&r.artifactDigest===digest(t))g.pending++;
      else if(actual&&r.artifactDigest===digest(t)&&r.recordedAt<t.ratedAt){
        const row={id:t.id,predictedPass:r.predictedPass,verdict:t.verdict};
        g.rows.push(row);const list=common.get(t.id)||[];list.push({...row,protocolId:r.protocolId});common.set(t.id,list);
      }else g.excluded++;
      groups.set(r.protocolId,g);
    }
  }
  const pairs=new Map();
  for(const rows of common.values())for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const [a,b]=[rows[i],rows[j]].sort((x,y)=>x.protocolId.localeCompare(y.protocolId)),key=JSON.stringify([a.protocolId,b.protocolId]);
    const p=pairs.get(key)||{protocols:[a.protocolId,b.protocolId],n:0,loss:[0,0]};
    p.n++;for(const [k,x] of [a,b].entries())p.loss[k]+=(x.predictedPass-Number(x.verdict==='pass'))**2;pairs.set(key,p);
  }
  return {protocols:[...groups.values()].map(({rows,reviewers,...g})=>({...g,reviewers:[...reviewers],rated:rows.length,
    calibration:measureCalibration(rows)})),matchedProtocolComparisons:[...pairs.values()].map(({loss,...p})=>({...p,
      brier:loss.map(x=>Math.round(1000*x/p.n)/1000)})),eligibleWaiting:trials.filter(eligible).length,
    note:'Prospective timestamps and text binding, not independently verified reviewer identity or actual independence. Partial counts as non-pass. No quality gate or automatic approval. Compare protocols on the same cases; small samples and selective submissions limit inference.'};
}
module.exports={packet,record,score};
