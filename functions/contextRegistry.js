/* Project/domain-scoped Contexts. Independent of human Thinking Spaces and Agent HQ Methods.
 * Legacy assistant-owned Spaces are copied idempotently, never deleted or repurposed.
 * The collection 'contexts' is canonical after import; legacy Space is provenance only.
 */
const { getDocumentDb, FieldValue } = require('./documentDb');
const crypto = require('node:crypto');
const db = () => getDocumentDb(process.env.AGENT_IDEAS_DATABASE_ID || '(default)');
const CONTEXTS = 'contexts';
const EVENTS = 'contextEvents';
const LEGACY_NOTES = 'aiContextNotes';
const key = value => String(value ?? '').trim();
const txt = (v,n=5000) => key(v).slice(0,n);
const strings=(a,n=20,max=150)=>[...new Set((Array.isArray(a)?a:[]).slice(0,n).map(v=>txt(v,max)).filter(Boolean))];
const iso = value=>value?.toDate?.()?.toISOString?.() || (typeof value==='string'?value:null);
const allowedKinds=['decision','correction','handoff','finding','update'];
const projectHints = {
 'QUZEAo2LJ7c4XhaMGBj2':['site-operations'],
 'iDHh01GdWNCE2g1Ce8xy':['knowledge-institute','site-operations'],
 'YDdXPTFVRe1lSmb9GwgF':['knowledge-institute','learning-os'],
 'A0GZ73VhZjmw58m5vlWM':['culture-institute'],
 'dCl9tY6FgwkmMsamDUah':['my-portal'],
 'DUTU7pufFyVmxj3sipK1':['my-portal','site-operations'],
 'KnZRTsVtjG2NdHUooHHE':['site-operations','my-portal'],
 'z67CXA9Ce6JAuGmlyCwG':['my-portal'],
};
const normalizeTitle = s=>txt(s,220).replace(/^AI側[：:]\s*/, '');
function serialize(doc) {
 const d=typeof doc.data==='function'?doc.data():doc;
 return {id:doc.id, title:d.title,summary:d.summary||'',purpose:d.purpose||'',
  decisions:d.decisions||'',currentState:d.currentState||'',nextActions:d.nextActions||'',
  projectIds:d.projectIds||[],domains:d.domains||[],status:d.status||'active',
  legacySpaceId:d.legacySpaceId||null,source:d.source||null,revision:Number(d.revision)||0,
  createdAt:iso(d.createdAt),updatedAt:iso(d.updatedAt)};
}
function clean(input={}) {
 const title=txt(input.title,220);if(!title)throw new Error('Context title required');
 const projectIds=strings(input.projectIds,30,140);
 const domains=strings(input.domains,30,100);
 if(!projectIds.length&&!domains.length)throw new Error('A Context needs at least one projectId or domain');
 return {title,summary:txt(input.summary,2000),purpose:txt(input.purpose,2500),
  decisions:txt(input.decisions,6500),currentState:txt(input.currentState,6500),
  nextActions:txt(input.nextActions,3500),projectIds,domains,
  status:['active','paused','archived'].includes(input.status)?input.status:'active'};
}
function legacyDoc(space) {
 const current=Array.isArray(space.nextActions)?space.nextActions.join('\n'):txt(space.nextActions);
 return {
   title:normalizeTitle(space.title),summary:txt(space.summary,2000),purpose:txt(space.goal,2500),
   decisions:txt(space.currentBrief,6500),currentState:txt(space.currentBrief,6500),
   nextActions:txt(current,3500),projectIds:projectHints[space.id]||[],
   domains:strings(space.domains?.length?space.domains:space.tags?.slice(0,4),30,100).length?
    strings(space.domains?.length?space.domains:space.tags?.slice(0,4),30,100):['general'],
   status:space.status==='archived'?'archived':'active',
   legacySpaceId:space.id,
   source:{kind:'legacy-assistant-space',id:space.id,importedAt:'2026-10-10'},
 };
}
// A one-time, idempotent COPY into the new collection. Legacy material stays untouched.
async function migrateLegacy() {
 const snap=await db().collection('spaces').limit(250).get();
 const eligible=snap.docs.filter(d=>d.data().themeOwner==='assistant' && d.data().status!=='archived');
 let imported=0;
 for(const doc of eligible){
   const ref=db().collection(CONTEXTS).doc('legacy-'+doc.id);
   await db().runTransaction(async tx=>{
     const old=await tx.get(ref);
     if(old.exists)return;
     tx.set(ref,{...legacyDoc({id:doc.id,...doc.data()}),revision:1,
       createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
     imported+=1;
   });
 }
 return {eligible:eligible.length,imported};
}
async function list(input={}) {
 await migrateLegacy();
 const docs=await db().collection(CONTEXTS).limit(250).get();
 const projectId=txt(input.projectId,140),domain=txt(input.domain,100);
 const items=docs.docs.map(serialize).filter(x=>(!projectId||x.projectIds.includes(projectId)) &&
 (!domain||x.domains.includes(domain)) && (input.includeArchived===true||x.status!=='archived'))
 .sort((a,b)=>a.title.localeCompare(b.title));
 return {items,count:items.length,filters:{projectId:projectId||null,domain:domain||null},
   sourceOfTruth:'contexts collection',legacyPolicy:'non-destructive copy, old Spaces only for provenance'};
}
async function listEvents(input={}) {
 const contextId=txt(input.contextId,160);
 if(!contextId)throw new Error('contextId required');
 const cap=Math.min(Math.max(Number(input.limit)||75,1),100);
 const [newSnap,legacySnap,decisionsSnap]=await Promise.all([
   db().collection(EVENTS).where('contextId','==',contextId).get(),
   db().collection(LEGACY_NOTES).limit(250).get(),
   db().collection('decisions').limit(250).get()
 ]);
 const oldId=contextId.startsWith('legacy-')?contextId.slice(7):null;
 const newItems=newSnap.docs.map(d=>({id:d.id,...d.data(),createdAt:iso(d.data().createdAt)}))
   .filter(x=>x.contextId===contextId);
 // Keep old discussion notes visible without changing their original ownership.
 const oldItems=legacySnap.docs.map(d=>({id:'legacy-note-'+d.id,...d.data(),
   contextId,createdAt:iso(d.data().createdAt),provenance:'legacy-ai-context-note'}))
   .filter(x=>oldId && x.spaceId===oldId);
 // Decisions previously attached to AI-owned Spaces remain available as historic evidence.
 // They are not copied into or edited as human Thinking Spaces.
 const decisionItems=decisionsSnap.docs.map(d=>({
   id:'legacy-decision-'+d.id,contextId,spaceId:d.data().spaceId,
   kind:'decision',summary:txt(d.data().decision+' — '+d.data().reason,1000),
   detail:txt(d.data().reason,5000),source:'My Portal legacy decision',
   createdAt:iso(d.data().createdAt),status:d.data().status||'active',
   provenance:'legacy-space-decision'
 })).filter(x=>oldId&&x.spaceId===oldId);
 const items=[...newItems,...oldItems,...decisionItems].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,cap);
 return {items,count:items.length,contextId,legacyNotesIncluded:Boolean(oldId)};
}
async function get(input={}) {
 const id=txt(input.id||input.contextId,160);if(!id)throw new Error('Context id required');
 await migrateLegacy();
 const snap=await db().collection(CONTEXTS).doc(id).get();
 if(!snap.exists)throw new Error('Context not found');
 const [history,projects]=await Promise.all([listEvents({contextId:id}),db().collection('projects').limit(250).get()]);
 return {context:serialize(snap),history:history.items,
  linkedProjects:projects.docs.filter(d=>snap.data().projectIds?.includes(d.id)).map(d=>({id:d.id,name:d.data().name||d.id}))};
}
async function save(input={}) {
 if(input.confirm!==true)throw new Error('confirm=true required');
 const id=txt(input.id,160);
 if(id&&!/^[a-z0-9A-Z][a-zA-Z0-9_-]{0,159}$/.test(id))throw new Error('Invalid context id');
 const data=clean(input.context||{});
 const expected=Number(input.expectedRevision ?? 0);
 if(!Number.isInteger(expected)||expected<0)throw new Error('Expected revision must be a nonnegative integer');
 const ref=id?db().collection(CONTEXTS).doc(id):db().collection(CONTEXTS).doc();
 await db().runTransaction(async tx=>{
   const snap=await tx.get(ref);
   const old=snap.exists?snap.data():{};
   if((Number(old.revision)||0)!==expected)throw new Error('Context revision conflict');
   tx.set(ref,{...data,source:old.source||{kind:'chat-context'},legacySpaceId:old.legacySpaceId||null,
     revision:expected+1,createdAt:old.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
 });
 return get({id:ref.id});
}
async function addEvent(input={}) {
 if(input.confirm!==true)throw new Error('confirm=true required');
 const contextId=txt(input.contextId,160),summary=txt(input.summary,1000);
 if(!contextId||!summary)throw new Error('contextId and summary required');
 await migrateLegacy();
 const parent=await db().collection(CONTEXTS).doc(contextId).get();
 if(!parent.exists)throw new Error('Context not found');
 const kind=allowedKinds.includes(input.kind)?input.kind:'handoff';
 const idem=txt(input.idempotencyKey,160);
 const id=idem?crypto.createHash('sha256').update(contextId+'|'+idem).digest('hex'):null;
 const ref=id?db().collection(EVENTS).doc(id):db().collection(EVENTS).doc();
 await db().runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(snap.exists)return;
   tx.set(ref,{contextId,kind,summary,detail:txt(input.detail,5000),source:txt(input.source,200)||'chat',
     sourceUrl:txt(input.sourceUrl,1000),createdAt:FieldValue.serverTimestamp()});
 });
 const snap=await ref.get();
 return {id:ref.id,...snap.data(),createdAt:iso(snap.data().createdAt)};
}
async function remove(input={}) {
 if(input.confirm!==true)throw new Error('confirm=true required');
 const id=txt(input.id,160);
 if(!/^[a-z0-9A-Z][a-zA-Z0-9_-]{0,159}$/.test(id))throw new Error('Invalid context id');
 const expected=Number(input.expectedRevision);
 if(!Number.isInteger(expected)||expected<0)throw new Error('Expected revision must be a nonnegative integer');
 const ref=db().collection(CONTEXTS).doc(id);
 const snap=await ref.get();
 if(!snap.exists)throw new Error('Context not found: '+id);
 const current=snap.data();
 if((Number(current.revision)||0)!==expected)throw new Error('Context revision conflict; reload before deleting');
 if(current.status!=='archived')throw new Error('Only archived Contexts can be permanently deleted');
 const events=await db().collection(EVENTS).where('contextId','==',id).limit(1001).get();
 if(events.docs.length>1000)throw new Error('More than 1000 Context events found; deletion needs a reviewed batch');
 for(let i=0;i<events.docs.length;i+=25) {
  await Promise.all(events.docs.slice(i,i+25).map(doc=>doc.ref.delete()));
 }
 await ref.delete();
 return {id,title:current.title,deletedEvents:events.docs.length,deleted:true,legacySourcesPreserved:true};
}
module.exports={list,get,save,remove,listEvents,addEvent,migrateLegacy,clean,legacyDoc,projectHints};
