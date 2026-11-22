/* ChatGPT Skill data: My Portal's chatSkills collection is canonical.
 * GitHub SKILL.md files and prior Methods are import sources or optional exports,
 * not execution authorities. The first read bootstraps imported skills into DB
 * only if missing; subsequent reads and edits always use the database.
 */
const { getDocumentDb, FieldValue } = require('./documentDb');
const { applyTextEdits } = require('./textEdits');
const SEEDS = require('./chatSkillSeeds');
const DB_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const db = () => getDocumentDb(DB_ID);
const SKILLS = 'chatSkills';
const SKILL_VERSIONS = 'chatSkillVersions';
const SKILL_BODY_LIMIT = 45000;
// Working budget for a skill body. Past it, or when one update adds a lot, the response carries a
// notice so the editor consolidates rules instead of appending (World Home Agent Guide).
const SKILL_BODY_BUDGET = 20000;
const SKILL_GROWTH_NOTICE = 2000;
function skillSizeNotice(previousLength, nextLength) {
 const notes=[];
 if(nextLength>SKILL_BODY_BUDGET)notes.push('本文は '+nextLength+' 字で、目安の '+SKILL_BODY_BUDGET+' 字を超えている。次の更新では、規則の統合・古い規則の削除で純減させる。経緯・引用・個別の稿は道場の台帳と版履歴に置く。');
 if(previousLength>0&&nextLength-previousLength>SKILL_GROWTH_NOTICE)notes.push('今回の更新で '+(nextLength-previousLength)+' 字増えた。追記ではなく、既存の規則の書き換え・統合で済ませられないか確認する。');
 return notes.length?{length:nextLength,budget:SKILL_BODY_BUDGET,previousLength,notes}:null;
}
const NOTES = 'aiContextNotes';
function safeString(value, limit=4000) { return String(value??'').trim().slice(0,limit); }
function safeStrings(value, max=20) { return Array.isArray(value) ? value.slice(0,max).map(x=>safeString(x,180)).filter(Boolean) : []; }
function cleanSkill(value) {
 const id=safeString(value?.id,90);
 if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Skill id must be kebab-case');
 const title=safeString(value?.title,220);
 if (!title) throw new Error('Skill title required');
 const rawBody=String(value?.body??'').trim();
 // Refuse instead of truncating: a silent cut once dropped the end of a skill without anyone noticing.
 if(rawBody.length>SKILL_BODY_LIMIT)throw new Error('Skill body is '+rawBody.length+' characters; the limit is '+SKILL_BODY_LIMIT+'. Consolidate the rules (move history, quotes and per-sample evidence to the dojo ledger) instead of adding more.');
 const body=rawBody;
 if(!body||body.length<50) throw new Error('Skill body required (full executable instructions)');
 return {
  id,title,summary:safeString(value?.summary,1100),
  triggers:safeStrings(value?.triggers,25), body,
  status:['available','paused','archived'].includes(value.status)?value.status:'available',
  sourceOfTruth:'My Portal DB', kind:'chat_skill',
  importProvenance:safeString(value?.importProvenance,350)||null,
 };
}
function summary(skill) {
 return {
  id:skill.id,title:skill.title,summary:skill.summary,triggers:skill.triggers,
  status:skill.status||'available',kind:'chat_skill',
  sourceOfTruth:'My Portal DB',revision:Number(skill.revision)||0,
  updatedAt:skill.updatedAt?.toDate?.()?.toISOString?.() || skill.updatedAt || null,
  importProvenance:skill.importProvenance||null,
 };
}
function skillData(snapshot) {
 const v={id:snapshot.id,...snapshot.data()};
 return {...summary(v),body:v.body};
}
async function bootstrapSkills() {
 const collection=db().collection(SKILLS);
 const all=await collection.limit(250).get();
 const known=new Set(all.docs.map(d=>d.id));
 const missing=SEEDS.filter(s=>!known.has(s.id));
 if(missing.length===0)return;
 await db().runTransaction(async tx=>{
  const refs=missing.map(s=>({value:cleanSkill(s),ref:collection.doc(s.id)}));
  const snaps=await Promise.all(refs.map(o=>tx.get(o.ref)));
  refs.forEach((o,i)=>{
   if(snaps[i].exists)return;
   tx.set(o.ref,{...o.value,revision:1,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
   const vref=db().collection(SKILL_VERSIONS).doc(o.value.id+'__000001');
   tx.set(vref,{...o.value,versionNumber:1,changeReason:'Initial migration to My Portal Skill DB',createdAt:FieldValue.serverTimestamp()});
  });
 });
}
async function upgradeNavigationContextRoute() {
 const ref=db().collection(SKILLS).doc('world-home-navigation');
 await db().runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists)return;
   const old=snap.data();
   // One-time guarded compatibility migration; never overwrite user-edited Skills.
   if(Number(old.revision)!==1 || !String(old.body||'').includes('aiContexts'))return;
   const body=String(old.body).replaceAll('aiContexts','contexts')
     .replace('登録済みのProject/Method/Spaceは動的に反映される。',
       '登録済みのProjects/Skills/ContextsはWorld Homeに動的に反映される。Contextsは人間側Spaceと別DBで、Project IDとDomainを使って context_list / context_get で既決事項と訂正履歴を確認する。');
   const updated={...old,body,revision:2,updatedAt:FieldValue.serverTimestamp()};
   tx.set(ref,updated);
   const version=db().collection(SKILL_VERSIONS).doc('world-home-navigation__000002');
   tx.set(version,{...updated,versionNumber:2,changeReason:'Switch from AI-side Spaces to project/domain Contexts',
     createdAt:FieldValue.serverTimestamp()});
 });
}
async function listSkills(input={}) {
 await bootstrapSkills();
 await upgradeNavigationContextRoute();
 const snap=await db().collection(SKILLS).limit(250).get();
 return {items:snap.docs.map(d=>summary({id:d.id,...d.data()})).filter(s=>input.includeArchived===true||s.status!=='archived').sort((a,b)=>a.title.localeCompare(b.title)),
  sourceOfTruth:'My Portal DB / chatSkills',
  notInstalledWarning:'Saving a skill in My Portal does not install it in ChatGPT. ChatGPT Skill installation is a separate user/product action.'};
}
// Lazy: the exploration base store loads the intelligence registry, which loads this module.
async function dojosFor(id){
 try{return await require('./explorationBaseStore').trainersOf({kind:'chat_skill',id});}catch(error){return [];}
}
function dojoNotice(dojos,id,revision){
 if(!dojos.length)return null;
 return dojos.map(d=>{
  const head='このスキルは道場「'+d.title+'」（'+d.baseId+'）で鍛えられている。実行で使うのは道場が合格させた v'+d.releasedVersion+'。';
  if(!(revision&&d.releasedVersion&&revision>d.releasedVersion))return head+'変更したら、道場で合格させるまで実行には使われない。';
  return head+'v'+revision+' はまだ道場を通っていないので実行には使われない。使うには、根拠（終わったrunか本人の判断）と練習問題の結果を添えて exploration_method_version_set({baseId:"'+d.baseId+'", method:{bodyRef:{kind:"chat_skill", location:"'+id+'", versionNumber:'+revision+'}, ...}}) で合格させる。';
 }).join('\n');
}
async function getSkill(input) {
 await bootstrapSkills();
 const id=safeString(input.id,90);
 const snap=await db().collection(SKILLS).doc(id).get();
 if(!snap.exists)throw new Error('Unknown chat Skill: '+id);
 const skill=skillData(snap);
 const dojos=await dojosFor(id);
 return dojos.length?{...skill,dojos,dojoNotice:dojoNotice(dojos,id,skill.revision)}:skill;
}
// Read a single immutable version by ID, independent of the 30-entry history
// display window. Dojo-approved execution must never fall back to a draft.
async function skillVersionGet(input={}) {
 await bootstrapSkills();
 const id=safeString(input.id,90);
 const number=Number(input.versionNumber);
 if(!/^[a-z][a-z0-9-]*$/.test(id))throw new Error('Skill ID must be kebab-case');
 if(!Number.isInteger(number)||number<1)throw new Error('versionNumber must be a positive integer');
 const doc=await db().collection(SKILL_VERSIONS).doc(id+'__'+String(number).padStart(6,'0')).get();
 if(!doc.exists)throw new Error('Chat Skill version not found: '+id+' v'+number);
 const item=doc.data();
 if(item.id!==id||Number(item.versionNumber)!==number)throw new Error('Chat Skill version record mismatch');
 return {...summary(item),versionNumber:number,body:item.body,changeReason:item.changeReason||''};
}

