'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createStore}=require('../functions/explorationBaseStore');
class Snapshot {
  constructor(id,value){this.id=id;this.value=value;this.exists=value!==undefined;}
  data(){return this.exists?structuredClone(this.value):undefined;}
}
class Ref {
  constructor(db,path,id){this.db=db;this.path=path;this.id=id;}
  async get(){return new Snapshot(this.id,this.db.records.get(this.path+'/'+this.id));}
}
class Collection {
  constructor(db,path,filter=[],limit=1000){this.db=db;this.path=path;this.filter=filter;this.max=limit;}
  doc(id){return new Ref(this.db,this.path,id);}
  where(field,op,value){return new Collection(this.db,this.path,[...this.filter,{field,value}],this.max);}
  limit(max){return new Collection(this.db,this.path,this.filter,max);}
  async get(){const docs=[...this.db.records.entries()].filter(([k])=>k.startsWith(this.path+'/'))
    .filter(([,v])=>this.filter.every(x=>v[x.field]===x.value))
    .slice(0,this.max).map(([k,v])=>new Snapshot(k.slice(this.path.length+1),v));
    return {docs,size:docs.length};}
}
class MemoryDb {
  constructor(){this.records=new Map();}
  collection(name){return new Collection(this,name);}
  async runTransaction(fn){const writes=[];const tx={get:r=>r.get(),set:(r,v)=>writes.push([r.path+'/'+r.id,structuredClone(v)])};
    const result=await fn(tx);for(const [k,v]of writes)this.records.set(k,v);return result;}
}
async function setup({withSub=false}={}){
  const db=new MemoryDb();
  const store=createStore({getDb:()=>db,resolveTarget:async({id,versionNumber})=>({
    title:id,body:'# Approved historical Skill Pack method for '+id+' v'+versionNumber,
    latestVersion:versionNumber+1,
  })});
  await store.create({id:'monetization-ideation',title:'Monetization Dojo',summary:'Keep real ratings',
    outcome:{statement:'Make proposals with real buyers',unit:'one rated proposal',
      acceptance:'The human user explicitly accepts it'},
    method:{title:'Dojo method',version:'monetization-pack-v5',summary:'Approved version',
      bodyRef:{kind:'intelligence_pack',location:'monetization-intelligence',versionNumber:4}},
    userAuthorized:true,authorizationNote:'Owner established this existing dojo'});
  if(withSub)db.records.set('submarines/monetization-ideas',{
    id:'monetization-ideas',status:'active',revision:81,openSortieId:null,events:[],
    loadout:[{kind:'intelligence_pack',id:'monetization-intelligence',dojoId:'monetization-ideation',
      role:'primary',train:true,versionNumber:null}],
  });
  return {db,store};
}
test('historical approval and submarine gear migrate atomically and idempotently',async()=>{
  const {db,store}=await setup({withSub:true});
  const before=db.records.get('explorationBases/monetization-ideation');
  const history=structuredClone(before.methodHistory);
  await store.migrateLegacyPackTarget({baseId:'monetization-ideation',
    packId:'monetization-intelligence',confirm:true});
  let base=db.records.get('explorationBases/monetization-ideation');
  let sub=db.records.get('submarines/monetization-ideas');
  assert.equal(base.method.bodyRef.kind,'skill_pack');
  assert.equal(base.method.bodyRef.versionNumber,4);
  assert.equal(base.method.version,'monetization-pack-v5');
  assert.deepEqual(base.methodHistory,history);
  assert.equal(sub.loadout[0].kind,'skill_pack');
  assert.equal(sub.loadout[0].dojoId,'monetization-ideation');
  assert.equal(sub.revision,82);
  await store.migrateLegacyPackTarget({baseId:'monetization-ideation',
    packId:'monetization-intelligence',confirm:true});
  base=db.records.get('explorationBases/monetization-ideation');
  sub=db.records.get('submarines/monetization-ideas');
  assert.equal(sub.revision,82,'idempotent retries do not rewrite gear');
  assert.deepEqual(base.methodHistory,history,'history never gets fake release entries');
});
test('an active sortie blocks both writes, preserving the legacy target',async()=>{
  const {db,store}=await setup({withSub:true});
  db.records.get('submarines/monetization-ideas').openSortieId='sortie-ongoing';
  await assert.rejects(store.migrateLegacyPackTarget({baseId:'monetization-ideation',
    packId:'monetization-intelligence',confirm:true}),/sortie is open/);
  assert.equal(db.records.get('explorationBases/monetization-ideation').method.bodyRef.kind,'intelligence_pack');
  assert.equal(db.records.get('submarines/monetization-ideas').loadout[0].kind,'intelligence_pack');
});
