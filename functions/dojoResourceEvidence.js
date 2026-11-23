'use strict';
// Immutable, agent-reported execution provenance. Recording a receipt reference
// does not independently verify that a remote tool returned what it claims.
const ID=/^[a-z][a-z0-9_-]{1,99}$/;
const KINDS=new Set(['consumer_model','tool','skill']);
function cleanExecutionResources(raw){
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>20)throw Error('trial.executionResources must be an array of at most 20 entries');
  const seen=new Set();
  return raw.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Invalid execution resource '+index);
    const kind=String(item.kind||''),id=String(item.id||'').trim();
    if(!KINDS.has(kind)||!ID.test(id))throw Error('Invalid execution resource identity');
    const version=String(item.version||'').trim();
    if((kind==='consumer_model'||kind==='skill')&&!version)throw Error('Execution resource version required for '+kind);
    if(version.length>80||!(/^[a-z0-9][a-z0-9._-]*$/i.test(version)||!version))
      throw Error('Invalid execution resource version');
    const receiptRef=String(item.receiptRef||'').trim();
    if(receiptRef.length<8||receiptRef.length>600)throw Error('Execution resource receiptRef is required');
    const purpose=String(item.purpose||'').trim();
    if(purpose.length<12||purpose.length>500)throw Error('Concrete execution resource purpose is required');
    const key=[kind,id,version].join(':');
    if(seen.has(key))throw Error('Duplicate execution resource '+key);
    seen.add(key);
    return {kind,id,version:version||null,receiptRef,purpose,
      evidenceStatus:'agent_reported_not_independently_verified'};
  });
}
function resourceBreakdown(trials){
  const groups=new Map();
  for(const trial of trials||[]){
    if(trial.status!=='rated'||!['pass','partial','fail'].includes(trial.verdict))continue;
    for(const item of trial.executionResources||[]){
      const key=item.kind+':'+item.id+'@'+(item.version||'unversioned');
      if(!groups.has(key))groups.set(key,{key,kind:item.kind,id:item.id,
        version:item.version||null,rated:0,pass:0,partial:0,fail:0,trialIds:[]});
      const current=groups.get(key);
      current.rated+=1;current[trial.verdict]+=1;current.trialIds.push(trial.id);
    }
  }
  return [...groups.values()].sort((a,b)=>b.rated-a.rated||a.key.localeCompare(b.key))
    .slice(0,30).map(x=>({...x,trialIds:x.trialIds.slice(0,15),
      causalConclusion:'unproven_observational_grouping'}));
}
module.exports={cleanExecutionResources,resourceBreakdown};
