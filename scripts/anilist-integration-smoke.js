'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=readFileSync(require('node:path').join(__dirname,'../functions/anilistIntegration.js'),'utf8');
function makeDb(){
 const stored=new Map();
 const col={doc:id=>({
  async get(){return {exists:stored.has(id),data:()=>stored.get(id)}},
  async set(data){stored.set(id,data)}
 })};
 return {collection:()=>col};
}
function load(fetch,vars={ANILIST_TOKEN_ENCRYPTION_KEY:'a'.repeat(64)}){
 const process={env:vars};
 const module={exports:{}},db=makeDb();
 const sandbox={module,exports:module.exports,process,Buffer,fetch,URL,AbortController,Date,Number,
  setTimeout,clearTimeout,globalThis:{Netlify:null},
  require:name=>name==='node:crypto'?crypto:name==='./documentDb'
   ?{getDocumentDb:()=>db,FieldValue:{serverTimestamp:()=>new Date()}}:require(name)};
 vm.runInNewContext(source,sandbox,{filename:'anilistIntegration.js'});
 return module.exports;
}
test('Public list preserves status separately from owner score, and deduplicates custom lists',async()=>{
 const api=load(async(url,req)=>{
  const {query,variables}=JSON.parse(req.body);
  let data;
  if(query.includes('User(name:'))data={User:{id:42,name:'topgear'}};
  else if(variables?.type==='ANIME')data={MediaListCollection:{lists:[
   {name:'Watching',entries:[{id:11,mediaId:1,status:'PLANNING',score:0,updatedAt:5,
    media:{id:1,type:'ANIME',title:{userPreferred:'Sample'},genres:[],tags:[],siteUrl:'https://anilist.co/anime/1'}}]},
   {name:'Custom',entries:[{id:11,mediaId:1,status:'PLANNING',score:0,updatedAt:5,
    media:{id:1,type:'ANIME',title:{userPreferred:'Sample'},genres:[],tags:[],siteUrl:'https://anilist.co/anime/1'}}]}]}};
  else data={MediaListCollection:{lists:[]}};
  return {ok:true,status:200,json:async()=>({data})};
 });
 const profile=await api.profile();
 assert.equal(profile.sources[0].count,1);
 assert.equal(profile.sources[0].entries[0].status,'PLANNING');
 assert.equal(profile.sources[0].byStatus.PLANNING,1);
 assert.equal(profile.sources[1].count,0);
});
test('Connection never discloses token or secret and requires the correct viewer',async()=>{
 let viewer='another';
 const api=load(async(url,req)=>({ok:true,status:200,json:async()=>({
  data:{Viewer:{id:77,name:viewer}}
 })}));
 await api.configure({clientId:'1234'});
 const token=[
  Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url'),
  Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),
  'a'.repeat(150)
 ].join('.');
 await assert.rejects(api.authorize({token}),/different AniList user/);
 viewer='topgear';
 const connection=await api.authorize({token});
 assert.equal(connection.connected,true);
 assert.equal(Object.prototype.hasOwnProperty.call(connection,'tokenEncrypted'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(connection,'clientSecret'),false);
});
test('Mutations reject missing user reason and invalid score before any write',async()=>{
 const api=load(async()=>{throw Error('network should not be called')});
 await assert.rejects(api.save({mediaId:7,status:'COMPLETED',changeReason:''}),/explicit user instruction/);
 await assert.rejects(api.save({mediaId:7,score:105,changeReason:'Set my score'}),/0..100/);
 await assert.rejects(api.save({mediaId:7,status:'UNKNOWN',changeReason:'Change my status'}),/Invalid status/);
});

test('Production server credential can derive a separate AES key without dedicated env',async()=>{
 const privateKey='-----BEGIN PRIVATE KEY-----\\n'+'A'.repeat(600)+'\\n-----END PRIVATE KEY-----';
 const vars={FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({private_key:privateKey})};
 const api=load(async()=>{throw Error('No API call necessary')},vars);
 const conn=await api.connection();
 assert.equal(conn.encryptionConfigured,true);
 const ciphertext=api.encrypt('sensitive-fake-oauth-token');
 assert.equal(api.decrypt(ciphertext),'sensitive-fake-oauth-token');
 assert.equal(Object.prototype.hasOwnProperty.call(conn,'tokenEncrypted'),false);
 assert.equal(JSON.stringify(conn).includes('PRIVATE KEY'),false);
 const changed=load(async()=>{throw Error('No API call necessary')},{
  FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({private_key:privateKey.replace('A'.repeat(600),'B'.repeat(600))})});
 assert.throws(()=>changed.decrypt(ciphertext));
});
test('UI reports disabled when no server-side credential is available',async()=>{
 const api=load(async()=>{throw Error('No network required')},{});
 assert.equal((await api.connection()).encryptionConfigured,false);
 assert.throws(()=>api.encrypt('x'),/not configured/);
});
