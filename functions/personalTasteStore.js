'use strict';
/**
 * Personal taste evidence ledger (My Portal-owned, private).
 * A user judgment, an expression inference, a teacher/reference corpus and
 * a watch-later bookmark are different semantic types, never interchangeable.
 * All revisions leave an append-only event. No automatic inference promotion.
 */
const {randomUUID}=require('node:crypto');
const {getDocumentDb,FieldValue}=require('./documentDb');
const COLLECTION='personalTasteEvidence';
const EVENTS='personalTasteEvidenceEvents';
const META='personalTasteMeta';
const KINDS=new Set(['explicit_user','expression_inference','external_reference','watch_later']);
const DIRECTIONS=new Set(['like','dislike','boundary','unknown']);
const DOMAINS=new Set(['discover','humor','writing','design','ideas','media','general']);
const STATUSES=new Set(['active','superseded','archived']);
const TARGET_KINDS=new Set(['item','creator','genre','pattern','format','editorial_policy','unspecified']);
const SOURCE_KINDS=new Set(['user_message','user_post','discover_item','external_raw','bookmark','other']);
const db=()=>getDocumentDb('(default)');
const trim=(v,n=800)=>String(v??'').trim().slice(0,n);
const iso=v=>v?.toDate?.()?.toISOString?.()||(typeof v==='string'?v:null);
const safeId=v=>/^taste-[a-z0-9-]{8,100}$/.test(trim(v,110));
function normalizeRefs(v){
 if(!Array.isArray(v))return [];
 return v.slice(0,12).map(x=>{
  const kind=trim(x?.kind,40),id=trim(x?.id,170),url=trim(x?.url,1200),note=trim(x?.note,500);
  if(!SOURCE_KINDS.has(kind)||(!id&&!url))throw Error('sourceRefs need a known kind and id/url');
  if(url&&!/^https:\/\/[^ ]+$/i.test(url))throw Error('sourceRefs URL must be https');
  return {kind,id,url,note};
 });
}
function validate(raw){
 const evidenceKind=trim(raw?.evidenceKind,60),direction=trim(raw?.direction,30);
 const domain=trim(raw?.domain,40),status=trim(raw?.status||'active',30);
 if(!KINDS.has(evidenceKind))throw Error('Invalid evidenceKind');
 if(!DIRECTIONS.has(direction))throw Error('Invalid direction');
 if(!DOMAINS.has(domain))throw Error('Invalid domain');
 if(!STATUSES.has(status))throw Error('Invalid status');
 if(evidenceKind!=='explicit_user'&&direction!=='unknown')throw Error('Only explicit user verdicts may assert like/dislike/boundary');
 if(evidenceKind==='explicit_user'&&direction==='unknown')throw Error('Explicit user verdict requires like/dislike/boundary');
 const title=trim(raw.title,180),detail=trim(raw.detail,2300);
 if(title.length<5||detail.length<12)throw Error('Concrete title and detail required');
 const confidence=raw.confidence===undefined||raw.confidence===null
  ?(evidenceKind==='explicit_user'?1:0.3):Number(raw.confidence);
 if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw Error('confidence must be between 0 and 1');
 if(evidenceKind!=='explicit_user'&&confidence>0.75)throw Error('Unconfirmed inference/reference cannot exceed .75 confidence');
 const sourceRefs=normalizeRefs(raw.sourceRefs);
 // Target identifies what was judged, not what the person is assumed to like.
 // Omitted fields preserve compatibility with evidence saved before v2.
 const targetKind=trim(raw.target?.kind||'unspecified',40);
 if(!TARGET_KINDS.has(targetKind))throw Error('Invalid target kind');
 const target={kind:targetKind,key:trim(raw.target?.key,160),
   label:trim(raw.target?.label||title,180)};
 if(!target.label)throw Error('Target label required');
 if(raw.facets!==undefined&&!Array.isArray(raw.facets))throw Error('facets must be an array');
 const facets=[...new Set((raw.facets||[]).slice(0,12).map(x=>{
   if(typeof x!=='string')throw Error('Facet must be a string');
   const label=trim(x.normalize('NFKC'),64);
   if(label.length<2)throw Error('Facet labels need at least two characters');
   return label;
 }))];
 if(raw.facets?.length>12)throw Error('Too many facets');
 if(raw.appliesTo!==undefined&&!Array.isArray(raw.appliesTo))throw Error('appliesTo must be an array');
 const appliesTo=[...new Set((raw.appliesTo||[domain]).map(x=>trim(x,40)))];
 if(!appliesTo.length||appliesTo.length>7||appliesTo.some(x=>!DOMAINS.has(x)))
   throw Error('Invalid applicable domains');
 if(evidenceKind==='explicit_user'&&!sourceRefs.some(x=>x.kind==='user_message'||x.kind==='discover_item'))
  throw Error('Explicit user verdict must cite an actual user message or Discover item');
 if(evidenceKind==='expression_inference'&&sourceRefs.filter(x=>x.kind==='user_post').length<2)
  throw Error('Expression hypotheses need at least two authored original post references');
 if(evidenceKind==='external_reference'&&!sourceRefs.some(x=>x.kind==='external_raw'))
  throw Error('External references need original corpus document IDs');
 if(evidenceKind==='watch_later'&&!sourceRefs.some(x=>x.kind==='bookmark'))
  throw Error('Watch-later is a separate bookmark, never a positive rating');
 return {title,detail,domain,evidenceKind,direction,status,confidence,target,facets,appliesTo,
  caveat:trim(raw.caveat,1200),sourceRefs,origin:trim(raw.origin||'manual',100),
  topicKey:trim(raw.topicKey,140)};
}
function view(snapshot){
 const d=snapshot.data();return {...d,id:snapshot.id,
   createdAt:iso(d.createdAt),updatedAt:iso(d.updatedAt)};
}
const STARTER=[
 {id:'taste-user-discover-contrived-20261017',title:'狙いすぎた変な企画は好みでない',
  detail:'変な状況をわざと作って「面白いでしょ」と見せる企画を、ユーザーは「そういう狙い過ぎてるやつ嫌い」と評価。今回の4記事の共通した作為性に対する否定であり、個々のジャンル全体の否定ではない。',
  domain:'discover',evidenceKind:'explicit_user',direction:'dislike',confidence:1,
  caveat:'4件への一括の編集パターン批評。個別作品すべてを恒久的にブロックしない。',
  sourceRefs:[{kind:'user_message',id:'2026-10-17-discover-overcontrived',note:'そういう狙い過ぎてるやつ嫌い'}],
  topicKey:'contrived-humor',origin:'user_chat'},
 {id:'taste-user-discover-news-20261017',title:'映画・ゲーム速報や公式PVの単純な羅列は合わない',
  detail:'Discoverの初期11件がすべて映画・ゲーム記事と公式トレーラー中心だったことについて、ユーザーは「センスがあんまり俺の好みじゃない」と評価。',
  domain:'discover',evidenceKind:'explicit_user',direction:'dislike',confidence:1,
  caveat:'ニュース媒体・映画・ゲーム・動画自体への全面的な否定ではない。',
  sourceRefs:[{kind:'user_message',id:'2026-10-17-discover-mismatch',note:'Discoverの初期選書への否定'}],
  topicKey:'generic-entertainment-news',origin:'user_chat'},
 {id:'taste-user-watchlater-rule-20261017',title:'後で見るメモは好みの確定データではない',
  detail:'エヴァ、マトリックス、Oasis、20世紀少年等のMy Portal趣味ボードは後で見ようと思って残したメモ。明示的な好意や視聴済みの正例として使わない。',
  domain:'general',evidenceKind:'explicit_user',direction:'boundary',confidence:1,
  sourceRefs:[{kind:'user_message',id:'2026-10-17-watchlater-is-not-like',note:'それ後で見ようと思ってたメモだから好みのデータじゃないよ'}],
  topicKey:'bookmark-not-preference',origin:'user_chat'}
];
let bootstrapped=false;
async function bootstrap(){
 if(bootstrapped)return;
 const database=db(),marker=database.collection(META).doc('explicit-corrections-20261017');
 await database.runTransaction(async tx=>{
  const snap=await tx.get(marker);if(snap.exists)return;
  const now=FieldValue.serverTimestamp();
  for(const item of STARTER){
   const {id,...value}=item;
   tx.set(database.collection(COLLECTION).doc(id),{...validate(value),revision:1,
     createdAt:now,updatedAt:now});
   tx.set(database.collection(EVENTS).doc(id+'-initial'),{evidenceId:id,revision:1,
     action:'initial_user_correction',snapshot:{...validate(value),id},createdAt:now});
  }
  tx.set(marker,{schemaVersion:1,createdAt:now,count:STARTER.length});
 });
 // Separate migration from the first 3 corrections: this direct user feedback
 // arrived later, and must not be mistaken for preference for any individual artist.
 const latest=db().collection(META).doc('explicit-corrections-20261017-netculture');
 await database.runTransaction(async tx=>{
  if((await tx.get(latest)).exists)return;
  const item={
   id:'taste-user-discover-netculture-20261017',
   title:'Discoverではネット文化を優先、硬すぎるインタビュー偏重は避ける',
   detail:'直前の作曲家や映画監督の長い取材に寄った選書について、本人が「硬すぎるな。ネット文化をもっと優位にして」と明示。配信・SNS・ネット音楽・ネット発の作品や界隈の出来事を主役にする編集上の嗜好。',
   domain:'discover',evidenceKind:'explicit_user',direction:'boundary',confidence:1,
   caveat:'ネット文化の全作品を無条件に好きという意味ではない。前に否定した狙いすぎの企画や、薄いニュースの羅列に戻さない。ネット以外の優れた映像・音楽を排除しない。',
   sourceRefs:[{kind:'user_message',id:'2026-10-17-internet-culture-first',
    note:'硬すぎるな。ネット文化をもっと優位にして'}],
   topicKey:'internet-culture-editorial-priority',origin:'user_chat'
  };
  const {id,...data}=item,now=FieldValue.serverTimestamp(),valid=validate(data);
  tx.set(database.collection(COLLECTION).doc(id),{...valid,revision:1,createdAt:now,updatedAt:now});
  tx.set(database.collection(EVENTS).doc(id+'-initial'),{
   evidenceId:id,revision:1,action:'initial_user_correction',snapshot:{...valid,id},createdAt:now});
  tx.set(latest,{schemaVersion:1,count:1,createdAt:now});
 });
 bootstrapped=true;
}
async function list(args={}){
 await bootstrap();
 const limit=Math.max(1,Math.min(300,Number(args.limit)||120));
 const scan=Math.min(450,Math.max(limit,Number(args.scanLimit)||350));
 const snapshot=await db().collection(COLLECTION).orderBy('updatedAt','desc').limit(scan).get();
 const items=snapshot.docs.map(view).filter(x=>
   (args.includeInactive===true||x.status==='active')&&
   (!args.domain||x.domain===args.domain)&&
   (!args.evidenceKind||x.evidenceKind===args.evidenceKind)&&
   (!args.direction||x.direction===args.direction)
 ).slice(0,limit);
 const all=snapshot.docs.map(view);
 return {items,count:items.length,scanned:all.length,sourceOfTruth:COLLECTION,profile:summarizeProfile(all),
   summary:{explicit:all.filter(x=>x.evidenceKind==='explicit_user'&&x.status==='active').length,
   hypotheses:all.filter(x=>x.evidenceKind==='expression_inference'&&x.status==='active').length,
   referenceOnly:all.filter(x=>x.evidenceKind==='external_reference'&&x.status==='active').length,
   watchLater:all.filter(x=>x.evidenceKind==='watch_later'&&x.status==='active').length}};
}

