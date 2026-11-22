'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {measureCalibration}=require('../functions/dojoCalibration');

test('100% majority-class accuracy never means creative quality gate succeeded',()=>{
 const observations=[...Array(9)].map((_,i)=>({predictedPass:0.2+i*0.01,verdict:'fail'}));
 const c=measureCalibration(observations);
 assert.equal(c.hitRate,1);
 assert.equal(c.baselineHitRate,1);
 assert.equal(c.positiveCalls,0);
 assert.equal(c.precision,null);
 assert.equal(c.probabilitySkill,null);
 assert.equal(c.predictiveStatus,'no_pass_examples');
});
test('overconfident forecasts are penalized against same-sample simple base rate',()=>{
 const observations=[
  {predictedPass:0.9,verdict:'fail'},
  {predictedPass:0.8,verdict:'fail'},
  {predictedPass:0.7,verdict:'fail'},
  {predictedPass:0.9,verdict:'pass'},
  {predictedPass:0.75,verdict:'fail'},
  {predictedPass:0.65,verdict:'fail'},
 ];
 const c=measureCalibration(observations);
 assert.equal(c.predicted,6);
 assert.ok(c.brier>c.inSampleBaseRateBrier);
 assert.ok(c.probabilitySkill<0);
 assert.equal(c.falsePositive,5);
 assert.equal(c.truePositive,1);
 assert.equal(c.precision,0.167);
 assert.equal(c.predictiveStatus,'no_better_than_base_rate');
});
test('calibration ignores unreviewed and out-of-range probabilities',()=>{
 const c=measureCalibration([
  {predictedPass:0.85,verdict:'pass'}, {predictedPass:0.1,verdict:'fail'},
  {predictedPass:0.95,verdict:'awaiting'}, {predictedPass:2,verdict:'pass'}
 ]);
 assert.equal(c.predicted,2);
 assert.equal(c.hitRate,1);
 assert.equal(c.brier,0.016);
 assert.equal(c.predictiveStatus,'too_few');
});
test('sufficient balanced predictions can improve over base-rate forecast',()=>{
 const points=Array.from({length:10},(_,i)=>({
  predictedPass:i<5?0.85:0.15,verdict:i<5?'pass':'fail'
 }));
 const c=measureCalibration(points);
 assert.equal(c.predictiveStatus,'beats_in_sample_base_rate');
 assert.ok(c.brier<c.inSampleBaseRateBrier);
 assert.equal(c.precision,1);assert.equal(c.recall,1);
});
