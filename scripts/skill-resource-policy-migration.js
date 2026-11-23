#!/usr/bin/env node
'use strict';
// Owner-authorized, one-time production migration to versioned My Portal
// Skill relation/resource policies. Does not modify Skill bodies, dojo releases
// or consumer models. Version-conflict checks fail closed.
const policies=require('../functions/chatSkillRelationsStore');
const benchmark={passed:true,ref:'scripts/skill-resource-evidence-smoke.js',
  cases:'Unknown audience remains unresolved; exact selected model version resolves; tool references do not claim invocation; execution receipts are not human verdicts.'};
const consumers=[
  {kind:'consumer_model',id:'audience',requiredness:'required',
    intents:['serious_creation','distribution','humor_ideation'],
    rationale:'Require an actual current audience model or explicit statement that target is unknown; avoid invented demographic assumptions.'},
  {kind:'tool',id:'consumer_model_get',requiredness:'required',
    intents:['serious_creation','distribution','humor_ideation'],
    rationale:'Load the exact selected audience model and its evidence from My Portal rather than a stale copied description.'},
  {kind:'tool',id:'consumer_model_list',requiredness:'recommended',
    intents:['serious_creation','distribution','humor_ideation'],
    rationale:'Discover relevant active models when the user or task has not already selected one.'},
];
const consumerLink={
  skillId:'consumer-model-context',requiredness:'required',
  intents:['serious_creation','distribution','humor_ideation'],
  rationale:'Select an explicit target audience and resolve its current consumer-model ID and version before generating dependent content.',
};
async function run(){
  const tasks=[
    {id:'consumer-model-context',expected:0,definition:prior=>({
      id:'consumer-model-context',defaultIntent:'serious_creation',
      relations:prior.relations||[],resources:consumers,
    })},
    {id:'buzz-content-ideation',expected:1,definition:prior=>({
      id:prior.id,defaultIntent:prior.defaultIntent||'distribution',
      relations:[...(prior.relations||[]).filter(x=>x.skillId!=='consumer-model-context'),
        {...consumerLink,intents:['distribution','humor_ideation']}],
      resources:prior.resources||[],
    })},
    {id:'asset-first-monetization-ideation',expected:0,definition:prior=>({
      id:prior.id,defaultIntent:'serious_creation',
      relations:[
        {...consumerLink,intents:['serious_creation']},
        {skillId:'market-research-orchestrator',requiredness:'recommended',
          intents:['serious_creation'],
          rationale:'Verify live market evidence, competing offers and genuine payment surfaces before proposing monetization.'},
        {skillId:'traffic-distribution-discovery',requiredness:'recommended',
          intents:['serious_creation'],
          rationale:'Verify a real audience-reach surface rather than assuming the content will attract buyers.'},
      ],
      resources:prior.resources||[],
    })},
  ];
  for(const task of tasks){
    const prior=await policies.get({id:task.id});
    const intended=policies.cleanPolicy(task.definition(prior));
    if(prior.revision>task.expected){
      const comparable=JSON.stringify({id:prior.id,defaultIntent:prior.defaultIntent,
        relations:prior.relations||[],resources:prior.resources||[]});
      if(comparable!==JSON.stringify(intended))throw Error('Unexpected Skill resource policy revision '+task.id);
      console.log('[skill-resource-migration] '+task.id+' already applied');
      continue;
    }
    if(prior.revision!==task.expected)throw Error('Skill policy expected revision mismatch: '+task.id);
    const result=await policies.publish({policy:intended,expectedRevision:task.expected,
      changeReason:'Owner requested structured tool/model/Skill dependencies for actual dojo learning; no Skill body or human feedback changed.',
      benchmark,confirm:true});
    if(result.revision!==task.expected+1)
      throw Error('Skill resource policy readback mismatch for '+task.id);
    console.log('[skill-resource-migration] '+task.id+' policy revision '+result.revision);
  }
}
if(require.main===module)run().catch(err=>{console.error(err);process.exitCode=1;});
module.exports={run,consumers};
