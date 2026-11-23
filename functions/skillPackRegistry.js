'use strict';

// Skill Packs assemble canonical Chat Skills. They are NOT Intelligence Packs:
// intelligence provides task-specific judgment; Skill Packs own the workflow.
// The legacy coordinator remains a referenced Skill so its dojo history and
// released version survive this additive migration without copying its body.
const { getDocumentDb } = require('./documentDb');
const chatSkills = require('./chatContextRegistry');

const DB_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const PACKS = 'skillPacks', VERSIONS = 'skillPackVersions';
const ID = /^[a-z][a-z0-9-]{1,89}$/;
const STAGES = new Set(['source','selection','audience','transform','humor','voice','gate','distribution']);
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
  if(!ID.test(String(def.id||'')) || !ID.test(String(def.entrySkillId||'')))throw Error('Invalid Skill Pack or entry Skill ID');
  const ids = Array.isArray(def.intelligenceIds)?def.intelligenceIds:[];
  if(ids.some(x=>!ID.test(String(x))) || ids.length>8)throw Error('Invalid Intelligence reference');
  if(!ID.test(String(def.dojoBaseId||'')))throw Error('A canonical existing dojoBaseId is required');
  const seen=new Set(), skills=[];
  for(const s of def.skills||[]){
    if(!ID.test(String(s.skillId||''))||!STAGES.has(s.stage)||seen.has(s.skillId)||s.skillId===def.entrySkillId)
      throw Error('Invalid, duplicate or recursive Pack Skill');
    seen.add(s.skillId);
    skills.push({skillId:s.skillId,stage:s.stage,required:s.required===true});
  }
  if(!skills.length || skills.length>30)throw Error('Skill Pack requires 1–30 unique member Skills');
  return {id:def.id,title:String(def.title||'').trim().slice(0,160),
    summary:String(def.summary||'').trim().slice(0,800),entrySkillId:def.entrySkillId,
    intelligenceIds:[...new Set(ids)],dojoBaseId:def.dojoBaseId,skills};
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
    intelligenceIds:p.intelligenceIds||[],dojoBaseId:p.dojoBaseId,
    memberCount:(p.skills||[]).length,skills:p.skills||[],
    currentVersionNumber:p.currentVersionNumber,status:p.status};
}
async function list(){
  await ensureLegacyPack();
  const snap=await db().collection(PACKS).limit(100).get();
  const items=snap.docs.map(d=>listSummary(d.data()))
    .filter(p=>p.status==='active').sort((a,b)=>a.title.localeCompare(b.title));
  return {items,count:items.length,kind:'skill_pack',databaseId:DB_ID};
}
function selectMemberSkills(definition,stages){
  if(stages!==undefined&&(!Array.isArray(stages)||stages.some(x=>!STAGES.has(x))))
    throw Error('stages must contain recognized Skill stages');
  return definition.skills.filter(s=>s.required || (stages||[]).includes(s.stage));
}
async function get(input={}){
  await ensureLegacyPack();
  const id=String(input.id||'');
  if(!ID.test(id))throw Error('Skill Pack id is required');
  const index=snapshot(await db().collection(PACKS).doc(id).get());
  if(!index)throw Error('Skill Pack not found: '+id);
  const versionNumber=input.versionNumber===undefined?index.currentVersionNumber:Number(input.versionNumber);
  if(!Number.isInteger(versionNumber)||versionNumber<1)throw Error('Invalid Skill Pack version');
  const definition=snapshot(await db().collection(VERSIONS).doc(versionDocId(id,versionNumber)).get());
  if(!definition)throw Error('Skill Pack version not found: '+id+' v'+versionNumber);
  const result={pack:listSummary(index),definition,
    executionPolicy:'read live dojo-approved Chat Skills; Intelligence is a separate reference, not a child Pack',
    legacyEntryAlias:definition.entrySkillId,
    historicDojoRetained:definition.dojoBaseId};
  if(input.resolve!==true)return result;
  const selected=selectMemberSkills(definition,input.stages);
  const [entry,...members]=await Promise.all([definition.entrySkillId,...selected.map(s=>s.skillId)]
    .map(id=>chatSkills.getExecutableSkill({id,includeRelations:false})));
  result.execution={entry:{id:entry.id,title:entry.title,revision:entry.revision,
      versionPolicy:entry.versionPolicy,body:entry.body},
    members:members.map((s,i)=>({...selected[i],title:s.title,
      revision:s.revision,versionPolicy:s.versionPolicy,body:s.body})),
    intelligenceReferences:definition.intelligenceIds.map(id=>({id,registry:'intelligencePacks',
      resolver:'intelligence_pack_get / cognitive_bundle_resolve'})),
    note:'A Skill Pack orchestrates skills; it does not duplicate the Intelli­gence definition or override individual dojo approvals.'};
  return result;
}
module.exports={list,get,ensureLegacyPack,clean,selectMemberSkills,SEED};
