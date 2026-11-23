'use strict';

// Skill Packs assemble canonical Chat Skills. Intelligence is a Skill or Pack subtype,
// not a fourth registry concept; legacy Intelligence history is projected read-only.
// The legacy coordinator remains a referenced Skill so its dojo history and
// released version survive this additive migration without copying its body.
const { getDocumentDb } = require('./documentDb');
const chatSkills = require('./chatContextRegistry');
const bridge = require('./intelligenceSkillBridge');

const DB_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const PACKS = 'skillPacks', VERSIONS = 'skillPackVersions';
const ID = /^[a-z][a-z0-9-]{1,89}$/;
const STAGE_ID = /^[a-z][a-z0-9-]{0,79}$/;
const SEED = Object.freeze({
  id: 'viral-post-pack', title: 'バズ投稿 Pack',
  summary: '市場観測から企画・ユーモア・文章化・品質審査までのSkill群を統括する制作Pack',
  entrySkillId: 'buzz-content-ideation',
  intelligenceIds: ['marketing-creative-cognition'],
  dojoBaseId: 'viral-post-method-discovery',
  skills: [
    {skillId:'creative-market-discovery',stage:'source',required:true},
    {skillId:'idea-resonance-lab',stage:'selection',required:true},
    {skillId:'baka-culture-content-engine',stage:'audience',required:false},
    {skillId:'consumer-model-context',stage:'audience',required:false},
    {skillId:'creative-thinking',stage:'transform',required:true},
    {skillId:'humor-craft',stage:'humor',required:false},
    {skillId:'text-native-social-copywriting',stage:'voice',required:true},
    {skillId:'human-web-voice',stage:'voice',required:true},
    {skillId:'social-post-quality-gate',stage:'gate',required:true},
    {skillId:'traffic-distribution-discovery',stage:'distribution',required:false},
  ],
});

function db(){ return getDocumentDb(DB_ID); }
const snapshot = s => s?.exists ? s.data() : null;
const versionDocId = (id, n) => id+'--v'+n;
function clean(def){
  if(!def || typeof def!=='object')throw Error('Skill Pack definition is required');
  const skillType=def.skillType==='intelligence'?'intelligence':'workflow';
  if(!ID.test(String(def.id||'')) || (def.entrySkillId && !ID.test(String(def.entrySkillId)))
     || (skillType!=='intelligence' && !ID.test(String(def.entrySkillId||''))))
    throw Error('Invalid Skill Pack or entry Skill ID');
  if(!String(def.title||'').trim())throw Error('Skill Pack title is required');
  const ids = Array.isArray(def.supportingPackIds)?def.supportingPackIds:(Array.isArray(def.intelligenceIds)?def.intelligenceIds:[]);
  if(ids.some(x=>!ID.test(String(x))||x===def.id) || ids.length>8)throw Error('Invalid supporting Pack reference');
  if(!ID.test(String(def.dojoBaseId||'')))throw Error('A canonical existing dojoBaseId is required');
  const seen=new Set(), skills=[];
  for(const s of def.skills||[]){
    if(!ID.test(String(s.skillId||''))||!STAGE_ID.test(String(s.stage||''))||seen.has(s.skillId)||s.skillId===def.entrySkillId)
      throw Error('Invalid, duplicate or recursive Pack Skill');
    seen.add(s.skillId);
    skills.push({skillId:s.skillId,stage:s.stage,required:s.required===true});
  }
  if(!skills.length || skills.length>30)throw Error('Skill Pack requires 1–30 unique member Skills');
  return {id:def.id,title:String(def.title||'').trim().slice(0,160),
    summary:String(def.summary||'').trim().slice(0,800),entrySkillId:def.entrySkillId||null,
    skillType,supportingPackIds:[...new Set(ids)],intelligenceIds:[...new Set(ids)],
    dojoBaseId:def.dojoBaseId,skills};
}

