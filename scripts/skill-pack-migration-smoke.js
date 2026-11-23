'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SEED,clean,selectMemberSkills}=require('../functions/skillPackRegistry');

test('migration keeps the original live Buzz Skill and dojo instead of copying history',()=>{
  const p=clean(SEED);
  assert.equal(p.id,'viral-post-pack');
  assert.equal(p.entrySkillId,'buzz-content-ideation');
  assert.equal(p.dojoBaseId,'viral-post-method-discovery');
  assert.deepEqual(p.intelligenceIds,['marketing-creative-cognition']);
  assert.ok(!p.skills.some(x=>x.skillId==='buzz-content-ideation'));
  assert.ok(p.skills.some(x=>x.skillId==='humor-craft'));
  assert.ok(p.skills.some(x=>x.skillId==='creative-thinking'));
});
test('required Skills load by default; humor and distribution load only for selected stages',()=>{
  const p=clean(SEED);
  const ids=selectMemberSkills(p).map(s=>s.skillId);
  assert.ok(ids.includes('social-post-quality-gate'));
  assert.ok(!ids.includes('humor-craft'));
  assert.ok(!ids.includes('traffic-distribution-discovery'));
  assert.ok(selectMemberSkills(p,['humor']).some(s=>s.skillId==='humor-craft'));
  assert.ok(selectMemberSkills(p,['distribution']).some(s=>s.skillId==='traffic-distribution-discovery'));
  assert.throws(()=>selectMemberSkills(p,['unknown']),/stages/);
});
test('a Pack must not create recursive or duplicate Skill ownership',()=>{
  assert.throws(()=>clean({...SEED,skills:[{skillId:SEED.entrySkillId,stage:'transform'}]}),/recursive/);
  assert.throws(()=>clean({...SEED,skills:[SEED.skills[0],SEED.skills[0]]}),/duplicate/);
  assert.throws(()=>clean({...SEED,skills:[{skillId:'creative-thinking',stage:'imaginary'}]}),/Invalid/);
});

const {projectLegacy,cognitionBody,LEGACY_PACKS}=require('../functions/intelligenceSkillBridge');
const {cleanSkill}=require('../functions/chatContextRegistry');

test('Intelligence is a subtype of an ordinary versioned Skill',()=>{
  const input={id:'cognitive-trial',title:'Cognitive Trial',body:'This intelligence Skill evaluates observed evidence and makes explicit assumptions before judging a case.'};
  assert.equal(cleanSkill({...input,skillType:'intelligence'}).skillType,'intelligence');
  assert.equal(cleanSkill(input).skillType,'standard');
  assert.equal(cleanSkill({...input,skillType:'untrusted'}).skillType,'standard');
});

test('historical composite Intelligence becomes an immutable Skill Pack view with full original reasoning',()=>{
  const pack={id:'monetization-intelligence',title:'Monetization',currentVersionNumber:5,summary:'Actual buyer to payment'};
  const definition={id:pack.id,versionNumber:4,title:pack.title,
    purpose:'Reach and revenue must not be confused',worldModel:{observed:['payments','buyer']},
    reasoningProcedures:['Compare paid alternatives','Reject missing acquisition surfaces'],
    evaluationCriteria:['A buyer can actually pay'],
    components:[{id:'buyer-research',title:'Buyer research',summary:'Source buyer evidence',
      dependencies:[{resourceType:'chat_skill',canonicalRef:'consumer-model-context',requiredness:'required'},
        {resourceType:'chat_skill',canonicalRef:'creative-thinking',requiredness:'recommended'}]},
      {id:'creative-work',title:'Creative work',summary:'Create ideas',
        dependencies:[{resourceType:'chat_skill',canonicalRef:'creative-thinking',requiredness:'recommended'}]}]};
  const projected=projectLegacy({pack,definition});
  assert.equal(projected.pack.kind,'skill_pack');
  assert.equal(projected.pack.skillType,'workflow');
  assert.equal(projected.pack.currentVersionNumber,5);
  assert.equal(projected.definition.versionNumber,4,'approved historical version must not become the latest draft');
  assert.equal(projected.definition.stages.length,2);
  assert.equal(projected.definition.skills[0].skillId,'consumer-model-context');
  assert.match(projected.definition.instructions,/Reach and revenue must not be confused/);
  assert.match(projected.definition.instructions,/Reject missing acquisition surfaces/);
  assert.match(projected.definition.instructions,/A buyer can actually pay/);
  assert.doesNotMatch(projected.definition.instructions,/This is the latest version/);
  assert.equal(cognitionBody(definition).includes('payments'),true);
  assert.deepEqual(Object.keys(LEGACY_PACKS).sort(),
    ['marketing-creative-cognition','monetization-intelligence','video-production-intelligence','youtube-view-growth-intelligence'].sort());
});
