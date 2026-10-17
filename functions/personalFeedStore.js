'use strict';
/** Private and source-backed cultural/news recommendations.
 * A story key is independent of publisher and media format: 10 articles about
 * one event should yield one feed entry. URL canonicalization is a second gate.
 */
const { createHash }=require('node:crypto');
const { getDocumentDb, FieldValue }=require('./documentDb');
const SEED=require('./personalFeedSeed20261017');
const COLLECTION='personalDiscoveryFeed';
const TOPICS='personalDiscoveryStoryKeys';
const SEEDS='personalDiscoverySeedEditions';
const REJECTIONS='personalDiscoveryRejectedCandidates';
const SCORE_AXES=Object.freeze(['tasteFit','discovery','payoff']);
const SCORE_THRESHOLD=4;
const TYPES=new Set(['video','article','website','music','art','game','other']);
const STATES=new Set(['new','saved','loved','skipped','seen']);
const db=()=>getDocumentDb(process.env.AGENT_IDEAS_DATABASE_ID||'(default)');
const trim=(s,n=2000)=>String(s??'').trim().slice(0,n);
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,30);
const unique=(v,n=12)=>[...new Set((Array.isArray(v)?v:[]).slice(0,n).map(x=>trim(x,70)).filter(Boolean))];
const iso=v=>v?.toDate?.()?.toISOString?.()||(typeof v==='string'?v:null);
function safeUrl(value){
 try{
  const u=new URL(trim(value,1600));
  if(u.protocol!=='https:'||!u.hostname||u.username||u.password)return '';
  if(u.hostname==='localhost'||u.hostname.endsWith('.local')||/^(?:127|10|192\.168|169\.254)\./.test(u.hostname))return '';
  u.hash='';return u.toString();
 }catch{return '';}
}
function youtubeId(value){
 try{
  const u=new URL(value),host=u.hostname.toLowerCase().replace(/^www\./,'');
  const id=host==='youtu.be'?u.pathname.split('/')[1]:
   ['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)
    ?(u.pathname.startsWith('/shorts/')||u.pathname.startsWith('/embed/'))?u.pathname.split('/')[2]:u.searchParams.get('v'):'';
  return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?id:'';
 }catch{return '';}
}
function canonicalUrl(raw){
 const url=safeUrl(raw);
 if(!url)return '';
 const video=youtubeId(url);
 if(video)return 'https://www.youtube.com/watch?v='+video;
 const u=new URL(url);
 u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');
 const kept=[];
 for(const [key,value] of u.searchParams)if(['id','p','article','story','page'].includes(key.toLowerCase()))kept.push([key,value]);
 u.search='';kept.sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>u.searchParams.append(k,v));
 u.pathname=u.pathname.replace(/\/+$/,'')||'/';
 return u.toString();
}
function normalizeTitle(value){
 return trim(value,250).normalize('NFKC').toLocaleLowerCase('ja-JP')
  .replace(/[\s\p{P}\p{S}]/gu,'').slice(0,160);
}
function normalizeStoryKey(value){
 return trim(value,180).normalize('NFKC').toLocaleLowerCase('ja-JP')
  .replace(/[^a-z0-9\p{L}\p{N}-]/gu,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,140);
}
function validDate(value){
 if(!value)return '';
 const text=trim(value,40);
 if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text))return '';
 const timestamp=Date.parse(text);
 if(!Number.isFinite(timestamp)||timestamp>Date.now()+86400000)return '';
 return text;
}
function view(doc){
 const d=doc.data();
 return {...d,id:doc.id,publishedAt:d.publishedAt||null,storyKey:d.storyKey||null,
  createdAt:iso(d.createdAt),updatedAt:iso(d.updatedAt)};
}
/**
 * Prediction axes, not a generic media-quality grade.
 * TasteFit without a cited positive user reaction is allowed only at <=3.
 * Exploration lane prevents cold-start discovery from being blocked by unknown taste.
 * Source verification, freshness, legality and dedupe are independent hard checks.
 */
