'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveRelatedSkills}=require('../functions/chatSkillResolution');
const {decorate}=require('../functions/chatSkillRelationsStore');
const records=new Map([
 ['character-creation-studio',{title:'Character',body:'`humor-craft` and `character-visual-design`',revision:4,versionPolicy:'latest_dojo_release'}],
 ['humor-craft',{title:'Humour',body:'`creative-thinking`',revision:8,versionPolicy:'latest_dojo_release'}],
 ['creative-thinking',{title:'Creative',body:'Independent method; no more links.',revision:7,versionPolicy:'latest_dojo_release'}],
 ['character-visual-design',{title:'Visual',body:'Visual design guidelines. End of references.',revision:1,versionPolicy:'latest_dojo_release'}],
]);
const relations={
 'character-creation-studio':[
  {skillId:'character-visual-design',requiredness:'required',intents:['character_ideation','technical_edit'],rationale:'Visual language'},
  {skillId:'humor-craft',requiredness:'recommended',intents:['character_ideation'],rationale:'Humorous concepts'}],
 'humor-craft':[{skillId:'creative-thinking',requiredness:'recommended',intents:['humor_ideation'],rationale:'Creative abstraction'}],
};
const defaults={'character-creation-studio':'character_ideation','humor-craft':'humor_ideation'};
const fetches=[];
function skill(id){const x=records.get(id);return x?{id,...x}:undefined;}
async function inspect(intent){
 fetches.length=0;
 return resolveRelatedSkills({root:skill('character-creation-studio'),intent,
  getPolicy:async id=>({id,revision:1,relations:relations[id]||[],defaultIntent:defaults[id]||''}),
  decorate,getApprovedSkill:async id=>{fetches.push(id);return skill(id);}});
}
test('nested character -> humour -> creative follows latest approved version with live changes',async()=>{
 const first=await inspect('character_ideation');
 assert.deepEqual(first.relatedSkills.map(x=>[x.id,x.revision]),[
  ['character-visual-design',1],['humor-craft',8],['creative-thinking',7]]);
 assert.equal(first.dependencyGraph,undefined);
 assert.equal(first.skillRelations.find(x=>x.sourceSkillId==='humor-craft'
  && x.skillId==='creative-thinking').loadState,'loaded');
 records.set('creative-thinking',{...records.get('creative-thinking'),revision:9});
 const next=await inspect('character_ideation');
 assert.equal(next.relatedSkills.find(x=>x.id==='creative-thinking').revision,9,
  'never cached or pinned older approved subdependencies');
 records.set('creative-thinking',{...records.get('creative-thinking'),revision:7});
});
test('technical edits do not transitively drag in humour',async()=>{
 const result=await inspect('technical_edit');
 assert.deepEqual(result.relatedSkills.map(x=>x.id),['character-visual-design']);
 assert.ok(!fetches.includes('humor-craft'));
});
test('cycles and duplicate dependencies stop without duplicate Skill text',async()=>{
 const original=relations['humor-craft'];
 relations['humor-craft']=[
  {skillId:'character-creation-studio',requiredness:'recommended',intents:['humor_ideation'],rationale:'Bad cycle'},
  ...original];
 records.set('humor-craft',{...records.get('humor-craft'),body:'`character-creation-studio`; `creative-thinking`'});
 const result=await inspect('character_ideation');
 assert.equal(result.relatedSkills.length,3);
 assert.equal(result.skillRelations.find(x=>x.sourceSkillId==='humor-craft'
  && x.skillId==='character-creation-studio').loadState,'cycle_avoided');
 relations['humor-craft']=original;
 records.set('humor-craft',{...records.get('humor-craft'),body:'`creative-thinking`'});
});
test('unknown source-body reference fails closed even if policy wants it',async()=>{
 records.set('character-creation-studio',{...records.get('character-creation-studio'),body:'`character-visual-design`'});
 const result=await inspect('character_ideation');
 assert.ok(!result.relatedSkills.some(x=>x.id==='humor-craft'));
 assert.equal(result.skillRelations.find(x=>x.skillId==='humor-craft').loadState,'stale_source_reference');
 records.set('character-creation-studio',{...records.get('character-creation-studio'),body:'`humor-craft` and `character-visual-design`'});
});