/**
 * Derived read model. It is NOT another editable preference DB.
 * A facet with one source is a one-off signal, not a global preference.
 * Inferred posts, external corpora, and bookmarks are excluded entirely.
 */
function summarizeProfile(all,{domain}={}){
 const active=all.filter(x=>x.status==='active'&&x.evidenceKind==='explicit_user'&&
   (!domain||(x.appliesTo||[x.domain]).includes(domain)));
 const facetMap=new Map();
 let uncategorized=0;
 for(const entry of active){
  if(!entry.facets?.length){uncategorized++;continue}
  for(const label of new Set(entry.facets)){
   const key=label.normalize('NFKC').trim().toLocaleLowerCase();
   if(!key)continue;
   let row=facetMap.get(key);
   if(!row){row={key,label,like:0,dislike:0,boundary:0,evidenceIds:[],domains:[]};facetMap.set(key,row)}
   row[entry.direction]=(row[entry.direction]||0)+1;
   row.evidenceIds.push(entry.id);
   for(const d of (entry.appliesTo||[entry.domain]))if(!row.domains.includes(d))row.domains.push(d);
  }
 }
 const facets=[...facetMap.values()].map(x=>({...x,
  evidenceCount:x.evidenceIds.length,
  state:x.like&&x.dislike?'mixed':x.evidenceIds.length>=2?'repeated':'single'
 })).sort((a,b)=>b.evidenceCount-a.evidenceCount||a.label.localeCompare(b.label,'ja'));
 return {facets,explicitCount:active.length,uncategorized,scanned:all.length,
  scanCap:450,mayBeIncomplete:all.length===450,
  policy:'Facets count only active direct user judgments. Counts describe evidence, not a computed personality score.'};
}
async function profile(args={}){
 await bootstrap();
 const snapshot=await db().collection(COLLECTION).orderBy('updatedAt','desc').limit(450).get();
 return summarizeProfile(snapshot.docs.map(view),args);
}

