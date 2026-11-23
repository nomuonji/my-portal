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
