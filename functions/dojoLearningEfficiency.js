'use strict';
const {createHash}=require('node:crypto');
const META_SKILL_ID='hypothesis-formation-analysis';
const PHASES=['exploration','validation','capability'];
const MIN_CAPABILITY=8;
const actual=t=>t.status==='rated'&&['pass','partial','fail'].includes(t.verdict);
const ratio=(a,b)=>b?Math.round(1000*a/b)/1000:null;
function stats(rows){
  const rated=rows.filter(actual),pass=rated.filter(t=>t.verdict==='pass').length;
  return {submitted:rows.length,rated:rated.length,pass,fail:rated.filter(t=>t.verdict==='fail').length,
    partial:rated.filter(t=>t.verdict==='partial').length,passRate:ratio(pass,rated.length)};
}
function lane(t){return !t.backfilled&&PHASES.includes(t.evaluationPhase)&&(t.evaluationPhase!=='capability'||t.capabilityEvidence)?t.evaluationPhase:'legacy_unclassified';}
function laneView(trials,base){
  const version=t=>t.version!=null?'v'+t.version:t.methodVersion||'unknown';
  const currentKey=base?.method?.bodyRef?.versionNumber!=null?'v'+base.method.bodyRef.versionNumber:base?.method?.version||'unknown';
  const phases=[...PHASES,'legacy_unclassified'];
  const grouped=Object.fromEntries(phases.map(p=>[p,stats(trials.filter(t=>lane(t)===p))]));
  const keys=[...new Set([currentKey,...trials.map(version)])];
  const byVersion=keys.map(v=>({version:v,released:v===currentKey,
    ...Object.fromEntries(phases.map(p=>[p,stats(trials.filter(t=>version(t)===v&&lane(t)===p))]))}));
  return {current:byVersion[0],overall:grouped,byVersion,
    note:'Capability is the approved method on predeclared fresh material. Exploration/validation/legacy are not capability results. Counts are descriptive, not causal estimates.'};
}
function capabilityPlan(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('capabilityPlan object required');
  const clean=(k,min,max)=>{const s=String(raw[k]||'').trim();if(s.length<min||s.length>max)throw Error('capabilityPlan.'+k+' requires '+min+'-'+max+' characters');return s;};
  const materialKeys=Array.isArray(raw.materialKeys)?raw.materialKeys.map(s=>String(s).trim()):[];
  if(!materialKeys.length||materialKeys.length>6||new Set(materialKeys).size!==materialKeys.length||materialKeys.some(s=>s.length<4||s.length>120))
    throw Error('Capability plan needs 1-6 distinct material keys before drafting');
  return {benchmarkKey:clean('benchmarkKey',3,120),materialKeys,task:clean('task',12,900),
    sampling:clean('sampling',20,900),controls:clean('controls',20,900),acceptance:clean('acceptance',20,900)};
}
function checkCapability(raw,run,existing,fresh,base){
  if(raw.evaluationPhase!=='capability')return null;
  const p=run?.capabilityPlan;
  if(!p||run.methodVersion!==base.method?.version)throw Error('Capability trial needs a preregistered plan on the pinned approved method');
  if(!p.materialKeys.includes(raw.materialKey))throw Error('Capability material must be declared before drafting');
  if(existing.some(t=>t.materialKey===raw.materialKey)||fresh.filter(t=>t.materialKey===raw.materialKey).length!==1)
    throw Error('Capability material must be fresh and used once');
  if(!raw.segmentKey||raw.segmentKey!==p.benchmarkKey)throw Error('Capability segmentKey must match the preregistered benchmarkKey');
  return {benchmarkKey:p.benchmarkKey,protocolDigest:createHash('sha256').update(JSON.stringify([p.task,p.sampling,p.controls,p.acceptance])).digest('hex'),task:p.task,materialKey:raw.materialKey,runId:run.id,
    provenance:'agent_declared_fresh_material_not_independently_verified'};
}
function capabilityComparison(trials,base,health){
  const eligible=trials.filter(t=>lane(t)==='capability'&&t.capabilityEvidence);
  const currentVersion=base?.method?.bodyRef?.versionNumber??base?.method?.version;
  const key=t=>t.version??t.methodVersion;
  const current=eligible.filter(t=>key(t)===currentVersion&&actual(t));
  const scopeOf=t=>JSON.stringify([t.capabilityEvidence.benchmarkKey,t.capabilityEvidence.protocolDigest||null]);
  const scopes=[...new Set(current.map(scopeOf))];
  const comparisons=scopes.map(scope=>{
    const c=current.filter(t=>scopeOf(t)===scope);
    const prior=eligible.filter(t=>actual(t)&&key(t)!==currentVersion&&scopeOf(t)===scope);
    const previousKey=prior.slice().sort((a,b)=>String(b.ratedAt||'').localeCompare(String(a.ratedAt||'')))[0];
    const p=prior.filter(t=>key(t)===key(previousKey||{}));
    return {benchmarkKey:JSON.parse(scope)[0],protocolDigest:JSON.parse(scope)[1],current:stats(c),previous:previousKey?{version:key(previousKey),...stats(p)}:null,
      ...health(stats(c),previousKey?stats(p):null,base?.outcome?.confirmedBy==='measurement')};
  });
  return {status:base?.outcome?.confirmedBy==='measurement'?'measurement_mode_requires_operator_data':comparisons.length?'capability_comparisons':'no_capability_ratings',
    comparisons,minimumRatedPerVersion:MIN_CAPABILITY,automaticRollback:false,
    nextAction:'Compare preregistered fresh samples under the same benchmark key and acceptance; do not infer release improvement from mixed legacy or exploratory ratings.'};
}
// Older MCP schemas could not supply researchEvidence.metaSkillVersion. Use
// explicit execution receipts as a separately identified observational fallback,
// never infer use from a timestamp, default Skill version, or prose alone.
function metaAttribution(t){
  if(t.backfilled)return null;
  const structured=Number(t.researchEvidence?.metaSkillVersion);
  const receipts=[...new Set((t.executionResources||[]).filter(r=>r.kind==='skill'&&r.id===META_SKILL_ID&&
    typeof r.receiptRef==='string'&&r.receiptRef.length>=8&&/^\d+$/.test(String(r.version||'')))
    .map(r=>Number(r.version)).filter(v=>Number.isInteger(v)&&v>0))];
  if(Number.isInteger(structured)&&structured>0){
    if(receipts.some(v=>v!==structured))return null;
    return {version:structured,provenance:'research_synthesis'};
  }
  return receipts.length===1?{version:receipts[0],provenance:'execution_resource_fallback'}:null;
}
function metaComparisons(rows){
  // Only explicit pre-rating research-operation contrasts. Domain trial ratings
  // stay in their own dojo. A tag is agent-reported, never causal proof.
  const groups=new Map();
  for(const t of rows){
    const f=t.plannedFactors||{};
    if(!actual(t)||t.evaluationPhase!=='validation'||!t.runId||!t.materialKey||!t.comparisonKey||
      !/^H-\d+$/.test(f.meta_hypothesis_id||'')||!f.meta_scope||
      !['control','treatment'].includes(f.meta_arm)||f.meta_arm!==t.experimentArm)continue;
    const key=JSON.stringify([f.meta_hypothesis_id,f.meta_scope,t.runId,t.comparisonKey,t.materialKey,t.segmentKey]);
    const g=groups.get(key)||{control:[],treatment:[]};
    g[f.meta_arm].push(t);groups.set(key,g);
  }
  const scopes=new Map(),seen=new Set();
  for(const [key,g] of groups){
    if(g.control.length!==1||g.treatment.length!==1)continue;
    const [hypothesisId,scope,runId,,materialKey]=JSON.parse(key);
    const k=JSON.stringify([hypothesisId,scope]),m=JSON.stringify([k,materialKey]);
    if(seen.has(m))continue;
    seen.add(m);
    const v=scopes.get(k)||{hypothesisId,scope,pairs:0,treatmentBetter:0,controlBetter:0,ties:0,runs:new Set(),evidence:[]};
    const c=g.control[0],t=g.treatment[0];
    v.pairs++;v.runs.add(runId);
    if(t.verdict==='pass'&&c.verdict!=='pass')v.treatmentBetter++;
    else if(c.verdict==='pass'&&t.verdict!=='pass')v.controlBetter++;
    else v.ties++;
    if(v.evidence.length<20)v.evidence.push({runId,materialKey,controlTrialId:c.id,treatmentTrialId:t.id});
    scopes.set(k,v);
  }
  return [...scopes.values()].map(({runs,...v})=>({...v,runCount:runs.size,
    status:'agent_declared_downstream_comparison_not_release_evidence'}));
}
function metaUsage(trials){
  const groups=new Map();
  for(const t of trials){
    const a=metaAttribution(t);if(!a)continue;
    const g=groups.get(a.version)||{rows:[],researchSynthesis:0,executionResourceFallback:0};
    g.rows.push(t);
    if(a.provenance==='research_synthesis')g.researchSynthesis++;
    else g.executionResourceFallback++;
    groups.set(a.version,g);
  }
  return [...groups.entries()].map(([version,g])=>({version,...stats(g.rows),
    capability:stats(g.rows.filter(t=>lane(t)==='capability')),
    runCount:new Set(g.rows.map(t=>t.runId).filter(Boolean)).size,
    provenance:{researchSynthesis:g.researchSynthesis,executionResourceFallback:g.executionResourceFallback},
    researchComparisons:metaComparisons(g.rows),
    note:'Explicit agent-reported use, including separately identified legacy resource receipts. No historical rating rewrite, independent verification or causal attribution.'}));
}
function pruningView(inventory,body,proposals=[]){
  const groups=new Map();
  for(const r of inventory.rules||[]){const list=groups.get(r.digest)||[];list.push(r);groups.set(r.digest,list);}
  const exactDuplicates=[...groups.values()].filter(x=>x.length>1).map(x=>({ruleIds:x.map(r=>r.id),sections:x.map(r=>r.section)}));
  const active=proposals.filter(p=>p.sourceMethodVersion===inventory.methodVersion&&['replace','retire'].includes(p.action));
  return {bodyCharacters:body.length,ruleCount:inventory.count,softBudgetCharacters:20000,overBudget:body.length>20000,
    exactDuplicates:exactDuplicates.slice(0,30),duplicateGroupCount:exactDuplicates.length,
    candidateProposalIds:active.map(p=>p.id).slice(0,30),
    instructions:'Read duplicates in context, not as automatic deletion candidates. Prefer replacing/merging/removing over append. Preserve unique nuance and evidence in linked cases, keep user-owned and safety/quality gates, test behavior under the same benchmark. No automatic rewrite or release.'};
}
function fieldObservation(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('fieldObservation object required');
  const clean=(k,max,min=1)=>{const s=String(raw[k]||'').trim();if(s.length<min||s.length>max)throw Error('fieldObservation.'+k+' is required and bounded');return s;};
  const metrics=raw.metrics;
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||!Object.keys(metrics).length||Object.keys(metrics).length>20||
    Object.entries(metrics).some(([k,v])=>!/^[a-z][a-z0-9_]{0,49}$/.test(k)||typeof v!=='number'||!Number.isFinite(v)))throw Error('fieldObservation.metrics needs 1-20 named finite measured values');
  const observedAt=clean('observedAt',40),window=clean('window',120),sourceRef=clean('sourceRef',600),artifactRef=clean('artifactRef',600);
  if(!Number.isFinite(Date.parse(observedAt)))throw Error('fieldObservation.observedAt must be an ISO observation time');
  const version=raw.skillVersion==null?null:Number(raw.skillVersion);
  if(version!==null&&(!Number.isInteger(version)||version<1))throw Error('fieldObservation.skillVersion must be a real positive integer or omitted');
  const attributionRef=String(raw.attributionRef||'').trim().slice(0,600);
  if(version!==null&&!attributionRef)throw Error('Field version attribution requires an actual execution record reference');
  return {artifactRef,sourceRef,observedAt,window,metrics,context:clean('context',1500,12),
    comparison:clean('comparison',1200,12),skillVersion:version,attributionRef:attributionRef||null,
    attribution:version===null?'unknown':'agent_reported_execution_reference_not_verified',
    provenance:'external_measurement_reported_by_agent_not_human_verdict'};
}
module.exports={META_SKILL_ID,PHASES,laneView,capabilityPlan,checkCapability,capabilityComparison,metaUsage,pruningView,fieldObservation};
