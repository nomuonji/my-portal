'use strict';

// Live, versioned, human-reviewed relation policies. The Chat Skill body and its
// dojo release remain canonical for *what* the agent may do; this policy says
// which other approved Skill to load for each task intent. No version pin to a
// related Skill is stored. Existing hardcoded relations are compatibility seeds,
// not silently written during reads.
const { getDocumentDb } = require('./documentDb');
const { MANIFEST, DEFAULT_INTENT, INTENTS } = require('./chatSkillRelations');
const COLLECTION = 'chatSkillRelationPolicies';
const VERSIONS = 'chatSkillRelationPolicyVersions';
const ID = /^[a-z][a-z0-9-]{1,89}$/;
const NEEDS = new Set(['required','recommended','optional']);

function cleanPolicy(raw) {
  const id=String(raw?.id||'').trim();
  if (!ID.test(id)) throw new Error('Invalid source Skill ID');
  const defaultIntent=String(raw?.defaultIntent||'').trim();
  if (defaultIntent && !INTENTS.has(defaultIntent)) throw new Error('Invalid default intent');
  const input=raw?.relations||[];
  if (!Array.isArray(input) || input.length>25) throw new Error('relations must be an array of up to 25 entries');
  const seen=new Set();
  const relations=input.map((rawLink) => {
    const skillId=String(rawLink?.skillId||'').trim();
    if (!ID.test(skillId) || skillId===id || seen.has(skillId)) throw new Error('Invalid, duplicate or self-referential related Skill: '+skillId);
    seen.add(skillId);
    const requiredness=String(rawLink?.requiredness||'').trim();
    if (!NEEDS.has(requiredness)) throw new Error('Invalid requiredness: '+requiredness);
    const intents=rawLink?.intents;
    if (!Array.isArray(intents)||!intents.length||intents.length>INTENTS.size||
        new Set(intents).size!==intents.length||intents.some(x=>!INTENTS.has(x)))
      throw new Error('Invalid intent list for '+skillId);
    const rationale=String(rawLink?.rationale||'').trim();
    if (rationale.length<8||rationale.length>700) throw new Error('Explain the dependency purpose');
    if (rawLink.versionNumber !== undefined) throw new Error('Related Skill versions are resolved at runtime, never pinned');
    return {skillId,requiredness,intents,rationale};
  });
  return {id,defaultIntent,relations};
}
function decorate(policy,intent){
  const chosen=intent&&INTENTS.has(intent) ? intent : (policy.defaultIntent||'');
  return (policy.relations||[]).map(link=>({
    ...link,intent:chosen,active:link.intents.includes(chosen),
    autoLoad:link.intents.includes(chosen)&&link.requiredness!=='optional',
    versionPolicy:'latest_approved_at_runtime',
    provenance:policy.revision?'my_portal_relation_policy_v'+policy.revision:'legacy_code_fallback',
    policyRevision:policy.revision||0,
  }));
}
function createStore(opts={}) {
  const db=opts.getDb||getDocumentDb;
  const sourceSkill=opts.sourceSkill||((id)=>require('./chatContextRegistry').getExecutableSkill({id,includeRelations:false}));
  const collection=()=>db().collection(COLLECTION);
  const policyRef=id=>collection().doc(id);
  const versionRef=(id,revision)=>db().collection(VERSIONS).doc(id+'__'+String(revision).padStart(6,'0'));
  async function get(input={}) {
    const id=String(input.id||'').trim();
    if (!ID.test(id)) throw new Error('Invalid Skill ID');
    const snap=await policyRef(id).get();
    if (snap.exists) return {...snap.data(),source:'my_portal_db'};
    return {id,revision:0,defaultIntent:DEFAULT_INTENT[id]||'',relations:MANIFEST[id]||[],source:'legacy_code_fallback',migrationRequired:Boolean(MANIFEST[id])};
  }
  async function resolve(input={}) { const policy=await get(input);return {policy,links:decorate(policy,input.intent)}; }
  async function list() {
    const snap=await collection().limit(250).get();
    return {items:snap.docs.map(doc=>({...doc.data(),source:'my_portal_db'})),
      legacyPending:Object.keys(MANIFEST).filter(id=>!snap.docs.some(doc=>doc.id===id))};
  }
  async function publish(input={}) {
    if(input.confirm!==true)throw new Error('Explicit confirmation required');
    const definition=cleanPolicy(input.policy);
    const expected=Number(input.expectedRevision);
    if(!Number.isInteger(expected)||expected<0)throw new Error('expectedRevision must be nonnegative');
    const changeReason=String(input.changeReason||'').trim();
    if(changeReason.length<12||changeReason.length>800)throw new Error('A concrete change reason is required');
    const approved=await sourceSkill(definition.id);
    if(!approved?.body||!Number.isInteger(Number(approved.revision)))throw new Error('Approved source Skill required');
    for(const link of definition.relations){
      // The approved body is the authority. Stale or invented references cannot
      // silently acquire runtime load privileges via a policy document.
      if(!approved.body.includes('`'+link.skillId+'`'))
        throw new Error('Approved source body does not reference '+link.skillId);
    }
    const legacy=MANIFEST[definition.id]||[];
    const initialIdentical=expected===0 && JSON.stringify(definition.relations)===JSON.stringify(legacy)
      && definition.defaultIntent===(DEFAULT_INTENT[definition.id]||'');
    const benchmark=input.benchmark;
    if(!initialIdentical && !(benchmark?.passed===true&&
       String(benchmark.ref||'').trim().length>=8&&
       String(benchmark.cases||'').trim().length>=8))
      throw new Error('Changed relation policy requires a passed, referenced benchmark and concrete cases');
    let saved;
    await db().runTransaction(async tx=>{
      const ref=policyRef(definition.id);
      const old=await tx.get(ref);
      const rev=old.exists?Number(old.data().revision)||0:0;
      if(rev!==expected)throw new Error('Relation policy revision conflict');
      const next=rev+1;
      const item={...definition,revision:next,sourceSkillVersion:Number(approved.revision),
        sourceVersionPolicy:approved.versionPolicy||'latest_registry_version',
        changeReason,benchmark:benchmark||{passed:true,ref:'legacy_approved_skill_body',cases:'exact pre-existing curated relation policy'},
        updatedAt:new Date().toISOString(),kind:'chat_skill_relation_policy'};
      tx.set(ref,item);
      tx.set(versionRef(definition.id,next),item);
      saved=item;
    });
    return {...saved,source:'my_portal_db'};
  }
  return {get,resolve,list,publish,cleanPolicy};
}
const store=createStore();
module.exports={...store,createStore,cleanPolicy,decorate,COLLECTION,VERSIONS};
