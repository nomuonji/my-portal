'use strict';
const crypto = require('node:crypto');
const {getDocumentDb,FieldValue,FieldPath}=require('./documentDb');
const db=()=>getDocumentDb(process.env.AGENT_IDEAS_DATABASE_ID||'(default)');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const required=(value,max,name)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(name+' is required, max '+max);
  return value.trim();
};
function optional(value,max,name){
  return value===undefined||value===''?'':required(value,max,name);
}
function strings(value,max,n,name){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>max)throw fail('Invalid '+name);
  return [...new Set(value.map(v=>required(v,n,name)))];
}
const idValid=id=>typeof id==='string'&&/^[0-9a-f]{64}$/.test(id);
const serialize=(doc)=>{const v=doc.data();return {id:doc.id,...v,createdAt:v.createdAt?.toDate?.()?.toISOString()||v.createdAt};};
async function save(input={}){
  if(input.confirm!==true)throw fail('confirm=true required');
  const kind=input.kind;
  if(!['research','experience','hypothesis'].includes(kind))throw fail('Invalid memory kind');
  const entry={
    kind,title:required(input.title,220,'title'),observation:required(input.observation,12000,'observation'),
    inference:optional(input.inference,12000,'inference'),counterexamples:optional(input.counterexamples,6000,'counterexamples'),
    application:optional(input.application,6000,'application'),validation:optional(input.validation,6000,'validation'),
    domains:strings(input.domains,12,80,'domains'),sourceUrls:strings(input.sourceUrls,20,1000,'sourceUrls'),
    materialIds:strings(input.materialIds,20,64,'materialIds'),legacyEventIds:strings(input.legacyEventIds,20,160,'legacyEventIds'),
    status:'candidate',space:'agent-memory'
  };
  if(!entry.domains.length)throw fail('At least one domain required');
  if(entry.materialIds.some(id=>!idValid(id)))throw fail('Invalid material ID');
  for(const url of entry.sourceUrls){try{if(!['https:','http:'].includes(new URL(url).protocol))throw Error()}catch{throw fail('Invalid source URL')}}
  if(!entry.materialIds.length&&!entry.sourceUrls.length&&!entry.legacyEventIds.length&&kind==='research')throw fail('Research requires source evidence');
  const id=hash(JSON.stringify(entry)),d=db(),ref=d.collection('agentMemories').doc(id);
  await d.runTransaction(async tx=>{
    const existing=await tx.get(ref);
    if(existing.exists)return;
    const sources=await Promise.all(entry.materialIds.map(id=>tx.get(d.collection('learningMaterials').doc(id))));
    if(sources.some(x=>!x.exists))throw fail('Source material not found',409);
    if(sources.some(x=>x.data().truncated!==false))throw fail('Incomplete source material; retrieve the full post before learning',422);
    tx.set(ref,{...entry,createdAt:FieldValue.serverTimestamp()});
  });
  return serialize(await ref.get());
}
async function get(input={}){
  if(!idValid(input.id))throw fail('Invalid memory ID');
  const snap=await db().collection('agentMemories').doc(input.id).get();
  if(!snap.exists)throw fail('Memory not found',404);
  return withCompleteness(serialize(snap));
}
async function withCompleteness(entry){
  if(!entry.materialIds?.length)return entry;
  const d=db();
  const sources=await Promise.all(entry.materialIds.map(id=>d.collection('learningMaterials').doc(id).get()));
  return sources.some(s=>!s.exists||s.data().truncated!==false)?{...entry,status:'incomplete-source'}:entry;
}
async function list(input={}){
  const limit=Math.min(Math.max(Math.floor(Number(input.limit)||20),1),50),d=db();
  let q=d.collection('agentMemories');
  const domain=input.domain?required(input.domain,80,'domain'):'';
  // Filter after a bounded page; callers can continue even when the page matches no search terms.
  q=q.orderBy('createdAt','desc').orderBy(FieldPath.documentId(),'desc');
  if(input.before){
    if(!idValid(input.before))throw fail('Invalid cursor');
    const cursor=await d.collection('agentMemories').doc(input.before).get();
    if(!cursor.exists)throw fail('Cursor not found',404);
    q=q.startAfter(cursor.data().createdAt,cursor.id);
  }
  const snap=await q.limit(limit).get();
  const search=String(input.query||'').toLowerCase().trim();
  const matched=snap.docs.map(serialize).filter(v=>(!domain||v.domains.includes(domain))&&(!search||[v.title,v.observation,v.inference,v.application,...v.domains].join(' ').toLowerCase().includes(search)))
    ;
  const items=(await Promise.all(matched.map(withCompleteness))).map(({id,kind,title,domains,status,createdAt,materialIds,sourceUrls})=>({id,kind,title,domains,status,createdAt,materialIds,sourceUrls}));
  return {items,count:items.length,nextCursor:snap.docs.length===limit?snap.docs.at(-1).id:null};
}
module.exports={save,get,list};
