'use strict';

// A common, evidence-only casebook for all Exploration Bases.
// It never infers why the user liked an item or turns an agent self-score into success.
const AUDIT_PREFIX = 'learning:v1:';

function evidenceCases(trials = [], feedbackLog = []) {
  const rows = [];
  for (const t of trials) {
    if (t.status !== 'rated' || !['pass', 'fail', 'partial'].includes(t.verdict)) continue;
    rows.push({
      id: t.id, verdict: t.verdict, at: t.ratedAt || t.createdAt || '',
      label: t.label || '', body: t.body || '', ref: t.ref || '',
      hypothesisIds: t.hypothesisIds || [], version: t.version ?? null,
      evidenceKind: 'user_trial',
    });
  }
  const trialRefs = new Set(trials.filter(t => t.status === 'rated' && t.ref).map(t => t.ref));
  for (const f of feedbackLog) {
    if (trialRefs.has(f.ref) || !['confirmed', 'declined'].includes(f.decision)) continue;
    rows.push({
      id: f.haulId || f.ref, verdict: f.decision === 'confirmed' ? 'pass' : 'fail',
      at: f.at || '', label: f.label || '', body: '', ref: f.ref || '',
      hypothesisIds: [], version: f.version ?? null, evidenceKind: 'confirmed_haul',
    });
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function learningView(trials = [], feedbackLog = [], hypotheses = [], progress = null) {
  const cases = evidenceCases(trials, feedbackLog);
  const accepted = cases.filter(x => x.verdict === 'pass');
  const rejected = cases.filter(x => x.verdict === 'fail');
  const compactCase = x => ({
    id: x.id, label: x.label, body: x.body.slice(0, 450), ref: x.ref,
    hypothesisIds: x.hypothesisIds, evidenceKind: x.evidenceKind, version: x.version,
  });
  const stats = new Map();
  for (const c of cases) for (const hid of new Set(c.hypothesisIds)) {
    const v = stats.get(hid) || { id: hid, rated: 0, pass: 0, partial: 0, fail: 0 };
    v.rated += 1;
    v[c.verdict] += 1;
    stats.set(hid, v);
  }
  const names = new Map(hypotheses.map(h => [h.id, h.title || '']));
  const calibrated = [...stats.values()].filter(x => x.rated >= 3).map(x => ({
    ...x, title: names.get(x.id) || '',
    // Laplace smoothing avoids declaring a 1/1 trial to be a proven win.
    adjustedPassRate: Math.round(((x.pass + 1) / (x.rated + 2)) * 1000) / 1000,
  })).sort((a, b) => b.adjustedPassRate - a.adjustedPassRate || b.rated - a.rated);
  const samples = trials.filter(t => t.status === 'rated' && t.backfilled !== true);
  const audited = samples.filter(t => t.learningAudit?.status === 'verified').length;
  const legacy = samples.filter(t => t.learningAudit?.status === 'legacy_buzz_screen').length;
  return {
    status: accepted.length && rejected.length ? 'contrast_ready'
      : accepted.length ? 'no_rejected_example' : rejected.length ? 'no_accepted_example' : 'no_rated_examples',
    acceptedCount: accepted.length, rejectedCount: rejected.length,
    acceptedCases: accepted.slice(0, 6).map(compactCase),
    rejectedCases: rejected.slice(0, 6).map(compactCase),
    promisingHypotheses: calibrated.slice(0, 6),
    // Human decisions are the ground truth; transfer conditions remain agent hypotheses.
    auditCoverage: { ratedTrials: samples.length, verified: audited, legacyBuzzScreen: legacy,
      missing: Math.max(0, samples.length - audited - legacy) },
    measuredWins: (progress?.achievements || []).filter(x => x.status === 'confirmed')
      .slice(-4).map(x => ({ id: x.id, label: x.label, ref: x.ref, hypothesisIds: x.hypothesisIds || [] })),
    caveat: 'Past ratings identify examples, not proven causal mechanisms. Compare applicability and counterexamples before transferring a pattern.',
  };
}

function validateLearningAudit(raw, { trials = [], feedbackLog = [], body = '', buzzScreen = null } = {}) {
  const cases = evidenceCases(trials, feedbackLog);
  const accepted = cases.filter(x => x.verdict === 'pass');
  const rejected = cases.filter(x => x.verdict === 'fail');
  const sufficient = accepted.length > 0 && rejected.length > 0 && cases.length >= 3;
  let audit = raw.learningAudit;
  const note = typeof raw.predictionNote === 'string' ? raw.predictionNote.trim() : '';
  if (note.startsWith(AUDIT_PREFIX)) {
    if (audit) throw new Error('Learning review: supply learningAudit or learning:v1 predictionNote, not both.');
    try { audit = JSON.parse(note.slice(AUDIT_PREFIX.length)); }
    catch (e) { throw new Error('Learning review: malformed learning:v1 JSON: ' + e.message); }
  }
  if (!audit && buzzScreen) {
    // Existing Buzz clients send the already-enforced screen:v1 packet. Preserve their
    // compatibility, but report that semantic transfer conditions were NOT verified.
    return {
      status: 'legacy_buzz_screen',
      positiveCaseId: buzzScreen.positiveCaseId,
      negativeCaseId: buzzScreen.negativeCaseIds?.[0] || '',
      mechanism: buzzScreen.distinctValue, fatalRisk: buzzScreen.strongestObjection,
    };
  }
  if (!audit) {
    if (sufficient) {
      throw new Error('Learning review required: cite one actual accepted and one rejected case, explain the transferable mechanism and why the prior failure does not recur (learningAudit or learning:v1 predictionNote).');
    }
    return { status: 'insufficient_history', acceptedCount: accepted.length, rejectedCount: rejected.length };
  }
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    throw new Error('Learning review must be an object.');
  }
  const field = (name, min, max = 700) => {
    const v = audit[name];
    if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) {
      throw new Error('Learning review: ' + name + ' must have ' + min + '-' + max + ' characters.');
    }
    return v.trim();
  };
  if (!sufficient) {
    throw new Error('Learning review: a past accepted and rejected case must exist; otherwise use exploratory evidence rather than inventing a comparison.');
  }
  const positiveCaseId = field('positiveCaseId', 3, 160);
  const negativeCaseId = field('negativeCaseId', 3, 160);
  if (!accepted.some(x => x.id === positiveCaseId)) throw new Error('Learning review: positiveCaseId must be an actual human-accepted earlier case in this dojo.');
  if (!rejected.some(x => x.id === negativeCaseId)) throw new Error('Learning review: negativeCaseId must be an actual human-rejected earlier case in this dojo.');
  const mechanism = field('mechanism', 15);
  const transferCondition = field('transferCondition', 15);
  const failureContrast = field('failureContrast', 15);
  const fatalRisk = field('fatalRisk', 15);
  const riskResolution = field('riskResolution', 15);
  const bodyAnchor = field('bodyAnchor', 8, 160);
  if (!body.includes(bodyAnchor)) throw new Error('Learning review: bodyAnchor must be a real passage in the proposed sample.');
  if (audit.decision !== 'submit') throw new Error('Learning review: unresolved/rejected candidate may not be submitted to the user.');
  return {
    status: 'verified', positiveCaseId, negativeCaseId, mechanism,
    transferCondition, failureContrast, fatalRisk, riskResolution, bodyAnchor,
    decision: 'submit', reviewer: 'agent_only_not_independent',
  };
}

module.exports = { evidenceCases, learningView, validateLearningAudit, AUDIT_PREFIX };