// Public execution view always contains the newest approved body.
// Editing must opt into getSkill, which retains the Registry draft and revision.
async function getExecutableSkill(input={}) {
 const current=await getSkill(input);
 const dojos=await require('./explorationBaseStore').trainersOf({kind:'chat_skill',id:current.id});
 if(!dojos.length)return {...current,versionPolicy:'latest_registry_version',registryRevision:current.revision};
 const releases=[...new Set(dojos.map(d=>Number(d.releasedVersion))
   .filter(v=>Number.isInteger(v)&&v>0))];
 if(releases.length!==1||dojos.some(d=>!Number(d.releasedVersion)))
   throw new Error('Chat Skill has missing or conflicting dojo release: '+current.id);
 const approved=await skillVersionGet({id:current.id,versionNumber:releases[0]});
 return {...current,body:approved.body,revision:approved.versionNumber,
   registryRevision:current.revision,versionPolicy:'latest_dojo_release',dojos,
   dojoNotice:dojoNotice(dojos,current.id,current.revision)};
}
async function upsertSkill(input) {
 if(input.confirm!==true)throw new Error('Explicit confirmation required');
 let draft=input.skill||{};
 if(input.bodyEdits!==undefined){
  if(draft.body!==undefined)throw new Error('Pass either skill.body or bodyEdits, not both');
  const existing=await db().collection(SKILLS).doc(safeString(draft.id,90)).get();
  if(!existing.exists)throw new Error('bodyEdits needs an existing skill');
  const current=existing.data();
  // Unspecified fields keep their stored value; the revision check below still guards against races.
  draft={id:current.id||existing.id,title:current.title,summary:current.summary,triggers:current.triggers,status:current.status,...draft,
   body:applyTextEdits(current.body,input.bodyEdits,'bodyEdits')};
 }
 const cleaned=cleanSkill(draft);
 const expectedRevision=Number(input.expectedRevision);
 if(!Number.isInteger(expectedRevision)||expectedRevision<0)throw new Error('expectedRevision must be a nonnegative integer');
 const ref=db().collection(SKILLS).doc(cleaned.id);
 let previousLength=0;
 await db().runTransaction(async tx=>{
  const snap=await tx.get(ref);
  const current=snap.exists?snap.data():{};
  previousLength=String(current.body||'').length;
  const rev=Number(current.revision)||0;
  if(rev!==expectedRevision)throw new Error('Skill revision conflict');
  const next=rev+1;
  // Preserve imported provenance unless the editor intentionally supplies it.
  const record={...cleaned,importProvenance:cleaned.importProvenance||current.importProvenance||null,
    revision:next,createdAt:current.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()};
  tx.set(ref,record);
  const versionRef=db().collection(SKILL_VERSIONS).doc(cleaned.id+'__'+String(next).padStart(6,'0'));
  tx.set(versionRef,{...record,versionNumber:next,changeReason:safeString(input.changeReason,800)||'Skill updated',createdAt:FieldValue.serverTimestamp()});
 });
 const saved=await getSkill({id:cleaned.id});
 const sizeNotice=skillSizeNotice(previousLength,cleaned.body.length);
 return sizeNotice?{...saved,sizeNotice}:saved;
}
async function skillVersions(input={}) {
 const id=safeString(input.id,90);
 if(!id)throw new Error('Skill id required');
 // Query by the skill id stored on each version; scanning the whole collection silently missed versions
 // once it held more than 250 documents.
 const snap=await db().collection(SKILL_VERSIONS).where('id','==',id).limit(500).get();
 const items=snap.docs.map(d=>({...d.data(),docId:d.id})).filter(d=>d.docId.startsWith(id+'__'))
  .sort((a,b)=>Number(b.versionNumber)-Number(a.versionNumber)).slice(0,30)
  .map(d=>({...summary(d),versionNumber:d.versionNumber,changeReason:d.changeReason||'',body:d.body}));
 return {skillId:id,items};
}
const NOTE_KINDS=['decision','correction','handoff','finding'];
function serializeNote(doc) {
 const d=typeof doc.data==='function'?doc.data():doc;
 return {id:doc.id,spaceId:d.spaceId,kind:d.kind,summary:d.summary,
  detail:d.detail||'',source:d.source||'',sourceUrl:d.sourceUrl||'',
  createdAt:d.createdAt?.toDate?.()?.toISOString?.() || d.createdAt || null};
}
async function listNotes(input={}) {
 const spaceId=safeString(input.spaceId,160);
 const max=Math.min(Math.max(Number(input.limit)||30,1),100);
 const base=db().collection(NOTES);
 // Limit to at most 250. Filter and sort on client to avoid new composite indexes.
 const snap=await base.limit(250).get();
 const items=snap.docs.map(serializeNote).filter(x=>!spaceId||x.spaceId===spaceId)
   .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,max);
 return {items,count:items.length,spaceId:spaceId||null};
}
async function createNote(input) {
 if(input.confirm!==true)throw new Error('Explicit confirmation required to save chat history');
 const spaceId=safeString(input.spaceId,160);
 const summary=safeString(input.summary,800);
 if(!spaceId||!summary)throw new Error('spaceId and summary required');
 const kind=NOTE_KINDS.includes(input.kind)?input.kind:'handoff';
 const spaceSnap=await db().collection('spaces').doc(spaceId).get();
 if(!spaceSnap.exists||spaceSnap.data()?.themeOwner!=='assistant')throw new Error('Chat notes only belong to AI-side Spaces');
 const dedupe=safeString(input.idempotencyKey,200);
 // Supplied idempotency key makes repeated chat turn saves harmless.
 const ref=dedupe?db().collection(NOTES).doc(require('node:crypto').createHash('sha256').update(spaceId+'|'+dedupe).digest('hex')):db().collection(NOTES).doc();
 const data={spaceId,summary,kind,detail:safeString(input.detail,4500),source:safeString(input.source,180),sourceUrl:safeString(input.sourceUrl,1000),createdAt:FieldValue.serverTimestamp()};
 await db().runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)tx.set(ref,data);});
 const snapshot=await ref.get();
 return serializeNote(snapshot);
}
async function removeSkill(input={}) {
 if(input.confirm!==true)throw new Error('Explicit confirmation required');
 const id=safeString(input.id,90);
 if(!/^[a-z][a-z0-9-]*$/.test(id))throw new Error('Skill id must be kebab-case');
 const expected=Number(input.expectedRevision);
 if(!Number.isInteger(expected)||expected<0)throw new Error('expectedRevision must be a nonnegative integer');
 const ref=db().collection(SKILLS).doc(id);
 const snap=await ref.get();
 if(!snap.exists)throw new Error('Skill not found: '+id);
 const current=snap.data();
 if((Number(current.revision)||0)!==expected)throw new Error('Skill revision conflict; reload before deleting');
 if(current.status!=='archived')throw new Error('Only archived Skills can be permanently deleted');
 // Do not remove a Skill still carried by any active or paused dojo.
 const trainers=await require('./explorationBaseStore').trainersOf({kind:'chat_skill',id});
 if(trainers.length)throw new Error('Skill is still used by a non-closed dojo: '+trainers.map(x=>x.baseId).join(', '));
 const versions=await db().collection(SKILL_VERSIONS).where('id','==',id).limit(501).get();
 if(versions.docs.length>500)throw new Error('More than 500 Skill versions found; deletion needs a reviewed batch');
 for(let i=0;i<versions.docs.length;i+=25) {
  await Promise.all(versions.docs.slice(i,i+25).map(doc=>doc.ref.delete()));
 }
 await ref.delete();
 return {id,title:current.title,deletedVersions:versions.docs.length,deleted:true};
}
module.exports={listSkills,getSkill,getExecutableSkill,upsertSkill,skillVersions,skillVersionGet,removeSkill,listNotes,createNote,cleanSkill,skillSizeNotice,SKILL_BODY_LIMIT,SKILL_BODY_BUDGET};
