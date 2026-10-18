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
module.exports={TRAKT_CALLBACK,LASTFM_USER,TRAKT_EXPECTED,
 lastfmConnection,lastfmConfigure,lastfmProfile,
 traktConnection,traktConfigure,traktStart,traktFinish,traktProfile,traktAdd,
 encrypt,decrypt,secretKey};
