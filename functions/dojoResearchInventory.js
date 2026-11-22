'use strict';

// Full per-run research inventory. This is separate from the six-case teaching
// view and deliberately includes failed, retired and negative hypotheses.
// Reading every page is observable; semantic understanding still needs later
// human-rated results.
const { createHash } = require('node:crypto');
const { ratedEntries } = require('./explorationLoop');

const HYPOTHESES_PER_PAGE = 12;
const FEEDBACK_PER_PAGE = 25;

function buildResearchInventory(hypotheses = [], trials = [], feedbackLog = [], runs = []) {
  const ratings = ratedEntries(trials, feedbackLog).map(e => ({
    id: e.id, kind: e.kind, verdict: e.verdict, userWords: e.userWords || '',
    failStage: e.failStage || '', label: e.label || '', at: e.at || '',
    version: e.version || null, hypothesisIds: e.hypothesisIds || [],
  }));
  const byHypothesis = new Map();
  for (const e of ratings) for (const id of new Set(e.hypothesisIds)) {
    const counts = byHypothesis.get(id) || { pass: 0, partial: 0, fail: 0 };
    if (Object.hasOwn(counts, e.verdict)) counts[e.verdict] += 1;
    byHypothesis.set(id, counts);
  }
  const ordered = hypotheses.filter(h => h.kind === 'hypothesis')
    .sort((a,b) => String(a.id).localeCompare(String(b.id), 'en'))
    .map(h => ({
      id: h.id, title: h.title || '', polarity: h.polarity || 'positive',
      status: h.status || 'open', stage: h.stage || 'conjecture',
      pipelineStage: h.pipelineStage || 'unknown',
      statement: h.statement || '', mechanism: h.mechanism || '',
      limits: h.limits || '', evidence: (h.evidence || []).map(e => ({
        type: e.type, ref: e.ref || '', source: e.source || '', date: e.date || '',
      })),
      counterexamples: h.counterexamples || [],
      revisions: (h.revisionHistory || []).map(e => ({
        at: e.at || '', reason: e.reason || '', before: e.before || {}, after: e.after || {},
      })),
      humanResults: byHypothesis.get(h.id) || { pass: 0, partial: 0, fail: 0 },
      runResults: runs.filter(r => r.status === 'finished')
        .flatMap(r => (r.verdicts || []).filter(v => v.hypothesisId === h.id)
          .map(v => ({ runId:r.id, result:v.result, observed:v.observed || '' }))).slice(-8),
    }));
  const hash = createHash('sha256').update(JSON.stringify([ordered, ratings])).digest('hex');
  const pages = Math.max(1, Math.ceil(ordered.length / HYPOTHESES_PER_PAGE), Math.ceil(ratings.length / FEEDBACK_PER_PAGE));
  return { hypotheses: ordered, feedback: ratings, hash, pages,
    hypothesisCount: ordered.length, feedbackCount: ratings.length };
}

function researchPage(inventory, page) {
  if (!Number.isInteger(page) || page < 0 || page >= inventory.pages) {
    throw new Error('Research history page out of range');
  }
  return {
    page, pages:inventory.pages, inventoryDigest:inventory.hash,
    totalHypotheses: inventory.hypothesisCount, totalFeedback: inventory.feedbackCount,
    hypotheses: inventory.hypotheses.slice(page * HYPOTHESES_PER_PAGE, (page + 1) * HYPOTHESES_PER_PAGE),
    feedback: inventory.feedback.slice(page * FEEDBACK_PER_PAGE, (page + 1) * FEEDBACK_PER_PAGE),
  };
}

function validateResearchSynthesis(raw, inventory) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Dialectical research synthesis is required after reading every history page');
  }
  const hById = new Map(inventory.hypotheses.map(h => [h.id,h]));
  const fById = new Map(inventory.feedback.map(f => [f.id,f]));
  const form = (name, min = 30, max = 1200) => {
    const value = String(raw[name] || '').trim();
    if (value.length < min || value.length > max) throw new Error('Research synthesis ' + name + ' needs ' + min + '-' + max + ' characters');
    return value;
  };
  const thesisId = String(raw.thesisId || '').trim();
  const antithesisId = String(raw.antithesisId || '').trim();
  const thesis = hById.get(thesisId);
  if (!thesis) throw new Error('Research synthesis thesisId must reference a previously inspected hypothesis');
  if (inventory.hypothesisCount >= 2 && (!hById.has(antithesisId) || thesisId === antithesisId)) {
    throw new Error('Research synthesis must compare two distinct existing hypotheses (or explicitly inspect a single-hypothesis dojo)');
  }
  const antithesis = hById.get(antithesisId) || null;
  const thesisAnchor = String(raw.thesisAnchor || '').trim();
  const antithesisAnchor = String(raw.antithesisAnchor || '').trim();
  if (thesisAnchor.length < 8 || thesisAnchor.length > 160
      || ![thesis.statement,thesis.mechanism,thesis.limits].some(x => x.includes(thesisAnchor))) {
    throw new Error('Research synthesis thesisAnchor must quote the actual prior claim');
  }
  if (antithesis && (antithesisAnchor.length < 8 || antithesisAnchor.length > 160
      || ![antithesis.statement,antithesis.mechanism,antithesis.limits].some(x => x.includes(antithesisAnchor)))) {
    throw new Error('Research synthesis antithesisAnchor must quote the actual contrasting hypothesis');
  }
  const pass = inventory.feedback.filter(f => f.verdict === 'pass');
  const fail = inventory.feedback.filter(f => f.verdict === 'fail' || f.verdict === 'partial');
  const passId = String(raw.passFeedbackId || '').trim();
  const failId = String(raw.failFeedbackId || '').trim();
  if (pass.length && !pass.some(f => f.id === passId)) throw new Error('Research synthesis needs a real historical accepted feedback ID');
  if (fail.length && !fail.some(f => f.id === failId)) throw new Error('Research synthesis needs a real historical rejected feedback ID');
  const action = String(raw.action || '');
  if (!['revise','synthesize','retain','retire'].includes(action)) throw new Error('Research synthesis action is invalid');
  return {
    thesisId, antithesisId:antithesis?.id || null,
    thesisAnchor, antithesisAnchor:antithesis?.id?antithesisAnchor:null,
    passFeedbackId:pass.length?passId:null,
    failFeedbackId:fail.length?failId:null,
    action,
    tension:form('tension'),
    proposedClaim:form('proposedClaim'),
    comparison:form('comparison'),
    falsification:form('falsification'),
    caveat:'Agent-authored synthesis; grounded references do not establish causality. Evaluate via future independent user verdicts.',
  };
}

module.exports={buildResearchInventory,researchPage,validateResearchSynthesis,HYPOTHESES_PER_PAGE,FEEDBACK_PER_PAGE};
