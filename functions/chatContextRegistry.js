/* ChatGPT Skill data: My Portal's chatSkills collection is canonical.
 * GitHub SKILL.md files and prior Methods are import sources or optional exports,
 * not execution authorities. The first read bootstraps imported skills into DB
 * only if missing; subsequent reads and edits always use the database.
 */
const { getDocumentDb, FieldValue } = require('./documentDb');
const SEEDS = require('./chatSkillSeeds');
const DB_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const db = () => getDocumentDb(DB_ID);
const SKILLS = 'chatSkills';
const SKILL_VERSIONS = 'chatSkillVersions';
const NOTES = 'aiContextNotes';
function safeString(value, limit=4000) { return String(value??'').trim().slice(0,limit); }
function safeStrings(value, max=20) { return Array.isArray(value) ? value.slice(0,max).map(x=>safeString(x,180)).filter(Boolean) : []; }
function cleanSkill(value) {
 const id=safeString(value?.id,90);
 if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Skill id must be kebab-case');
 const title=safeString(value?.title,220);
 if (!title) throw new Error('Skill title required');
 const body=safeString(value?.body,45000);
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
async function listSkills() {
 await bootstrapSkills();
 const snap=await db().collection(SKILLS).limit(250).get();
 return {items:snap.docs.map(d=>summary({id:d.id,...d.data()})).filter(s=>s.status!=='archived').sort((a,b)=>a.title.localeCompare(b.title)),
  sourceOfTruth:'My Portal DB / chatSkills',
  notInstalledWarning:'Saving a skill in My Portal does not install it in ChatGPT. ChatGPT Skill installation is a separate user/product action.'};
}
async function getSkill(input) {
 await bootstrapSkills();
 const id=safeString(input.id,90);
 const snap=await db().collection(SKILLS).doc(id).get();
 if(!snap.exists)throw new Error('Unknown chat Skill: '+id);
 return skillData(snap);
}
async function upsertSkill(input) {
 if(input.confirm!==true)throw new Error('Explicit confirmation required');
 const cleaned=cleanSkill(input.skill||{});
 const expectedRevision=Number(input.expectedRevision);
 if(!Number.isInteger(expectedRevision)||expectedRevision<0)throw new Error('expectedRevision must be a nonnegative integer');
 const ref=db().collection(SKILLS).doc(cleaned.id);
 await db().runTransaction(async tx=>{
  const snap=await tx.get(ref);
  const current=snap.exists?snap.data():{};
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
 return getSkill({id:cleaned.id});
}
async function skillVersions(input={}) {
 const id=safeString(input.id,90);
 if(!id)throw new Error('Skill id required');
 const snap=await db().collection(SKILL_VERSIONS).limit(250).get();
 const items=snap.docs.map(d=>({id:d.id,...d.data()})).filter(d=>d.id.startsWith(id+'__'))
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
module.exports={listSkills,getSkill,upsertSkill,skillVersions,listNotes,createNote,cleanSkill};
