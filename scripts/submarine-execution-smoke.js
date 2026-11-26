'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createStore,AMD_URL,COLLECTIONS}=require('../functions/submarineExecutionStore');
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
class DB {
  constructor(){this.map=new Map();this.queue=Promise.resolve();}
  collection(path){
    const db=this;
    function query(filters=[]){return {doc:id=>({path:path+'/'+id,get:async()=>snapshot(path+'/'+id)}),where:(k,op,v)=>query([...filters,[k,v]]),get:async()=>({docs:[...db.map].filter(([k,v])=>k.startsWith(path+'/')&&filters.every(([f,x])=>v[f]===x)).map(([k])=>snapshot(k))})};}
    function snapshot(key){const value=clone(db.map.get(key));return {exists:value!==undefined,data:()=>value};}
    return query();
  }
  runTransaction(fn){
    const next=this.queue.then(async()=>{const writes=[];const result=await fn({get:r=>r.get(),set:(r,v)=>writes.push([r.path,clone(v)])});for(const [k,v] of writes)this.map.set(k,v);return result;});
    this.queue=next.catch(()=>{});return next;
  }
}
const specimen={submarineId:'viral-post',baseId:'viral-post-method-discovery',variantKey:'V01',body:'完整な制作方法。通常の依頼を完成させる。',modules:[{skillId:'test-skill',revision:7,stage:'voice',body:'固定された専門スキル'}],cardIds:['SECRET_HYPOTHESIS'],expectedRevision:0,confirm:true};
const source={url:'https://example.org/public',excerpt:'public material',retrievedAt:'2026-11-26T00:00:00.000Z'};
function setup(overrides={}){
 const db=new DB();db.map.set('submarines/viral-post',{status:'active',loadout:[{train:false,dojoId:specimen.baseId}],openSortieId:null});
 const calls=[];const cfg={configured:true,key:'server-only-secret',model:'amd-test-model',dailyCallLimit:2};
 const store=createStore({getDb:()=>db,config:()=>cfg,fetch:async(url,request)=>{calls.push({url,request:JSON.parse(request.body)});return {ok:true,json:async()=>({id:'receipt-1',model:'actual-model',choices:[{message:{content:'original prototype'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}})};},...overrides});
 const run=(versionId,key,more={})=>({submarineId:specimen.submarineId,versionId,requestKey:key,task:'普通の投稿を1本作成',sources:[source],confirm:true,confirmExternalProcessing:true,...more});
 return {db,calls,store,run,cfg};
}
test('native immutable versions and unchanged imports; production release remains untouched',async()=>{
 const {store,db}=setup();const a=await store.register(specimen);const same=await store.register(specimen);
 assert.equal(a.id,same.id);assert.equal(same.unchanged,true);
 await assert.rejects(store.register({...specimen,body:'changed'}),/revision conflict/);
 const b=await store.register({...specimen,body:'changed',expectedRevision:1,parentVersionId:a.id});
 assert.equal(b.revision,2);assert.equal((await store.get({versionId:a.id})).body,specimen.body);
 assert.equal((await store.get({versionId:b.id})).body,'changed');
 assert.equal(db.map.get('submarines/viral-post').loadout[0].train,false);
});
test('AMD invocation sends frozen body only, persists actual output, and never repeats a request',async()=>{
 const {store,calls,run}=setup();const v=await store.register(specimen);
 const result=await store.execute(run(v.id,'one'));assert.equal(result.run.status,'completed');
 assert.equal(result.run.actualModel,'actual-model');assert.equal(result.run.body,'original prototype');assert.equal(result.run.usage.totalTokens,14);
 assert.equal(calls.length,1);assert.equal(calls[0].url,AMD_URL);
 const prompt=JSON.stringify(calls[0].request.messages);assert.match(prompt,/固定された専門スキル/);assert.doesNotMatch(prompt,/SECRET_HYPOTHESIS|server-only-secret/);
 const again=await store.execute(run(v.id,'one'));assert.equal(again.replayed,true);assert.equal(calls.length,1);
 await assert.rejects(store.execute(run(v.id,'one',{task:'different'})),/requestKey/);
 await store.execute(run(v.id,'two'));await assert.rejects(store.execute(run(v.id,'three')),/daily call cap/);
 assert.equal(calls.length,2);
 const harvested=await store.harvest({runId:result.run.id,note:'counterexample',confirm:true});
 assert.equal(harvested.body,result.run.body);assert.equal(harvested.harvestStatus,'harvested');assert.equal(harvested.verdict,undefined);
});
test('execution refuses private/invalid request, legacy sortie, and concurrent agent lease',async()=>{
 const {store,db,calls,run}=setup();const v=await store.register(specimen);
 await assert.rejects(store.execute(run(v.id,'no',{confirmExternalProcessing:false})),/not confirmed/);
 await assert.rejects(store.execute(run(v.id,'bad',{sources:[{...source,url:'http://localhost'}]})),/public HTTPS/);
 db.map.get('submarines/viral-post').openSortieId='S-001';
 await assert.rejects(store.execute(run(v.id,'busy')),/legacy sortie/);
 db.map.get('submarines/viral-post').openSortieId=null;
 const prepared=await store.prepare(run(v.id,'agent'));
 assert.ok(prepared.executionInput.system.includes(specimen.body));assert.ok(!prepared.executionInput.system.includes('SECRET_HYPOTHESIS'));
 await assert.rejects(store.execute(run(v.id,'other')),/already at sea/);
 await assert.rejects(store.record({runId:prepared.runId,leaseToken:'wrong',body:'text',actualModel:'ChatGPT'}),/lease mismatch/);
 await store.record({runId:prepared.runId,leaseToken:prepared.leaseToken,body:'agent text',actualModel:'ChatGPT'});
 await store.execute(run(v.id,'after'));assert.equal(calls.length,1);
});
test('provider failure is recorded without leaking response; no retry and partial is not success',async()=>{
 let calls=0;
 const {store,run}=setup({fetch:async()=>{calls++;return calls===1?{ok:false,status:429}:{ok:true,json:async()=>({model:'actual',choices:[{message:{content:'truncated'},finish_reason:'length'}]})};}});
 const v=await store.register(specimen);
 const a=await store.execute(run(v.id,'failed'));assert.equal(a.run.status,'failed');assert.equal(a.run.error,'AMD HTTP 429');
 await store.execute(run(v.id,'failed'));assert.equal(calls,1);
 const b=await store.execute(run(v.id,'partial'));assert.equal(b.run.status,'partial');assert.equal(b.run.body,'truncated');
});
test('legacy immutable pool migration resolves exact module versions and preserves history',async()=>{
 const pool='pool',pv='pool__v000001',vo='variant',vv='variant__v000001',dep='dep',dv='dep__v000001';
 const data={
 [pool]:{item:{type:'dojo_submarine_variant_pool',currentVersionId:pv,metadata:{status:'active_pool',submarineId:specimen.submarineId,baseId:specimen.baseId,roster:[{status:'ready',key:'V01',outputId:vo,versionId:vv}]}},versions:[{id:pv,content:'manifest '+vv}]},
 [vo]:{item:{type:'dojo_submarine_skill_variant',currentVersionId:vv,metadata:{researchOnly:true,submarineId:specimen.submarineId,baseId:specimen.baseId,variantKey:'V01',cardIds:specimen.cardIds,dependencySnapshots:[{id:dep,versionId:dv}],activeModules:[{skillId:'test-skill',revision:7,stage:'voice'}]}},versions:[{id:vv,content:specimen.body}]},
 [dep]:{item:{type:'dojo_submarine_skill_dependency_snapshot',metadata:{submarineId:specimen.submarineId,baseId:specimen.baseId}},versions:[{id:dv,content:JSON.stringify(specimen.modules)}]}
 };
 const {store}=setup({outputs:{get:async({id})=>clone(data[id])}});
 const args={poolOutputId:pool,poolVersionId:pv,confirm:true};
 const a=await store.importPool(args);const b=await store.importPool(args);
 assert.equal(a.imported.length,1);assert.equal(b.imported[0].unchanged,true);assert.deepEqual((await store.get({versionId:a.imported[0].id})).modules,specimen.modules);
});
