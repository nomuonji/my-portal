'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {planSkillTransfers} = require('../functions/dojoSkillTransfer');

const rated = (id, verdict, hypothesisIds) => ({
  id, status:'rated', verdict, hypothesisIds, ratedAt:'2026-11-23T00:00:00Z',
});
test('Buzz ratings reach individual Skills without changing or inferring human verdicts', () => {
  const base={id:'viral-post-method-discovery',method:{bodyRef:{kind:'chat_skill',location:'buzz-content-ideation'}}};
  const items=[
    {id:'H-1',kind:'hypothesis',pipelineStage:'gate',targetModuleIds:['gate']},
    {id:'H-2',kind:'hypothesis',pipelineStage:'transform',targetModuleIds:['transform']},
  ];
  const inbox=planSkillTransfers({base,items,trials:[
    rated('T-1','pass',['H-1']),rated('T-2','fail',['H-1']),rated('T-3','partial',['H-2']),
  ]});
  const gate=inbox.routes.find(r=>r.targetSkillId==='social-post-quality-gate');
  assert.equal(gate.evidence.pass,1);
  assert.equal(gate.evidence.fail,1);
  assert.equal(gate.state,'positive_and_negative_cases_need_controlled_comparison');
  assert.deepEqual(gate.evidence.examples.map(e=>e.trialId).sort(),['T-1','T-2']);
  assert.ok(inbox.routes.some(r=>r.targetSkillId==='creative-thinking'));
  assert.match(inbox.releasePolicy,/No automatic edits/);
});
test('Other dojos require explicit target skill instead of broad module guesses',()=>{
  const base={id:'video-script-dojo',method:{bodyRef:{kind:'chat_skill',location:'video-script-owner'}}};
  const items=[
    {id:'H-1',kind:'hypothesis',pipelineStage:'gate'},
    {id:'H-2',kind:'hypothesis',pipelineStage:'voice',targetSkillIds:['human-web-voice']},
  ];
  const inbox=planSkillTransfers({base,items,trials:[
    rated('T-4','fail',['H-1']),rated('T-5','pass',['H-2']),
  ]});
  assert.deepEqual(inbox.routes.map(r=>r.targetSkillId),['human-web-voice']);
  assert.equal(inbox.unroutedRated,1);
});
test('Unrated or withdrawn cases cannot masquerade as learning evidence',()=>{
  const base={id:'viral-post-method-discovery',method:{bodyRef:{kind:'chat_skill',location:'buzz-content-ideation'}}};
  const items=[{id:'H-1',kind:'hypothesis',pipelineStage:'source'}];
  assert.equal(planSkillTransfers({base,items,trials:[
    {id:'T-1',status:'awaiting',verdict:'pass',hypothesisIds:['H-1']},
    {id:'T-2',status:'rated',verdict:'withdrawn',hypothesisIds:['H-1']},
  ]}).routes.length,0);
});
