'use strict';
/**
 * User-provided film/book activity imported into a separate RAW source layer.
 * This is not the personalTasteEvidence verdict ledger. A clip or bookshelf
 * registration is never automatically promoted to a positive judgment.
 * External sites are not fetched by this service and passwords are not stored.
 */
const {createHash}=require('node:crypto');
const {getDocumentDb,FieldValue}=require('./documentDb');
const COLLECTION='personalTasteExternalSources';
const SOURCE_CONFIG={
 filmarks:{id:'filmarks-postmodern137',service:'filmarks',label:'Filmarks · 観たい映画',
  url:'https://filmarks.com/users/postmodern137/clips',importMethod:'manual_clip_list',
  description:'Clip! = 観たい。鑑賞済み・高評価の証拠ではない。'},
 booklog:{id:'booklog-nomuman',service:'booklog',label:'ブクログ · 本棚',
  url:'https://booklog.jp/users/nomuman',importMethod:'official_csv',
  description:'本棚登録だけでは好評とみなさない。読書状況、本人の数値評価を別々に保持。'}
};
const clean=(s,n=300)=>String(s??'').normalize('NFKC').trim().slice(0,n);
const iso=x=>x?.toDate?.()?.toISOString?.()||((typeof x==='string')?x:null);
const db=()=>getDocumentDb('(default)');
function normalize(source,raw){
 if(!raw||typeof raw!=='object')throw Error('Record must be an object');
 const title=clean(raw.title,220);
 if(!title)throw Error('Missing work title');
 if(source==='filmarks'){
  const match=String(raw.url||'').match(/^https:\/\/filmarks\.com\/movies\/(\d{1,12})(?:[/?#].*)?$/);
  const movieId=clean(raw.movieId||match?.[1],20);
  if(!/^\d{1,12}$/.test(movieId))throw Error('Filmarks movie ID required');
  if(raw.url&&!match)throw Error('Filmarks URL must be an official movie URL');
  if(match&&match[1]!==movieId)throw Error('Conflicting Filmarks ID');
  return {id:'movie:'+movieId,title,medium:'movie',signal:'want_to_watch',
   url:'https://filmarks.com/movies/'+movieId,sourceType:'filmarks_clip'};
 }
 const isbn=clean(raw.isbn,20).replace(/[-\s]/g,'');
 const itemId=clean(raw.itemId,90);
 const serviceId=clean(raw.serviceId,10);
 if(isbn&&!/^\d{10}(?:\d{3})?$/.test(isbn))throw Error('Invalid ISBN');
 if(itemId&&!/^[a-zA-Z0-9_-]{1,90}$/.test(itemId))throw Error('Invalid booklog item ID');
 if(serviceId&&!/^\d{1,6}$/.test(serviceId))throw Error('Invalid booklog service ID');
 const key=itemId&&serviceId?'item:'+serviceId+':'+itemId:
  isbn?'isbn:'+isbn:'title:'+createHash('sha256').update(title+'|'+clean(raw.author,180)).digest('hex').slice(0,20);
 let rating=null;
 if(raw.rating!==undefined&&raw.rating!==null&&String(raw.rating).trim()!==''){
  rating=Number(raw.rating);
  if(!Number.isFinite(rating)||rating<0||rating>5)throw Error('Booklog rating must be in 0..5');
  if(rating===0)rating=null;
 }
 const status=clean(raw.readingStatus,60);
 const allowed=new Set(['読みたい','積読','いま読んでる','読み終わった','読み終えた','読書中','未設定','未読','読了','', 'reading','read','want_to_read','unread','unknown']);
 return {id:key,title,medium:'book',author:clean(raw.author,180),
  isbn,itemId,serviceId,rating,readingStatus:allowed.has(status)?status:'unknown',
  category:clean(raw.category,100),tags:clean(raw.tags,260),
  registeredAt:clean(raw.registeredAt,40),finishedAt:clean(raw.finishedAt,40),
  review:clean(raw.review,1200),
  signal:rating!==null?'explicit_numeric_rating':'bookshelf_record',
  sourceType:'booklog_export'};
}
function normalizeRows(source,rows){
 if(!SOURCE_CONFIG[source])throw Error('Unknown external source');
 if(!Array.isArray(rows)||rows.length===0||rows.length>1200)throw Error('Expected 1..1200 source items');
 const items=new Map();
 for(const raw of rows){const item=normalize(source,raw);items.set(item.id,item)}
 const normalized=[...items.values()].sort((a,b)=>a.id.localeCompare(b.id));
 if(Buffer.byteLength(JSON.stringify(normalized),'utf8')>650000)
  throw Error('Import exceeds safe document size. Remove large reviews or split the export.');
 return normalized;
}
function summarise(items,source){
 if(source==='filmarks')return {count:items.length,wantToWatch:items.length,ratings:0,read:0};
 const rated=items.filter(x=>x.rating!==null);
 const finished=items.filter(x=>['読み終わった','読み終えた','読了','read'].includes(x.readingStatus));
 return {count:items.length,ratings:rated.length,read:finished.length,
  wantToRead:items.filter(x=>['読みたい','want_to_read'].includes(x.readingStatus)).length,
  reviews:items.filter(x=>x.review).length};
}
async function list({includeItems=false}={}){
 const results=[];
 for(const source of Object.keys(SOURCE_CONFIG)){
  const config=SOURCE_CONFIG[source],snap=await db().collection(COLLECTION).doc(config.id).get();
  const data=snap.exists?snap.data():null,items=data?.items||[];
  results.push({...config,connected:!!data,revision:data?.revision||0,
   lastImportedAt:iso(data?.updatedAt),stats:data?.stats||{count:0},
   ...(includeItems?{items:items.slice(0,400)}:{samples:items.slice(0,12)})});
 }
 return {items:results,sourceOfTruth:COLLECTION,
  note:'Import-derived activity, not confirmed likes. No automatic external scraping or credentials.'};
}
async function importRecords(args={}){
 const source=clean(args.source,30),config=SOURCE_CONFIG[source];
 if(!config)throw Error('Unknown external source');
 const records=normalizeRows(source,args.rows);
 const digest=createHash('sha256').update(JSON.stringify(records)).digest('hex');
 const ref=db().collection(COLLECTION).doc(config.id);
 let result={source,changed:false,digest,count:records.length};
 await db().runTransaction(async tx=>{
  const snap=await tx.get(ref),prev=snap.exists?snap.data():null;
  if(prev?.digest===digest){result={...result,revision:prev.revision};return}
  const revision=(prev?.revision||0)+1,now=FieldValue.serverTimestamp();
  const next={service:source,sourceUrl:config.url,importMethod:config.importMethod,
   revision,digest,items:records,stats:summarise(records,source),
   createdAt:prev?.createdAt||now,updatedAt:now};
  tx.set(ref,next);
  result={...result,changed:true,revision,stats:next.stats};
 });
 return result;
}
module.exports={COLLECTION,SOURCE_CONFIG,normalize,normalizeRows,summarise,list,importRecords};
