'use strict';
const crypto = require('node:crypto');
const { getDocumentDb, FieldValue } = require('./documentDb');
const CONTEXT_ID = 'W1Ezf9gmcFe7nwYePmd0';
const db = () => getDocumentDb(process.env.AGENT_IDEAS_DATABASE_ID || '(default)');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const configRef = d => d.collection('learningInboxConfig').doc('sender');
const itemRef = (d,id) => d.collection('learningInbox').doc(id);
const eventRef = (d,id) => d.collection('contextEvents').doc(id);
const fail = (message,status=400) => Object.assign(new Error(message),{status});
async function setKey(input={}) {
  const key = input.key;
  if(typeof key!=='string'||!/^learn-[A-Za-z0-9-]{12,80}$/.test(key)) throw fail('Use learn- followed by at least 12 letters, digits or hyphens');
  await configRef(db()).set({keyHash:hash(key),updatedAt:FieldValue.serverTimestamp()});
  return {configured:true};
}
async function authorized(key) {
  if(typeof key!=='string'||key.length>100) return false;
  const s=await configRef(db()).get();
  const expected=s.data()?.keyHash;
  return typeof expected==='string' && /^[0-9a-f]{64}$/.test(expected) &&
    crypto.timingSafeEqual(Buffer.from(hash(key),'hex'),Buffer.from(expected,'hex'));
}
function normalize(post) {
  if(!post||typeof post!=='object'||Array.isArray(post)) throw fail('Invalid post');
  const platform=post.platform, postId=post.postId;
  if(!['x','threads'].includes(platform)||typeof postId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(postId)) throw fail('Invalid post identity');
  let url; try{url=new URL(post.url)}catch{throw fail('Invalid post URL')}
  const host=platform==='x'?'x.com':'www.threads.com';
  const prefix=platform==='x'?'/status/':'/post/';
  if(url.protocol!=='https:'||url.hostname!==host||!url.pathname.endsWith(prefix+postId)||url.username||url.password||url.port) throw fail('Invalid post URL');
  if(typeof post.text!=='string'||(!post.text.trim()&&!post.media?.length)) throw fail('Empty post');
  // Preserve the observed source fields; never store credentials or arbitrary extra fields.
  const raw=JSON.stringify({platform,postId,url:url.href,author:post.author||{},text:post.text,rawText:post.rawText||'',createdAt:post.createdAt||null,metrics:post.metrics||{},media:post.media||[],links:post.links||[],quoted:post.quoted||null,context:post.context||'',truncated:Boolean(post.truncated)});
  if(Buffer.byteLength(raw)>128000) throw fail('Post exceeds 128 KB',413);
  return {raw,postKey:platform+':'+postId,sourceUrl:url.href,truncated:Boolean(post.truncated),id:hash(raw)};
}
async function enqueue(post) {
  const item=normalize(post), d=db(), ref=itemRef(d,item.id), receipt=eventRef(d,'learning-inbox-'+item.id+'-0');
  return d.runTransaction(async tx=>{
    const [pending,received]=await Promise.all([tx.get(ref),tx.get(receipt)]);
    if(received.exists) return {id:item.id,status:'received'};
    if(pending.exists) return {id:item.id,status:'pending'};
    tx.set(ref,{...item,createdAt:FieldValue.serverTimestamp()});
    return {id:item.id,status:'pending'};
  });
}
async function list(input={}) {
  const limit=Math.min(Math.max(Math.floor(Number(input.limit)||10),1),30);
  const snap=await db().collection('learningInbox').orderBy('createdAt','asc').limit(limit).get();
  return {items:snap.docs.map(doc=>{const v=doc.data();return {id:doc.id,postKey:v.postKey,sourceUrl:v.sourceUrl,truncated:v.truncated,createdAt:v.createdAt?.toDate?.()?.toISOString()||v.createdAt};}),count:snap.docs.length};
}
async function receive(input={}) {
  const d=db(), id=input.id;
  if(typeof id!=='string'||!(/^[0-9a-f]{64}$/).test(id)) throw fail('Invalid inbox id');
  const ref=itemRef(d,id), context=d.collection('contexts').doc(CONTEXT_ID), first=eventRef(d,'learning-inbox-'+id+'-0');
  return d.runTransaction(async tx=>{
    const [pending,parent,receipt]=await Promise.all([tx.get(ref),tx.get(context),tx.get(first)]);
    if(!parent.exists||parent.data().status!=='active') throw fail('Learning Context is not active',409);
    if(!pending.exists) {
      if(receipt.exists) return {id,status:'received',eventId:first.id,parts:receipt.data().learningParts};
      throw fail('Inbox item not found',404);
    }
    const v=pending.data();
    if(hash(v.raw)!==id||v.id!==id) throw fail('Inbox payload integrity failure',409);
    const chars=Array.from(v.raw), chunks=[];
    for(let i=0;i<chars.length;i+=1800) chunks.push(chars.slice(i,i+1800).join(''));
    if(!chunks.length||chunks.length>100) throw fail('Invalid payload size');
    const refs=chunks.map((_,i)=>eventRef(d,'learning-inbox-'+id+'-'+i));
    const existing=await Promise.all(refs.map(r=>tx.get(r)));
    for(let i=0;i<chunks.length;i++){
      const detail='未検証の原典 / '+v.postKey+' / '+(i+1)+'/'+chunks.length+'\n'+chunks[i];
      if(existing[i].exists){
        const e=existing[i].data();
        if(e.contextId!==CONTEXT_ID||e.detail!==detail||e.learningInboxId!==id) throw fail('Receipt integrity conflict',409);
      }else{
        tx.set(refs[i],{contextId:CONTEXT_ID,kind:'finding',summary:'指導学習・未検証｜'+v.postKey+' ('+(i+1)+'/'+chunks.length+')',detail,source:'本人提供SNS・学習Inbox',sourceUrl:v.sourceUrl,learningInboxId:id,learningParts:chunks.length,learningPart:i,learningRawChunk:chunks[i],learningStatus:'unverified',createdAt:FieldValue.serverTimestamp()});
      }
    }
    tx.delete(ref);
    return {id,status:'received',eventId:first.id,parts:chunks.length};
  });
}
module.exports={setKey,authorized,normalize,enqueue,list,receive,CONTEXT_ID};
