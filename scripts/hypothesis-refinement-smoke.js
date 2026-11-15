'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { refinementView } = require('../functions/hypothesisRefinement');

const entry = (id, verdict, predictedPass, hypothesisIds = []) => ({ id, verdict, predictedPass, hypothesisIds });

test('a strongly overconfident forecast is penalized without rewriting the recorded predictions', () => {
  const inputs = [
    entry('T-001', 'fail', 0.9), entry('T-002', 'fail', 0.8),
    entry('T-003', 'pass', 0.7), entry('T-004', 'fail', 0.6),
    entry('T-005', 'partial', 0.8), entry('T-006', 'pass', 0.9),
  ];
  const before = inputs.map((e) => e.predictedPass);
  const result = refinementView(inputs, []);
  assert.equal(result.calibration.count, 6);
  assert.equal(result.calibration.actualPassRate, 0.333);
  assert.ok(result.calibration.meanBias > 0.4, 'predictions exceeded observed success');
  assert.ok(result.calibration.brier > result.calibration.baselineBrier, 'an uncalibrated forecaster can be worse than the base-rate baseline');
  assert.ok(result.calibration.suggestedAdjustment < 0, 'the advisory correction penalizes overconfidence');
  assert.deepEqual(inputs.map((e) => e.predictedPass), before, 'precommitted forecasts are immutable');
});

test('one accepted result does not become a 100% proven hypothesis and shared trials flag confounding', () => {
  const result = refinementView([
    entry('T-101', 'pass', 0.7, ['H-001', 'H-002']),
  ], [
    { id: 'H-001', title: 'Change source', status: 'open', pipelineStage: 'source' },
    { id: 'H-002', title: 'Change voice', status: 'open', pipelineStage: 'voice' },
    { id: 'H-003', title: 'Discarded', status: 'rejected' },
  ]);
  assert.equal(result.baseline.rated, 1);
  assert.equal(result.hypotheses.length, 2, 'rejected hypotheses cannot be proposed as next arms');
  assert.ok(result.hypotheses.every((h) => h.predictedPass < 1), 'posterior is shrunk toward base rate');
  assert.equal(result.contrast.sharedRatedTrials, 1);
  assert.equal(result.contrast.confounded, true, 'two hypothesis labels on the same post do not provide two independent successes');
  assert.equal(result.calibration.suggestedAdjustment, null, 'too little data for a calibration correction');
});

test('separate pipeline stages expose a discriminating comparison; partial remains a non-pass', () => {
  const result = refinementView([
    entry('T-201', 'partial', 0.65, ['H-001']),
    entry('T-202', 'pass', 0.65, ['H-002']),
  ], [
    { id: 'H-001', title: 'Selection', status: 'open', pipelineStage: 'selection', revisionHistory: [{ reason: 'new source' }] },
    { id: 'H-002', title: 'Voice', status: 'open', pipelineStage: 'voice' },
  ]);
  assert.equal(result.baseline.pass, 1, 'partial is not counted as user acceptance');
  assert.equal(result.contrast.sharedRatedTrials, 0);
  assert.equal(result.contrast.confounded, false);
  assert.equal(result.hypotheses.find((h) => h.id === 'H-001').revisionCount, 1);
  assert.equal(result.hypotheses.find((h) => h.id === 'H-001').pass, 0);
});

test('no user ratings means no apparent calibration accuracy', () => {
  const result = refinementView([], [{ id: 'H-001', status: 'open', title: 'Unproven' }]);
  assert.equal(result.calibration.count, 0);
  assert.equal(result.calibration.brier, null);
  assert.equal(result.calibration.suggestedAdjustment, null);
  assert.equal(result.hypotheses[0].readiness, 'needs_comparison');
});
