'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const {readFileSync}=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const snapshot=require(path.join(root,'functions/filmarksTraktSnapshot.js'));
function harness(){
 const db=new Map(),watchlist=[],ratings=[],calls=[];
 const doc=id=>({async get(){return {exists:db.has(id),data:()=>db.get(id)}},async set(record){db.set(id,record)}});
 const traktApi=async(method,resource,body)=>{
  calls.push({method,resource});
  const u=new URL('https://api.trakt.tv'+resource);
  if(resource.startsWith('/search/movie')){
   const term=u.searchParams.get('query'),year=Number(u.searchParams.get('years'));
   if(/Sirat/i.test(term)&&year===2025)return [{movie:{title:'Sirât',year:2025,ids:{trakt:111,imdb:'tt10000001'}}}];
   if(/shall we dance/i.test(term)&&year===2004)return [
    {movie:{title:'Shall We Dance?',year:1996,ids:{trakt:222}}},
    {movie:{title:'Shall We Dance?',year:2004,ids:{trakt:333}}}];
   return [];
  }
  if(resource.startsWith('/movies/99'))return {title:'Drifting Clouds',year:1996};
  if(method==='GET'&&resource.startsWith('/sync/watchlist'))return watchlist;
  if(method==='GET'&&resource.startsWith('/sync/ratings'))return ratings;
  if(method==='POST'&&resource==='/sync/watchlist'){
   for(const m of body.movies)if(!watchlist.some(x=>x.movie.ids.trakt===m.ids.trakt))watchlist.push({movie:{ids:m.ids}});
   return {added:{movies:body.movies.length}};
  }
  if(method==='POST'&&resource==='/sync/ratings'){
   for(const m of body.movies){const at=ratings.findIndex(x=>x.movie.ids.trakt===m.ids.trakt);
    if(at>=0)ratings[at]={movie:{ids:m.ids},rating:m.rating};
    else ratings.push({movie:{ids:m.ids},rating:m.rating})}
   return {added:{movies:body.movies.length}};
  }
  throw Error('Unexpected '+method+' '+resource);
 };
 const source=readFileSync(path.join(root,'functions/filmarksTraktMigration.js'),'utf8');
 const module={exports:{}},ctx={
  module,exports:module.exports,Date,Number,String,URL,encodeURIComponent,console,Set,
  require:n=>n==='./documentDb'?{getDocumentDb:()=>({collection:()=>({doc})}),
   FieldValue:{serverTimestamp:()=>new Date()}}:
   n==='./filmarksTraktSnapshot'?snapshot:
   n==='./mediaAccountConnections'?{traktApi,authData:async()=>({username:'__c4a362'})}:require(n)
 };
 vm.runInNewContext(source,ctx,{filename:'filmarksTraktMigration.js'});
 return {...module.exports,db,calls,watchlist,ratings};
}
test('User Filmarks snapshot is 44 clips + 8 personal ratings and disambiguates distinct films',()=>{
 assert.equal(snapshot.clips.length,44);
 assert.equal(snapshot.marks.length,8);
 assert.equal(snapshot.items().length,52);
 const naked=snapshot.items().filter(x=>x.title==='裸の銃を持つ男');
 assert.deepEqual(naked.map(x=>x.year),[1988,2025]);
 assert.equal(snapshot.items().find(x=>x.title==='浮雲').year,1955);
 assert.equal(snapshot.items().find(x=>x.title==='浮き雲').year,1996);
 assert.equal(snapshot.items().find(x=>x.title==='浮き雲').score,5);
});
test('Batch transfer exact title/year only; skips 1996 remake result for 2004 film',async()=>{
 const t=harness();
 const one=await t.importBatch({limit:2});
 assert.equal(one.imported,2);
 assert.equal(one.watchlistImported,2);
 assert.equal(one.ratingsImported,0);
 assert.deepEqual([...t.watchlist].map(x=>x.movie.ids.trakt),[111,333]);
 assert.equal(t.calls.filter(x=>x.method==='POST').length,2);
 const again=await t.report();
 assert.equal(again.imported,2);
 const zeroRisk=await t.importBatch({limit:1});
 assert.equal(zeroRisk.imported,2); // Third film unresolved by mocked API; no extra write.
 assert.equal(zeroRisk.unresolved,1);
});
test('Verified personal 5.0 rating transfers as 10/10 and source score remains in the audit',async()=>{
 const t=harness();
 const x=await t.importVerified({items:[{title:'浮き雲',intent:'mark',year:1996,traktId:99,filmarksRating:5}]});
 assert.equal(x.summary.ratingsImported,1);
 assert.equal(t.ratings[0].rating,10);
 const r=await t.report(),item=r.results.find(z=>z.title==='浮き雲');
 assert.equal(item.filmarksScore,5);
 assert.equal(item.traktRating,10);
 assert.equal(r.watchedHistoryImported,0);
 assert.match(r.policy,/No fictional watched_at/);
});
test('Never use a fake 1996 Drifting Clouds ID for 1955 Floating Clouds watchlist',async()=>{
 const t=harness();
 const result=await t.importVerified({items:[{title:'浮雲',intent:'watchlist',year:1955,traktId:99}]});
 assert.equal(result.responses[0].state,'unresolved');
 assert.equal(t.watchlist.length,0);
});
