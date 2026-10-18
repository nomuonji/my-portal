'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const path=require('node:path');
const raw=readFileSync(path.join(__dirname,'../functions/mediaAccountConnections.js'),'utf8');
const filmSnapshot=require('../functions/filmarksTraktSnapshot');
function fixture(){
 const stored=new Map(),watch=[],ratings=[],writes=[];
 const db={collection:()=>({doc:id=>({async get(){
  return {exists:stored.has(id),data:()=>stored.get(id)};
 },async set(v){stored.set(id,v)}})})};
 const privateKey='-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(560)+'\n-----END PRIVATE KEY-----';
 const process={env:{FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({private_key:privateKey})}};
 const fetch=async(url,opts={})=>{
  const u=new URL(String(url)),method=opts.method||'GET';
  let body={};
  if(u.pathname==='/search/movie'){
   const q=u.searchParams.get('query')||'',year=Number(u.searchParams.get('years'));
   body=q.toLowerCase().includes('sirat')&&year===2025
    ?[{movie:{title:'Sirât',year:2025,ids:{trakt:111}}}]:
    q.toLowerCase().includes('shall we dance')&&year===2004
    ?[{movie:{title:'Shall We Dance?',year:1996,ids:{trakt:222}}},
      {movie:{title:'Shall We Dance?',year:2004,ids:{trakt:333}}}]:[];
  }else if(u.pathname==='/sync/watchlist/movies')body=watch;
  else if(u.pathname==='/sync/ratings/movies')body=ratings;
  else if(u.pathname==='/sync/watchlist'&&method==='POST'){
   const a=JSON.parse(opts.body).movies;
   for(const item of a)watch.push({movie:{ids:item.ids}});
   writes.push({kind:'clip',items:a});body={added:{movies:a.length}};
  }else if(u.pathname==='/sync/ratings'&&method==='POST'){
   const a=JSON.parse(opts.body).movies;
   for(const item of a)ratings.push({movie:{ids:item.ids},rating:item.rating});
   writes.push({kind:'mark',items:a});body={added:{movies:a.length}};
  }else throw Error('Unexpected fetch '+u.pathname);
  return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>body};
 };
 const module={exports:{}},sandbox={module,exports:module.exports,process,
  Buffer,URL,URLSearchParams,Date,Number,setTimeout,clearTimeout,AbortController,fetch,
  globalThis:{Netlify:null},
  require:n=>n==='node:crypto'?crypto:n==='./documentDb'
   ?{getDocumentDb:()=>db,FieldValue:{serverTimestamp:()=>new Date()}}:
    n==='./filmarksTraktSnapshot'?filmSnapshot:require(n)};
 vm.runInNewContext(raw,sandbox,{filename:'mediaAccountConnections.js'});
 const api=module.exports;
 stored.set('trakt',{clientId:'a'.repeat(64),token:api.encrypt('fake_access'),
  refreshToken:api.encrypt('fake_refresh'),username:'__c4a362',expiresAt:Date.now()+7200000});
 return {api,stored,watch,ratings,writes};
}
test('Only 44 clips and 8 marks and correct remake disambiguation',()=>{
 assert.equal(filmSnapshot.items().length,52);
 assert.equal(filmSnapshot.clips.length,44);
 assert.equal(filmSnapshot.marks.length,8);
 assert.equal(filmSnapshot.items().find(x=>x.title==='浮雲').year,1955);
 assert.equal(filmSnapshot.items().find(x=>x.title==='浮き雲').year,1996);
 assert.equal(filmSnapshot.items().filter(x=>x.title==='裸の銃を持つ男').length,2);
});
test('Exact title + year imported, independent Trakt readback, idempotency',async()=>{
 const t=fixture();
 const a=await t.api.filmarksImportBatch({limit:2});
 assert.equal(a.imported,2);
 assert.equal(a.watchlistImported,2);
 assert.equal(a.unresolved,0);
 assert.equal(a.pending,50);
 assert.equal(t.watch.length,2);
 assert.equal(t.watch[0].movie.ids.trakt,111);
 assert.equal(t.watch[1].movie.ids.trakt,333);
 assert.equal(t.writes.length,2);
 const b=await t.api.filmarksImportReport();
 assert.equal(b.imported,2);
 assert.equal(t.stored.get('filmarks-trakt-20261018').rows['clip-01'].verified,true);
 const c=await t.api.filmarksImportBatch({limit:1});
 assert.equal(c.unresolved,1);
 assert.equal(t.writes.length,2);
});
