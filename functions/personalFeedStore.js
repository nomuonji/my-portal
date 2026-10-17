'use strict';
/** Private personal discovery feed. Distinct from strategic ideas and Agent HQ. */
const { createHash } = require('node:crypto');
const { getDocumentDb, FieldValue } = require('./documentDb');
const COLLECTION = 'personalDiscoveryFeed';
const db = () => getDocumentDb(process.env.AGENT_IDEAS_DATABASE_ID || '(default)');
const TYPES = new Set(['video','article','website','music','art','game','other']);
const STATES = new Set(['new','saved','loved','skipped','seen']);
const trim = (s,n=2000)=> String(s ?? '').trim().slice(0,n);
const unique = (v,n=12)=>[...new Set((Array.isArray(v)?v:[]).slice(0,n).map(x=>trim(x,70)).filter(Boolean))];
function safeUrl(value){
  try {
    const u=new URL(trim(value,1600));
    if(u.protocol!=='https:' || !u.hostname || u.username || u.password) return '';
    if(u.hostname==='localhost' || u.hostname.endsWith('.local')) return '';
    if(/^(?:127|10|192\.168)\./.test(u.hostname)) return '';
    u.hash='';
    return u.toString();
  } catch { return ''; }
}
function youtubeId(value){
  try {
    const u=new URL(value);
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    const id= host==='youtu.be' ? u.pathname.split('/')[1] :
      ['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)
        ? u.pathname.startsWith('/shorts/')||u.pathname.startsWith('/embed/')
          ? u.pathname.split('/')[2] : u.searchParams.get('v') : '';
    return /^[A-Za-z0-9_-]{11}$/.test(id||'') ? id : '';
  } catch { return ''; }
}
const idFor = url => 'cur-' + createHash('sha256').update(url).digest('hex').slice(0,30);
const iso = v => v?.toDate?.()?.toISOString?.() || (typeof v==='string' ? v : null);
function view(doc){
  const d=doc.data(); return {...d,id:doc.id,createdAt:iso(d.createdAt),updatedAt:iso(d.updatedAt)};
}
async function list(args={}){
  const limit=Math.min(200,Math.max(1,Number(args.limit)||100));
  const snap=await db().collection(COLLECTION).orderBy('createdAt','desc').limit(limit).get();
  let items=snap.docs.map(view);
  if(args.type && TYPES.has(args.type)) items=items.filter(x=>x.type===args.type);
  if(!args.includeSkipped) items=items.filter(x=>x.feedback!=='skipped');
  return {items,count:items.length,sourceOfTruth:COLLECTION};
}
async function get(args={}){
  const id=trim(args.id,100);
  if(!/^cur-[a-f0-9]{30}$/.test(id)) throw new Error('Invalid content id');
  const doc=await db().collection(COLLECTION).doc(id).get();
  if(!doc.exists) throw new Error('Content not found');
  return view(doc);
}
async function add(args={}){
  const url=safeUrl(args.url);
  if(!url) throw new Error('An absolute public https URL is required');
  const title=trim(args.title,200), description=trim(args.description,1600), reason=trim(args.reason,1000);
  if(title.length<5 || description.length<15 || reason.length<8) throw new Error('Specific title, summary and personal recommendation reason are required');
  const type=TYPES.has(args.type)?args.type:'website';
  const videoId=youtubeId(url);
  if(type==='video' && !videoId) throw new Error('video requires a valid YouTube video or short URL');
  const sourceUrl=safeUrl(args.sourceUrl)||url;
  const id=idFor(url), ref=db().collection(COLLECTION).doc(id);
  let outcome='created';
  await db().runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists){outcome='already_exists';return;}
    tx.set(ref,{
      title,description,reason,url,sourceUrl,
      creator:trim(args.creator,140),type,tags:unique(args.tags),category:trim(args.category||'発見',70),
      thumbnail:safeUrl(args.thumbnail),videoId,
      checkedAt:trim(args.checkedAt,40),uncertainty:trim(args.uncertainty,600),
      feedback:'new',feedbackNote:'',revision:1,
      createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
    });
  });
  return {outcome,content:await get({id})};
}
async function feedback(args={}){
  const id=trim(args.id,100), status=trim(args.status,20), expectedRevision=Number(args.expectedRevision);
  if(!STATES.has(status)) throw new Error('Invalid feedback status');
  if(!/^cur-[a-f0-9]{30}$/.test(id)) throw new Error('Invalid content id');
  if(!Number.isInteger(expectedRevision)||expectedRevision<1) throw new Error('expectedRevision is required');
  const ref=db().collection(COLLECTION).doc(id);
  await db().runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists) throw new Error('Content not found');
    if(snap.data().revision!==expectedRevision) throw new Error('Content revision conflict; reload');
    tx.update(ref,{feedback:status,feedbackNote:trim(args.note,500),revision:expectedRevision+1,updatedAt:FieldValue.serverTimestamp()});
  });
  return get({id});
}
module.exports={COLLECTION,list,get,add,feedback,safeUrl,youtubeId,idFor};
