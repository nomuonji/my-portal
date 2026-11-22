'use strict';

// Evaluate probability forecasts *only* against later explicit human verdicts.
// A majority-class hit rate can be high even if the model predicts "fail" for
// every proposal; report a base-rate benchmark, the forecast error, and the
// absence of positive predictions instead of confusing hit rate with quality.
const round=(v)=>Math.round(v*1000)/1000;
function measureCalibration(entries) {
  const samples=(entries||[]).filter(x=>Number.isFinite(x.predictedPass)
    && x.predictedPass>=0&&x.predictedPass<=1
    && ['pass','partial','fail'].includes(x.verdict));
  const n=samples.length;
  if(!n)return null;
  const passed=samples.filter(x=>x.verdict==='pass').length;
  const prevalence=passed/n;
  const hits=samples.filter(x=>(x.predictedPass>=0.5)===(x.verdict==='pass')).length;
  const positiveCalls=samples.filter(x=>x.predictedPass>=0.5);
  const truePositive=positiveCalls.filter(x=>x.verdict==='pass').length;
  const negatives=n-passed;
  const brier=samples.reduce((sum,x)=>sum+(x.predictedPass-(x.verdict==='pass'?1:0))**2,0)/n;
  // This is an in-sample no-feature reference, not a verified prospective
  // forecast. Neither brier improvement nor threshold precision is causality.
  const baseBrier=prevalence*(1-prevalence);
  const calibration={
    predicted:n,hitRate:round(hits/n),baselineHitRate:round(Math.max(prevalence,1-prevalence)),
    meanPredictedPass:round(samples.reduce((sum,x)=>sum+x.predictedPass,0)/n),
    actualPassRate:round(prevalence),brier:round(brier),
    inSampleBaseRateBrier:round(baseBrier),
    probabilitySkill:baseBrier>0?round(1-brier/baseBrier):null,
    positiveCalls:positiveCalls.length,
    truePositive,falsePositive:positiveCalls.length-truePositive,
    falseNegative:passed-truePositive,
    precision:positiveCalls.length?round(truePositive/positiveCalls.length):null,
    recall:passed?round(truePositive/passed):null,
    // True-negative-only success is not a validated creative quality gate.
    predictiveStatus:n<5?'too_few':
      passed===0?'no_pass_examples':
      negatives===0?'no_fail_examples':
      positiveCalls.length===0?'no_positive_predictions':
      brier>=baseBrier?'no_better_than_base_rate':
      'beats_in_sample_base_rate',
    referencePolicy:'in_sample_base_rate_descriptive_only',
  };
  return calibration;
}
module.exports={measureCalibration};