async function get(args={}){
 await bootstrap();const id=trim(args.id,120);if(!safeId(id))throw Error('Invalid taste ID');
 const snap=await db().collection(COLLECTION).doc(id).get();
 if(!snap.exists)throw Error('Taste evidence not found');
 return view(snap);
}
async function upsert(args={}){
 await bootstrap();
 const id=args.id?trim(args.id,120):'taste-'+randomUUID();
 if(!safeId(id))throw Error('Invalid taste ID');
 const expectedRevision=Number(args.expectedRevision);
 const reason=trim(args.changeReason,400);
 if(reason.length<3)throw Error('changeReason required for audit');
 const content=validate(args.record||{});
 const ref=db().collection(COLLECTION).doc(id),event=db().collection(EVENTS).doc('event-'+randomUUID());
 await db().runTransaction(async tx=>{
  const old=await tx.get(ref);
  if(old.exists&&(!Number.isInteger(expectedRevision)||expectedRevision!==old.data().revision))
    throw Error('Revision conflict: refresh evidence');
  if(!old.exists&&args.expectedRevision!==undefined)throw Error('New evidence cannot declare expectedRevision');
  const revision=old.exists?old.data().revision+1:1,now=FieldValue.serverTimestamp();
  const next={...content,revision,createdAt:old.exists?old.data().createdAt:now,updatedAt:now};
  tx.set(ref,next);
  tx.set(event,{evidenceId:id,revision,action:old.exists?'revision':'created',
    changeReason:reason,prior:old.exists?old.data():null,snapshot:content,createdAt:now});
 });
 return get({id});
}
async function history(args={}){
 await bootstrap();
 const id=trim(args.id,120);
 if(!safeId(id))throw Error('Invalid taste ID');
 const snap=await db().collection(EVENTS).orderBy('createdAt','desc').limit(250).get();
 const items=snap.docs.map(view).filter(x=>x.evidenceId===id).slice(0,Math.max(1,Math.min(80,Number(args.limit)||30)));
 return {items,count:items.length};
}
async function fromDiscover(args={}){
 await bootstrap();
 const itemId=trim(args.itemId,120),feedback=trim(args.feedback,30);
 if(!/^cur-[a-f0-9]{30}$/.test(itemId))throw Error('Invalid content item ID');
 if(!['new','loved','saved','skipped','seen'].includes(feedback))throw Error('Invalid Discover feedback');
 const id='taste-feed-'+itemId.slice(4);
 const direction=feedback==='loved'?'like':feedback==='skipped'?'dislike':'unknown';
 // saved/seen are not explicit endorsements and must not be entered as positive taste.
 const record=direction==='unknown'?{
  title:trim(args.title||'Discover item',170),detail:'Discoverで「'+feedback+'」になった。これは好意や嫌悪の確定判断ではない。',
  domain:'discover',evidenceKind:'watch_later',direction:'unknown',status:'superseded',confidence:0.1,
  sourceRefs:[{kind:'bookmark',id:itemId}],origin:'discover_feedback',topicKey:itemId,
 }:{
  title:trim(args.title||'Discover item',170),detail:'Discoverの本人評価: '+(direction==='like'?'好き':'興味なし')+'。'+trim(args.note,450),
  domain:'discover',evidenceKind:'explicit_user',direction,status:'active',confidence:1,
  caveat:'特定コンテンツへの個別評価。他のジャンルや作者全体の評価に拡張しない。',
  sourceRefs:[{kind:'discover_item',id:itemId,url:trim(args.url,1000),note:trim(args.note,350)}],
  origin:'discover_feedback',topicKey:itemId,
 };
 const ref=db().collection(COLLECTION).doc(id);
 const prior=await ref.get();
 if(prior.exists&&prior.data().origin==='discover_feedback'&&prior.data().direction===record.direction&&prior.data().evidenceKind===record.evidenceKind&&prior.data().status===record.status)return view(prior);
 return upsert({id,record,expectedRevision:prior.exists?prior.data().revision:undefined,
    changeReason:'Discover feedback='+feedback});
}
module.exports={COLLECTION,EVENTS,KINDS,DIRECTIONS,TARGET_KINDS,STARTER,validate,summarizeProfile,profile,list,get,upsert,history,fromDiscover,bootstrap};
