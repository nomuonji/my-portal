'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=readFileSync(require('node:path').join(__dirname,'../functions/mediaAccountConnections.js'),'utf8');
function createHarness(reply){
 const stored=new Map();
 const firestore={collection:()=>({doc:id=>({
  async get(){return {exists:stored.has(id),data:()=>stored.get(id)}},
  async set(x){stored.set(id,x)}
 })})};
 const privateKey='-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(560)+'\n-----END PRIVATE KEY-----';
 const process={env:{FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({private_key:privateKey})}};
 const module={exports:{}};
 const fetch=async(url,options={})=>{
  const result=await reply(new URL(String(url)),options);
  return {ok:result.status===undefined||result.status<400,status:result.status||200,
   json:async()=>result.body||{}};
 };
 const ctx={module,exports:module.exports,process,Buffer,URL,URLSearchParams,
  setTimeout,clearTimeout,AbortController,Date,fetch,globalThis:{Netlify:null},
  require:n=>n==='node:crypto'?crypto:n==='./documentDb'
   ?{getDocumentDb:()=>firestore,FieldValue:{serverTimestamp:()=>new Date()}}:require(n)};
 vm.runInNewContext(source,ctx);
 return {api:module.exports,stored};
}
test('Last.fm requires API key and explicitly separates love from play count',async()=>{
 const {api}=createHarness(async(url)=>{
  const method=url.searchParams.get('method');
  assert.equal(url.searchParams.get('user'),'goodhangedman');
  assert.equal(url.searchParams.get('api_key'),'a'.repeat(32));
  if(method==='user.getinfo')return {body:{user:{playcount:'0'}}};
  return {body:({
   'user.gettopartists':{topartists:{artist:[]}},
   'user.gettoptracks':{toptracks:{track:[]}},
   'user.getrecenttracks':{recenttracks:{track:[]}},
   'user.getlovedtracks':{lovedtracks:{track:[]}}
  })[method]};
 });
 await assert.rejects(api.lastfmProfile(),/API key not yet connected/);
 await api.lastfmConfigure({apiKey:'a'.repeat(32)});
 const data=await api.lastfmProfile();
 assert.equal(data.playcount,0);
 assert.equal(data.lovedTracks.length,0);
 assert.ok(data.interpretation.includes('not an explicit like'));
});
test('Trakt generates S256 PKCE, checks state, exchanges authorized tokens and hides secrets',async()=>{
 let captured;
 const {api,stored}=createHarness(async(url,options)=>{
  if(url.pathname==='/oauth/token'){
   captured=JSON.parse(options.body);
   return {body:{access_token:'mock_access',refresh_token:'mock_refresh',
    expires_in:604800,created_at:Math.floor(Date.now()/1000)}};
  }
  if(url.pathname==='/users/settings')return {body:{user:{username:'__c4a362'}}};
  return {body:[]};
 });
 await api.traktConfigure({clientId:'a'.repeat(64)});
 const start=await api.traktStart(),u=new URL(start.url);
 assert.equal(u.hostname,'auth.trakt.tv');
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 const state=u.searchParams.get('state');
 await assert.rejects(api.traktFinish({state:'fake',code:'very_long_mock_auth_code'}),/state mismatch/);
 const result=await api.traktFinish({state,code:'very_long_mock_auth_code'});
 assert.equal(result.connected,true);
 assert.equal(result.username,'__c4a362');
 assert.equal(captured.grant_type,'authorization_code');
 assert.equal(crypto.createHash('sha256').update(captured.code_verifier).digest('base64url'),
  u.searchParams.get('code_challenge'));
 assert.equal(result.token,undefined);
 assert.ok(!JSON.stringify(result).includes('mock_access'));
 assert.ok(stored.get('trakt').token!== 'mock_access');
 assert.equal(stored.get('trakt').pending,undefined);
});
test('Trakt writes validate exact instruction and 1..10 rating before API call',async()=>{
 const {api}=createHarness(async()=>{throw Error('Should not call network')});
 await assert.rejects(api.traktAdd({kind:'rating',mediaType:'movie',traktId:42,rating:12,changeReason:'set personal rating'}),/1 to 10/);
 await assert.rejects(api.traktAdd({kind:'watchlist',mediaType:'movie',traktId:42,changeReason:''}),/user request/);
});
test('SPA nested Trakt redirect uses absolute assets',()=>{
 const manifest=JSON.parse(readFileSync(require('node:path').join(__dirname,'../package.json'),'utf8'));
 assert.equal(manifest.homepage,'/');
});
