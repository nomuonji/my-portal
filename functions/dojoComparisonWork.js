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
function cleanHistoricalContrast(raw, previousTrials, name) {
  const accepted=previousTrials.filter(t=>t.status==='rated'&&t.verdict==='pass'&&t.body);
  const rejected=previousTrials.filter(t=>t.status==='rated'&&['fail','partial'].includes(t.verdict)&&t.body);
  if(!accepted.length||!rejected.length)return null;
  const positiveCaseId=required(raw?.positiveCaseId,name+'.positiveCaseId',3,20);
  const negativeCaseId=required(raw?.negativeCaseId,name+'.negativeCaseId',3,20);
  const positiveAnchor=required(raw?.positiveAnchor,name+'.positiveAnchor',8,160);
  const negativeAnchor=required(raw?.negativeAnchor,name+'.negativeAnchor',8,160);
  const positive=accepted.find(t=>t.id===positiveCaseId);
  const negative=rejected.find(t=>t.id===negativeCaseId);
  if(!positive?.body.includes(positiveAnchor)||!negative?.body.includes(negativeAnchor))
    throw Error('Comparison work: every branch must cite exact passages from real human-rated pass and non-pass texts.');
  return {positiveCaseId,negativeCaseId,positiveAnchor,negativeAnchor,
    transfer:required(raw.transfer,name+'.transfer',20,700),
    failureContrast:required(raw.failureContrast,name+'.failureContrast',20,700)};
}
function cleanPlan(raw, allowedHypotheses, previousTrials=[]) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 5)
    throw Error('Comparison work: preregister 3-5 independent branches before drafting.');
  const plan=raw.map((row,i)=>{
    const hypothesisId=required(row?.hypothesisId,'hypothesisId',3,20);
    if(!allowedHypotheses.has(hypothesisId))
      throw Error('Comparison work: branch hypothesis must be a declared target or contrast: '+hypothesisId);
    if(!OPERATIONS.includes(row.operation))throw Error('Comparison work: unknown operation.');
    const historicalContrast=cleanHistoricalContrast(row.historicalContrast,previousTrials,'historicalContrast');
    return {
      branchId:'B'+(i+1), hypothesisId, operation:row.operation,
      ...(historicalContrast?{historicalContrast}:{}),
      intervention:required(row.intervention,'intervention',20,600),
      control:required(row.control,'control',20,600),
      expectedDifference:required(row.expectedDifference,'expectedDifference',20,600),
      falsifier:required(row.falsifier,'falsifier',20,600)
    };
  });
  if(new Set(plan.map(x=>x.operation)).size<3 || new Set(plan.map(x=>normalized(x.intervention))).size!==plan.length)
    throw Error('Comparison work: at least three different operations and distinct interventions are required; a different H ID or topic is not enough.');
  const contrast=plan.map(x=>x.historicalContrast).filter(Boolean);
  if(contrast.length){
    const count=verdicts=>previousTrials.filter(t=>t.status==='rated'&&verdicts.includes(t.verdict)&&t.body).length;
    if(new Set(contrast.map(x=>x.positiveCaseId)).size<Math.min(3,count(['pass'])) ||
       new Set(contrast.map(x=>x.negativeCaseId)).size<Math.min(3,count(['fail','partial'])))
      throw Error('Comparison work: contrast several distinct actual historical passes and non-passes across branches when available.');
  }
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
  // Bind the entire screen, not just the winner, to actual saved drafts.
  // An agent cannot inflate the comparison pool with invented candidate names.
  const mapped=new Set();
  for(const entry of editorialScreen?.pool||[]){
    const pair=run.comparisonWork.rows.find(row=>row.branchId===entry.branchId);
    const arm=entry.comparisonArm;
    if(!pair||!['control','treatment'].includes(arm)||pair.sourceId!==entry.sourceId||
       (entry.hypothesisId&&pair.hypothesisId!==entry.hypothesisId))
      throw Error('Comparison work: every editorial pool entry must reference an actual saved branch and arm with matching source/H.');
    const key=pair.branchId+':'+arm;
    if(mapped.has(key))throw Error('Comparison work: a saved draft cannot appear twice in the screening pool.');
    mapped.add(key);
    if(entry.decision==='rejected'&&(pair.selection===arm||pair.selection==='both'))
      throw Error('Comparison work: a selected comparison draft cannot be mislabeled as a rejected pool entry.');
  }
  const selected=editorialScreen?.pool?.find(row=>row.decision==='selected');
  const body=String(raw.body||'').trim();
  const pair=run.comparisonWork.rows.find(row=>row.hypothesisId===hypothesisIds[0] &&
    row.sourceId===selected?.sourceId && row.branchId===selected?.branchId &&
    ((row.selection==='control'&&row.controlBody===body) ||
     (row.selection==='treatment'&&row.treatmentBody===body) ||
     (row.selection==='both'&&raw.evaluationPhase==='validation'&&
       ((raw.experimentArm==='control'&&row.controlBody===body)||(raw.experimentArm==='treatment'&&row.treatmentBody===body)))));
  if(!pair||selected.comparisonArm!==(pair.controlBody===body?'control':'treatment'))throw Error('Comparison work: submitted body, primary H and selected source must exactly match a saved selected comparison draft.');
  return {branchId:pair.branchId,operation:pair.operation,recordedAt:run.comparisonWork.recordedAt,
    arm:pair.controlBody===body?'control':'treatment',status:'agent_comparison_unverified'};
}
function workStatus(run) {
  if(!run?.comparisonWork?.rows?.length)
    return run?.comparisonPlan?.length?'incomplete_comparison':'research_only';
  return (run.trialIds||[]).length?'compared_submitted':'compared_no_submission';
}
module.exports={BUZZ_BASE,OPERATIONS,cleanPlan,cleanWork,assertComparedTrial,workStatus};