function validateSelfEvaluation(value,allowLegacy=false){
 if(allowLegacy)return null;
 if(!value||typeof value!=='object')throw Error('selfEvaluation is required on every new Discover item');
 const scores={},reasons={};
 const fitBasis=trim(value.fitBasis,30);
 if(!['user_feedback','hypothesis','unknown'].includes(fitBasis))throw Error('fitBasis must be user_feedback, hypothesis, or unknown');
 for(const axis of SCORE_AXES){
  const score=value.scores?.[axis];
  if(axis==='tasteFit'&&fitBasis==='unknown'&&score===null){scores[axis]=null;}
  else if(!Number.isInteger(score)||score<1||score>5)throw Error('selfEvaluation.scores.'+axis+' must be an integer from 1 to 5 (tasteFit may be null when unknown)');
  else scores[axis]=score;
  const reason=trim(value.reasons?.[axis],500);
  if(reason.length<12)throw Error('selfEvaluation.reasons.'+axis+' needs a specific reference or a stated uncertainty');
  reasons[axis]=reason;
 }
 const feedbackExampleId=trim(value.feedbackExampleId,100);
 if(fitBasis==='user_feedback'&&(!/^cur-[a-f0-9]{30}$/.test(feedbackExampleId)||scores.tasteFit===null))
   throw Error('Direct user preference fit requires a real liked/saved Discover feedbackExampleId');
 if(fitBasis==='unknown'&&scores.tasteFit!==null)throw Error('Unknown taste must use tasteFit=null');
 if(fitBasis==='hypothesis'&&scores.tasteFit>3)throw Error('A taste hypothesis cannot be scored above 3 without verified user feedback');
 const weakness=trim(value.weakness,800);
 if(weakness.length<20)throw Error('selfEvaluation.weakness must state a plausible reason user may dislike this item');
 const lane=(scores.tasteFit>=4&&scores.payoff>=4)?'familiar':
   (scores.discovery>=4&&scores.payoff>=4&&(scores.tasteFit===null||scores.tasteFit>=3))?'explore':'rejected';
 const total=(scores.tasteFit||0)+scores.discovery+scores.payoff;
 return {version:'discover-taste-v2',scores,reasons,fitBasis,feedbackExampleId:fitBasis==='user_feedback'?feedbackExampleId:null,
   weakness,total,maximum:15,lane,passed:lane!=='rejected',evaluatedAt:new Date().toISOString()};
}
function normalizedInput(args={}, options={}){
 const url=canonicalUrl(args.url),title=trim(args.title,200),description=trim(args.description,1600),reason=trim(args.reason,1000);
 if(!url)throw Error('Valid source HTTPS URL required');
 if(title.length<5||description.length<15||reason.length<8)throw Error('Specific title, summary and recommendation reason required');
 const videoId=youtubeId(url),type=TYPES.has(args.type)?args.type:'article';
 if(type==='video'&&!videoId)throw Error('Videos require an actual YouTube watch/shorts URL');
 const rawPublished=trim(args.publishedAt,40),publishedAt=validDate(rawPublished);
 if(rawPublished&&!publishedAt)throw Error('publishedAt must be a real, nonfuture ISO date (or omitted)');
 const storyKey=normalizeStoryKey(args.storyKey)||normalizeStoryKey(title);
 const selfEvaluation=validateSelfEvaluation(args.selfEvaluation,Boolean(options.internalLegacySeed));
 return {
  url,canonicalUrl:url,title,description,reason,
  type,videoId,category:trim(args.category||'カルチャー',70),creator:trim(args.creator,140),
  tags:unique(args.tags),thumbnail:safeUrl(args.thumbnail),
  sourceUrl:safeUrl(args.sourceUrl)||url,checkedAt:trim(args.checkedAt,40),
  publishedAt,storyKey,uncertainty:trim(args.uncertainty,600),selfEvaluation
 };
}
function sameContent(a,b){
 return (a.canonicalUrl||canonicalUrl(a.url))===b.canonicalUrl||
  (a.storyKey&&normalizeStoryKey(a.storyKey)===b.storyKey)||
  (a.videoId&&a.videoId===b.videoId)||
  normalizeTitle(a.title)===normalizeTitle(b.title);
}
async function list(args={}){
 await seedOnce();
 const limit=Math.min(500,Math.max(1,Number(args.limit)||160));
 const snap=await db().collection(COLLECTION).orderBy('createdAt','desc').limit(limit).get();
 let items=snap.docs.map(view);
 // Previous records predate story keys and the URL normalization contract.
 const keys=new Set();items=items.filter(item=>{
  const k=item.storyKey?normalizeStoryKey(item.storyKey):canonicalUrl(item.url);
  if(keys.has(k))return false;
  keys.add(k);return true;
 });
 if(args.type&&TYPES.has(args.type))items=items.filter(x=>x.type===args.type);
 if(!args.includeSkipped)items=items.filter(x=>x.feedback!=='skipped');
 items.sort((a,b)=>Date.parse(b.publishedAt||b.createdAt||0)-Date.parse(a.publishedAt||a.createdAt||0));
 return {items,count:items.length,sourceOfTruth:COLLECTION,sortBy:'publishedAt',maxLimit:500};
}
async function get(args={}){
 const id=trim(args.id,100);
 if(!/^cur-[a-f0-9]{30}$/.test(id))throw Error('Invalid content id');
 const snap=await db().collection(COLLECTION).doc(id).get();
 if(!snap.exists)throw Error('Content not found');
 return view(snap);
}
async function batchAdd(args={}){
 const input=Array.isArray(args.items)?args.items:[];
 if(!input.length||input.length>35)throw Error('Supply 1 to 35 curated items');
 // Only scan recent unindexed legacy records; newer items have a global atomic storyKey index.
 // Scanning 500 existing records for every incremental update is unnecessary Firestore cost.
 const existingSnap=await db().collection(COLLECTION).orderBy('createdAt','desc').limit(100).get();
 const seen=existingSnap.docs.map(view);
 const results=[];
 for(const raw of input){
  try{
   const item=normalizedInput(raw,{internalLegacySeed:args.internalLegacySeed===true});
   const dup=seen.find(old=>sameContent(old,item));
   if(dup){results.push({outcome:'already_exists',id:dup.id,storyKey:item.storyKey});continue;}
   if(item.selfEvaluation?.fitBasis==='user_feedback'){
    const proof=await db().collection(COLLECTION).doc(item.selfEvaluation.feedbackExampleId).get();
    if(!proof.exists||!['saved','loved'].includes(proof.data().feedback))
     throw Error('Taste-fit >=4 requires an existing saved/loved user feedback record, not an AI-generated example');
   }
   if(item.selfEvaluation&&!item.selfEvaluation.passed){
    // Keep a compact rejected-candidate memory without putting weak items in the feed.
    const rejectionId='rejected-'+hash(item.canonicalUrl);
    await db().collection(REJECTIONS).doc(rejectionId).set({
      id:rejectionId,url:item.url,title:item.title,storyKey:item.storyKey,
      selfEvaluation:item.selfEvaluation,reason:item.reason,
      updatedAt:FieldValue.serverTimestamp()
    });
    results.push({outcome:'rejected_score',id:rejectionId,storyKey:item.storyKey,score:item.selfEvaluation.total,
      minimum:item.selfEvaluation.minimum});
    continue;
   }
   const id='cur-'+hash(item.canonicalUrl),ref=db().collection(COLLECTION).doc(id);
   const keyRef=db().collection(TOPICS).doc('story-'+hash(item.storyKey));
   let outcome='created',existingId=null;
   await db().runTransaction(async tx=>{
    const [entry,key]=await Promise.all([tx.get(ref),tx.get(keyRef)]);
    if(entry.exists){outcome='already_exists';existingId=entry.id;return;}
    if(key.exists){outcome='already_exists';existingId=key.data().contentId||null;return;}
    tx.set(ref,{...item,feedback:'new',feedbackNote:'',revision:1,
      createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    tx.set(keyRef,{contentId:id,storyKey:item.storyKey,createdAt:FieldValue.serverTimestamp()});
   });
   const actualId=existingId||id;
   results.push({outcome,id:actualId,storyKey:item.storyKey});
   if(outcome==='created')seen.push({...item,id});
  }catch(error){results.push({outcome:'failed',error:String(error?.message||error).slice(0,250),url:trim(raw?.url,300)});}
 }
 return {results,createdCount:results.filter(r=>r.outcome==='created').length,
  duplicateCount:results.filter(r=>r.outcome==='already_exists').length,
  failedCount:results.filter(r=>r.outcome==='failed').length,
  rejectedCount:results.filter(r=>r.outcome==='rejected_score').length};
}
async function add(args={}){
 const result=await batchAdd({items:[args]});
 const first=result.results[0];
 if(first.outcome==='failed')throw Error(first.error);
 if(first.outcome==='rejected_score')return {outcome:'rejected_score',rejectionId:first.id,score:first.score,minimum:first.minimum};
 return {outcome:first.outcome,content:await get({id:first.id})};
}
// Seed a real recent issue without overwriting the older evergreen picks.
// This is a one-time initial edition, not a substitute for recurring fresh curation.
let seeded=false;
async function seedOnce(){
 if(seeded)return;
 const marker=db().collection(SEEDS).doc('edition-20261017');
 const snap=await marker.get();
 if(snap.exists){seeded=true;return;}
 const outcome=await batchAdd({items:SEED,internalLegacySeed:true});
 if(outcome.failedCount)throw Error('Starter edition incomplete: '+outcome.failedCount+' records failed');
 await marker.set({createdCount:outcome.createdCount,duplicateCount:outcome.duplicateCount,
  seedVersion:'2026-10-17',createdAt:FieldValue.serverTimestamp()});
 seeded=true;
}
async function feedback(args={}){
 const id=trim(args.id,100),status=trim(args.status,20),expectedRevision=Number(args.expectedRevision);
 if(!STATES.has(status))throw Error('Invalid feedback status');
 if(!/^cur-[a-f0-9]{30}$/.test(id))throw Error('Invalid content id');
 if(!Number.isInteger(expectedRevision)||expectedRevision<1)throw Error('expectedRevision required');
 const ref=db().collection(COLLECTION).doc(id);
 await db().runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)throw Error('Content not found');
  if(snap.data().revision!==expectedRevision)throw Error('Content revision conflict; refresh');
  tx.update(ref,{feedback:status,feedbackNote:trim(args.note,500),
   revision:expectedRevision+1,updatedAt:FieldValue.serverTimestamp()});
 });
 return get({id});
}
module.exports={COLLECTION,REJECTIONS,SCORE_AXES,SCORE_THRESHOLD,list,get,add,batchAdd,feedback,validateSelfEvaluation,safeUrl,youtubeId,canonicalUrl,normalizeStoryKey,normalizeTitle,sameContent};
