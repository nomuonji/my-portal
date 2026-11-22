'use strict';

// A compact, reproducible recall check for user-reviewed dojos.
// This is a check of historical labels, not proof that the agent understands
// humor or will generalize to unseen user preferences.
const { evidenceCases } = require('./dojoLearning');

const MIN_PER_CLASS = 4;
const STUDY_PER_CLASS = 2;
const CHALLENGE_PER_CLASS = 2;

function sourceCases(trials = [], feedbackLog = []) {
  return evidenceCases(trials, feedbackLog).filter(c =>
    c.evidenceKind === 'user_trial'
    && (c.verdict === 'pass' || c.verdict === 'fail')
    && typeof c.body === 'string' && c.body.trim().length >= 8);
}

function recallRequired(trials = [], feedbackLog = []) {
  const cases = sourceCases(trials, feedbackLog);
  return ['pass', 'fail'].every(verdict => cases.filter(c => c.verdict === verdict).length >= MIN_PER_CLASS);
}

function fragments(value) {
  const s = String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 420);
  const grams = new Set();
  for (let i = 0; i + 2 < s.length; i++) grams.add(s.slice(i, i + 3));
  return grams;
}
function similarity(a, b) {
  const grams = fragments(a);
  if (!grams.size) return 0;
  const other = fragments(b);
  let overlap = 0;
  for (const g of grams) if (other.has(g)) overlap += 1;
  return overlap / Math.max(1, Math.min(grams.size, other.size));
}
function compactCase(c, revealVerdict) {
  return {
    id: c.id, label: c.label,
    body: (c.body || c.label).slice(0, 1500),
    hypothesisIds: c.hypothesisIds || [],
    ...(revealVerdict ? { verdict: c.verdict } : {}),
  };
}

function buildRecallProbe(trials, feedbackLog, topic, hypothesisIds = []) {
  const cases = sourceCases(trials, feedbackLog);
  if (!recallRequired(trials, feedbackLog)) return { required: false, reason: 'insufficient_human_contrast' };
  const ids = new Set(hypothesisIds);
  const rank = c => {
    const matchingHypotheses = (c.hypothesisIds || []).filter(x => ids.has(x)).length;
    return matchingHypotheses * 5 + similarity(topic, c.body || c.label) * 3;
  };
  const choose = verdict => cases.filter(c => c.verdict === verdict)
    .sort((a, b) => rank(b) - rank(a) || String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id))
    .slice(0, STUDY_PER_CLASS + CHALLENGE_PER_CLASS);
  const pass = choose('pass');
  const fail = choose('fail');
  const study = [...pass.slice(0, STUDY_PER_CLASS), ...fail.slice(0, STUDY_PER_CLASS)];
  const challenge = [...pass.slice(STUDY_PER_CLASS), ...fail.slice(STUDY_PER_CLASS)]
    .sort((a, b) => a.id.localeCompare(b.id)); // no pass/fail ordering cue
  return {
    required: true,
    studyCases: study.map(c => compactCase(c, true)),
    challengeCases: challenge.map(c => compactCase(c, false)),
    studyCaseIds: study.map(c => c.id),
    challengeCaseIds: challenge.map(c => c.id),
    // Label truth stays on the server. The challenge is not secret from other
    // history endpoints and cannot be treated as a truly blind evaluation.
  };
}

function checkRecallPredictions(probe, answers, trials, feedbackLog) {
  if (!probe || !probe.required) throw new Error('Recall check has not been prepared');
  if (!Array.isArray(answers) || answers.length !== probe.challengeCaseIds.length) {
    throw new Error('Recall check must predict every assigned challenge case exactly once');
  }
  const actual = new Map(sourceCases(trials, feedbackLog).map(c => [c.id, c]));
  const expected = new Set(probe.challengeCaseIds);
  const seen = new Set();
  let correct = 0;
  const verified = answers.map(answer => {
    if (!answer || !expected.has(answer.caseId) || seen.has(answer.caseId)) {
      throw new Error('Recall check has a duplicate or unassigned case ID');
    }
    seen.add(answer.caseId);
    const c = actual.get(answer.caseId);
    if (!c) throw new Error('Recall check case is no longer available');
    const predictedVerdict = answer.predictedVerdict;
    if (!['pass', 'fail'].includes(predictedVerdict)) {
      throw new Error('Recall check prediction must be pass or fail');
    }
    const quote = String(answer.quote || '').trim();
    if (quote.length < 8 || quote.length > 160 || !(c.body || c.label).includes(quote)) {
      throw new Error('Recall check quote must match the original case, 8-160 characters');
    }
    const reason = String(answer.reason || '').trim();
    if (reason.length < 20 || reason.length > 700) {
      throw new Error('Recall check reason must discuss an observable difference, 20-700 characters');
    }
    if (predictedVerdict === c.verdict) correct += 1;
    return { caseId: c.id, predictedVerdict, quote, reason, matched: predictedVerdict === c.verdict };
  });
  return {
    status: correct >= 3 ? 'passed' : 'failed',
    correct, total: verified.length, checks: verified,
    note: 'Historical label classification only; no independent proof of causal explanation or future quality.',
  };
}


/**
 * Recover the actual earlier experimental claims, falsifiers and revisions.
 * The sample casebook alone contains only hypothesis IDs, which do not tell
 * the author what was tested or what repeatedly failed.
 * Rank by the current task and frozen run hypotheses; require mixed user
 * outcomes to avoid showing an untested hypothesis as a proven win.
 */
