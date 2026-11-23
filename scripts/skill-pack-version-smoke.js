'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');

const documents=new Map();
const key=(collection,id)=>collection+'/'+id;
const ref=(collection,id)=>({
  key:key(collection,id),
  get:async()=>{
    const data=documents.get(key(collection,id));
    return data?{exists:true,data:()=>data}:{exists:false};
  },
});
const db={
  collection:collection=>({
    doc:id=>ref(collection,id),
    limit:()=>({get:async()=>({
      docs:[...documents.entries()].filter(([k])=>k.startsWith(collection+'/'))
        .map(([k,v])=>({id:k.slice(collection.length+1),data:()=>v})),
    })}),
  }),
  runTransaction:async fn=>fn({get:r=>r.get(),set:(r,v)=>documents.set(r.key,structuredClone(v))}),
};
let approved=1;
const original=Module._load;
Module._load=function(request,parent,isMain){
  const filename=parent?.filename||'';
  if(filename.endsWith(path.join('functions','skillPackRegistry.js'))){
    if(request==='./documentDb')return {getDocumentDb:()=>db};
    if(request==='./chatContextRegistry')return {getExecutableSkill:async ({id})=>({
      id,title:id,revision:9,versionPolicy:'latest_dojo_release',body:'Approved Skill body',
    })};
    if(request==='./intelligenceSkillBridge')return {
      owned:id=>id==='marketing-creative-cognition',
      legacyList:async()=>[],
    };
    if(request==='./explorationBaseStore')return {
      trainersOf:async ({kind,id})=>kind==='skill_pack'&&id==='skill-pack-example'
        ?[{baseId:'dojo-example',releasedVersion:approved}]:[],
    };
  }
  return original.call(this,request,parent,isMain);
};
const packs=require('../functions/skillPackRegistry');
test.after(()=>{Module._load=original;});

test('Skill Pack shares immutable version lifecycle but never bypasses Dojo release',async()=>{
  const manifest={
    id:'skill-pack-example',title:'Evidence-led Creative Pack',summary:'One evidence-led workflow',
    skillType:'intelligence',entrySkillId:null,dojoBaseId:'dojo-example',
    supportingPackIds:[],skills:[
      {skillId:'creative-thinking',stage:'creative-lens',required:true},
      {skillId:'market-research-orchestrator',stage:'market-evidence',required:false},
    ],
  };
  await assert.rejects(()=>packs.createVersion({pack:manifest,expectedCurrentVersion:0,
    changeSummary:'Initial reusable Intelligence Pack',confirm:false}),/confirm=true/);
  await assert.rejects(()=>packs.createVersion({pack:{...manifest,id:'marketing-creative-cognition'},
    expectedCurrentVersion:0,changeSummary:'Duplicate historical record',confirm:true}),/historical|History|historical/i);
  const first=await packs.createVersion({pack:manifest,expectedCurrentVersion:0,
    changeSummary:'Introduce reusable cognitive capability Pack',confirm:true});
  assert.equal(first.pack.currentVersionNumber,1);
  assert.equal(first.definition.skillType,'intelligence');
  assert.equal(first.definition.entrySkillId,null);
  const updated={...manifest,summary:'A revised method that must be released by its dojo'};
  const second=await packs.createVersion({pack:updated,expectedCurrentVersion:1,
    changeSummary:'Improve acquisition evidence before creative selection',confirm:true});
  assert.equal(second.pack.currentVersionNumber,2);
  assert.equal((await packs.get({id:manifest.id,versionNumber:1})).definition.summary,manifest.summary);
  assert.equal((await packs.get({id:manifest.id,versionNumber:2})).definition.summary,updated.summary);
  await assert.rejects(()=>packs.createVersion({pack:updated,expectedCurrentVersion:1,
    changeSummary:'Stale write may not replace the current version',confirm:true}),/version conflict/);
  const execution=await packs.get({id:manifest.id,resolve:true});
  assert.equal(execution.versionPolicy,'latest_dojo_release');
  assert.equal(execution.definition.versionNumber,1);
  assert.equal(execution.execution.entry,null);
  assert.equal(execution.execution.members.length,1);
  assert.equal(execution.execution.members[0].skillId,'creative-thinking');
  await assert.rejects(()=>packs.get({id:manifest.id,versionNumber:2,resolve:true}),/Unapproved/);
  approved=2;
  assert.equal((await packs.get({id:manifest.id,resolve:true})).definition.versionNumber,2);
  assert.equal(documents.has('skillPackVersions/skill-pack-example--v1'),true);
  assert.equal(documents.has('skillPackVersions/skill-pack-example--v2'),true);
});
