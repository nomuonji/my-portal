'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {createStore}=require('../functions/chatSkillRelationsStore');
class Snapshot{constructor(id,v){this.id=id;this.exists=v!==undefined;this.value=v;}data(){return this.value;}}
class Doc{constructor(db,c,id){this.db=db;this.collectionPath=c;this.id=id;}get(){return Promise.resolve(new Snapshot(this.id,this.db.docs.get(this.collectionPath+'/'+this.id)));}}
class Collection{constructor(db,name){this.db=db;this.name=name;}doc(id){return new Doc(this.db,this.name,id);}limit(){return this;}async get(){return {docs:[...this.db.docs].filter(([key])=>key.startsWith(this.name+'/')).map(([key,v])=>new Snapshot(key.slice(this.name.length+1),v))};}}
class Db{constructor(){this.docs=new Map();}collection(name){return new Collection(this,name);}async runTransaction(fn){const writes=[];const tx={get:r=>r.get(),set:(r,v)=>writes.push([r.collectionPath+'/'+r.id,v])};const out=await fn(tx);writes.forEach(([id,v])=>this.docs.set(id,v));return out;}}
const body='# Character Skill\n\nUse `character-visual-design` and `humor-craft` for concept work. If needed refer to `creative-thinking`.';
function setup(){const db=new Db();const store=createStore({getDb:()=>db,sourceSkill:async()=>({revision:4,versionPolicy:'latest_dojo_release',body})});return {db,store};}
test('legacy fallback is read-only until explicitly published', async()=>{
 const {db,store}=setup();
 const old=await store.get({id:'character-creation-studio'});
 assert.equal(old.source,'legacy_code_fallback');assert.equal(old.revision,0);
 assert.equal(db.docs.size,0);
 const saved=await store.ensureMigrated({id:old.id});
 assert.equal((await store.ensureMigrated({id:old.id})).revision,1,'on-demand bootstrap is idempotent');
 assert.equal(saved.revision,1);
 assert.equal(saved.sourceSkillVersion,4);
 assert.equal((await store.get({id:old.id})).source,'my_portal_db');
 assert.equal(db.docs.size,2,'current version and immutable v1 snapshot');
 const execution=await store.resolve({id:old.id,intent:'technical_edit'});
 assert.deepEqual(execution.links.filter(link=>link.autoLoad).map(link=>link.skillId),['character-visual-design']);
});
test('policy revisions need benchmark and only approved-body referenced targets',async()=>{
 const {store}=setup();
 const old=await store.get({id:'character-creation-studio'});
 await store.publish({policy:{id:old.id,defaultIntent:old.defaultIntent,relations:old.relations},expectedRevision:0,changeReason:'Import existing approved body links without changing their behavior',confirm:true});
 const changed={id:old.id,defaultIntent:'serious_creation',relations:old.relations};
 await assert.rejects(store.publish({policy:changed,expectedRevision:1,changeReason:'Change the default for safe serious tasks',confirm:true}),/benchmark/);
 await assert.rejects(store.publish({policy:{...changed,relations:old.relations.concat([{skillId:'made-up-skill',requiredness:'required',intents:['serious_creation'],rationale:'Supposed dependency of character work'}])},expectedRevision:1,changeReason:'Unverified new reference should be rejected',confirm:true,benchmark:{passed:true,ref:'test-run-200',cases:'Accepted and rejected same-scene examples'}}),/Approved source body does not reference/);
 const saved=await store.publish({policy:changed,expectedRevision:1,changeReason:'Change default intent after controlled character editing evaluation',benchmark:{passed:true,ref:'dojo-character-T-004',cases:'Existing accepted T-004 and rejected T-010 contrasted'},confirm:true});
 assert.equal(saved.revision,2);
 await assert.rejects(store.publish({policy:changed,expectedRevision:1,changeReason:'Stale concurrent revision attempt',benchmark:{passed:true,ref:'test-ref-200',cases:'Previously rated examples'},confirm:true}),/conflict/);
});
test('unknown Skills remain unlinked, malformed policies cannot add pins or cycles',async()=>{
 const {store}=setup();
 assert.deepEqual((await store.resolve({id:'unknown-skill'})).links,[]);
 const old=await store.get({id:'character-creation-studio'});
 for(const extra of [{...old.relations[0],versionNumber:7},{...old.relations[0],skillId:'character-creation-studio'}]){
  await assert.rejects(store.publish({policy:{id:old.id,defaultIntent:old.defaultIntent,relations:[extra]},expectedRevision:0,changeReason:'Verify unsafe relation policy fails',confirm:true}),/versions|self-referential/);
 }
});

