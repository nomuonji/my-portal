/* ChatGPT skills and AI-side conversation context belong above the Agent HQ
 * Method/Worker layer. GitHub SKILL.md files are canonical; this directory
 * stores pointers and classification, never a second executable Method.
 */
const { getDocumentDb, FieldValue } = require('./documentDb');
const DB_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const db = () => getDocumentDb(DB_ID);
const SKILLS = 'chatSkills';
const NOTES = 'aiContextNotes';
const BUILTIN_SKILLS = Object.freeze([
 {id:'human-web-voice',title:'Human Web Voice',summary:'人が書いたネット文章を観察し、媒体の役割に合わせて執筆・編集する。',triggers:['文章','記事執筆','SNS文体','自然な文体'],repo:'nomuonji/skills',path:'human-web-voice/SKILL.md',status:'available',kind:'github_skill'},
 {id:'site-originality-studio',title:'Site Originality Studio',summary:'サイトの編集思想から世界観、UI/UX、ブランドの独自性を設計する。',triggers:['サイトデザイン','UI','UX','世界観','ブランディング'],repo:'nomuonji/skills',path:'site-originality-studio/SKILL.md',status:'available',kind:'github_skill'},
 {id:'idea-resonance-lab',title:'Idea Resonance Lab',summary:'実際の観測から、刺さる企画・商品・コンテンツを発想して検証する。',triggers:['企画','アイデア','市場','刺さる'],repo:'nomuonji/skills',path:'idea-resonance-lab/SKILL.md',status:'available',kind:'github_skill'},
]);
function safeString(value, limit=4000) { return String(value??'').trim().slice(0,limit); }
function safeStrings(value, max=20) { return Array.isArray(value) ? value.slice(0,max).map(x=>safeString(x,180)).filter(Boolean) : []; }
function checkSkill(value) {
 const id=safeString(value?.id,90);
 if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Skill id must be kebab-case');
 const title=safeString(value?.title,220);
 if (!title) throw new Error('Skill title required');
 const repo=safeString(value?.repo,190);
 const path=safeString(value?.path,320);
 if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo) || !/^(?!\/)(?!.*\.\.)[a-zA-Z0-9_./-]+\/SKILL\.md$/.test(path))
   throw new Error('Skill must point at a GitHub repo SKILL.md');
 return {
  id,title,summary:safeString(value?.summary,1100),triggers:safeStrings(value?.triggers,25),
  repo,path,kind:'github_skill',
  status:['available','paused','archived'].includes(value.status)?value.status:'available',
  note:safeString(value?.note,1200),
 };
}
function projectSkill(skill) {
 const x=checkSkill(skill);
 return { ...x, url:`https://github.com/${x.repo}/blob/main/${x.path}`, installState:'not_verified',
   sourceOfTruth:'GitHub SKILL.md', revision:Number(skill.revision)||0,
   updatedAt: skill.updatedAt?.toDate?.()?.toISOString?.() || skill.updatedAt || null };
}
async function listSkills() {
 const snap=await db().collection(SKILLS).limit(250).get();
 const skills=new Map(BUILTIN_SKILLS.map(s=>[s.id,projectSkill(s)]));
 snap.docs.forEach(d=>{try{const entry=projectSkill({id:d.id,...d.data()});skills.set(entry.id,entry);}catch(_) {}});
 return {items:[...skills.values()].filter(s=>s.status!=='archived').sort((a,b)=>a.title.localeCompare(b.title)),source:'chatSkills + built-in verified pointers',notInstalledWarning:'GitHub storage does not mean the skill is installed in ChatGPT. Check the active ChatGPT Skill catalog in that session.'};
}
async function getSkill(input) {
 const id=safeString(input.id,90);
 const snap=await db().collection(SKILLS).doc(id).get();
 const entry=snap.exists ? {id,...snap.data()} : BUILTIN_SKILLS.find(s=>s.id===id);
 if(!entry)throw new Error('Unknown chat skill: '+id);
 return projectSkill(entry);
}
async function upsertSkill(input) {
 if(input.confirm!==true)throw new Error('Explicit confirmation required');
 const cleaned=checkSkill(input.skill||{});
 const ref=db().collection(SKILLS).doc(cleaned.id);
 const revision=Number(input.expectedRevision);
 if(!Number.isInteger(revision)||revision<0)throw new Error('expectedRevision required');
 await db().runTransaction(async tx=>{
   const snap=await tx.get(ref);
   const current=snap.exists ? snap.data() : {};
   if((Number(current.revision)||0)!==revision)throw new Error('Skill revision conflict');
   tx.set(ref,{...cleaned,revision:revision+1,updatedAt:FieldValue.serverTimestamp()}, {merge:false});
 });
 return getSkill({id:cleaned.id});
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
module.exports={listSkills,getSkill,upsertSkill,listNotes,createNote,BUILTIN_SKILLS,checkSkill};
