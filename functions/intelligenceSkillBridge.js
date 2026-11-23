'use strict';
// Compatibility bridge: the old Intelligence Registry is historical storage.
// Its composite definitions are exposed as Skill Packs, not a fourth capability type.
// Do not copy immutable legacy bodies or create a second mutable source of truth.
const LEGACY_PACKS=Object.freeze({
  'marketing-creative-cognition': {skillType:'intelligence',entrySkillId:null,dojoBaseId:null},
  'monetization-intelligence': {skillType:'workflow',entrySkillId:'asset-first-monetization-ideation',dojoBaseId:'monetization-ideation'},
  'youtube-view-growth-intelligence': {skillType:'workflow',entrySkillId:'youtube-scriptwriting',dojoBaseId:'youtube-scriptwriting'},
  'video-production-intelligence': {skillType:'workflow',entrySkillId:'video-production',dojoBaseId:'short-video-direction'},
});
const ATOMIC_INTELLIGENCE_SKILLS=Object.freeze([
  'human-md-creative-intelligence',
  'treasure-keyword-intelligence',
  'exploration-operations',
]);
const owned=(id)=>Object.prototype.hasOwnProperty.call(LEGACY_PACKS,id);
function textLines(value){
  if(value==null)return '';
  if(Array.isArray(value))return value.map(x=>typeof x==='string'?'- '+x:'- '+JSON.stringify(x)).join('\n');
  if(typeof value==='object')return JSON.stringify(value,null,2);
  return String(value);
}
function cognitionBody(d){
  const parts=[
    ['Purpose',d.purpose],
    ['Scope',d.scope],
    ['World model',d.worldModel],
    ['Epistemology / evidence interpretation',d.epistemology],
    ['Applicability',d.applicability],
    ['Input contract',d.inputContract],
    ['Reasoning and practical judgment',d.reasoningProcedures],
    ['Evaluation and failure checks',d.evaluationCriteria],
    ['Contribution contract',d.contributionContract],
    ['Limits',d.knownLimits],
    ['Failure modes',d.failureModes],
    ['References (do not duplicate source bodies)',d.dependencies],
  ].filter(x=>x[1]!=null);
  return '# '+(d.title||d.id)+'\n\n'
    +'Skill subtype: intelligence. This Skill can reason, assess, interpret and produce an output; intelligence is not a separate registry concept.\n'
    +'Historical source: '+d.id+' v'+d.versionNumber+'. The original immutable version remains available for audit.\n\n'
    +parts.map(([label,value])=>'## '+label+'\n'+textLines(value)).join('\n\n');
}
function projectLegacy(result){
  const {pack,definition}=result||{};
  if(!pack||!definition||!owned(pack.id))throw Error('Not a migrated composite Intelligence Skill Pack');
  const config=LEGACY_PACKS[pack.id];
  const components=Array.isArray(definition.components)?definition.components:[];
  const stages=components.map(c=>({
    id:c.id,title:c.title,summary:c.summary||'',
    skills:(c.dependencies||[]).filter(dep=>dep.resourceType==='chat_skill')
      .map(dep=>({skillId:dep.canonicalRef,requiredness:dep.requiredness||'optional'})),
  }));
  const skills=[];
  for(const stage of stages){
    for(const dep of stage.skills){
      if(!skills.some(x=>x.skillId===dep.skillId&&x.stage===stage.id))
        skills.push({skillId:dep.skillId,stage:stage.id,
          required:dep.requiredness==='required',recommended:dep.requiredness==='recommended'});
    }
  }
  const versionNumber=Number(definition.versionNumber)||Number(pack.currentVersionNumber)||1;
  const instructions=cognitionBody(definition);
  const summary={
    id:pack.id,title:pack.title,summary:pack.summary||pack.purpose||'',
    skillType:config.skillType,kind:'skill_pack',status:pack.status||'active',
    entrySkillId:config.entrySkillId,dojoBaseId:config.dojoBaseId,
    intelligenceIds:[],skills,stages,memberCount:skills.length,
    currentVersionNumber:Number(pack.currentVersionNumber)||versionNumber,
    legacySource:{id:pack.id,versionNumber,registry:'intelligencePacks',readOnlyHistory:true},
  };
  return {pack:summary,definition:{...summary,versionNumber,instructions,
    releasedWorkflowSource:'legacy intelligence_pack history',
    changeSummary:definition.changeSummary||'',
    skillType:config.skillType}};
}
async function legacyGet(input={}){
  const id=String(input.id||'');
  if(!owned(id))throw Error('Unknown composite Skill Pack: '+id);
  const registry=require('./agentIntelligenceRegistry');
  const original=await registry.getPack({id,versionNumber:input.versionNumber});
  return projectLegacy(original);
}
async function legacyList(){
  const registry=require('./agentIntelligenceRegistry');
  const index=await registry.listPacks({limit:100});
  const available=new Set((index.items||[]).map(x=>x.id));
  const ids=Object.keys(LEGACY_PACKS).filter(id=>available.has(id));
  const results=await Promise.all(ids.map(id=>registry.getPack({id})));
  return results.map(projectLegacy).map(x=>x.pack);
}
async function resolvedVersionForPack(id){
  const store=require('./explorationBaseStore');
  const old=await store.trainersOf({kind:'intelligence_pack',id});
  const current=await store.trainersOf({kind:'skill_pack',id}).catch(()=>[]);
  const dojos=[...old,...current];
  if(!dojos.length)return {versionNumber:null,dojos:[]};
  const versions=[...new Set(dojos.map(x=>Number(x.releasedVersion)))];
  if(versions.length!==1||!Number.isInteger(versions[0])||versions[0]<1)
    throw Error('Conflicting or missing Skill Pack dojo releases: '+id);
  return {versionNumber:versions[0],dojos};
}
module.exports={LEGACY_PACKS,ATOMIC_INTELLIGENCE_SKILLS,owned,projectLegacy,legacyGet,legacyList,cognitionBody,resolvedVersionForPack};
