'use strict';

// Shared across all Exploration Bases. A negative hypothesis is a proposed failure
// mode, NOT an agent-issued fail verdict. Only a real human rating can confirm
// whether an exposed sample passed; internally rejected candidates are unverified.
const POSITIVE = 'positive';
const NEGATIVE = 'negative';
const isNegative = (item) => item?.kind === 'hypothesis' && item?.polarity === NEGATIVE;
const str = (value, max, field, required = true) => {
  const result = value === undefined || value === null ? '' : String(value).trim();
  if (result.length > max) throw new Error(field + ' exceeds ' + max + ' characters');
  if (required && !result) throw new Error(field + ' is required');
  return result;
};
function priorCase(trials, id, verdict, field) {
  const candidate = (trials || []).find(t => t.id === id && t.status === 'rated' && (
    verdict === 'pass' ? t.verdict === 'pass' : ['fail','partial'].includes(t.verdict)
  ));
  if (!candidate) throw new Error(field + ' must cite a real ' + (verdict === 'pass' ? 'human-accepted' : 'human-rejected') + ' case in the same dojo: ' + id);
}
// New runs implicitly pair one relevant failure mechanism with a positive target.
// The agent may override it by explicitly naming its negativeTargets, or by using
// one of the contrasted failure hypotheses in experimentDesign. Selection is
// deterministic, bounded to one arm and independent of any human pass-rate data.
function selectAutomaticNegativeTarget(items = [], changedStage, runCount = 0) {
  const open = items.filter(item => isNegative(item) && item.status === 'open')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!open.length) return null;
  const matching = changedStage ? open.filter(item => item.pipelineStage === changedStage) : [];
  const pool = matching.length ? matching : open;
  const index = Math.max(0, Math.trunc(Number(runCount) || 0)) % pool.length;
  const selected = pool[index];
  return { hypothesisId: selected.id,
    prediction: str(selected.statement, 800, 'automatic negative prediction') };
}
function checkNegativeTargets(rawTargets, hypotheses) {
  if (rawTargets === undefined) return [];
  if (!Array.isArray(rawTargets) || rawTargets.length > 6) throw new Error('negativeTargets must be an array of at most 6');
  const seen = new Set();
  return rawTargets.map(raw => {
    const hid = str(raw?.hypothesisId, 20, 'negativeTargets.hypothesisId');
    if (seen.has(hid)) throw new Error('Duplicate negative target ' + hid);
    seen.add(hid);
    const item = hypotheses.get(hid);
    if (!isNegative(item) || item.status !== 'open') throw new Error('Negative target must reference an open negative hypothesis: ' + hid);
    return { hypothesisId: hid, prediction: str(raw.prediction, 800, 'negativeTargets.prediction') };
  });
}
function checkNegativeReview(raw, { negativeTargets, hypotheses, trials, body }) {
  const targets = negativeTargets || [];
  if (!targets.length && (raw === undefined || raw === null)) return null; // Backward-compatible existing runs.
  if (!targets.length) throw new Error('negativeReview requires negativeTargets on the open run');
  if (raw === undefined || raw === null) {
    const hasPass = (trials || []).some(t => t.status === 'rated' && t.verdict === 'pass');
    const hasFail = (trials || []).some(t => t.status === 'rated' && ['fail', 'partial'].includes(t.verdict));
    // Cold-start/measurement dojos do not have a human positive/negative pair yet.
    // Do not fabricate comparator IDs or turn off exploration; keep it explicitly unverified.
    if (!hasPass || !hasFail) return { status: 'insufficient_human_contrast', checks: [] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('negativeReview is required for runs testing negative hypotheses');
  const checks = raw.checks;
  if (!Array.isArray(checks) || checks.length < targets.length || checks.length > 8)
    throw new Error('negativeReview.checks must cover every declared negative target (max 8)');
  const targetIds = new Set(targets.map(t => t.hypothesisId));
  const seen = new Set();
  const result = checks.map(check => {
    const hid = str(check?.hypothesisId, 20, 'negativeReview.hypothesisId');
    if (!targetIds.has(hid) || !isNegative(hypotheses.get(hid)) || seen.has(hid))
      throw new Error('negativeReview may reference each declared negative target once: ' + hid);
    seen.add(hid);
    const rejectedCaseId = str(check.rejectedCaseId, 20, 'negativeReview.rejectedCaseId');
    const acceptedCaseId = str(check.acceptedCaseId, 20, 'negativeReview.acceptedCaseId');
    priorCase(trials, rejectedCaseId, 'fail', 'negativeReview.rejectedCaseId');
    priorCase(trials, acceptedCaseId, 'pass', 'negativeReview.acceptedCaseId');
    const bodyAnchor = str(check.bodyAnchor, 160, 'negativeReview.bodyAnchor');
    if (bodyAnchor.length < 8 || !String(body).includes(bodyAnchor))
      throw new Error('negativeReview.bodyAnchor must quote 8+ exact characters from this candidate');
    const observedRisk = str(check.observedRisk, 700, 'negativeReview.observedRisk');
    const counterEvidence = str(check.counterEvidence, 700, 'negativeReview.counterEvidence');
    const decision = str(check.decision, 20, 'negativeReview.decision');
    if (decision !== 'cleared') throw new Error('Unresolved negative risk: reject the candidate internally, do not record a user-facing trial');
    return { hypothesisId: hid, rejectedCaseId, acceptedCaseId, bodyAnchor, observedRisk, counterEvidence, decision };
  });
  if (seen.size !== targetIds.size) throw new Error('negativeReview did not cover every negative target');
  return { status: 'preflight_cleared_unverified', checks: result };
}
// The old MCP schema cannot send negativeReview. Reuse the *already-validated*
// learningAudit (or the Buzz editorial screen) only for one explicit negative arm.
// The resulting gate is marked legacy/unverified; never call it independent proof.
function legacyNegativeReviewFromAudit(negativeTargets, audit, buzzScreen) {
  if (!Array.isArray(negativeTargets) || negativeTargets.length !== 1 || !audit) return null;
  const hypothesisId = negativeTargets[0].hypothesisId;
  if (audit.status === 'verified') return { checks: [{
    hypothesisId, rejectedCaseId: audit.negativeCaseId, acceptedCaseId: audit.positiveCaseId,
    bodyAnchor: audit.bodyAnchor, observedRisk: audit.fatalRisk,
    counterEvidence: audit.riskResolution, decision: 'cleared',
  }] };
  if (audit.status === 'legacy_buzz_screen' && buzzScreen) return { checks: [{
    hypothesisId, rejectedCaseId: buzzScreen.negativeCaseIds[0],
    acceptedCaseId: buzzScreen.positiveCaseId, bodyAnchor: buzzScreen.readerQuote,
    observedRisk: buzzScreen.strongestObjection,
    counterEvidence: buzzScreen.distinctValue, decision: 'cleared',
  }] };
  return null;
}
function checkScreenedOut(raw, negativeTargets, hypotheses) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw new Error('screenedOut must be an array of at most 20');
  const ids = new Set((negativeTargets || []).map(x => x.hypothesisId));
  return raw.map(item => {
    const hypothesisId = str(item?.hypothesisId, 20, 'screenedOut.hypothesisId');
    if (!ids.has(hypothesisId) || !isNegative(hypotheses.get(hypothesisId)))
      throw new Error('screenedOut must cite a declared negative hypothesis: ' + hypothesisId);
    return {
      hypothesisId, candidate: str(item.candidate, 300, 'screenedOut.candidate'),
      observedRisk: str(item.observedRisk, 700, 'screenedOut.observedRisk'),
      counterEvidence: str(item.counterEvidence, 700, 'screenedOut.counterEvidence'),
      decision: 'rejected_unverified',
    };
  });
}
function negativeLearning(trials = [], base = {}, hypotheses = []) {
  const withChecks = trials.filter(t => t.negativeReview?.checks?.length);
  const reviewed = withChecks.filter(t => t.status === 'rated' && t.verdict !== 'withdrawn');
  const clearedAndPassed = reviewed.filter(t => t.verdict === 'pass').length;
  const clearedButRejected = reviewed.filter(t => ['fail','partial'].includes(t.verdict)).length;
  const tracked = new Set(withChecks.flatMap(t => t.negativeReview.checks.map(c => c.hypothesisId)));
  const byHypothesis = hypotheses.filter(isNegative).map(h => {
    const rated = reviewed.filter(t => t.negativeReview.checks.some(c => c.hypothesisId === h.id));
    return { id: h.id, title: h.title, polarity: NEGATIVE,
      clearedRated: rated.length, clearedPassed: rated.filter(t => t.verdict === 'pass').length,
      missedRisk: rated.filter(t => ['fail','partial'].includes(t.verdict)).length };
  });
  const allRated = trials.filter(t => t.status === 'rated' && t.verdict !== 'withdrawn');
  return {
    status: hypotheses.some(isNegative) ? 'active' : 'not_registered',
    negativeHypotheses: hypotheses.filter(isNegative).length,
    trackedHypotheses: tracked.size, checks: withChecks.reduce((n,t)=>n+t.negativeReview.checks.length,0),
    reviewed: reviewed.length, clearedAndPassed, clearedButRejected,
    unreviewedRated: allRated.length - reviewed.length,
    screenedOutUnverified: Number(base.negativeScreening?.rejectedUnverified)||0,
    insufficientHumanContrast: trials.filter(t => t.negativeReview?.status === 'insufficient_human_contrast').length,
    legacyDerivedReviewed: reviewed.filter(t => t.negativeReview?.status === 'preflight_legacy_derived_unverified').length,
    byHypothesis,
    note:'Internal rejections are not human fails; a cleared candidate later rejected by the user is a negative-gate false negative, not a success.',
  };
}
module.exports = { POSITIVE, NEGATIVE, isNegative, checkNegativeTargets, checkNegativeReview, checkScreenedOut, negativeLearning, legacyNegativeReviewFromAudit, selectAutomaticNegativeTarget };
