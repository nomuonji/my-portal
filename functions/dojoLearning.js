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

// Do not let the most recent burst from one hypothesis monopolize the few examples
// that an agent sees. Keep two recent cases, then cover distinct hypotheses/versions.
function representativeCases(cases, limit = 6) {
  const chosen = [];
  const seen = new Set();
  const hypotheses = new Set();
  const versions = new Set();
  function add(row) {
    if (!row || seen.has(row.id)) return;
    chosen.push(row);
    seen.add(row.id);
    for (const id of row.hypothesisIds || []) hypotheses.add(id);
    if (row.version !== null && row.version !== undefined) versions.add(String(row.version));
  }
  for (const row of cases.slice(0, 2)) add(row);
  while (chosen.length < Math.min(limit, cases.length)) {
    let best = null;
    let bestScore = -Infinity;
    for (let index = 0; index < cases.length; index += 1) {
      const row = cases[index];
      if (seen.has(row.id)) continue;
      const newHypotheses = new Set(row.hypothesisIds || []);
      const uncovered = [...newHypotheses].filter(id => !hypotheses.has(id)).length;
      const newVersion = row.version !== null && row.version !== undefined && !versions.has(String(row.version));
      // One independent mechanism beats merely another recent phrasing of the same one.
      const score = 4 * uncovered + (newVersion ? 2 : 0) + (row.body ? 0.5 : 0) - index / Math.max(1, cases.length);
      if (score > bestScore) { best = row; bestScore = score; }
    }
    add(best);
  }
  return chosen;
}

// A contrast is a retrieval hint, not a causal finding. Prefer examples which
// received different human verdicts under the SAME registered hypothesis.
function contrastPairs(accepted, rejected, limit = 4) {
  const pairs = [];
  const used = new Set();
  for (const positive of accepted) {
    const match = rejected.find(negative =>
      (positive.hypothesisIds || []).some(id => (negative.hypothesisIds || []).includes(id))
      && !used.has(negative.id));
    if (!match) continue;
    used.add(match.id);
    pairs.push({
      positiveId: positive.id,
      negativeId: match.id,
      commonHypothesisIds: positive.hypothesisIds.filter(id => match.hypothesisIds.includes(id)),
      note: '同じ仮説で採否が割れた実例。因果を決めつけず原文と条件の差を調べる。',
    });
    if (pairs.length >= limit) break;
  }
  return pairs;
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
    acceptedCases: representativeCases(accepted).map(compactCase),
    rejectedCases: representativeCases(rejected).map(compactCase),
    contrastPairs: contrastPairs(accepted, rejected),
    caseSelection: 'two_recent_plus_hypothesis_and_version_diversity',
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
  // A Buzz editorial screen is an assertion written by the candidate's author.
  // It cannot stand in for a transfer audit using real human-rated text.
  // Older MCP clients may send editorialScreen alongside a learning:v1 packet.
  if (!audit && buzzScreen && sufficient) {
    throw new Error('Learning review required: the Buzz editorial screen is not a verified transfer audit. Supply learningAudit or learning:v1 with exact positive/negative text anchors.');
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
  const positiveCase = accepted.find(x => x.id === positiveCaseId);
  const negativeCase = rejected.find(x => x.id === negativeCaseId);
  if (!positiveCase) throw new Error('Learning review: positiveCaseId must be an actual human-accepted earlier case in this dojo.');
  if (!negativeCase) throw new Error('Learning review: negativeCaseId must be an actual human-rejected earlier case in this dojo.');
  // Verify the quoted evidence against the immutable historical trial text, not
  // a paraphrase supplied by the same LLM that authored the new candidate.
  const positiveAnchor = field('positiveAnchor', 8, 160);
  const negativeAnchor = field('negativeAnchor', 8, 160);
  if (!(positiveCase.body || positiveCase.label).includes(positiveAnchor)) throw new Error('Learning review: positiveAnchor must quote the actual human-accepted case.');
  if (!(negativeCase.body || negativeCase.label).includes(negativeAnchor)) throw new Error('Learning review: negativeAnchor must quote the actual human-rejected case.');
  if (positiveAnchor === negativeAnchor) throw new Error('Learning review: accepted and rejected case anchors must be different.');
  const mechanism = field('mechanism', 15);
  const transferCondition = field('transferCondition', 15);
  const failureContrast = field('failureContrast', 15);
  const fatalRisk = field('fatalRisk', 15);
  const riskResolution = field('riskResolution', 15);
  const bodyAnchor = field('bodyAnchor', 8, 160);
  if (!body.includes(bodyAnchor)) throw new Error('Learning review: bodyAnchor must be a real passage in the proposed sample.');
  if (audit.decision !== 'submit') throw new Error('Learning review: unresolved/rejected candidate may not be submitted to the user.');
  return {
    status: 'verified', positiveCaseId, negativeCaseId, positiveAnchor, negativeAnchor, mechanism,
    transferCondition, failureContrast, fatalRisk, riskResolution, bodyAnchor,
    decision: 'submit', reviewer: 'agent_only_not_independent',
    verificationScope: 'case_identity_and_exact_quotes_only',
  };
}

module.exports = { evidenceCases, learningView, validateLearningAudit, representativeCases, contrastPairs, AUDIT_PREFIX };