// Idempotent, migration-safe bootstrap. Existing Skill versions, dojo method,
// user trials and Intelligence Pack documents are not modified.
async function ensureLegacyPack(){
  const ref=db().collection(PACKS).doc(SEED.id);
  const vref=db().collection(VERSIONS).doc(versionDocId(SEED.id,1));
  await db().runTransaction(async tx=>{
    const [index,version]=await Promise.all([tx.get(ref),tx.get(vref)]);
    if(index.exists)return;
    if(version.exists)throw Error('Skill Pack migration has an orphaned version');
    const at=new Date().toISOString();
    const definition=clean(SEED);
    tx.set(ref,{...definition,revision:1,currentVersionNumber:1,status:'active',createdAt:at,updatedAt:at,
      migratedFrom:{entrySkillId:definition.entrySkillId,dojoBaseId:definition.dojoBaseId}});
    tx.set(vref,{...definition,versionNumber:1,createdAt:at,
      changeSummary:'Initial Skill Pack wrapper; preserve existing coordinator Skill, Intelligence and dojo history'});
  });
}
function listSummary(p){
  return {id:p.id,title:p.title,summary:p.summary,entrySkillId:p.entrySkillId,
    skillType:p.skillType||'workflow',supportingPackIds:p.supportingPackIds||p.intelligenceIds||[],
    intelligenceIds:p.intelligenceIds||[],dojoBaseId:p.dojoBaseId,
    memberCount:(p.skills||[]).length,skills:p.skills||[],
    currentVersionNumber:p.currentVersionNumber,status:p.status};
}
async function list(){
  await ensureLegacyPack();
  const snap=await db().collection(PACKS).limit(100).get();
  const persisted=snap.docs.map(d=>listSummary(d.data())).filter(p=>p.status==='active');
  const legacy=await bridge.legacyList();
  const ids=new Set(persisted.map(p=>p.id));
  const items=[...persisted,...legacy.filter(p=>!ids.has(p.id))]
    .sort((a,b)=>a.title.localeCompare(b.title));
  return {items,count:items.length,kind:'skill_pack',databaseId:DB_ID,
    classification:'Skill Pack is a distinct composite concept; Intelligence is a Skill subtype'};
}
function selectMemberSkills(definition,stages){
  const registered=new Set((definition.skills||[]).map(s=>s.stage));
  if(stages!==undefined&&(!Array.isArray(stages)||stages.some(x=>!registered.has(x))))
    throw Error('stages must contain recognized Skill stages');
  return definition.skills.filter(s=>s.required || (stages||[]).includes(s.stage));
}
async function get(input={}){
  await ensureLegacyPack();
  const id=String(input.id||'');
  if(bridge.owned(id))return getLegacyPack(input);
  if(!ID.test(id))throw Error('Skill Pack id is required');
  const index=snapshot(await db().collection(PACKS).doc(id).get());
  if(!index)throw Error('Skill Pack not found: '+id);
  const release=input.resolve===true?await require('./explorationBaseStore').trainersOf({kind:'skill_pack',id}):[];
  const approved=[...new Set(release.map(x=>Number(x.releasedVersion)).filter(n=>Number.isInteger(n)&&n>0))];
  if(approved.length>1)throw Error('Conflicting Skill Pack dojo releases: '+id);
  // The old Buzz Pack is an approved v1 wrapper around a separately released
  // coordinator Skill. A new manifest version must NOT go live by default.
  const legacyBaseline=index.migratedFrom?.entrySkillId&&index.migratedFrom?.dojoBaseId?1:null;
  const released=approved[0]||legacyBaseline;
  if(input.resolve===true&&!released)throw Error('Skill Pack has no released dojo version: '+id);
  if(input.resolve===true&&input.versionNumber!==undefined&&Number(input.versionNumber)!==released)
    throw Error('Unapproved Skill Pack version for execution: '+id+' v'+input.versionNumber);
  const versionNumber=input.resolve===true?released:
    (input.versionNumber===undefined?index.currentVersionNumber:Number(input.versionNumber));
  if(!Number.isInteger(versionNumber)||versionNumber<1)throw Error('Invalid Skill Pack version');
  const definition=snapshot(await db().collection(VERSIONS).doc(versionDocId(id,versionNumber)).get());
  if(!definition)throw Error('Skill Pack version not found: '+id+' v'+versionNumber);
  const result={pack:listSummary(index),definition,
    executionPolicy:'Read current dojo-approved Skills; referenced MCC is an Intelligence-type Skill Pack, not a separate layer',
    legacyEntryAlias:definition.entrySkillId,
    historicDojoRetained:definition.dojoBaseId,
    versionPolicy:approved.length?'latest_dojo_release':(input.resolve===true&&legacyBaseline?'legacy_entry_approved_pack_baseline':'latest_registry_version'),
    dojos:release};
  if(input.resolve!==true)return result;
  const selected=selectMemberSkills(definition,input.stages);
  const resolved=await Promise.all([definition.entrySkillId,...selected.map(s=>s.skillId)]
    .filter(Boolean).map(id=>chatSkills.getExecutableSkill({id,includeRelations:false})));
  const hasEntry=Boolean(definition.entrySkillId);
  const entry=hasEntry?resolved[0]:null;
  const members=hasEntry?resolved.slice(1):resolved;
  result.execution={entry:entry?{id:entry.id,title:entry.title,revision:entry.revision,
      versionPolicy:entry.versionPolicy,body:entry.body}:null,
    members:members.map((s,i)=>({...selected[i],title:s.title,
      revision:s.revision,versionPolicy:s.versionPolicy,body:s.body})),
    supportingPacks:(definition.intelligenceIds||[]).map(id=>({id,registry:'skillPacks',resolver:'skill_pack_get'})),
    intelligenceReferences:(definition.intelligenceIds||[]).map(id=>({id,registry:'intelligencePacks',
      resolver:'intelligence_pack_get (legacy compatibility)'})),
    note:'MCC is available as an Intelligence-type Skill Pack, and specialist Skill bodies retain their own approved versions.'};
  return result;
}
async function createVersion(input={}){
  if(input.confirm!==true)throw Error('skill_pack_version_create requires confirm=true');
  const definition=clean(input.pack);
  if(bridge.owned(definition.id))throw Error('Historical Intelligence Pack versions remain with the original immutable registry; do not create a second live source of truth for '+definition.id);
  const expected=Number(input.expectedCurrentVersion);
  if(!Number.isInteger(expected)||expected<0)throw Error('expectedCurrentVersion must be a nonnegative integer');
  const changeSummary=String(input.changeSummary||'').trim();
  if(changeSummary.length<8||changeSummary.length>1200)throw Error('A specific changeSummary (8-1200 chars) is required');
  await ensureLegacyPack();
  const packRef=db().collection(PACKS).doc(definition.id);
  const next=expected+1;
  const versionRef=db().collection(VERSIONS).doc(versionDocId(definition.id,next));
  await db().runTransaction(async tx=>{
    const [rootSnap,versionSnap]=await Promise.all([tx.get(packRef),tx.get(versionRef)]);
    const existing=snapshot(rootSnap);
    const current=Number(existing?.currentVersionNumber)||0;
    if(current!==expected)throw Error('Skill Pack version conflict: expected '+expected+', current '+current);
    if(existing?.status==='archived')throw Error('Archived Skill Pack cannot be revised');
    if(versionSnap.exists)throw Error('Immutable Skill Pack version already exists: '+definition.id+' v'+next);
    const at=new Date().toISOString();
    tx.set(versionRef,{...definition,versionNumber:next,changeSummary,createdAt:at});
    tx.set(packRef,{...definition,currentVersionNumber:next,revision:(Number(existing?.revision)||0)+1,
      status:'active',createdAt:existing?.createdAt||at,updatedAt:at,
      ...(existing?.migratedFrom?{migratedFrom:existing.migratedFrom}:{})});
  });
  // A new Registry version is only a candidate until its dojo explicitly releases it.
  return get({id:definition.id,versionNumber:next});
}
async function getLegacyPack(input={}){
  const id=String(input.id||'');
  const release=input.resolve===true?await bridge.resolvedVersionForPack(id):{versionNumber:null,dojos:[]};
  if(input.resolve===true && input.versionNumber!==undefined && release.versionNumber!==null
    && Number(input.versionNumber)!==release.versionNumber)
    throw Error('Unapproved Skill Pack version for execution: '+id+' v'+input.versionNumber);
  const effectiveVersion=release.versionNumber||input.versionNumber;
  const result=await bridge.legacyGet({id,versionNumber:effectiveVersion});
  result.executionPolicy='Legacy immutable Intelligence Pack history projected into the composite Skill interface. Skill texts use current dojo releases.';
  result.versionPolicy=release.versionNumber?'latest_dojo_release':'latest_registry_version';
  result.dojos=release.dojos;
  if(input.resolve!==true)return result;
  const stages=result.definition.stages||[];
  if(input.stages!==undefined&&(!Array.isArray(input.stages)||input.stages.some(x=>!stages.some(s=>s.id===x))))
    throw Error('Unknown selected Skill Pack stages for '+id);
  const selectedStages=input.stages===undefined?stages.map(s=>s.id):input.stages;
  const selected=result.definition.skills.filter(s=>s.required || (selectedStages.includes(s.stage)&&s.recommended));
  const ids=[...new Set(selected.map(s=>s.skillId))];
  const [entry,...members]=await Promise.all([
    result.definition.entrySkillId,
    ...ids,
  ].filter(Boolean).map(skillId=>chatSkills.getExecutableSkill({id:skillId,includeRelations:false})));
  const hasEntry=Boolean(result.definition.entrySkillId);
  const actualEntry=hasEntry?entry:null;
  const actualMembers=hasEntry?members:[entry,...members].filter(Boolean);
  result.execution={
    instructions:result.definition.instructions,
    stages,
    entry:actualEntry?{id:actualEntry.id,title:actualEntry.title,revision:actualEntry.revision,
      versionPolicy:actualEntry.versionPolicy,body:actualEntry.body}:null,
    members:actualMembers.map(s=>({id:s.id,skillId:s.id,title:s.title,revision:s.revision,
      versionPolicy:s.versionPolicy,body:s.body})),
    versionNumber:result.definition.versionNumber,
    source:'Legacy immutable version served through Skill Pack; no copied mutable Intelligence record',
  };
  return result;
}
module.exports={list,get,createVersion,getLegacyPack,ensureLegacyPack,clean,selectMemberSkills,SEED};
