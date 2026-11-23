'use strict';
// Bind a released Skill to declared runtime resources. This is a preflight:
// declaring an MCP tool is NOT evidence of invocation, and selecting a model
// is NOT evidence that a creative hypothesis worked.
const {INTENTS}=require('./chatSkillRelations');

async function resolveSkillResources(input={}){
  const policies=input.policies instanceof Map?input.policies:new Map();
  const modelGetter=input.getConsumerModel||((args)=>require('./consumerModelStore').get(args));
  const selectedId=String(input.consumerModelId||'').trim();
  const selectedVersion=String(input.consumerModelVersion||'').trim();
  if(selectedVersion&&!selectedId)throw Error('consumerModelId required when specifying a consumer model version');
  const resources=[];
  let activeConsumerModel=null;
  for(const [sourceSkillId,policy] of policies){
    const preferred=sourceSkillId===input.rootSkillId?input.intent:undefined;
    const intent=(INTENTS.has(preferred)?preferred:policy.defaultIntent)||'';
    for(const resource of policy.resources||[]){
      const active=resource.intents.includes(intent);
      const entry={
        sourceSkillId,kind:resource.kind,id:resource.id,
        requiredness:resource.requiredness,intent,when:resource.intents,
        active,toolName:resource.kind==='tool'?resource.id:'consumer_model_get',
        versionPolicy:resource.versionPolicy||null,
        loadState:active?'pending':'not_applicable',
        rationale:resource.rationale,
      };
      if(!active){resources.push(entry);continue;}
      if(resource.kind==='tool'){
        // Even when the tool is connected, only a real host action can confirm
        // the call. The runtime must not report that it has used this resource.
        entry.loadState=resource.id==='consumer_model_get'&&activeConsumerModel
          ?'model_data_available_via_server_resolver':'tool_call_required';
      }else if(!selectedId){
        entry.loadState='consumer_selection_required';
      }else {
        try {
          const modelResult=activeConsumerModel
            ||await modelGetter({id:selectedId,...(selectedVersion?{version:selectedVersion}:{})});
          if(!modelResult?.model?.id||!modelResult.model.version)
            throw Error('Consumer model resolver returned no identified version');
          activeConsumerModel=modelResult;
          entry.loadState='resolved_in_my_portal';
          entry.modelId=modelResult.model.id;
          entry.modelVersion=modelResult.model.version;
          entry.modelRevision=modelResult.model.revision||null;
        }catch(error){
          entry.loadState='consumer_model_unavailable';
          entry.reason=String(error.message||error).slice(0,300);
        }
      }
      resources.push(entry);
    }
  }
  return {resources,selectedConsumerModel:activeConsumerModel?.model||null,
    requiredMissing:resources.filter(r=>r.active&&r.requiredness==='required'
      &&!['resolved_in_my_portal','model_data_available_via_server_resolver'].includes(r.loadState))
      .map(r=>({sourceSkillId:r.sourceSkillId,kind:r.kind,id:r.id,
        loadState:r.loadState,toolName:r.toolName})),
    note:'Tool declarations are calls to make, not verified calls. Consumer models are hypotheses, not user ratings. Store real source receipts and model version with each evaluated trial.'};
}
module.exports={resolveSkillResources};
