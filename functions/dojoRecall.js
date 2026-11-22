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
    (c.verdict === 'pass' || c.verdict === 'fail')
    && (c.body || c.label).trim().length >= 8);
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

module.exports = { sourceCases, recallRequired, buildRecallProbe, checkRecallPredictions };
