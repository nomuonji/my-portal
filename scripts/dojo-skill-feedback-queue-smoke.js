'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {enqueueFeedback,validateReview,applyReviews}=require('../functions/dojoSkillFeedbackQueue');
const {createStore}=require('../functions/explorationBaseStore');

const BASE='viral-post-method-discovery';
const HYP=[
 {id:'H-001',kind:'hypothesis',status:'open',targetModuleIds:['transform'],targetSkillIds:['creative-thinking']},
 {id:'H-002',kind:'hypothesis',status:'open',targetModuleIds:['selection'],targetSkillIds:['idea-resonance-lab']},
];
const T=(id,hypothesisIds,verdict)=>({id,baseId:BASE,label:'Real human-rated sample '+id,status:'rated',verdict,
  hypothesisIds,methodVersion:'bci-v7.9',runId:'R-001',ratedAt:'2026-11-24T00:00:00.000Z',
  userWords:verdict==='pass'?'本人：合格':'本人：ボツ'});

test('human ratings enter per-specialist queue; exact T/H references retained',()=>{
 const base={id:BASE,method:{bodyRef:{kind:'chat_skill',location:'buzz-content-ideation'}}};
 const first=enqueueFeedback({base,hypotheses:HYP,ratedTrials:[T('T-100',['H-001'],'fail'),T('T-101',['H-002'],'pass')],
   timestamp:'2026-11-24T00:00:00Z'});
 assert.equal(first.length,2);
 assert.deepEqual(first.find(x=>x.targetSkillId==='creative-thinking').pendingTrialIds,['T-100']);
 assert.equal(first.find(x=>x.targetSkillId==='creative-thinking').status,'pending_review');
 const repeated=enqueueFeedback({base:{...base,skillImprovementInbox:first},hypotheses:HYP,
   ratedTrials:[T('T-100',['H-001'],'fail')],timestamp:'2026-11-24T00:01:00Z'});
 assert.deepEqual(repeated.find(x=>x.targetSkillId==='creative-thinking').pendingTrialIds,['T-100']);
 assert.equal(repeated.find(x=>x.targetSkillId==='idea-resonance-lab').status,'pending_review');
});

test('a failed specimen is not evidence that a shared Skill rule is wrong',()=>{
 const entry={id:'creative-thinking:transform',status:'pending_review',pendingTrialIds:['T-100'],
  targetSkillId:'creative-thinking',moduleId:'transform',hypothesisIds:['H-001']};
 const review={action:'rule_candidate',trialIds:['T-100'],
   rationale:'Human rejected the candidate. That observation alone does not identify whether material, method or wording caused it.',
   competingExplanations:'Material was weak or the Skill transformation was wrong; both can explain the exact same negative outcome.',
   nextDiscriminatingExperiment:'Keep the same source and audience, vary only the transformation, and compare both results with human verdicts.',
   candidateRule:'When material is weak, reject it before transforming; never add a fabricated third-person explanation as a substitute.',
 };
 assert.throws(()=>validateReview(review,entry,[T('T-100',['H-001'],'fail')]),/positive and negative/);
 const accepted={...entry,pendingTrialIds:['T-100','T-101']};
 const result=validateReview({...review,trialIds:['T-100','T-101']},accepted,
  [T('T-100',['H-001'],'fail'),T('T-101',['H-001'],'pass')]);
 assert.equal(result.evidence.pass,1);
 assert.equal(result.releaseStatus,'no_skill_revision_or_release');
 const updated=applyReviews([accepted],[],[{...result,inboxId:entry.id}], '2026-11-24T01:00:00Z');
 assert.equal(updated.inbox[0].status,'candidate_needs_independent_test');
 assert.equal(updated.inbox[0].pendingTrialIds.length,0);
 assert.equal(updated.reviews[0].evidenceStatus,'agent_hypothesis_not_causal_proof');
});

