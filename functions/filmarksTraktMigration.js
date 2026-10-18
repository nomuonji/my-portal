'use strict';
/* One-time, user-requested Filmarks -> Trakt transfer, guarded by source/year
 * matching and a persistent per-title readback ledger.
 * Filmarks data are a frozen, user-owned personal-list snapshot; never scraped
 * or changed in this function. Trakt searches/writes use official owner OAuth.
 */
const {getDocumentDb,FieldValue}=require('./documentDb');
const {items}=require('./filmarksTraktSnapshot');
const {traktApi,authData}=require('./mediaAccountConnections');
const MIGRATION_ID='filmarks-trakt-20261018';
const FILES=['https://filmarks.com/users/postmodern137/clips',
 'https://filmarks.com/users/postmodern137/clips?page=2',
 'https://filmarks.com/users/postmodern137'];
const doc=()=>getDocumentDb('(default)').collection('personalTasteConnections').doc(MIGRATION_ID);
const normalize=s=>String(s||'').normalize('NFKD').toLowerCase()
 .replace(/\p{M}/gu,'').replace(/[\u2018\u2019]/g,"'")
 .replace(/[^\p{L}\p{N}]/gu,'');
const safeError=x=>String(x?.message||x).replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]')
 .slice(0,240);
async function state(){
 const snap=await doc().get(),r=snap.exists?snap.data():{};
 return {items:r.items||{},startedAt:r.startedAt||null,updatedAt:r.updatedAt||null};
}
function statusSummary(results){
 const list=items(),statuses=list.map(i=>results[i.id]?.state||'pending');
 return {total:list.length,clips:44,marks:8,
  imported:statuses.filter(s=>s==='imported').length,
  unresolved:statuses.filter(s=>s==='unresolved').length,
  pending:statuses.filter(s=>s==='pending').length,
  errors:statuses.filter(s=>s==='error').length,
  watchlistImported:list.filter(i=>i.source==='clip'&&results[i.id]?.state==='imported').length,
  ratingsImported:list.filter(i=>i.source==='mark'&&results[i.id]?.state==='imported').length,
  watchedHistoryImported:0};
}
async function report(){
 const s=await state();
 return {migrationId:MIGRATION_ID,source:FILES,sourceOwner:'postmodern137',
  destination:'Trakt / authenticated owner account',...statusSummary(s.items),
  results:items().map(i=>({id:i.id,source:i.source,title:i.title,year:i.year,
   filmarksScore:i.source==='mark'?i.score:undefined,
   traktRating:i.source==='mark'?Math.round(i.score*2):undefined,
   ...(s.items[i.id]||{state:'pending'})})),
  policy:'Only exact normalized international title and exact production year. No guessed matches. Ratings preserve original Filmarks 0-5 decimal in audit; Trakt uses rounded 1-10. No fictional watched_at is assigned, so 8 reviewed entries are rated but watched history remains pending an actual watched date.',
  sourceAccessible:'public user list; snapshot verified 2026-10-18'};
}
async function searchOne(film){
 const matched=[];
 for(const alias of film.aliases.slice(0,3)){
  const path='/search/movie?query='+encodeURIComponent(alias)+'&years='+film.year+'&limit=15';
  const results=await traktApi('GET',path);
  for(const result of Array.isArray(results)?results:[]){
   const m=result.movie||{},id=m.ids?.trakt;
   if(!Number.isSafeInteger(id)||m.year!==film.year)continue;
   if(film.aliases.some(candidate=>normalize(candidate)===normalize(m.title))
    && !matched.some(x=>x.id===id))matched.push({id,title:m.title,year:m.year,
    imdb:m.ids?.imdb||null,tmdb:m.ids?.tmdb||null,confidence:'exact-title-year'});
  }
  if(matched.length)break;
 }
 return matched.length===1?{match:matched[0]}:
  {reason:matched.length>1?'multiple-exact-matches':'no-exact-title-year-match'};
}
async function readback(kind){
 const part=kind==='clip'?'watchlist':'ratings';
 const all=await traktApi('GET','/sync/'+part+'/movies?limit=120&page=1');
 return Array.isArray(all)?all:[];
}
async function transferSingle(film,match){
 const kind=film.source;
 const path=kind==='clip'?'/sync/watchlist':'/sync/ratings';
 const rating=kind==='mark'?Math.round(film.score*2):null;
 const existed=await readback(kind);
 const found=existed.find(e=>e.movie?.ids?.trakt===match.id);
 if(found&& (kind==='clip'||found.rating===rating))
  return {state:'imported',traktId:match.id,traktTitle:match.title,
   traktYear:match.year,alreadyPresent:true,rating:rating||undefined,
   observedInTrakt:true};
 const payload={movies:[{ids:{trakt:match.id},...(rating!==null?{rating}:{})}]};
 await traktApi('POST',path,payload);
 const check=await readback(kind);
 const after=check.find(e=>e.movie?.ids?.trakt===match.id);
 if(!after||(kind==='mark'&&after.rating!==rating))
  throw Error('Trakt write not verified on first page; do not claim imported');
 return {state:'imported',traktId:match.id,traktTitle:match.title,
  traktYear:match.year,rating:rating||undefined,alreadyPresent:false,
  observedInTrakt:true};
}
let active=false;
async function importBatch({limit=4}={}){
 if(active)throw Error('Import already running in this process');
 active=true;
 try{
  const max=Math.min(6,Math.max(1,Number(limit)||4));
  // Fail before recording any success if owner OAuth unavailable.
  await authData();
  const source=items(),dbState=await state(),results={...dbState.items};
  const chosen=source.filter(x=>!['imported','unresolved'].includes(results[x.id]?.state)
   && (results[x.id]?.attempts||0)<3).slice(0,max);
  for(const film of chosen){
   const attempts=(results[film.id]?.attempts||0)+1;
   try{
    const found=results[film.id]?.traktId
     ?{match:{id:results[film.id].traktId,title:results[film.id].traktTitle,year:film.year}}
     :await searchOne(film);
    if(!found.match){
     results[film.id]={state:'unresolved',attempts,reason:found.reason};
    }else{
     const x=await transferSingle(film,found.match);
     results[film.id]={...x,attempts};
    }
   }catch(error){
    results[film.id]={...(results[film.id]||{}),state:'error',attempts,
     error:safeError(error)};
    // Fail closed on authorization or rate limit; avoid a retry storm.
    if(/429|401|403|token|OAuth|rate limit/i.test(safeError(error)))break;
   }
   // Checkpoint after each item; lost invocation can safely retry.
   await doc().set({sourceVersion:1,sourceOwner:'postmodern137',destination:'trakt',
    startedAt:dbState.startedAt||new Date().toISOString(),
    updatedAt:FieldValue.serverTimestamp(),items:results});
  }
  const rep=await report();
  return {...rep,processedThisCall:chosen.length};
 }finally{active=false}
}
module.exports={report,importBatch,normalize,searchOne};
