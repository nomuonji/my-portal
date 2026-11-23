#!/usr/bin/env node
'use strict';
// Owner-authorized one-shot bootstrap: expose older real human-rated H/T data
// through the new specialist Skill review inbox. Never edit H/T or Skill bodies.
const dojo=require('../functions/explorationBaseStore');
async function run(){
  const id='viral-post-method-discovery';
  const result=await dojo.seedSkillImprovementInbox({
    baseId:id,confirm:true,actor:'owner-requested-skill-learning-bootstrap-2026-11-24',
  });
  const graph=await dojo.graphGet({baseId:id,view:'summary'});
  const queue=graph.stewardship?.skillImprovement?.inbox||[];
  if(!queue.length)throw Error('Skill feedback bootstrap failed readback: no routed specialists');
  console.log('[skill-learning-bootstrap] '+id+': '+result.addedCount+
    ' new specialist review routes, '+queue.length+' total; H/T and released method unchanged');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
