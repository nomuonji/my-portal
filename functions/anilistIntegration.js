'use strict';
/* AniList public recommendation signals and optional owner-approved editing.
 * Public lists are query-only; a server-encrypted OAuth token is needed for writes.
 */
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const {getDocumentDb,FieldValue}=require('./documentDb');
const USERNAME='topgear',PROFILE='https://anilist.co/user/topgear/';
const CALLBACK='https://my-portal-agent.netlify.app/anilist/callback';
const COLLECTION='personalTasteConnections',DOC_ID='anilist-topgear';
const STATUS=['CURRENT','PLANNING','COMPLETED','DROPPED','PAUSED','REPEATING'];
const doc=()=>getDocumentDb('(default)').collection(COLLECTION).doc(DOC_ID);
const env=k=>process.env[k]||(globalThis.Netlify?.env?.get?.(k))||'';
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const QUERY_USER='query($name:String){User(name:$name){id name}}';
const QUERY_VIEWER='query{Viewer{id name}}';
const QUERY_LIST='query($name:String,$type:MediaType!){MediaListCollection(userName:$name,type:$type){lists{name isCustomList entries{id mediaId status score(format:POINT_100) progress progressVolumes updatedAt media{id type format title{romaji english native userPreferred} genres tags{name rank} averageScore siteUrl}}}}}';
const QUERY_SEARCH='query($search:String,$type:MediaType!){Page(page:1,perPage:12){media(search:$search,type:$type,sort:SEARCH_MATCH){id type format title{romaji english native userPreferred} siteUrl isAdult}}}';
const QUERY_ENTRY='query($id:Int!,$user:Int!){Media(id:$id){id type title{romaji native} siteUrl} MediaList(mediaId:$id,userId:$user){id mediaId status score(format:POINT_100) progress progressVolumes updatedAt}}';
function key(){
 const raw=clean(env('ANILIST_TOKEN_ENCRYPTION_KEY'),160);
 const bytes=/^[a-f0-9]{64}$/i.test(raw)?Buffer.from(raw,'hex'):Buffer.from(raw,'base64');
 if(bytes.length!==32)throw Error('AniList token encryption is not configured');
 return bytes;
}
function encrypt(t){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
 const body=Buffer.concat([cipher.update(t,'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),body].map(b=>b.toString('base64url')).join('.');
}
function decrypt(e){
 const [iv,tag,body]=String(e||'').split('.').map(x=>Buffer.from(x,'base64url'));
 const cipher=createDecipheriv('aes-256-gcm',key(),iv);
 cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(body),cipher.final()]).toString('utf8');
}
async function gql(query,variables={},token=''){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetch('https://graphql.anilist.co',{method:'POST',signal:controller.signal,
   headers:{'Content-Type':'application/json','Accept':'application/json',
    ...(token?{Authorization:'Bearer '+token}:{})},
   body:JSON.stringify({query,variables})});
  const data=await r.json().catch(()=>({}));
  if(r.status===429)throw Error('AniList API rate limited (429)');
  if(r.status===401)throw Error('AniList authorization expired; reconnect');
  if(!r.ok||data.errors?.length)throw Error('AniList API: '+clean(data.errors?.[0]?.message||r.status,180));
  return data.data||{};
 }finally{clearTimeout(timeout)}
}
function expiry(token){
 const encoded=String(token).split('.')[1];
 if(!encoded)throw Error('AniList OAuth token format error');
 const exp=Number(JSON.parse(Buffer.from(encoded,'base64url').toString()).exp);
 if(!Number.isFinite(exp)||exp*1000<Date.now()+60000)throw Error('AniList token expired');
 return new Date(exp*1000).toISOString();
}
async function connection(){
 const snap=await doc().get(),d=snap.exists?snap.data():{};
 return {service:'anilist',userName:USERNAME,url:PROFILE,clientConfigured:!!d.clientId,
  connected:!!d.tokenEncrypted&&!!d.expiresAt&&new Date(d.expiresAt)>new Date(),
  expiresAt:d.expiresAt||null, authorizedUser:d.authorizedUser||null,
  encryptionConfigured:!!env('ANILIST_TOKEN_ENCRYPTION_KEY'),
  note:'Public data is readable without OAuth; writes need AniList approval'};
}
async function configure({clientId}={}){
 const id=clean(clientId,20);
 if(!/^\d{1,15}$/.test(id))throw Error('Enter AniList numeric Client ID');
 const ref=doc(),before=await ref.get(),prev=before.exists?before.data():{};
 await ref.set({...prev,clientId:id,service:'anilist',userName:USERNAME,
   createdAt:prev.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
 return connection();
}
async function authorizeUrl(){
 const s=await doc().get(),id=s.data()?.clientId;
 if(!id)throw Error('First register a Client ID from AniList developer settings');
 return {url:'https://anilist.co/api/v2/oauth/authorize?client_id='+id+'&response_type=token',
  redirectUrl:CALLBACK};
}
async function authorize({token}={}){
 if(!/^[A-Za-z0-9._-]{100,6000}$/.test(String(token||'')))throw Error('Invalid access token');
 const before=await doc().get(),prev=before.data();
 if(!prev?.clientId)throw Error('Configure Client ID first');
 const viewer=(await gql(QUERY_VIEWER,{},token)).Viewer;
 if(!viewer||viewer.name?.toLowerCase()!==USERNAME)throw Error('Token belongs to a different AniList user');
 const expiresAt=expiry(token);
 await doc().set({...prev,tokenEncrypted:encrypt(token),
   authorizedUser:{id:viewer.id,name:viewer.name},expiresAt,
   updatedAt:FieldValue.serverTimestamp()});
 return connection();
}
async function tokenForEdit(){
 const s=await doc().get(),d=s.data();
 if(!d?.tokenEncrypted)throw Error('Please approve AniList connection in My Portal');
 if(!d.expiresAt||new Date(d.expiresAt).getTime()<Date.now()+60000)
  throw Error('AniList authorization expired, reconnect in My Portal');
 return {token:decrypt(d.tokenEncrypted),userId:d.authorizedUser.id};
}
function mapped(e){
 const m=e.media||{};
 return {mediaId:e.mediaId,listEntryId:e.id,mediaType:m.type,status:e.status,
  score:e.score>0?e.score:null,progress:e.progress||0,progressVolumes:e.progressVolumes||0,
  updatedAt:e.updatedAt,title:m.title||{},mediaTitle:m.title?.userPreferred||m.title?.native||m.title?.romaji,
  genres:m.genres||[],tags:(m.tags||[]).filter(t=>t.rank>=60).slice(0,10),
  format:m.format,siteUrl:m.siteUrl||null};
}
async function profile({type='ALL',limit=150}={}){
 const kind=clean(type,10).toUpperCase(),cap=Math.max(1,Math.min(450,Number(limit)||150));
 if(!['ALL','ANIME','MANGA'].includes(kind))throw Error('type must be ALL/ANIME/MANGA');
 const user=(await gql(QUERY_USER,{name:USERNAME})).User;
 if(!user)throw Error('AniList public profile unavailable');
 const sources=[];
 for(const t of kind==='ALL'?['ANIME','MANGA']:[kind]){
  const x=await gql(QUERY_LIST,{name:USERNAME,type:t}),unique=new Map();
  for(const list of x.MediaListCollection?.lists||[])
   for(const e of list.entries||[])if(e.media?.id)unique.set(e.media.id,mapped(e));
  const entries=[...unique.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  sources.push({type:t,count:entries.length,entries:entries.slice(0,cap),
   truncated:entries.length>cap,
   byStatus:Object.fromEntries(STATUS.map(s=>[s,entries.filter(e=>e.status===s).length]))});
 }
 return {user:{id:user.id,name:user.name,url:PROFILE},sources,authoritativeSource:'AniList public API',
  interpretation:'PLANNING means interest, not liked. A score is user-provided, not the community average.'};
}
async function search({text,type='ANIME'}={}){
 const q=clean(text,150),kind=clean(type,10).toUpperCase();
 if(q.length<2||!['ANIME','MANGA'].includes(kind))throw Error('text and ANIME/MANGA required');
 const x=await gql(QUERY_SEARCH,{search:q,type:kind});
 return {items:x.Page?.media||[],query:q};
}
async function entry({mediaId}={}){
 const id=Number(mediaId);
 if(!Number.isInteger(id)||id<1)throw Error('Valid media ID required');
 const user=(await gql(QUERY_USER,{name:USERNAME})).User;
 const result=await gql(QUERY_ENTRY,{id,user:user.id});
 return {media:result.Media,entry:result.MediaList};
}
async function save({mediaId,status,score,progress,progressVolumes,changeReason}={}){
 const id=Number(mediaId),reason=clean(changeReason,300);
 if(!Number.isInteger(id)||id<1)throw Error('Valid media ID required');
 if(reason.length<5)throw Error('A current explicit user instruction is required to mutate AniList');
 if(status!==undefined&&!STATUS.includes(status))throw Error('Invalid status');
 if(score!==undefined&&(!Number.isFinite(score)||score<0||score>100))throw Error('score must be 0..100');
 for(const n of [progress,progressVolumes])
  if(n!==undefined&&(!Number.isInteger(n)||n<0||n>100000))throw Error('Invalid progress');
 if(status===undefined&&score===undefined&&progress===undefined&&progressVolumes===undefined)throw Error('No changes requested');
 const {token,userId}=await tokenForEdit();
 const before=await gql(QUERY_ENTRY,{id,user:userId},token);
 if(!before.Media)throw Error('Media not found');
 const prev=before.MediaList;
 const fields={...(prev?.id?{id:prev.id}:{mediaId:id,status:status||'PLANNING'}),
  ...(status&&prev?.id?{status}:{}),
  ...(score!==undefined?{score}:{}),
  ...(progress!==undefined?{progress}:{}),
  ...(progressVolumes!==undefined?{progressVolumes}:{})};
 const types={id:'Int',mediaId:'Int',status:'MediaListStatus',score:'Float',progress:'Int',progressVolumes:'Int'};
 const definitions=Object.keys(fields).map(k=>'$'+k+':'+types[k]).join(',');
 const argumentsList=Object.keys(fields).map(k=>k+':$'+k).join(',');
 const query='mutation('+definitions+'){SaveMediaListEntry('+argumentsList+'){id mediaId status score(format:POINT_100) progress progressVolumes updatedAt}}';
 const result=await gql(query,fields,token);
 if(!result.SaveMediaListEntry)throw Error('AniList write was not acknowledged');
 const readback=await gql(QUERY_ENTRY,{id,user:userId},token);
 return {media:before.Media,before:prev,after:readback.MediaList,changeReason:reason,
  status:'confirmed_by_anilist_readback'};
}
module.exports={USERNAME,PROFILE,CALLBACK,STATUS,gql,connection,configure,authorizeUrl,authorize,profile,search,entry,save,encrypt,decrypt,expiry};