function buildHistoricalHypotheses(hypotheses = [], trials = [], runs = [], topic = '', pinnedIds = []) {
  const cases = sourceCases(trials);
  const pinned = new Set(pinnedIds);
  const ranked = hypotheses.filter(h => h.kind === 'hypothesis' && h.polarity !== 'negative')
    .map(h => {
      const linked = cases.filter(c => (c.hypothesisIds || []).includes(h.id));
      const positive = linked.filter(c => c.verdict === 'pass');
      const negative = linked.filter(c => c.verdict === 'fail');
      if (!positive.length || !negative.length) return null;
      const relatedRuns = runs.filter(r => r.status === 'finished'
        && (r.verdicts || []).some(v => v.hypothesisId === h.id));
      return { h, positive, negative, relatedRuns,
        rank: (pinned.has(h.id) ? 12 : 0)
          + 5 * similarity(topic, [h.title, h.statement, h.mechanism].join(' '))
          + Math.min(positive.length, negative.length) * 0.3,
      };
    }).filter(Boolean)
    .sort((a, b) => b.rank - a.rank || (b.positive.length + b.negative.length) - (a.positive.length + a.negative.length))
    .slice(0, 2);
  return ranked.map(({ h, positive, negative, relatedRuns }) => ({
    id: h.id, title: h.title,
    claim: String(h.statement || '').slice(0, 1500),
    mechanism: String(h.mechanism || '').slice(0, 1600),
    limits: String(h.limits || '').slice(0, 1200),
    stage: h.stage || 'conjecture', status: h.status || 'open',
    testCounts: { pass: positive.length, fail: negative.length },
    passCaseIds: positive.map(c => c.id).slice(0, 25),
    failCaseIds: negative.map(c => c.id).slice(0, 25),
    supportingEvidence: (h.evidence || []).slice(-2).map(e => String(e.ref || '').slice(0, 600)),
    counterexamples: ((h.counterexamples || []).length ? (h.counterexamples || []).slice(-2) : negative.slice(0, 2).map(c => c.body))
      .map(e => String(e).slice(0, 600)),
    revisionHistory: (h.revisionHistory || []).slice(-2).map(e => ({
      at: e.at, reason: e.reason, changedFields: e.changedFields,
      before: e.before, after: e.after,
    })),
    pastRunResults: relatedRuns.slice(-2).flatMap(r =>
      (r.verdicts || []).filter(v => v.hypothesisId === h.id)
        .map(v => ({ runId: r.id, result: v.result, observed: String(v.observed || '').slice(0, 500) }))),
    note: 'Hypothesis claims and run verdicts are agent interpretations. Counts reflect actual historical user labels, not causal proof.',
  }));
}

function checkHypothesisReviews(snapshot = [], reviews = []) {
  if (!snapshot.length) {
    if (Array.isArray(reviews) && reviews.length) throw new Error('Unassigned hypothesis reviews are not allowed');
    return [];
  }
  if (!Array.isArray(reviews) || reviews.length !== snapshot.length) {
    throw new Error('Every retrieved historical hypothesis requires an explicit review before submitting a trial');
  }
  const seen = new Set();
  return reviews.map(review => {
    if (!review || seen.has(review.hypothesisId)) throw new Error('Duplicate or invalid hypothesis review');
    seen.add(review.hypothesisId);
    const h = snapshot.find(c => c.id === review.hypothesisId);
    if (!h) throw new Error('Hypothesis review ID is not among the retrieved historical hypotheses');
    const claimAnchor = String(review.claimAnchor || '').trim();
    const limitAnchor = String(review.limitAnchor || '').trim();
    if (claimAnchor.length < 8 || claimAnchor.length > 160
      || !(h.claim || '').includes(claimAnchor) && !(h.mechanism || '').includes(claimAnchor)) {
      throw new Error('Historical hypothesis claimAnchor must quote its actual claim or mechanism');
    }
    if (limitAnchor.length < 8 || limitAnchor.length > 160
      || !(h.limits || '').includes(limitAnchor)
        && !(h.counterexamples || []).some(e => e.includes(limitAnchor))) {
      throw new Error('Historical hypothesis limitAnchor must quote its actual limits or counterexamples');
    }
    if (!(h.passCaseIds || []).includes(review.passCaseId) || !(h.failCaseIds || []).includes(review.failCaseId)) {
      throw new Error('Historical hypothesis review must cite an actual pass and fail linked to this hypothesis');
    }
    const transferCondition = String(review.transferCondition || '').trim();
    const refutingCondition = String(review.refutingCondition || '').trim();
    if (transferCondition.length < 25 || transferCondition.length > 650
      || refutingCondition.length < 25 || refutingCondition.length > 650) {
      throw new Error('Historical hypothesis review needs concrete transfer and refuting conditions (25-650 chars)');
    }
    return { hypothesisId:h.id, claimAnchor, limitAnchor, passCaseId:review.passCaseId,
      failCaseId:review.failCaseId, transferCondition, refutingCondition,
      observedPass:h.testCounts.pass, observedFail:h.testCounts.fail };
  });
}

module.exports = { sourceCases, recallRequired, buildRecallProbe, checkRecallPredictions, buildHistoricalHypotheses, checkHypothesisReviews };
