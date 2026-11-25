'use strict';

const { sourceHasPrimaryText } = require('./dojoBuzzRecovery');
const BUZZ_BASE = 'viral-post-method-discovery';
const OPERATIONS = Object.freeze(['source','selection','causal_sequence','language','perspective','desire','emotion','voice','audience','format']);
const normalized = value => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
function required(value, name, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    throw Error('Comparison work: '+name+' requires '+min+'-'+max+' characters.');
  return value.trim();
}
function exactKeys(rows, expected, name) {
  if (!Array.isArray(rows) || rows.length !== expected.length ||
      new Set(rows.map(row => row?.branchId)).size !== expected.length ||
      rows.some(row => !expected.includes(row?.branchId)))
    throw Error('Comparison work: '+name+' must cover every pinned branch exactly once.');
}
function cleanPlan(raw, allowedHypotheses) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 5)
    throw Error('Comparison work: preregister 3-5 independent branches before drafting.');
  const plan=raw.map((row,i)=>{
    const hypothesisId=required(row?.hypothesisId,'hypothesisId',3,20);
    if(!allowedHypotheses.has(hypothesisId))
      throw Error('Comparison work: branch hypothesis must be a declared target or contrast: '+hypothesisId);
    if(!OPERATIONS.includes(row.operation))throw Error('Comparison work: unknown operation.');
    return {
      branchId:'B'+(i+1), hypothesisId, operation:row.operation,
      intervention:required(row.intervention,'intervention',20,600),
      control:required(row.control,'control',20,600),
      expectedDifference:required(row.expectedDifference,'expectedDifference',20,600),
      falsifier:required(row.falsifier,'falsifier',20,600)
    };
  });
  if(new Set(plan.map(x=>x.operation)).size<3 || new Set(plan.map(x=>normalized(x.intervention))).size!==plan.length)
    throw Error('Comparison work: at least three different operations and distinct interventions are required; a different H ID or topic is not enough.');
  return plan;
}
function cleanWork({plan, rows, sources, previousTrials=[]}) {
  if(!plan?.length)throw Error('Comparison work: no preregistered comparisonPlan; start a new run before drafting.');
  exactKeys(rows,plan.map(x=>x.branchId),'actual comparisons');
  const known=new Map(sources.map(s=>[s.id,s]));
  const seen=new Set(previousTrials.filter(t=>t.body).map(t=>normalized(t.body)));
  const materials=new Set(), urls=new Set();
  return plan.map(branch=>{
    const row=rows.find(r=>r.branchId===branch.branchId);
    const sourceId=required(row.sourceId,'sourceId',3,20);
    const source=known.get(sourceId);
    if(!source || source.kind!=='source' || source.status!=='open' || source.stage==='conjecture' || !sourceHasPrimaryText(source))
      throw Error('Comparison work: each pair needs an active observed source with direct original proof: '+sourceId);
    if(materials.has(sourceId)||urls.has(source.originalProof.originalUrl))
      throw Error('Comparison work: independent branches must use different original materials.');
    materials.add(sourceId);urls.add(source.originalProof.originalUrl);
    const controlBody=required(row.controlBody,'actual control body',25,4000);
    const treatmentBody=required(row.treatmentBody,'actual treatment body',25,4000);
    for(const body of [controlBody,treatmentBody]){
      const key=normalized(body);
      if(key.length<12 || seen.has(key))
        throw Error('Comparison work: duplicate or historical draft; produce actual distinct comparison texts.');
      seen.add(key);
    }
    const controlAnchor=required(row.controlAnchor,'controlAnchor',4,160);
    const treatmentAnchor=required(row.treatmentAnchor,'treatmentAnchor',4,160);
    if(!controlBody.includes(controlAnchor)||!treatmentBody.includes(treatmentAnchor))
      throw Error('Comparison work: anchors must quote the actual comparison texts.');
    if(controlBody.includes(treatmentAnchor)||treatmentBody.includes(controlAnchor))
      throw Error('Comparison work: anchors must identify the changed text in each arm.');
    if(!['control','treatment','neither','both'].includes(row.selection))
      throw Error('Comparison work: select control, treatment, neither or both (matched validation only).');
    return {...branch,sourceId,originalUrl:source.originalProof.originalUrl,
      controlBody,treatmentBody,controlAnchor,treatmentAnchor,selection:row.selection,
      observedDifference:required(row.observedDifference,'observedDifference',20,900),
      reason:required(row.reason,'selection/rejection reason',20,900)};
  });
}
function assertComparedTrial(run, raw, editorialScreen, hypothesisIds) {
  if(!run?.comparisonWork?.rows?.length)
    throw Error('Comparison work required: record all preregistered branches with full actual control and treatment drafts via exploration_comparison_record before submitting. A title-only editorial screen cannot replace this.');
  const selected=editorialScreen?.pool?.find(row=>row.decision==='selected');
  const body=String(raw.body||'').trim();
  const pair=run.comparisonWork.rows.find(row=>row.hypothesisId===hypothesisIds[0] &&
    row.sourceId===selected?.sourceId &&
    ((row.selection==='control'&&row.controlBody===body) ||
     (row.selection==='treatment'&&row.treatmentBody===body) ||
     (row.selection==='both'&&raw.evaluationPhase==='validation'&&
       ((raw.experimentArm==='control'&&row.controlBody===body)||(raw.experimentArm==='treatment'&&row.treatmentBody===body)))));
  if(!pair)throw Error('Comparison work: submitted body, primary H and selected source must exactly match a saved selected comparison draft.');
  return {branchId:pair.branchId,operation:pair.operation,recordedAt:run.comparisonWork.recordedAt,
    arm:pair.controlBody===body?'control':'treatment',status:'agent_comparison_unverified'};
}
function workStatus(run) {
  if(!run?.comparisonWork?.rows?.length)
    return run?.comparisonPlan?.length?'incomplete_comparison':'research_only';
  return (run.trialIds||[]).length?'compared_submitted':'compared_no_submission';
}
module.exports={BUZZ_BASE,OPERATIONS,cleanPlan,cleanWork,assertComparedTrial,workStatus};
