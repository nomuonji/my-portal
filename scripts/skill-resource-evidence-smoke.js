'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {cleanPolicy}=require('../functions/chatSkillRelationsStore');
const {resolveSkillResources}=require('../functions/skillResourceResolution');
const {cleanExecutionResources,resourceBreakdown}=require('../functions/dojoResourceEvidence');
const resources=[
  {kind:'consumer_model',id:'audience',requiredness:'required',
    intents:['serious_creation'],rationale:'Verify what the real customer cares about, not age demographics.'},
  {kind:'tool',id:'consumer_model_get',requiredness:'required',
    intents:['serious_creation'],rationale:'Use the authoritative current consumer-model definition.'},
  {kind:'tool',id:'consumer_model_list',requiredness:'recommended',
    intents:['serious_creation'],rationale:'Choose a named segment when the customer is not specified.'},
];
test('resource links are typed and versioned; invented tools and duplicate targets fail closed',()=>{
  const x=cleanPolicy({id:'consumer-model-context',defaultIntent:'serious_creation',relations:[],resources});
  assert.equal(x.resources.length,3);
  assert.throws(()=>cleanPolicy({...x,resources:[...resources,resources[0]]}),/Duplicate/);
  assert.throws(()=>cleanPolicy({...x,resources:[{...resources[0],id:'any-customer'}]}),/Invalid/);
  assert.throws(()=>cleanPolicy({...x,resources:[{...resources[1],id:'https://fake.site'}]}),/Invalid/);
});
test('unknown audience is unresolved; tool declaration does not claim invocation',async()=>{
  const policies=new Map([['consumer-model-context',cleanPolicy({
    id:'consumer-model-context',defaultIntent:'serious_creation',relations:[],resources,
  })]]);
  const result=await resolveSkillResources({policies,rootSkillId:'consumer-model-context'});
  assert.equal(result.selectedConsumerModel,null);
  assert.ok(result.requiredMissing.some(x=>x.kind==='consumer_model'&&x.loadState==='consumer_selection_required'));
  assert.ok(result.requiredMissing.some(x=>x.kind==='tool'&&x.loadState==='tool_call_required'));
  assert.ok(result.resources.every(x=>x.loadState!=='tool_called'));
});
test('explicit model ID resolves its exact version, without asserting a tool was called',async()=>{
  const policies=new Map([['consumer-model-context',cleanPolicy({
    id:'consumer-model-context',defaultIntent:'serious_creation',relations:[],resources,
  })]]);
  let received=null;
  const result=await resolveSkillResources({policies,rootSkillId:'consumer-model-context',
    consumerModelId:'daishu-consumer',consumerModelVersion:'1.7',
    getConsumerModel:async args=>{received=args;return {model:{id:args.id,version:args.version,revision:9}};},
  });
  assert.deepEqual(received,{id:'daishu-consumer',version:'1.7'});
  assert.equal(result.selectedConsumerModel.version,'1.7');
  assert.ok(result.resources.some(x=>x.loadState==='model_data_available_via_server_resolver'));
  assert.ok(result.requiredMissing.length===0);
  assert.ok(result.resources.every(x=>x.loadState!=='tool_called'));
});
test('trial resource receipts remain agent-reported and distinct from human verdict',()=>{
  const manifest=cleanExecutionResources([
    {kind:'consumer_model',id:'daishu-consumer',version:'1.7',
      receiptRef:'my-portal:consumer_model_get:daishu-consumer@1.7',purpose:'Compare the public audience reaction model'},
    {kind:'tool',id:'consumer_model_get',receiptRef:'tool-result-001',purpose:'Read the model and compare its source evidence'},
  ]);
  assert.equal(manifest[0].evidenceStatus,'agent_reported_not_independently_verified');
  assert.throws(()=>cleanExecutionResources([{kind:'consumer_model',id:'daishu-consumer',
    receiptRef:'tool-result-001',purpose:'Check audience'}]),/version required/);
  const ratings=[{id:'T-1',status:'rated',verdict:'pass',executionResources:manifest},
    {id:'T-2',status:'rated',verdict:'fail',executionResources:manifest},
    {id:'T-3',status:'awaiting',executionResources:manifest}];
  const breakdown=resourceBreakdown(ratings);
  assert.equal(breakdown.find(x=>x.kind==='consumer_model').rated,2);
  assert.equal(breakdown.find(x=>x.kind==='consumer_model').pass,1);
  assert.equal(breakdown.find(x=>x.kind==='consumer_model').fail,1);
  assert.ok(breakdown.every(x=>x.causalConclusion==='unproven_observational_grouping'));
});
