'use strict';
/**
 * Personal movie and music accounts. Trakt owner-authorized OAuth PKCE,
 * Last.fm official read-only REST API. Neither service is scraped.
 * Account activity is NOT a verdict of liking.
 */
const {randomBytes,createHash,createCipheriv,createDecipheriv,hkdfSync,timingSafeEqual}=require('node:crypto');
const {getDocumentDb,FieldValue}=require('./documentDb');
const COLLECTION='personalTasteConnections';
const TRAKT_CALLBACK='https://my-portal-agent.netlify.app/trakt/callback';
const LASTFM_USER='goodhangedman',TRAKT_EXPECTED='__c4a362';
const TRAKT_USER_AGENT='MyPortal/1.0 (https://my-portal-agent.netlify.app; personal Trakt integration)';
const db=()=>getDocumentDb('(default)').collection(COLLECTION);
const doc=id=>db().doc(id);
const env=n=>process.env[n]||(globalThis.Netlify?.env?.get?.(n))||'';
const clean=(s,max=250)=>String(s??'').trim().slice(0,max);
function secretKey(){
 const privateKey=JSON.parse(env('FIREBASE_SERVICE_ACCOUNT_JSON')||'{}').private_key;
 if(typeof privateKey!=='string'||!privateKey.includes('PRIVATE KEY'))throw Error('Server encryption credential unavailable');
 return Buffer.from(hkdfSync('sha256',Buffer.from(privateKey,'utf8'),
  Buffer.from('my-portal:trakt:tokens:v1'),Buffer.from('AES-256-GCM-OAuth-PKCE'),32));
}
function encrypt(s){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secretKey(),iv);
 const encrypted=Buffer.concat([cipher.update(s,'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),encrypted].map(x=>x.toString('base64url')).join('.');
}
function decrypt(s){
 const chunks=String(s||'').split('.');
 if(chunks.length!==3)throw Error('Encrypted token invalid');
 const [iv,tag,body]=chunks.map(x=>Buffer.from(x,'base64url'));
 const d=createDecipheriv('aes-256-gcm',secretKey(),iv);d.setAuthTag(tag);
 return Buffer.concat([d.update(body),d.final()]).toString('utf8');
}
function safeStatus(d){
 return {service:'trakt',username:d?.username||TRAKT_EXPECTED,
  profileUrl:d?.username?'https://trakt.tv/users/'+encodeURIComponent(d.username):
   'https://app.trakt.tv/profile/me',
  clientConfigured:!!d?.clientId,connected:!!d?.token&&!!d?.refreshToken,
  authorizedAt:d?.authorizedAt?.toDate?.()?.toISOString?.()||null,
  encryptionConfigured:(()=>{try{return secretKey().length===32}catch{return false}})(),
  note:'Trakt mutations require user OAuth approval. Only personal activity is read.'};
}
async function traktConnection(){
 const x=await doc('trakt').get();return safeStatus(x.exists?x.data():{});
}
async function lastfmConnection(){
 const x=await doc('lastfm').get(),d=x.exists?x.data():{};
 return {service:'lastfm',username:LASTFM_USER,profileUrl:'https://www.last.fm/user/'+LASTFM_USER,
  apiConfigured:!!d.apiKey,readOnly:true,
  note:'Official Last.fm API key needed for public listen data; no OAuth or edit privileges.'};
}
async function traktConfigure({clientId}={}){
 const id=clean(clientId,140);
 if(!/^[a-zA-Z0-9_-]{16,130}$/.test(id))throw Error('Invalid Trakt application Client ID');
 const snap=await doc('trakt').get(),data=snap.exists?snap.data():{};
 if(data.clientId&&data.clientId!==id&&data.token)throw Error('Disconnect existing Trakt authorization before changing app');
 await doc('trakt').set({...data,clientId:id,updatedAt:FieldValue.serverTimestamp()});
 return traktConnection();
}
async function lastfmConfigure({apiKey}={}){
 const key=clean(apiKey,100);
 if(!/^[a-zA-Z0-9]{24,64}$/.test(key))throw Error('Invalid Last.fm API key');
 await doc('lastfm').set({service:'lastfm',userName:LASTFM_USER,apiKey:key,
  updatedAt:FieldValue.serverTimestamp()});
 return lastfmConnection();
}
async function request(method,url,opts={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);
 try{
  const r=await fetch(url,{method,signal:controller.signal,headers:opts.headers||{},
   ...(opts.body?{body:JSON.stringify(opts.body)}:{})});
  const contentType=r.headers?.get?.('content-type')||'';
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
   // Trakt/Cloudflare sometimes returns an HTML 403, not JSON. Don't
   // echo HTML, OAuth codes, token values or request bodies to the UI.
   const isHtml=/text\/html/i.test(contentType);
   const detail=isHtml
    ?'Non-JSON upstream rejection; inspect Trakt API key, User-Agent or upstream access policy'
    :clean(data?.error_description||data?.error||data?.message||'upstream rejected request',140);
   throw Error((opts.provider||'External API')+' HTTP '+r.status+': '+detail);
  }
  return data;
 }finally{clearTimeout(timer)}
}
async function lastfmCall(method,params={}){
 const snap=await doc('lastfm').get(),apiKey=snap.data()?.apiKey;
 if(!apiKey)throw Error('Last.fm API key not yet connected');
 const q=new URLSearchParams({method,user:LASTFM_USER,api_key:apiKey,format:'json',...params});
 const x=await request('GET','https://ws.audioscrobbler.com/2.0/?'+q.toString(),{provider:'Last.fm'});
 if(x.error)throw Error('Last.fm API '+x.error+': '+clean(x.message,140));
 return x;
}
async function lastfmProfile({period='overall'}={}){
 if(!['overall','7day','1month','3month','6month','12month'].includes(period))throw Error('Invalid period');
 const [user,artists,tracks,recent,loved]=await Promise.all([
  lastfmCall('user.getinfo'),
  lastfmCall('user.gettopartists',{period,limit:'20'}),
  lastfmCall('user.gettoptracks',{period,limit:'20'}),
  lastfmCall('user.getrecenttracks',{limit:'20'}),
  lastfmCall('user.getlovedtracks',{limit:'20'})
 ]);
 return {service:'lastfm',username:LASTFM_USER,profileUrl:'https://www.last.fm/user/'+LASTFM_USER,
  playcount:Number(user.user?.playcount||0),
  topArtists:artists.topartists?.artist||[],topTracks:tracks.toptracks?.track||[],
  recentTracks:recent.recenttracks?.track||[],lovedTracks:loved.lovedtracks?.track||[],
  period,interpretation:'Playback frequency is listening behavior, not an explicit like. Loved tracks are explicit positive signals.'};
}
async function traktStart(){
 const snap=await doc('trakt').get(),d=snap.exists?snap.data():{};
 if(!d.clientId)throw Error('Please register Trakt Client ID');
 const state=randomBytes(24).toString('base64url');
 const verifier=randomBytes(48).toString('base64url');
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 await doc('trakt').set({...d,pending:{stateHash:createHash('sha256').update(state).digest('hex'),
  verifierEncrypted:encrypt(verifier),until:Date.now()+10*60*1000},
  updatedAt:FieldValue.serverTimestamp()});
 const u=new URL('https://auth.trakt.tv/oauth/authorize');
 for(const [key,value] of Object.entries({client_id:d.clientId,redirect_uri:TRAKT_CALLBACK,
  response_type:'code',state,code_challenge:challenge,code_challenge_method:'S256'}))
  u.searchParams.set(key,value);
 return {url:u.toString(),redirectUrl:TRAKT_CALLBACK};
}
async function traktToken(body){
 return request('POST','https://api.trakt.tv/oauth/token',{
  provider:'Trakt OAuth',
  // Trakt expects the same required application identity headers for OAuth
  // exchange/refresh as for ordinary API calls, not just Content-Type.
  headers:{'Content-Type':'application/json','Accept':'application/json',
   'User-Agent':TRAKT_USER_AGENT,'trakt-api-version':'2',
   'trakt-api-key':body.client_id},
  body});
}
function traktHeaders(d,token){return {'Content-Type':'application/json','Accept':'application/json',
 'User-Agent':TRAKT_USER_AGENT,'trakt-api-version':'2',
 'trakt-api-key':d.clientId,Authorization:'Bearer '+token};}
async function traktApi(method,path,body,override){
 const d=override?.data||await authData(),token=override?.token||decrypt(d.token);
 return request(method,'https://api.trakt.tv'+path,{
  provider:'Trakt',headers:traktHeaders(d,token),body});
}
async function traktFinish({code,state}={}){
 const c=clean(code,2000),s=clean(state,100);
 const snap=await doc('trakt').get(),d=snap.exists?snap.data():{},pending=d.pending;
 if(!/^[a-zA-Z0-9_-]{10,1800}$/.test(c)||!pending||pending.until<Date.now())throw Error('Trakt authorization is missing or expired; restart connection');
 const incoming=createHash('sha256').update(s).digest(),expected=Buffer.from(pending.stateHash,'hex');
 if(incoming.length!==expected.length||!timingSafeEqual(incoming,expected))throw Error('Trakt OAuth state mismatch');
 const exchanged=await traktToken({code:c,client_id:d.clientId,redirect_uri:TRAKT_CALLBACK,
  grant_type:'authorization_code',code_verifier:decrypt(pending.verifierEncrypted)});
 if(!exchanged.access_token||!exchanged.refresh_token)throw Error('Trakt returned incomplete token');
 const viewer=await traktApi('GET','/users/settings',null,{data:d,token:exchanged.access_token});
 const username=viewer.user?.username;
 if(!username)throw Error('Trakt account identity verification failed');
 if(d.username&&d.username!==username)throw Error('Connected Trakt account differs from saved account');
 // Do not keep the transient verifier, raw tokens or OAuth code.
 const {pending:_ignored,...rest}=d;
 await doc('trakt').set({...rest,username,
  token:encrypt(exchanged.access_token),refreshToken:encrypt(exchanged.refresh_token),
  expiresAt:(Number(exchanged.created_at)||Math.floor(Date.now()/1000))*1000+Number(exchanged.expires_in||604800)*1000,
  authorizedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
 return traktConnection();
}
let refreshInProgress=null;
async function authData(){
 const snap=await doc('trakt').get(),d=snap.exists?snap.data():{};
 if(!d.token||!d.refreshToken)throw Error('Trakt is not authorized; connect it in My Portal');
 if(d.expiresAt>Date.now()+90000)return d;
 if(!refreshInProgress){
  refreshInProgress=(async()=>{
   // A Trakt refresh token is single-use, so serialize refresh in this process.
   const current=(await doc('trakt').get()).data();
   if(current.expiresAt>Date.now()+90000)return current;
   const response=await traktToken({refresh_token:decrypt(current.refreshToken),
    client_id:current.clientId,redirect_uri:TRAKT_CALLBACK,grant_type:'refresh_token'});
   if(!response.access_token||!response.refresh_token)throw Error('Trakt refresh incomplete');
   const next={...current,token:encrypt(response.access_token),
    refreshToken:encrypt(response.refresh_token),expiresAt:
     (Number(response.created_at)||Math.floor(Date.now()/1000))*1000+Number(response.expires_in||604800)*1000,
    updatedAt:FieldValue.serverTimestamp()};
   await doc('trakt').set(next);return next;
  })().finally(()=>{refreshInProgress=null});
 }
 return refreshInProgress;
}
async function traktProfile({limit=80}={}){
 const d=await authData(),n=Math.max(1,Math.min(120,Number(limit)||80));
 const [watchlist,ratings,history]=await Promise.all([
  traktApi('GET','/sync/watchlist?limit='+n+'&page=1',null,{data:d}),
  traktApi('GET','/sync/ratings?limit='+n+'&page=1',null,{data:d}),
  traktApi('GET','/sync/history?limit='+n+'&page=1',null,{data:d})
 ]);
 return {service:'trakt',username:d.username,profileUrl:'https://trakt.tv/users/'+encodeURIComponent(d.username),
  watchlist:Array.isArray(watchlist)?watchlist:[],
  ratings:Array.isArray(ratings)?ratings:[],
  history:Array.isArray(history)?history:[],hasMorePossible:true,
  interpretation:'Watchlist is interest only, ratings are explicit scores, history is viewing (not necessarily liking)'};
}
async function traktAdd({kind,mediaType,traktId,rating,changeReason}={}){
 const k=clean(kind,20),type=clean(mediaType,10),id=Number(traktId),reason=clean(changeReason,350);
 if(!['watchlist','rating'].includes(k)||!['movie','show'].includes(type)||!Number.isSafeInteger(id)||id<=0)
  throw Error('Valid kind, mediaType and Trakt ID required');
 if(reason.length<5)throw Error('Specify the exact user request for this change');
 if(k==='rating'&&(!Number.isInteger(rating)||rating<1||rating>10))throw Error('Trakt rating must be 1 to 10');
 const media=type==='movie'?'movies':'shows';
 const data=await traktApi('POST',k==='watchlist'?'/sync/watchlist':'/sync/ratings',
  {[media]:[{ids:{trakt:id},...(k==='rating'?{rating}:{})}]});
 const count=data.added?.[media]??0;
 if(count<1)throw Error('Trakt did not confirm an added '+type+'; check whether item already exists');
 const verified=await traktApi('GET','/sync/'+(k==='rating'?'ratings':'watchlist')+'/'+media+'?limit=120&page=1');
 const matches=(Array.isArray(verified)?verified:[]).filter(e=>e[type]?.ids?.trakt===id);
 return {kind:k,mediaType:type,traktId:id,rating:k==='rating'?rating:undefined,
  added:count,visibleInFirstPage:matches.length>0,changeReason:reason,
  readback:matches[0]||null};
}

/** Strict live lookup. The client must explicitly inspect title/year/ID
 * before using a result for migration; no first-result auto-accept.
 */
async function traktMediaSearch({queries=[]}={}){
 if(!Array.isArray(queries)||queries.length<1||queries.length>10)
  throw Error('Supply 1..10 Trakt title queries');
 const output=[];
 for(const q of queries){
  const title=clean(q.title,160),type=clean(q.mediaType||'movie',10),year=q.year==null?null:Number(q.year);
  if(title.length<2||!['movie','show'].includes(type)||year!=null&&(!Number.isInteger(year)||year<1880||year>2100))
   throw Error('Valid media title/type/year required');
  const url='/search/'+type+'?query='+encodeURIComponent(title)+'&limit=8&page=1';
  const matches=await traktApi('GET',url);
  output.push({requested:{title,mediaType:type,year},candidates:
   (Array.isArray(matches)?matches:[]).slice(0,8).map(hit=>{
    const m=hit[type]||{};
    return {title:m.title,year:m.year,traktId:m.ids?.trakt,imdb:m.ids?.imdb||null,
     tmdb:m.ids?.tmdb||null,score:hit.score};
   }).filter(x=>Number.isSafeInteger(x.traktId))});
 }
 return {source:'Trakt official search API',results:output,
  warning:'A search hit is not proof of the same work. Check release year and original/translated title before writing. Reissues/remakes can collide.'};
}
async function traktFilmarksImport({items=[]}={}){
 if(!Array.isArray(items)||items.length<1||items.length>8)
  throw Error('Import 1..8 independently verified records per batch');
 const statusDoc=doc('filmarks-trakt-transfer'),snap=await statusDoc.get();
 let persisted=snap.exists?snap.data():{},entries={...(persisted.entries||{})};
 const results=[];
 for(const input of items){
  const title=clean(input.title,170),intent=clean(input.intent,15),
   type=clean(input.mediaType||'movie',10),id=Number(input.traktId),
   year=input.year==null?null:Number(input.year),rating=input.filmarksRating==null?null:Number(input.filmarksRating);
  if(title.length<2||!['watchlist','mark'].includes(intent)||!['movie','show'].includes(type)
   ||!Number.isSafeInteger(id)||id<=0||year!=null&&(!Number.isInteger(year)||year<1880||year>2100)
   ||intent==='mark'&&type!=='movie'||intent==='mark'&&(rating==null||rating<0.5||rating>5||Math.round(rating*10)!==rating*10))
   throw Error('Invalid Filmarks import item');
  const idempotencyKey=[intent,type,clean(input.filmarksId||title,150),year||''].join(':');
  if(entries[idempotencyKey]?.complete){
   results.push({title,intent,traktId:id,skipped:'already imported',complete:true});continue;
  }
  // Validate the Trakt ID refers to a film/show of the expected release year.
  const lookup=await traktApi('GET','/search/trakt/'+id+'?type='+type);
  const actual=(Array.isArray(lookup)?lookup[0]:null)?.[type];
  if(!actual||actual.ids?.trakt!==id||year!=null&&actual.year!==year){
   results.push({title,intent,traktId:id,complete:false,error:'Trakt ID/year did not verify',
    candidate:actual?{title:actual.title,year:actual.year}:null});continue;
  }
  const media=type==='movie'?'movies':'shows';
  const item={ids:{trakt:id}};
  try{
   let write;
   if(intent==='watchlist'){
    write=await traktApi('POST','/sync/watchlist',{[media]:[item]});
   }else{
    // Filmarks does not provide an actual viewed-at timestamp in its list
    // view. Trakt will assign import time; retain this limitation in log.
    const viewed=await traktApi('POST','/sync/history',{movies:[item]});
    if((viewed.added?.movies||0)<1)throw Error('Trakt did not accept viewed movie');
    const traktRating=Math.max(1,Math.min(10,Math.round(rating*2)));
    write=await traktApi('POST','/sync/ratings',{movies:[{...item,rating:traktRating}]});
    if((write.added?.movies||0)<1)throw Error('Trakt did not accept rating');
   }
   // Import might be retrying after a successful post but lost response;
   // zero-added means an existing item, not a failure.
   const all=await traktApi('GET',intent==='watchlist'
     ?'/sync/watchlist/'+media+'?limit=120&page=1'
     :'/sync/ratings/movies?limit=120&page=1');
   const record=(Array.isArray(all)?all:[]).find(x=>x[type]?.ids?.trakt===id);
   if(!record)throw Error('Trakt readback did not locate imported record');
   if(intent==='mark'){
    const wanted=Math.max(1,Math.min(10,Math.round(rating*2)));
    if(record.rating!==wanted)throw Error('Rating readback mismatch');
   }
   entries[idempotencyKey]={complete:true,intent,mediaType:type,title,
    source:'Filmarks @postmodern137',sourceId:clean(input.filmarksId||'',90),
    sourceYear:year,sourceRating:rating,
    traktId:id,traktTitle:actual.title,traktYear:actual.year,
    traktRating:intent==='mark'?Math.max(1,Math.min(10,Math.round(rating*2))):null,
    migratedAt:new Date().toISOString(),watchedAtNote:intent==='mark'
     ?'Trakt added import-time history; Filmarks actual watched date is unavailable':null};
   await statusDoc.set({...persisted,service:'filmarks-to-trakt',userName:'postmodern137',
     targetAccount:'__c4a362',entries,updatedAt:FieldValue.serverTimestamp()});
   results.push({title,intent,traktId:id,traktTitle:actual.title,traktYear:actual.year,
    rating:entries[idempotencyKey].traktRating||null,complete:true});
  }catch(e){results.push({title,intent,traktId:id,complete:false,error:clean(e.message,180)})}
 }
 return {source:'Filmarks @postmodern137',destination:'Trakt __c4a362',
  processed:items.length,completed:results.filter(x=>x.complete).length,
  results,notes:['Filmarks Clip is wishlisted (not liked). Filmarks Mark reflects watched + user score.',
   'Filmarks 5-point scores rounded to nearest Trakt 1–10 integer. Original score retained in migration audit.',
   'Actual watched date was not available; Trakt history records import time.']};
}
async function traktMediaSearch({queries}={}){
 if(!Array.isArray(queries)||queries.length<1||queries.length>10)throw Error('Pass 1..10 search queries');
 const out=[];
 for(const q of queries){
  const type=q.mediaType||'movie',title=clean(q.title,160),year=Number(q.year)||null;
  if(!['movie','show'].includes(type)||title.length<2)throw Error('Valid movie/show title required');
  const api=await traktApi('GET','/search/'+type+'?query='+encodeURIComponent(title)
   +(year?'&years='+year:'')+'&limit=12');
  out.push({query:q,results:(Array.isArray(api)?api:[]).map(x=>({
   title:x[type]?.title,year:x[type]?.year,traktId:x[type]?.ids?.trakt,
   imdbId:x[type]?.ids?.imdb||null,tmdbId:x[type]?.ids?.tmdb||null
  })).filter(x=>x.traktId)});
 }
 return {queries:out,interpretation:'Verify exact title/year before importing'};
}
async function traktFilmarksImport({items}={}){
 return require('./filmarksTraktMigration').importVerified({items});
}
// Incremental user-approved migration with per-item progress persisted in DB.
const filmarksList=()=>[]; // temporary build isolation
const filmDoc=()=>doc('filmarks-trakt-20261018');
function filmSlug(value){return String(value||'').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
async function filmarksImportReport(){
 const snap=await filmDoc().get(),rows=snap.exists?snap.data()?.rows||{}:{},source=filmarksList();
 const num=(state,kind)=>source.filter(v=>!kind||v.source===kind).filter(v=>(rows[v.id]?.status||'pending')===state).length;
 return {total:source.length,clips:44,marks:8,
  imported:num('imported'),unresolved:num('unresolved'),pending:num('pending'),errors:num('error'),
  watchlistImported:num('imported','clip'),ratingsImported:num('imported','mark'),
  rows:source.map(f=>({id:f.id,title:f.title,year:f.year,kind:f.source,originalScore:f.score??null,
   ...(rows[f.id]||{status:'pending'})})),
  note:'Filmarks is not changed. Marks transfer as ratings only: no guessed watched date.'};
}
async function filmResolve(f){
 const possible=new Map();
 for(const alias of f.aliases.slice(0,3)){
  const candidates=await traktApi('GET','/search/movie?query='+encodeURIComponent(alias)+'&years='+f.year+'&limit=12');
  for(const r of Array.isArray(candidates)?candidates:[]){
   const m=r.movie;
   if(m?.year!==f.year||!Number.isSafeInteger(m.ids?.trakt))continue;
   if(f.aliases.some(a=>filmSlug(a)===filmSlug(m.title)))
    possible.set(m.ids.trakt,{id:m.ids.trakt,title:m.title,year:m.year});
  }
  if(possible.size)break;
 }
 return possible.size===1?[...possible.values()][0]:null;
}
async function filmCheck(kind,id,rating){
 const key=kind==='clip'?'watchlist':'ratings';
 const result=await traktApi('GET','/sync/'+key+'/movies?limit=120&page=1');
 const record=(Array.isArray(result)?result:[]).find(x=>x.movie?.ids?.trakt===id);
 return !!record&&(rating==null||record.rating===rating);
}
let filmBatchBusy=false;
async function filmarksImportBatch({limit=3}={}){
 if(filmBatchBusy)throw Error('Migration already running');
 filmBatchBusy=true;
 try{
  await authData();
  const max=Math.min(5,Math.max(1,Number(limit)||3));
  const snap=await filmDoc().get(),rows=snap.exists?{...snap.data().rows}:{};
  const selection=filmarksList().filter(f=>!['imported','unresolved'].includes(rows[f.id]?.status)
   &&(rows[f.id]?.attempts||0)<3).slice(0,max);
  let processed=0;
  for(const f of selection){
   const attempts=(rows[f.id]?.attempts||0)+1;
   let result;
   try{
    const m=await filmResolve(f);
    if(!m)result={status:'unresolved',attempts,reason:'No unique exact title+year match'};
    else{
     const rating=f.source==='mark'?Math.round(f.score*2):null;
     const exists=await filmCheck(f.source,m.id,rating);
     if(!exists)await traktApi('POST',f.source==='mark'?'/sync/ratings':'/sync/watchlist',
      {movies:[{ids:{trakt:m.id},...(rating==null?{}:{rating})}]});
     if(!await filmCheck(f.source,m.id,rating))throw Error('Trakt readback failed');
     result={status:'imported',attempts,traktId:m.id,traktTitle:m.title,
      traktYear:m.year,originalScore:f.score??null,traktRating:rating,verified:true};
    }
   }catch(e){result={status:'error',attempts,reason:clean(e?.message,140)}}
   rows[f.id]=result;processed++;
   await filmDoc().set({service:'filmarks-trakt',source:'Filmarks @postmodern137',
     target:'Trakt',rows,updatedAt:FieldValue.serverTimestamp()});
   if(result.status==='error'&&/401|403|429|token|rate limit/i.test(result.reason))break;
  }
  return {...await filmarksImportReport(),processedThisCall:processed};
 }finally{filmBatchBusy=false}
}
module.exports={TRAKT_CALLBACK,LASTFM_USER,TRAKT_EXPECTED,
 lastfmConnection,lastfmConfigure,lastfmProfile,
 traktConnection,traktConfigure,traktStart,traktFinish,traktProfile,traktAdd,
 traktMediaSearch,traktFilmarksImport,
 filmarksImportReport,filmarksImportBatch,
 encrypt,decrypt,secretKey,traktApi,authData};