test('structured resource policy preserves exact model/tool references across legacy-client revisions',async()=>{
 const db=new Db();
 const store=createStore({getDb:()=>db,sourceSkill:async()=>({
  revision:72,versionPolicy:'latest_dojo_release',
  body:'Use `consumer_model_get` and `consumer_model_list` with `consumer-model-context`; never invent an audience.',
 })});
 const resources=[{kind:'consumer_model',id:'audience',requiredness:'required',
  intents:['distribution'],rationale:'Resolve an actual audience model for the stated buyer situation.'},
  {kind:'tool',id:'consumer_model_get',requiredness:'required',
  intents:['distribution'],rationale:'Fetch the exact My Portal current audience model.'}];
 const original=await store.publish({policy:{
  id:'buzz-content-ideation',defaultIntent:'distribution',relations:[],resources,
 },expectedRevision:0,changeReason:'Introduce versioned consumer-model resource provenance',
  benchmark:{passed:true,ref:'skill-resource-evidence-smoke',cases:'Missing audience blocks; explicit model id resolves'},confirm:true});
 assert.equal(original.resources.length,2);
 assert.equal(original.resources[0].versionPolicy,'explicit_version_or_current');
 const oldClient=await store.publish({policy:{
  id:'buzz-content-ideation',defaultIntent:'distribution',
  relations:[{skillId:'consumer-model-context',requiredness:'required',intents:['distribution'],
    rationale:'Select the currently appropriate audience model before generating a post.'}],
 },expectedRevision:1,changeReason:'Add explicit approved Skill relation without re-sending resources',
  benchmark:{passed:true,ref:'skill-resource-evidence-smoke',cases:'Approved source body mentions the relation'},confirm:true});
 assert.equal(oldClient.resources.length,2,'an old MCP client must not wipe structured resources');
 assert.equal((await store.get({id:'buzz-content-ideation'})).resources.length,2);
 await assert.rejects(store.publish({policy:{id:'buzz-content-ideation',
  relations:[],resources:[{...resources[1],id:'nonexistent_tool_foo'}]},
  expectedRevision:2,changeReason:'Reject invented tool without approved Skill body',
  benchmark:{passed:true,ref:'skill-resource-evidence-smoke',cases:'Unknown tool must be refused'},confirm:true}),
  /does not reference resource resolver/);
});

test('approved parametric tool calls satisfy resource policy validation',async()=>{
 const db=new Db();
 const sourceBody='Use `consumer_model_list({status:"active"})` to discover models and `consumer_model_get({id:"daishu-consumer"})` to read evidence.';
 const store=createStore({getDb:()=>db,sourceSkill:async()=>({revision:2,versionPolicy:'latest_registry_version',body:sourceBody})});
 const resources=[
  {kind:'consumer_model',id:'audience',requiredness:'required',intents:['serious_creation'],rationale:'Read the concrete audience model before acting.'},
  {kind:'tool',id:'consumer_model_get',requiredness:'required',intents:['serious_creation'],rationale:'Read the currently approved audience model evidence.'},
  {kind:'tool',id:'consumer_model_list',requiredness:'recommended',intents:['serious_creation'],rationale:'List possible audience models for the current task.'},
 ];
 const res=await store.publish({policy:{id:'consumer-model-context',defaultIntent:'serious_creation',relations:[],resources},
  expectedRevision:0,changeReason:'Support actual parameterized MCP tool references in approved Skill text',
  benchmark:{passed:true,ref:'skill-resource-evidence-smoke',cases:'Model get and list calls are explicit in the source body'},confirm:true});
 assert.equal(res.revision,1);assert.equal(res.resources.length,3);
});
