'use strict';

// Shared dojo hypothesis-refinement diagnostics. These are decision aids, never a substitute
// for an actual user verdict, causal evidence, or the version-release gates.
const round = (n) => Math.round(n * 1000) / 1000;
const clamp = (n, low = 0, high = 1) => Math.min(high, Math.max(low, n));
const rated = (e) => e && (e.verdict === 'pass' || e.verdict === 'partial' || e.verdict === 'fail');
const pass = (e) => Number(e.verdict === 'pass');

function refinementView(entries = [], hypotheses = []) {
  const decisions = entries.filter(rated);
  const forecasts = decisions.filter((e) => Number.isFinite(e.predictedPass) && e.predictedPass >= 0 && e.predictedPass <= 1);
  const count = forecasts.length;
  const passCount = decisions.reduce((n, e) => n + pass(e), 0);
  // A weak Beta(1,1) prior prevents a single success from looking like certainty.
  const baseRate = (passCount + 1) / (decisions.length + 2);
  const signedBias = count ? forecasts.reduce((n, e) => n + e.predictedPass - pass(e), 0) / count : null;
  const brier = count ? forecasts.reduce((n, e) => n + (e.predictedPass - pass(e)) ** 2, 0) / count : null;
  const baseBrier = count ? forecasts.reduce((n, e) => n + (baseRate - pass(e)) ** 2, 0) / count : null;
  const mae = count ? forecasts.reduce((n, e) => n + Math.abs(e.predictedPass - pass(e)), 0) / count : null;
  // Calibrate cautiously: small samples are strongly shrunk toward zero adjustment.
  const adjustment = count >= 5 ? clamp(-signedBias * count / (count + 12), -0.25, 0.25) : null;

  const seen = (hypotheses || []).filter((h) => h && h.status === 'open').map((h) => {
    const cases = decisions.filter((e) => (e.hypothesisIds || []).includes(h.id));
    const p = cases.reduce((n, e) => n + pass(e), 0);
    const strength = 4; // Independent observations are not assumed; keep the prior visible.
    const alpha = p + strength * baseRate;
    const beta = cases.length - p + strength * (1 - baseRate);
    const estimate = alpha / (alpha + beta);
    const uncertainty = Math.sqrt(alpha * beta / ((alpha + beta) ** 2 * (alpha + beta + 1)));
    const hasSourceEvidence = (h.evidence || []).some((e) => e.type === 'observation');
    const priority = (uncertainty * 0.6 + (cases.length < 3 ? 0.2 : 0) + (hasSourceEvidence ? 0.06 : 0) + (cases.length > 0 ? 0.06 : 0));
    return {
      id: h.id, title: h.title || '', pipelineStage: h.pipelineStage || 'unknown',
      rated: cases.length, pass: p, partial: cases.filter((e) => e.verdict === 'partial').length,
      fail: cases.filter((e) => e.verdict === 'fail').length, predictedPass: round(estimate),
      uncertainty: round(uncertainty), priority: round(priority),
      readiness: cases.length < 3 ? 'needs_comparison' : 'review_evidence',
      caseIds: cases.map((e) => e.id),
      revisionCount: (h.revisionHistory || []).length,
    };
  }).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  // Prefer an alternative from a different pipeline stage, and expose shared trials
  // so an agent does not mistake two labels on the same sample for independent proof.
  const a = seen[0] || null;
  const b = a ? (seen.slice(1).find((x) => x.pipelineStage !== a.pipelineStage
    && x.pipelineStage !== 'unknown' && a.pipelineStage !== 'unknown') || seen[1] || null) : null;
  const shared = a && b ? a.caseIds.filter((id) => b.caseIds.includes(id)) : [];
  const contrast = a && b ? {
    hypothesisIds: [a.id, b.id], stages: [a.pipelineStage, b.pipelineStage],
    sharedRatedTrials: shared.length, confounded: shared.length > 0 || a.pipelineStage === b.pipelineStage
      || a.pipelineStage === 'unknown' || b.pipelineStage === 'unknown',
    guidance: 'Change one sourcing/selection/transformation variable, keep the other steps comparable, and precommit a different observable prediction for each alternative.',
  } : null;

  return {
    calibration: {
      count, actualPassRate: count ? round(forecasts.reduce((n, e) => n + pass(e), 0) / count) : null,
      meanPrediction: count ? round(forecasts.reduce((n, e) => n + e.predictedPass, 0) / count) : null,
      meanBias: signedBias === null ? null : round(signedBias),
      brier: brier === null ? null : round(brier),
      baselineBrier: baseBrier === null ? null : round(baseBrier),
      meanAbsoluteError: mae === null ? null : round(mae),
      suggestedAdjustment: adjustment === null ? null : round(adjustment),
      note: count < 10 ? 'Few rated forecasts: do not claim prediction accuracy.' : 'Advisory only; preserve each precommitted prediction and the user verdict.',
    },
    baseline: { rated: decisions.length, pass: passCount, smoothedPassRate: round(baseRate) },
    hypotheses: seen.slice(0, 8),
    contrast,
    guidance: 'Before the next trial, compare at least two causal explanations with supporting and opposing evidence, name the changed pipeline stage and the falsifying outcome. Do not treat self-review as a user pass.',
  };
}

module.exports = { refinementView };
