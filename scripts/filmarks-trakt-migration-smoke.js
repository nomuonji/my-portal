'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),path=require('node:path');
const snapshot=require('../functions/filmarksTraktSnapshot');
function fixture(){
 let source=readFileSync(path.join(__dirname,'../functions/mediaAccountConnections.js'),'utf8');
 const db=new Map(),watch=[],calls=[];
 const mock=async(method,uri,payload)=>{
  calls.push({method,uri});
  const u=new URL('https://api.trakt.tv'+uri);
  if(u.pathname==='/search/movie'){
   const q=(u.searchParams.get('query')||'').toLowerCase(),year=Number(u.searchParams.get('years'));
   if(q.includes('sirat')&&year===2025)return [{movie:{title:'Sirât',year:2025,ids:{trakt:111}}}];
   if(q.includes('shall we dance')&&year===2004)return [
    {movie:{title:'Shall We Dance?',year:1996,ids:{trakt:222}}},
    {movie:{title:'Shall We Dance?',year:2004,ids:{trakt:333}}}];
   return [];
  }
  if(method==='GET'&&u.pathname==='/sync/watchlist/movies')return watch;
  if(method==='GET'&&u.pathname==='/sync/ratings/movies')return [];
  if(method==='POST'&&u.pathname==='/sync/watchlist'){
   for(const v of payload.movies)watch.push({movie:{ids:v.ids}});
   return {added:{movies:payload.movies.length}};
  }
  throw Error('unexpected mocked path '+uri);
 };
 function substitute(first,last,replacement){
  const start=source.indexOf(first),end=source.indexOf(last,start);
  assert.ok(start>0&&end>start,'Function anchors must remain stable');
  source=source.slice(0,start)+replacement+'\n'+source.slice(end);
 }
 // Fully test the real migration engine against a fake authenticated official
 // API: no OAuth tokens, secrets or remote network access are required.
 substitute('async function traktApi(','async function traktFinish(',
  'async function traktApi(method,path,body){return mockApi(method,path,body)}');
 substitute('async function authData(','async function traktProfile(',
  'async function authData(){return {username:"__c4a362"}}');
 const module={exports:{}},requireShim=name=>{
  if(name==='node:crypto')return {};
  if(name==='./filmarksTraktSnapshot')return snapshot;
  if(name==='./documentDb')return {getDocumentDb:()=>({collection:()=>({
   doc:id=>({get:async()=>({exists:db.has(id),data:()=>db.get(id)}),
    set:async v=>db.set(id,v)})
  })}),FieldValue:{serverTimestamp:()=>new Date()}};
  throw Error('Unexpected dependency '+name);
 };
 new Function('module','require','mockApi',source)(module,requireShim,mock);
 return {api:module.exports,db,watch,calls};
}
test('Source snapshot contains 44 Clips, 8 Marks, and distinct film years',()=>{
 assert.equal(snapshot.clips.length,44);assert.equal(snapshot.marks.length,8);
 assert.equal(snapshot.items().length,52);
 assert.equal(snapshot.items().find(v=>v.title==='浮雲').year,1955);
 assert.equal(snapshot.items().find(v=>v.title==='浮き雲').year,1996);
});
test('Importer transfers only exact canonical title and year with readback',async()=>{
 const f=fixture();
 const first=await f.api.filmarksImportBatch({limit:2});
 assert.equal(first.imported,2);
 assert.equal(first.pending,50);
 assert.deepEqual(f.watch.map(v=>v.movie.ids.trakt),[111,333]);
 assert.equal(f.calls.filter(v=>v.method==='POST').length,2);
 assert.equal(f.db.get('filmarks-trakt-20261018').rows['clip-01'].verified,true);
 const next=await f.api.filmarksImportBatch({limit:1});
 assert.equal(next.unresolved,1);
 assert.equal(next.imported,2);
 assert.equal(f.calls.filter(v=>v.method==='POST').length,2);
});