class Snapshot {
 constructor(id,value){this.id=id;this.value=value;this.exists=value!==undefined;}
 data(){return this.exists?structuredClone(this.value):undefined;}
}
class Ref {
 constructor(db,path,id){this.db=db;this.path=path;this.id=id;}
 async get(){return new Snapshot(this.id,this.db.records.get(this.path+'/'+this.id));}
}
class Collection {
 constructor(db,path,filter=[],limit=1000){this.db=db;this.path=path;this.filter=filter;this.max=limit;}
 doc(id){return new Ref(this.db,this.path,id);}
 where(field,op,value){return new Collection(this.db,this.path,[...this.filter,{field,value}],this.max);}
 limit(max){return new Collection(this.db,this.path,this.filter,max);}
 async get(){return{docs:[...this.db.records.entries()].filter(([k])=>k.startsWith(this.path+'/'))
  .filter(([,v])=>this.filter.every(x=>v[x.field]===x.value)).slice(0,this.max)
  .map(([k,v])=>new Snapshot(k.slice(this.path.length+1),v))};}
}
class MemoryDb{
 constructor(){this.records=new Map();}
 collection(name){return new Collection(this,name);}
 async runTransaction(fn){
  const staged=[];const tx={get:r=>r.get(),set:(r,v)=>staged.push([r.path+'/'+r.id,structuredClone(v)])};
  const result=await fn(tx);for(const [k,v]of staged)this.records.set(k,v);return result;
 }
}
test('historical H/T history is unmodified by idempotent inbox seed and agent triage',async()=>{
 const db=new MemoryDb();
 const store=createStore({getDb:()=>db,resolveTarget:async({id,versionNumber})=>({
  title:id,body:'Approved Skill v'+versionNumber,latestVersion:versionNumber})});
 const base={id:BASE,title:'Buzz',status:'active',revision:1,
  counters:{E:0},method:{version:'bci-v7.9',bodyRef:{kind:'chat_skill',location:'buzz-content-ideation',versionNumber:72}},
  outcome:{statement:'User rated posts',unit:'one post',acceptance:'User accepted it',confirmedBy:'user'},
  skillImprovementInbox:[],skillImprovementReviews:[],progress:{achievements:[],confirmedCount:0}};
 db.records.set('explorationBases/'+BASE,structuredClone(base));
 for(const h of HYP)db.records.set('explorationBaseItems/'+BASE+'__'+h.id,structuredClone({...h,baseId:BASE}));
 db.records.set('explorationBaseTrials/'+BASE+'__T-100',T('T-100',['H-001'],'fail'));
 db.records.set('explorationBaseTrials/'+BASE+'__T-101',T('T-101',['H-001'],'pass'));
 const snapshot=structuredClone([...db.records.entries()].filter(([key])=>key.includes('explorationBaseTrials/')));
 const one=await store.seedSkillImprovementInbox({baseId:BASE,confirm:true});
 assert.equal(one.addedCount,1);
 assert.deepEqual(one.added[0].pendingTrialIds,['T-100','T-101']);
 const two=await store.seedSkillImprovementInbox({baseId:BASE,confirm:true});
 assert.equal(two.addedCount,0,'legacy replay must not create a duplicate pending review');
 const response=await store.reviewSkillImprovement({baseId:BASE,review:{
   targetSkillId:'creative-thinking',moduleId:'transform',trialIds:['T-100','T-101'],action:'rule_candidate',
   rationale:'The original cases received different human ratings, but the transformation and source may differ in multiple ways.',
   competingExplanations:'Either transformation invented a false motive, or original material was weaker: compare both before editing the Skill.',
   nextDiscriminatingExperiment:'Keep the same original source and primary audience, vary only whether the third-person motive is added, and compare user verdicts.',
   candidateRule:'Retain concrete original behavior and do not add third-person motives unless the original source or explicit fiction warrants it.',
 }});
 assert.equal(response.review.releaseStatus,'no_skill_revision_or_release');
 assert.match(response.nextAction,/no dojo|no Skill/i);
 assert.equal(db.records.get('explorationBases/'+BASE).method.bodyRef.versionNumber,72);
 assert.deepEqual([...db.records.entries()].filter(([key])=>key.includes('explorationBaseTrials/')),snapshot,
  'reviews may not edit original human-rated records');
});
