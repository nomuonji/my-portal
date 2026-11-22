'use strict';

// Exploration Base: the fixed points an agent carries while exploring unknown territory.
// One base per exploration. Intelligence Packs hold slow-moving cognition; the base holds
// what moves during the exploration: outcome contract, method pointer/version, hypothesis
// ledger, constraints and the run log.

const { getDocumentDb } = require('./documentDb');
const { loopView, loopSummary, ratedEntries, VERDICTS: TRIAL_VERDICTS, FAIL_STAGES, LIMITS } = require('./explorationLoop');
const { validateLearningAudit } = require('./dojoLearning');
const { trialArtifactStatus, publicMediaUrl } = require('./dojoArtifactReadiness');

const DEFAULT_DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTIONS = Object.freeze({
  bases: 'explorationBases',
  items: 'explorationBaseItems',
  runs: 'explorationBaseRuns',
  events: 'explorationBaseEvents',
  trials: 'explorationBaseTrials',
});
const ID_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
const STAGES = ['conjecture', 'observed', 'reproduced', 'yielded_candidate', 'yielded_outcome'];
const WIN_STAGES = new Set(['yielded_candidate', 'yielded_outcome']);
const HYPOTHESIS_STATUS = ['open', 'rejected', 'retired'];
const PIPELINE_STAGES = ['source', 'selection', 'transform', 'voice', 'gate', 'audience', 'unknown'];
// Sources (where material comes from) climb the same ladder as hypotheses: tried and seen relevant material,
// useful in two runs, produced a candidate, produced a confirmed achievement. Rejected = tried and useless.
const LEDGER_KINDS = { hypothesis: 'H', source: 'S' };
const CONSTRAINT_OWNERS = ['user', 'environment', 'agent'];
const CONSTRAINT_STATUS = ['active', 'relaxed', 'retired'];
const EVIDENCE_TYPES = ['observation', 'candidate', 'outcome'];
const VERDICTS = ['supported', 'contradicted', 'inconclusive'];
const OPEN_RUN_TTL_MS = 12 * 60 * 60 * 1000;
const { NEGATIVE, checkNegativeTargets, checkNegativeReview, checkScreenedOut, legacyNegativeReviewFromAudit, selectAutomaticNegativeTarget } = require('./dojoNegativeReview');
const STALL_WARNING_AT = 3;
const PROTOCOL = [
  'Read this base before exploring; do not rely on memory of an earlier version.',
  'exploration_run_start: read loop.refinement, compare competing explanations, and precommit a discriminating experimentDesign (changed stage, controls, expected difference, falsification) where possible. An exploratory probe may have no design.',
  'Forecast calibration and hypothesis ranking are advisory, not proof or automatic method release. Do not inflate predictedPass to bypass a domain-specific quality gate.',
  'All dojos: register falsifiable failure modes as polarity=negative. Every positive-target run with registered open failure hypotheses automatically pins one negative arm (stage-matched if possible); explicitly declared negativeTargets override the automatic choice. Compare genuine accepted/rejected cases via negativeReview before showing a trial, and screen out unresolved risks.',
  'At finishRun, negativeVerdicts report what was observed. screenedOut cases are unverified internal rejections, not user fails or method wins. Read loop.negativeLearning for cleared-but-rejected misses and update the next experiment. Older runs remain readable without evidence of negative testing.',
  'exploration_run_start: declare which hypotheses this run tests and the predicted result before measuring.',
  'During the run, write every changed fixed point with the runId (exploration_item_upsert).',
  'exploration_run_finish: give a verdict per declared hypothesis. A run that moved no fixed point is recorded as stalled.',
  'Never change the method version during an open run. Bump it only between runs, with the motivating runs and a benchmark result.',
  'The outcome contract and user-owned constraints belong to the user: propose changes, never apply them without authorization.',
  'IDs are never reused. Rejected hypotheses stay in the ledger so the same inference is not repeated.',
  'When the method is a chat_skill or intelligence_pack target, use exactly the released version (method.target.releasedVersion, body included here), not the latest one. A newer version made outside this base is unverified until it is released here.',
  'Sources (where candidates come from) are a ledger too: record which source a candidate came from (evidence on the source, sourceIds on the achievement) and reject sources that yield nothing, so the next run starts from proven ones.',
  'When a submarine (Project Submarine) carries this skill/pack, its sortie opens and closes the run here. What it finds is the submarine\'s haul; a haul the user confirms comes back here as an achievement.',
  'The measure of a 道場 is the pass rate of what its released version produces, by version (loop). There is no count target. Read loop.nextActions first.',
  'Every sample shown to the user is a trial: exploration_trial_record before showing it, with the hypotheses it tests and the predicted chance of passing. A sample tied to no hypothesis teaches nothing and is refused.',
  'When the user reacts, exploration_trial_rate with their own words. The rating lands on the version and on each hypothesis the trial tested, so a rated hypothesis can no longer be closed as inconclusive.',
  'A new version waits until the released one has enough ratings to be compared (loop.gates). Three consecutive non-passes require a research run with a structured failureAnalysis: two actual failed examples, a confirmed pass or externally verifiable positive contrast, two competing causes with contradictory evidence and falsification, uncertainty, and a discriminating next test. A mere finished run or agent self-score never clears the gate.',
  'feedback holds what the user said about each thing the gear produced (action and comment), grouped by the version that produced it. Read it before proposing a new version and cite it as the reason; a version is better only if the user said so more often, not if self-scores rose.',
];

function database() { return getDocumentDb(DEFAULT_DATABASE_ID); }
function now() { return new Date().toISOString(); }
function text(value, max, label, required) {
  const result = value === undefined || value === null ? '' : String(value).trim().slice(0, max);
  if (required && !result) throw new Error(label + ' is required');
  return result;
}
// Optional picture of a sample (product photo, thumbnail). Only public HTTPS URLs are kept.
function imageUrl(value) {
  const url = text(value, 1000, 'trial.imageUrl', false);
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new Error('trial.imageUrl must be a public https URL');
  return url;
}
function list(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength, 'array item', false)).filter(Boolean))].slice(0, maxItems);
}
function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object');
  return value;
}
function oneOf(value, allowed, label, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(label + ' is required');
  }
  if (!allowed.includes(value)) throw new Error(label + ' must be one of: ' + allowed.join(', '));
  return value;
}
function requireBaseId(value) {
  const id = text(value, 80, 'baseId', true);
  if (!ID_PATTERN.test(id)) throw new Error('baseId must be lowercase kebab-case');
  return id;
}
function seqId(prefix, number) { return prefix + '-' + String(number).padStart(3, '0'); }
function docId(baseId, localId) { return baseId + '__' + localId; }
function value(snapshot) { return snapshot && snapshot.exists ? snapshot.data() : null; }
function authorization(input, what) {
  const note = text(input?.authorizationNote, 600, 'authorizationNote', false);
  if (input?.userAuthorized !== true || note.length < 8) {
    throw new Error(what + ' is owned by the user. Pass userAuthorized=true with authorizationNote quoting where the user approved it, or record it as a proposal instead.');
  }
  return note;
}

// Evidence audit for a failed batch. This verifies provenance and contradictory hypotheses,
// NOT that an agent has correctly diagnosed the causal mechanism. Only user ratings count.
// Compatibility with MCP clients whose tool schema was pinned before failureAnalysis
// was added. The compact audit is transported inside the legacy summary field, but
// runs through EXACTLY the same server-side evidence validation as the native field.
// This is not a skip or a weaker gate; malformed envelopes fail closed.
const LEGACY_FAILURE_ANALYSIS_PREFIX = 'failureAnalysis:v1:';
function unpackFailureAnalysis(input) {
  const summary = text(input?.summary, 2500, 'summary', true);
  if (!summary.startsWith(LEGACY_FAILURE_ANALYSIS_PREFIX)) {
    return { summary, failureAnalysis: input?.failureAnalysis || null };
  }
  if (input?.failureAnalysis) throw new Error('Cannot send failureAnalysis in both the direct field and the legacy summary envelope.');
  let payload;
  try {
    payload = plain(JSON.parse(summary.slice(LEGACY_FAILURE_ANALYSIS_PREFIX.length)), 'legacy failureAnalysis payload');
  } catch (error) {
    throw new Error('Invalid legacy failureAnalysis envelope: ' + error.message);
  }
  if (Object.keys(payload).some((key) => key !== 'summary' && key !== 'failureAnalysis')) {
    throw new Error('Unknown legacy failureAnalysis envelope field');
  }
  return {
    summary: text(payload.summary, 2500, 'legacy summary', true),
    failureAnalysis: plain(payload.failureAnalysis, 'legacy failureAnalysis'),
  };
}

function cleanFailureAnalysis(raw, entries) {
  const input = plain(raw, 'failureAnalysis');
  const recent = entries.filter((e) => e.verdict === 'fail' || e.verdict === 'partial').slice(-LIMITS.failStreak);
  const cases = list(input.caseRefs, 12, 120);
  if (cases.length < 2 || cases.filter((id) => recent.some((e) => e.id === id)).length < 2) {
    throw new Error('failureAnalysis.caseRefs must cite at least two recent, real, user-rated non-pass IDs. Agent scores or invented refs do not count.');
  }
  const comparisons = list(input.contrastRefs, 12, 600);
  if (!comparisons.length) throw new Error('failureAnalysis.contrastRefs requires at least one real accepted example or externally verifiable positive contrast.');
  comparisons.forEach((ref) => {
    const recorded = entries.find((e) => e.id === ref);
    if (recorded) {
      if (recorded.verdict !== 'pass') throw new Error('failureAnalysis.contrastRefs points to a non-pass: ' + ref);
    } else if (!/^https:\/\/[^\s]+/.test(ref)) {
      throw new Error('failureAnalysis.contrastRefs must cite a real rated pass ID or public HTTPS evidence URL: ' + ref);
    }
  });
  const alternativeInputs = Array.isArray(input.alternatives) ? input.alternatives : [];
  if (alternativeInputs.length < 2 || alternativeInputs.length > 6) {
    throw new Error('failureAnalysis.alternatives needs 2 to 6 competing explanations, not a single opposite-sounding conclusion.');
  }
  const stages = new Set();
  const substantial = (v, max, label, min = 20) => {
    const result = text(v, max, label, true);
    if (result.length < min) throw new Error(label + ' must describe observable evidence/conditions, not an empty label (min ' + min + ' chars).');
    return result;
  };
  const allowedStages = ['source', 'selection', 'transform', 'voice', 'gate', 'audience', 'unknown'];
  const alternatives = alternativeInputs.map((entry, i) => {
    const a = plain(entry, 'failureAnalysis.alternatives[' + i + ']');
    const stage = oneOf(a.stage, allowedStages, 'failureAnalysis.alternatives.stage');
    stages.add(stage);
    return {
      stage,
      claim: substantial(a.claim, 750, 'failureAnalysis.alternatives.claim'),
      forEvidence: substantial(a.forEvidence, 950, 'failureAnalysis.alternatives.forEvidence'),
      againstEvidence: substantial(a.againstEvidence, 950, 'failureAnalysis.alternatives.againstEvidence'),
      falsification: substantial(a.falsification, 950, 'failureAnalysis.alternatives.falsification'),
    };
  });
  if (stages.size < 2) throw new Error('failureAnalysis needs alternatives across at least two causal stages. Changing wording to its opposite is not a second explanation.');
  const next = plain(input.nextTest, 'failureAnalysis.nextTest');
  // Audit every false-positive in the recent loss streak, including ones deliberately omitted from caseRefs.
  const falsePositive = recent.some((e) => Number(e.predictedPass) >= 0.5);
  const falsePositiveAudit = text(input.falsePositiveAudit, 1200, 'failureAnalysis.falsePositiveAudit', false);
  if (falsePositive && falsePositiveAudit.length < 20) {
    throw new Error('failureAnalysis.falsePositiveAudit must investigate why AI quality/PASS prediction was wrong before the next batch.');
  }
  return {
    caseRefs: cases, contrastRefs: comparisons, alternatives,
    uncertainty: substantial(input.uncertainty, 1200, 'failureAnalysis.uncertainty'),
    falsePositiveAudit,
    nextTest: {
      sourcingChange: substantial(next.sourcingChange, 900, 'failureAnalysis.nextTest.sourcingChange'),
      selectionChange: substantial(next.selectionChange, 900, 'failureAnalysis.nextTest.selectionChange'),
      predictedDifference: substantial(next.predictedDifference, 900, 'failureAnalysis.nextTest.predictedDifference'),
      refutingObservation: substantial(next.refutingObservation, 900, 'failureAnalysis.nextTest.refutingObservation'),
    },
    status: 'hypotheses_unverified',
  };
}

function cleanOutcome(raw) {
  const input = plain(raw, 'outcome');
  // A count target is optional: a 道場 is measured by its pass rate. Missions of submarines may still set one.
  let target = null;
  if (input.target) {
    const raw = plain(input.target, 'outcome.target');
    const min = Number(raw.min);
    if (!Number.isInteger(min) || min < 1) throw new Error('outcome.target.min must be a positive integer');
    const max = raw.max === undefined || raw.max === null ? null : Number(raw.max);
    if (max !== null && (!Number.isInteger(max) || max < min)) throw new Error('outcome.target.max must be an integer >= min');
    target = { min, max };
  }
  const budget = input.budget ? plain(input.budget, 'outcome.budget') : {};
  const maxRuns = budget.maxRuns === undefined || budget.maxRuns === null ? null : Number(budget.maxRuns);
  if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 1)) throw new Error('outcome.budget.maxRuns must be a positive integer');
  return {
    statement: text(input.statement, 1200, 'outcome.statement', true),
    unit: text(input.unit, 300, 'outcome.unit', true),
    target,
    acceptance: text(input.acceptance, 1500, 'outcome.acceptance', true),
    confirmedBy: oneOf(input.confirmedBy, ['user', 'measurement'], 'outcome.confirmedBy', 'user'),
    finalIndicator: text(input.finalIndicator, 800, 'outcome.finalIndicator', false),
    proxies: list(input.proxies, 20, 300),
    deadline: text(input.deadline, 40, 'outcome.deadline', false) || null,
    budget: { maxRuns, note: text(budget.note, 500, 'outcome.budget.note', false) },
    stopConditions: list(input.stopConditions, 12, 500),
    priority: text(input.priority, 300, 'outcome.priority', false),
  };
}
// A base trains one target: a Chat Skill or an Intelligence Pack in the DB, pinned to the version this base
// released. Execution uses that version; the base never holds a second copy of the body.
const TARGET_KINDS = new Set(['chat_skill', 'intelligence_pack']);
function cleanMethod(raw, fallbackLocation) {
  const input = plain(raw, 'method');
  const ref = input.bodyRef ? plain(input.bodyRef, 'method.bodyRef') : {};
  const body = text(input.body, 20000, 'method.body', false);
  const bodyRef = {
    kind: oneOf(ref.kind, ['repo', 'inline', 'document', 'chat_skill', 'intelligence_pack', 'hq_method'], 'method.bodyRef.kind', body ? 'inline' : undefined),
    // An inline body has no external location; only pointer bodies inherit the previous location.
    location: text(ref.location, 500, 'method.bodyRef.location', false) || ((ref.kind || (body ? 'inline' : '')) === 'inline' ? '' : (fallbackLocation || '')),
    path: text(ref.path, 500, 'method.bodyRef.path', false),
    commit: text(ref.commit, 80, 'method.bodyRef.commit', false),
  };
  if (TARGET_KINDS.has(bodyRef.kind)) {
    const versionNumber = Number(ref.versionNumber);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new Error('method.bodyRef.versionNumber is required for a ' + bodyRef.kind + ' target: the version this base releases');
    if (!ID_PATTERN.test(bodyRef.location)) throw new Error('method.bodyRef.location must be the ' + bodyRef.kind + ' id');
    if (body) throw new Error('A ' + bodyRef.kind + ' target keeps its body in the DB; do not pass method.body');
    bodyRef.versionNumber = versionNumber;
  }
  if (bodyRef.kind === 'inline' && !body) throw new Error('method.body is required when bodyRef.kind is inline');
  if (bodyRef.kind !== 'inline' && !bodyRef.location) throw new Error('method.bodyRef.location is required unless the body is inline');
  return {
    title: text(input.title, 220, 'method.title', true),
    version: text(input.version, 60, 'method.version', true),
    summary: text(input.summary, 2000, 'method.summary', true),
    bodyRef,
    body,
    benchmarkRef: text(input.benchmarkRef, 500, 'method.benchmarkRef', false),
  };
}
function cleanEvidence(raw, runId) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map((entry) => {
    const item = plain(entry, 'evidence');
    return {
      type: oneOf(item.type, EVIDENCE_TYPES, 'evidence.type', 'observation'),
      ref: text(item.ref, 600, 'evidence.ref', true),
      source: text(item.source, 600, 'evidence.source', false),
      date: text(item.date, 40, 'evidence.date', false) || now().slice(0, 10),
      runId: text(item.runId, 20, 'evidence.runId', false) || runId || null,
    };
  });
}
function hypothesisBrief(item) {
  return {
    id: item.id, title: item.title, stage: item.stage, pipelineStage: item.pipelineStage || 'unknown', polarity: item.polarity || 'positive', statement: item.statement,
    revisionCount: (item.revisionHistory || []).length, limits: item.limits || '', evidenceCount: (item.evidence || []).length,
    counterexampleCount: (item.counterexamples || []).length, legacyIds: item.legacyIds || [],
  };
}
function sourceBrief(item) {
  const evidence = item.evidence || [];
  return {
    id: item.id, title: item.title, stage: item.stage, locator: item.locator || '', coverage: item.coverage || '',
    limits: item.limits || '', evidenceCount: evidence.length,
    candidateCount: evidence.filter((entry) => entry.type === 'candidate' || entry.type === 'outcome').length,
    missCount: (item.counterexamples || []).length, legacyIds: item.legacyIds || [],
  };
}
// Ledger view shared by hypotheses and sources: open items by stage, then rejected and retired.
function ledgerView(items, brief) {
  const open = items.filter((item) => item.status === 'open');
  return {
    winPatterns: open.filter((item) => WIN_STAGES.has(item.stage)).map(brief),
    reproduced: open.filter((item) => item.stage === 'reproduced').map(brief),
    observed: open.filter((item) => item.stage === 'observed').map(brief),
    conjectures: open.filter((item) => item.stage === 'conjecture').map(brief),
    rejected: items.filter((item) => item.status === 'rejected')
      .map((item) => ({ id: item.id, title: item.title, reason: item.statusReason || '', legacyIds: item.legacyIds || [] })),
    // Retired: real but not leading to the outcome. Listed so it is not rediscovered.
    retired: items.filter((item) => item.status === 'retired')
      .map((item) => ({ id: item.id, title: item.title, stage: item.stage, reason: item.statusReason || '', legacyIds: item.legacyIds || [] })),
  };
}

// Loads a pinned version of a target and the latest version number. Required lazily: the intelligence
// registry itself requires this module.
async function defaultResolveTarget({ kind, id, versionNumber }) {
  if (kind === 'chat_skill') {
    const skills = require('./chatContextRegistry');
    const history = await skills.skillVersions({ id });
    const items = history.items || [];
    const pinned = items.find((item) => Number(item.versionNumber) === versionNumber);
    if (!pinned) throw new Error('Chat Skill version not found: ' + id + ' v' + versionNumber);
    const latest = Math.max(...items.map((item) => Number(item.versionNumber) || 0));
    return { title: pinned.title, latestVersion: latest, body: pinned.body || '' };
  }
  if (kind === 'intelligence_pack') {
    const registry = require('./agentIntelligenceRegistry');
    const { pack, definition } = await registry.getPack({ id, versionNumber });
    const parts = (definition.components || []).map((component) => '### ' + component.title + '\n' + (component.summary || '') + '\n'
      + (component.dependencies || []).map((dep) => '- ' + dep.canonicalRef + (dep.versionNumber ? ' v' + dep.versionNumber : '') + '（' + (dep.requiredness || '') + '）' + (dep.when ? ' ' + dep.when : '')).join('\n'));
    return {
      title: definition.title || pack.title, latestVersion: Number(pack.currentVersionNumber) || versionNumber,
      body: '## ' + (definition.title || id) + ' v' + versionNumber + '\n\n' + (definition.purpose || definition.summary || '') + '\n\n' + parts.join('\n\n'),
    };
  }
  throw new Error('Not a trainable target: ' + kind);
}

// The user's evaluations grouped by the released version that produced the evaluated thing, newest version first.
function feedbackView(log, releasedVersion) {
  const groups = new Map();
  log.forEach((f) => {
    const key = f.version === null || f.version === undefined ? 'unknown' : String(f.version);
    const g = groups.get(key) || { version: key === 'unknown' ? null : Number(key), total: 0, confirmed: 0, candidate: 0, declined: 0, comments: [] };
    g.total += 1; g[f.decision] = (g[f.decision] || 0) + 1;
    if (f.comment && g.comments.length < 8) g.comments.push({ at: f.at, label: f.label, actionLabel: f.actionLabel, text: f.comment, haulId: f.haulId, submarineId: f.submarineId });
    groups.set(key, g);
  });
  const byVersion = [...groups.values()].sort((a, b) => (b.version ?? -1) - (a.version ?? -1))
    .map((g) => ({ ...g, released: g.version !== null && g.version === releasedVersion }));
  return { releasedVersion, total: log.length, byVersion, recent: log.slice(0, 15) };
}

function createStore(options) {
  const getDb = (options && options.getDb) || database;
  const resolveTarget = (options && options.resolveTarget) || defaultResolveTarget;
  const db = () => getDb();
  const baseRef = (id) => db().collection(COLLECTIONS.bases).doc(id);
  const itemRef = (baseId, id) => db().collection(COLLECTIONS.items).doc(docId(baseId, id));
  const runRef = (baseId, id) => db().collection(COLLECTIONS.runs).doc(docId(baseId, id));
  const trialRef = (baseId, id) => db().collection(COLLECTIONS.trials).doc(docId(baseId, id));
  const eventRef = (baseId, seq) => db().collection(COLLECTIONS.events).doc(docId(baseId, 'E' + String(seq).padStart(6, '0')));

  // JSON round-trip drops undefined fields, which Firestore refuses.
  const put = (tx, ref, data) => tx.set(ref, JSON.parse(JSON.stringify(data)));

  function pushEvent(tx, base, event) {
    base.counters.E = (base.counters.E || 0) + 1;
    put(tx, eventRef(base.id, base.counters.E), {
      baseId: base.id, seq: base.counters.E, createdAt: now(),
      actor: text(event.actor, 120, 'actor', false) || 'agent',
      type: event.type, itemId: event.itemId || null, runId: event.runId || null,
      summary: text(event.summary, 1000, 'event.summary', false), detail: event.detail || null,
    });
  }
  async function loadBase(tx, baseId) {
    const base = value(await tx.get(baseRef(baseId)));
    if (!base) throw new Error('Exploration Base not found: ' + baseId);
    if (base.status === 'closed') throw new Error('Exploration Base is closed: ' + baseId);
    base.counters = base.counters || {};
    return base;
  }
  function saveBase(tx, base) {
    base.revision = (Number(base.revision) || 0) + 1;
    base.updatedAt = now();
    put(tx, baseRef(base.id), base);
  }
  function requireOpenRun(base, runId) {
    if (!runId) return null;
    if (base.openRunId !== runId) throw new Error('runId ' + runId + ' is not the open run of this base (open: ' + (base.openRunId || 'none') + ')');
    return runId;
  }

  async function create(input) {
    const id = requireBaseId(input?.id);
    const note = authorization(input, 'Creating an Exploration Base (it fixes the outcome contract)');
    const outcome = cleanOutcome(input.outcome);
    const method = input.method ? cleanMethod(input.method) : null;
    if (method && TARGET_KINDS.has(method.bodyRef.kind)) await resolveTarget({ kind: method.bodyRef.kind, id: method.bodyRef.location, versionNumber: method.bodyRef.versionNumber });
    const packRefs = Array.isArray(input.packRefs) ? input.packRefs.slice(0, 12).map((raw) => {
      const ref = plain(raw, 'packRef');
      return { packId: text(ref.packId, 80, 'packRef.packId', true), role: text(ref.role, 200, 'packRef.role', false) };
    }) : [];
    await db().runTransaction(async (tx) => {
      if (value(await tx.get(baseRef(id)))) throw new Error('Exploration Base already exists: ' + id);
      const at = now();
      const base = {
        id, schemaVersion: 1, kind: 'exploration_base', status: 'active',
        title: text(input.title, 220, 'title', true),
        summary: text(input.summary, 1500, 'summary', true),
        projectIds: list(input.projectIds, 20, 140),
        domains: list(input.domains, 20, 100),
        canonicalData: list(input.canonicalData, 12, 400),
        packRefs,
        outcome: { ...outcome, revision: 1, setAt: at, authorizationNote: note },
        progress: { achievements: [], confirmedCount: 0 },
        method: method ? { ...method, setAt: at } : null,
        methodHistory: method ? [{ version: method.version, summary: method.summary, setAt: at, motivatingRunIds: [], benchmark: null }] : [],
        proposals: [], lastRuns: [], openRunId: null, stalledRuns: 0, runCount: 0,
        counters: { H: 0, K: 0, R: 0, A: 0, PR: 0, E: 0 },
        revision: 0, createdAt: at,
      };
      pushEvent(tx, base, { type: 'base_created', summary: base.title, actor: input.actor, detail: { outcome, method: method && { version: method.version } } });
      saveBase(tx, base);
    });
    return get({ id });
  }

  async function listBases(input) {
    const status = text(input?.status, 20, 'status', false);
    const snap = await db().collection(COLLECTIONS.bases).limit(200).get();
    const items = snap.docs.map((doc) => doc.data())
      .filter((base) => !status || base.status === status)
      .map((base) => ({
        id: base.id, title: base.title, summary: base.summary, status: base.status, revision: Number(base.revision) || 0,
        projectIds: base.projectIds || [], packRefs: base.packRefs || [],
        outcome: base.outcome ? { statement: base.outcome.statement, target: base.outcome.target, deadline: base.outcome.deadline } : null,
        confirmedCount: base.progress?.confirmedCount || 0,
        methodVersion: base.method?.version || null,
        target: TARGET_KINDS.has(base.method?.bodyRef?.kind) && base.method.bodyRef.versionNumber
          ? { kind: base.method.bodyRef.kind, id: base.method.bodyRef.location, versionNumber: base.method.bodyRef.versionNumber } : null,
        runCount: base.runCount || 0, stalledRuns: base.stalledRuns || 0, openRunId: base.openRunId || null,
        awaitingCount: (base.progress?.achievements || []).filter((a) => a.status === 'candidate').length,
        pendingProposalCount: (base.proposals || []).filter((p) => p.status === 'pending').length,
        lastRun: (base.lastRuns || [])[0] || null, // newest first
        loop: base.loop || loopSummary(loopView({ trials: [], feedbackLog: base.feedbackLog, base })),
        updatedAt: base.updatedAt,
      }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return { items, count: items.length, collection: COLLECTIONS.bases };
  }

  async function loadItems(baseId) {
    const snap = await db().collection(COLLECTIONS.items).where('baseId', '==', baseId).limit(1000).get();
    return snap.docs.map((doc) => doc.data()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  async function loadTrials(baseId) {
    const snap = await db().collection(COLLECTIONS.trials).where('baseId', '==', baseId).limit(3000).get();
    return snap.docs.map((doc) => doc.data()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  // Cache the loop summary on the base so the list and World Home need no extra reads.
  async function refreshLoop(baseId) {
    const [trials, items] = await Promise.all([loadTrials(baseId), loadItems(baseId)]);
    let view = null;
    await db().runTransaction(async (tx) => {
      const base = value(await tx.get(baseRef(baseId)));
      if (!base) return;
      view = loopView({ trials, feedbackLog: base.feedbackLog, base, hypotheses: items.filter((item) => item.kind === 'hypothesis') });
      base.loop = loopSummary(view);
      put(tx, baseRef(baseId), base);
    });
    return view;
  }

  async function get(input) {
    const id = requireBaseId(input?.id);
    const view = oneOf(input?.view, ['state', 'brief', 'full'], 'view', 'brief');
    const base = value(await baseRef(id).get());
    if (!base) throw new Error('Exploration Base not found: ' + id);
    const [items, trials] = await Promise.all([loadItems(id), loadTrials(id)]);
    const hypotheses = items.filter((item) => item.kind === 'hypothesis');
    const constraints = items.filter((item) => item.kind === 'constraint');
    const sources = items.filter((item) => item.kind === 'source');
    const confirmed = base.progress?.confirmedCount || 0;
    const warnings = [];
    if ((base.stalledRuns || 0) >= STALL_WARNING_AT) {
      warnings.push(base.stalledRuns + ' consecutive runs moved no fixed point. Stop measuring and re-examine: is the constraint set satisfiable, is the method measuring the outcome, is the outcome still the right one? Report which constraint binds.');
    }
    if (base.outcome?.budget?.maxRuns && (base.runCount || 0) >= base.outcome.budget.maxRuns) {
      warnings.push('Run budget (' + base.outcome.budget.maxRuns + ') is used up. Report to the user before running again.');
    }
    if (base.openRunId) warnings.push('Run ' + base.openRunId + ' is still open. Finish it, or take it over if abandoned.');
    let released = null;
    const ref = base.method?.bodyRef;
    // State is a refresh, not the initial method/contract load. It deliberately
    // skips resolving the released skill body and sending the complete ledgers.
    if (view === 'state') {
      if (ref && TARGET_KINDS.has(ref.kind) && !ref.versionNumber) warnings.push('No released target version is pinned. Read view=brief before executing.');
      if ((base.proposals || []).some((p) => p.status === 'pending')) warnings.push('There are pending proposals waiting for the user.');
      return {
        base: { id: base.id, title: base.title, status: base.status, revision: base.revision, updatedAt: base.updatedAt },
        method: base.method ? { version: base.method.version, bodyRef: ref } : null,
        outcome: { revision: base.outcome?.revision, confirmedCount: confirmed, awaitingConfirmation: (base.progress?.achievements || []).filter((a) => a.status === 'candidate').map(({ id, label, ref }) => ({ id, label, ref })) },
        position: { runCount: base.runCount || 0, stalledRuns: base.stalledRuns || 0, openRunId: base.openRunId || null, lastRuns: (base.lastRuns || []).slice(0, 1) },
        loop: loopView({ trials, feedbackLog: base.feedbackLog, base, hypotheses }),
        warnings,
        note: 'Refresh only. Use view=brief if the method or contract changed, or to load constraints, ledgers and the released body.',
      };
    }
    if (ref && TARGET_KINDS.has(ref.kind) && !ref.versionNumber) {
      // Set before versions were pinned: it points at the skill/pack but releases no version.
      warnings.push('The method points at ' + ref.kind + ' ' + ref.location + ' without a released version, so execution would follow whatever its latest version is. Release a version with exploration_method_version_set (bodyRef.versionNumber).');
    } else if (ref && TARGET_KINDS.has(ref.kind)) {
      released = { kind: ref.kind, id: ref.location, releasedVersion: ref.versionNumber };
      try {
        const resolved = await resolveTarget({ kind: ref.kind, id: ref.location, versionNumber: ref.versionNumber });
        Object.assign(released, { title: resolved.title, latestVersion: resolved.latestVersion, body: resolved.body });
        if (resolved.latestVersion > ref.versionNumber) {
          released.unreleasedNewer = true;
          warnings.push('The ' + ref.kind + ' ' + ref.location + ' has v' + resolved.latestVersion + ', newer than v' + ref.versionNumber + ' released by this base. It was changed outside this base and is not verified here; keep using v' + ref.versionNumber + ' until it passes the benchmark and is released with exploration_method_version_set.');
        }
      } catch (error) {
        released.error = String(error?.message || error).slice(0, 300);
        warnings.push('The released target ' + ref.location + ' v' + ref.versionNumber + ' could not be loaded: ' + released.error);
      }
    }
    if ((base.proposals || []).some((p) => p.status === 'pending')) warnings.push('There are pending proposals waiting for the user.');
    const result = {
      base: {
        id: base.id, title: base.title, summary: base.summary, status: base.status, revision: base.revision,
        projectIds: base.projectIds || [], domains: base.domains || [], canonicalData: base.canonicalData || [],
        packRefs: base.packRefs || [], updatedAt: base.updatedAt,
      },
      outcome: {
        ...base.outcome,
        confirmedCount: confirmed,
        awaitingConfirmation: (base.progress?.achievements || []).filter((a) => a.status === 'candidate'),
        confirmed: (base.progress?.achievements || []).filter((a) => a.status === 'confirmed'),
      },
      method: base.method ? {
        title: base.method.title, version: base.method.version, summary: base.method.summary,
        bodyRef: base.method.bodyRef, benchmarkRef: base.method.benchmarkRef || '', setAt: base.method.setAt,
        ...(released ? { target: released, body: released.body || '' } : (base.method.bodyRef?.kind === 'inline' || view === 'full' ? { body: base.method.body || '' } : {})),
        recentChanges: (base.methodHistory || []).slice(-3),
      } : null,
      constraints: Object.fromEntries(CONSTRAINT_OWNERS.map((owner) => [owner, constraints
        .filter((item) => item.owner === owner && item.status === 'active')
        .map((item) => ({ id: item.id, statement: item.statement, check: item.check || '', legacyIds: item.legacyIds || [] }))])),
      hypotheses: ledgerView(hypotheses, hypothesisBrief),
      sources: ledgerView(sources, sourceBrief),
      position: {
        runCount: base.runCount || 0, stalledRuns: base.stalledRuns || 0,
        openRunId: base.openRunId || null, lastRuns: base.lastRuns || [],
      },
      loop: loopView({ trials, feedbackLog: base.feedbackLog, base, hypotheses }),
      feedback: feedbackView(base.feedbackLog || [], base.method?.bodyRef?.versionNumber || null),
      proposals: (base.proposals || []).filter((p) => p.status === 'pending'),
      warnings,
      protocol: PROTOCOL,
    };
    if (view === 'full') {
      const eventLimit = Math.min(Math.max(Number(input?.eventLimit) || 60, 1), 300);
      const [runs, events] = await Promise.all([
        db().collection(COLLECTIONS.runs).where('baseId', '==', id).limit(500).get(),
        db().collection(COLLECTIONS.events).where('baseId', '==', id).limit(2000).get(),
      ]);
      result.full = {
        hypotheses, constraints, sources,
        relaxedOrRetiredConstraints: constraints.filter((item) => item.status !== 'active').map((item) => item.id),
        methodHistory: base.methodHistory || [],
        proposals: base.proposals || [],
        runs: runs.docs.map((doc) => doc.data()).sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 50),
        trials: trials.slice().sort((a, b) => String(b.ratedAt || b.createdAt || '').localeCompare(String(a.ratedAt || a.createdAt || ''))).slice(0, 120),
        events: events.docs.map((doc) => doc.data()).sort((a, b) => b.seq - a.seq).slice(0, eventLimit),
      };
    }
    return result;
  }

  async function setOutcome(input) {
    const id = requireBaseId(input?.baseId);
    const hasOutcome = input.outcome !== undefined;
    const decisions = Array.isArray(input.confirmAchievements) ? input.confirmAchievements.slice(0, 30) : [];
    const resolve = list(input.resolveProposalIds, 30, 20);
    // Title, summary and domains describe what is being explored and for whom: the user's, like the outcome.
    // Domains may arrive as a comma-separated string from clients holding an older tool schema.
    const descriptor = {};
    if (input.title !== undefined) descriptor.title = text(input.title, 220, 'title', true);
    if (input.summary !== undefined) descriptor.summary = text(input.summary, 1500, 'summary', true);
    if (input.canonicalData !== undefined) {
      descriptor.canonicalData = list(typeof input.canonicalData === 'string' ? input.canonicalData.split('\n').map((d) => d.trim()) : input.canonicalData, 12, 400);
    }
    if (input.domains !== undefined) {
      descriptor.domains = list(typeof input.domains === 'string' ? input.domains.split(',').map((d) => d.trim()) : input.domains, 20, 100);
    }
    const hasDescriptor = Object.keys(descriptor).length > 0;
    if (!hasOutcome && !hasDescriptor && !decisions.length && !resolve.length && !input.status) throw new Error('Nothing to change');
    const authorized = input.userAuthorized === true;
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      if (!authorized) {
        if (!hasOutcome) authorization(input, 'Renaming the base, confirming achievements, resolving proposals or changing status');
        base.counters.PR = (base.counters.PR || 0) + 1;
        const proposal = {
          id: seqId('PR', base.counters.PR), status: 'pending', target: 'outcome',
          proposed: cleanOutcome(input.outcome),
          reason: text(input.reason, 1500, 'reason (why the outcome should change)', true),
          proposedAt: now(), runId: text(input.runId, 20, 'runId', false) || null,
        };
        base.proposals = [...(base.proposals || []), proposal].slice(-40);
        pushEvent(tx, base, { type: 'outcome_proposed', summary: proposal.reason, actor: input.actor, detail: proposal });
        saveBase(tx, base);
        return;
      }
      const note = authorization(input, 'The outcome contract');
      if (hasOutcome) {
        const outcome = cleanOutcome(input.outcome);
        base.outcome = { ...outcome, revision: (Number(base.outcome?.revision) || 0) + 1, setAt: now(), authorizationNote: note };
        pushEvent(tx, base, { type: 'outcome_set', summary: text(input.reason, 1000, 'reason', false) || 'Outcome contract revised', actor: input.actor, detail: outcome });
      }
      if (hasDescriptor) {
        const before = { title: base.title, summary: base.summary, domains: base.domains, canonicalData: base.canonicalData };
        Object.assign(base, descriptor);
        pushEvent(tx, base, { type: 'base_described', summary: text(input.reason, 1000, 'reason', false) || 'Title or summary revised', actor: input.actor, detail: { before, after: descriptor } });
      }
      decisions.forEach((raw) => {
        const decision = plain(raw, 'confirmAchievements item');
        const achievement = (base.progress?.achievements || []).find((a) => a.id === decision.id);
        if (!achievement) throw new Error('Achievement not found: ' + decision.id);
        achievement.status = oneOf(decision.decision, ['confirmed', 'declined'], 'decision');
        achievement.decidedAt = now();
        achievement.decisionNote = text(decision.note, 800, 'note', false) || note;
        pushEvent(tx, base, { type: 'achievement_' + achievement.status, itemId: achievement.id, summary: achievement.label, actor: input.actor });
      });
      base.progress.confirmedCount = (base.progress.achievements || []).filter((a) => a.status === 'confirmed').length;
      resolve.forEach((proposalId) => {
        const proposal = (base.proposals || []).find((p) => p.id === proposalId);
        if (!proposal) throw new Error('Proposal not found: ' + proposalId);
        proposal.status = 'resolved'; proposal.resolvedAt = now(); proposal.resolutionNote = note;
      });
      if (input.status) {
        base.status = oneOf(input.status, ['active', 'paused', 'closed'], 'status');
        pushEvent(tx, base, { type: 'status_' + base.status, summary: note, actor: input.actor });
      }
      saveBase(tx, base);
    });
    return get({ id });
  }

  async function setMethodVersion(input) {
    const id = requireBaseId(input?.baseId);
    const trials = await loadTrials(id);
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      if (base.openRunId) throw new Error('Run ' + base.openRunId + ' is open. The method version cannot change during a run; finish the run first.');
      const method = cleanMethod(input.method, base.method?.bodyRef?.location);
      if (TARGET_KINDS.has(method.bodyRef.kind)) await resolveTarget({ kind: method.bodyRef.kind, id: method.bodyRef.location, versionNumber: method.bodyRef.versionNumber });
      if ((base.methodHistory || []).some((entry) => entry.version === method.version)) {
        throw new Error('Method version label already used: ' + method.version + '. Version labels are never reused.');
      }
      const motivating = list(input.motivatingRunIds, 20, 20);
      // A version is justified either by finished runs or by an explicit user decision (e.g. the user dropped a
      // criterion). Clients holding an older tool schema send the flag as the string "true".
      const userDirected = (input.userAuthorized === true || input.userAuthorized === 'true')
        ? authorization({ ...input, userAuthorized: true }, 'A user-directed method version') : '';
      if (base.method) {
        if (!motivating.length && !userDirected) throw new Error('motivatingRunIds is required: name the finished runs whose results justify this version, or pass userAuthorized with authorizationNote when the user decided the change.');
        for (const runId of motivating) {
          const run = value(await tx.get(runRef(id, runId)));
          if (!run || run.status !== 'finished') throw new Error('Motivating run not found or not finished: ' + runId);
        }
      }
      // Measured-outcome bases validate against real measurements, not former user trial ratings.
      // Preserve the original rating gate for every user-confirmed dojo.
      const measurementMode = base.outcome?.confirmedBy === 'measurement';
      if (base.method && measurementMode && !userDirected) {
        const distinctRuns = [...new Set(motivating)];
        if (distinctRuns.length < 2) {
          throw new Error('A measurement-based method revision needs two distinct finished evidence-bearing runs.');
        }
        for (const runId of distinctRuns) {
          const run = value(await tx.get(runRef(id, runId)));
          if (!run?.moved || !(run.movedItemIds || []).length) {
            throw new Error('Measurement run lacks recorded evidence movement: ' + runId);
          }
        }
        if (input.benchmark?.passed !== true || !String(input.benchmark.ref || '').trim() || !String(input.benchmark.cases || '').trim()) {
          throw new Error('A measurement-based method revision requires a passed, referenced case benchmark.');
        }
      }
      // User-reviewed dojos still compare the released version with actual user-rated samples.
      const loop = loopView({ trials, feedbackLog: base.feedbackLog, base });
      if (base.method && loop.gates.usesTrials && !loop.gates.canReleaseNewVersion && !userDirected) {
        throw new Error('The released version has ' + loop.current.rated + ' rated trial(s); a new version needs ' + LIMITS.minRatedPerVersion
          + ' so the two can be compared by pass rate. Keep the insight in the hypothesis ledger and show more samples from the released version, or pass userAuthorized with authorizationNote when the user directed this change.');
      }
      if (base.method && loop.gates.researchDueBeforeNextTrial && !userDirected) {
        throw new Error('Cannot release a revised Skill/Pack after consecutive non-passes without a finished research run recording verified failureAnalysis; a changed label or noBenchmarkReason is not evidence.');
      }
      const rawBenchmark = input.benchmark ? plain(input.benchmark, 'benchmark') : null;
      const noBenchmarkReason = text(input.noBenchmarkReason, 600, 'noBenchmarkReason', false);
      if (base.method && !(rawBenchmark && rawBenchmark.passed === true) && noBenchmarkReason.length < 8) {
        throw new Error('A new method version needs benchmark.passed=true (known cases still judged correctly), or noBenchmarkReason explaining why no benchmark exists yet.');
      }
      const benchmark = rawBenchmark ? {
        passed: rawBenchmark.passed === true, ref: text(rawBenchmark.ref, 500, 'benchmark.ref', false),
        cases: text(rawBenchmark.cases, 1000, 'benchmark.cases', false),
      } : { passed: null, noBenchmarkReason };
      const at = now();
      base.method = { ...method, setAt: at };
      base.methodHistory = [...(base.methodHistory || []), {
        version: method.version, summary: method.summary, setAt: at, motivatingRunIds: motivating, benchmark,
        replaced: base.method ? { version: loop.current.version, rated: loop.current.rated, pass: loop.current.pass, passRate: loop.current.passRate } : null,
        ...(userDirected ? { authorizationNote: userDirected } : {}),
      }].slice(-100);
      pushEvent(tx, base, { type: 'method_version_set', summary: method.version + ': ' + method.summary, actor: input.actor, detail: { motivatingRunIds: motivating, benchmark, bodyRef: method.bodyRef, authorizationNote: userDirected || undefined } });
      saveBase(tx, base);
    });
    await refreshLoop(id);
    return get({ id });
  }

  function applyLedgerItem(kind, prior, raw, runId, base) {
    const creating = !prior;
    const item = prior ? { ...prior } : {
      kind, stage: 'conjecture', status: 'open', evidence: [], counterexamples: [], legacyIds: [], createdAt: now(),
    };
    if (creating || raw.title !== undefined) item.title = text(raw.title, 160, kind + '.title', true);
    if (kind === 'hypothesis') {
      if (creating || raw.statement !== undefined) item.statement = text(raw.statement, 1500, 'hypothesis.statement', true);
      if (creating || raw.mechanism !== undefined) item.mechanism = text(raw.mechanism, 2000, 'hypothesis.mechanism (why it would hold)', true);
      if (raw.pipelineStage !== undefined) item.pipelineStage = oneOf(raw.pipelineStage, PIPELINE_STAGES, 'hypothesis.pipelineStage');
      if (creating) item.pipelineStage = item.pipelineStage || 'unknown';
      if (raw.polarity !== undefined) item.polarity = oneOf(raw.polarity, ['positive', NEGATIVE], 'hypothesis.polarity');
      if (creating) item.polarity = item.polarity || 'positive';
    } else {
      if (creating || raw.locator !== undefined) item.locator = text(raw.locator, 600, 'source.locator (URL, query or tool call that reaches it)', true);
      if (creating || raw.coverage !== undefined) item.coverage = text(raw.coverage, 1500, 'source.coverage (what it yields and why it is worth trying)', true);
      if (raw.statement !== undefined) item.statement = text(raw.statement, 1500, 'source.statement', false);
    }
    if (raw.limits !== undefined) item.limits = text(raw.limits, 1500, kind + '.limits', false);
    if (raw.legacyIds !== undefined) item.legacyIds = list(raw.legacyIds, 12, 60);
    const added = cleanEvidence(raw.addEvidence, runId);
    item.evidence = [...(item.evidence || []), ...added].slice(-60);
    item.counterexamples = [...new Set([...(item.counterexamples || []), ...list(raw.addCounterexamples, 20, 800)])].slice(-40);
    const reason = text(raw.reason, 1500, 'reason', false);
    // Old MCP installations cannot send the new polarity property until reconnected.
    // Their existing reason field supports an explicit migration directive, without
    // changing titles, legacyIds, evidence or human ratings.
    const legacyPolarity = /^\[polarity:(positive|negative)\](?:\s|$)/.exec(reason);
    if (kind === 'hypothesis' && raw.polarity === undefined && legacyPolarity) item.polarity = legacyPolarity[1];
    const previousStage = item.stage;
    if (raw.stage !== undefined) item.stage = oneOf(raw.stage, STAGES, kind + '.stage');
    const rank = STAGES.indexOf(item.stage);
    const previousRank = STAGES.indexOf(previousStage);
    const count = (type) => item.evidence.filter((entry) => !type || entry.type === type).length;
    if (rank >= 1 && count() < 1) throw new Error('Stage ' + item.stage + ' needs at least one evidence entry.');
    if (rank >= 2 && count() < 2) throw new Error('Stage reproduced needs two independent evidence entries.');
    if (rank >= 3 && count('candidate') + count('outcome') < 1) throw new Error('Stage yielded_candidate needs evidence of type candidate: a candidate that passed the acceptance checks because of this ' + kind + '.');
    if (rank >= 4 && count('outcome') < 1) throw new Error('Stage yielded_outcome needs evidence of type outcome: a confirmed achievement of this base.');
    if (rank >= 4 && !(base.progress?.confirmedCount > 0)) throw new Error('Stage yielded_outcome is impossible while the base has no confirmed achievement.');
    if (!creating && rank > previousRank && !added.length) throw new Error('Advancing a stage requires addEvidence in the same call.');
    if (!creating && rank < previousRank && !reason) throw new Error('Demoting a stage requires a reason.');
    if (raw.status !== undefined) {
      const status = oneOf(raw.status, HYPOTHESIS_STATUS, kind + '.status');
      if (status !== item.status) {
        if (status !== 'open' && !reason) throw new Error('Rejecting or retiring a ' + kind + ' requires a reason.');
        if (status === 'open' && !reason) throw new Error('Reopening a ' + kind + ' requires a reason.');
        item.status = status; item.statusReason = reason; item.statusChangedAt = now();
      }
    }
    // Preserve actual changes to a hypothesis, not just its latest wording. A rating/evidence
    // append is not a hypothesis revision, and does not erase earlier versions of the claim.
    if (!creating && kind === 'hypothesis') {
      const fields = ['title', 'statement', 'mechanism', 'limits', 'pipelineStage', 'polarity', 'stage', 'status'];
      const modified = fields.filter((field) => (item[field] || '') !== (prior[field] || ''));
      if (modified.length) {
        item.revisionHistory = [...(prior.revisionHistory || []), {
          at: now(), runId: runId || null, changedFields: modified,
          reason: reason || 'Reason not supplied',
          before: Object.fromEntries(modified.map((field) => [field, prior[field] || ''])),
          after: Object.fromEntries(modified.map((field) => [field, item[field] || ''])),
        }].slice(-12);
      }
    }
    return { item, change: creating ? 'created' : (item.stage !== previousStage ? 'stage:' + previousStage + '>' + item.stage : (raw.status && raw.status !== prior.status ? 'status:' + raw.status : 'updated')), reason };
  }

  function applyConstraint(prior, raw, input) {
    const creating = !prior;
    const item = prior ? { ...prior } : { kind: 'constraint', status: 'active', legacyIds: [], createdAt: now() };
    const previousOwner = item.owner;
    if (creating || raw.owner !== undefined) item.owner = oneOf(raw.owner, CONSTRAINT_OWNERS, 'constraint.owner');
    const reason = text(raw.reason, 1500, 'reason', false);
    if (item.owner === 'user' || previousOwner === 'user') {
      item.authorizationNote = authorization(input, 'A user-owned constraint');
    } else if (item.owner === 'environment') {
      if (creating || raw.statement !== undefined || raw.status !== undefined) {
        item.basis = text(raw.basis, 1500, 'constraint.basis (the measurement that established it)', true);
      }
    } else if (!creating && !reason) {
      throw new Error('Changing an agent-owned constraint requires a reason.');
    }
    if (creating || raw.statement !== undefined) item.statement = text(raw.statement, 1500, 'constraint.statement', true);
    if (raw.rationale !== undefined) item.rationale = text(raw.rationale, 1500, 'constraint.rationale', false);
    if (raw.check !== undefined) item.check = text(raw.check, 800, 'constraint.check', false);
    if (raw.legacyIds !== undefined) item.legacyIds = list(raw.legacyIds, 12, 60);
    const previousStatus = item.status;
    if (raw.status !== undefined) item.status = oneOf(raw.status, CONSTRAINT_STATUS, 'constraint.status');
    if (!creating && item.status !== previousStatus) { item.statusReason = reason || item.authorizationNote || item.basis || ''; item.statusChangedAt = now(); }
    return { item, change: creating ? 'created' : (item.status !== previousStatus ? 'status:' + item.status : 'updated'), reason };
  }

  async function upsertItems(input) {
    const id = requireBaseId(input?.baseId);
    const kind = oneOf(input.kind, ['hypothesis', 'constraint', 'source'], 'kind');
    if (!Array.isArray(input.items) || !input.items.length) throw new Error('items must be a non-empty array');
    if (input.items.length > 40) throw new Error('At most 40 items per call');
    const prefix = LEDGER_KINDS[kind] || 'K';
    const changed = [];
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      const runId = requireOpenRun(base, text(input.runId, 20, 'runId', false));
      const loaded = [];
      for (const rawItem of input.items) {
        const raw = plain(rawItem, 'item');
        const itemId = text(raw.id, 20, 'item.id', false);
        let prior = null;
        if (itemId) {
          prior = value(await tx.get(itemRef(id, itemId)));
          if (!prior || prior.kind !== kind) throw new Error(kind + ' not found: ' + itemId + '. Omit id to create; IDs are assigned by the base.');
        }
        loaded.push({ raw, prior });
      }
      const run = runId ? value(await tx.get(runRef(id, runId))) : null;
      loaded.forEach(({ raw, prior }) => {
        const result = LEDGER_KINDS[kind] ? applyLedgerItem(kind, prior, raw, runId, base) : applyConstraint(prior, raw, input);
        const item = result.item;
        if (!prior) {
          base.counters[prefix] = (base.counters[prefix] || 0) + 1;
          item.id = seqId(prefix, base.counters[prefix]);
          item.baseId = id;
        }
        item.updatedAt = now();
        put(tx, itemRef(id, item.id), item);
        pushEvent(tx, base, {
          type: kind + '_' + result.change.split(':')[0], itemId: item.id, runId, actor: input.actor,
          summary: (item.title || item.statement || '').slice(0, 200) + (result.reason ? ' — ' + result.reason : ''),
          detail: { change: result.change, stage: item.stage, status: item.status, owner: item.owner },
        });
        changed.push({ id: item.id, change: result.change, legacyIds: item.legacyIds || [] });
      });
      if (run) put(tx, runRef(id, runId), { ...run, movedItemIds: [...new Set([...(run.movedItemIds || []), ...changed.map((entry) => entry.id)])] });
      saveBase(tx, base);
    });
    return { baseId: id, kind, changed, count: changed.length };
  }

  async function startRun(input) {
    const id = requireBaseId(input?.baseId);
    const responseMode = oneOf(input?.responseMode, ['brief', 'compact'], 'responseMode', 'brief');
    let runId;
    let receipt;
    // Bounded read before the transaction: selecting a negative arm must not require
    // newer MCP clients or an agent remembering an extra field. A transaction then
    // verifies the selected item is still open before persisting the run.
    const automaticNegativeCandidates = (Array.isArray(input.targets) && input.targets.length
      && (!Array.isArray(input.negativeTargets) || input.negativeTargets.length === 0))
      ? (await loadItems(id)).filter(item => item.kind === 'hypothesis' && item.polarity === NEGATIVE && item.status === 'open') : [];
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      if (base.status !== 'active') throw new Error('Exploration Base is ' + base.status + '; runs start only on an active base.');
      if (!base.method) throw new Error('This base has no method yet. Set one with exploration_method_version_set first.');
      const openRun = base.openRunId ? value(await tx.get(runRef(id, base.openRunId))) : null;
      const targets = Array.isArray(input.targets) ? input.targets.slice(0, 12) : [];
      const cleanTargets = [];
      for (const rawTarget of targets) {
        const target = plain(rawTarget, 'target');
        const hypothesisId = text(target.hypothesisId, 20, 'target.hypothesisId', true);
        const hypothesis = value(await tx.get(itemRef(id, hypothesisId)));
        if (!hypothesis || hypothesis.kind !== 'hypothesis') throw new Error('Hypothesis not found: ' + hypothesisId);
        if (hypothesis.status !== 'open') throw new Error('Hypothesis ' + hypothesisId + ' is ' + hypothesis.status + '; reopen it with a reason before testing it again.');
        if (hypothesis.polarity === NEGATIVE) throw new Error('Success targets must be positive; place failure hypotheses in negativeTargets: ' + hypothesisId);
        cleanTargets.push({ hypothesisId, prediction: text(target.prediction, 800, 'target.prediction (what you expect to measure, stated before measuring)', true) });
      }
      const negativeInputs = Array.isArray(input.negativeTargets) ? [...input.negativeTargets] : [];
      const negativeHypotheses = new Map();
      let negativeTargetOrigin = negativeInputs.length ? 'explicit' : null;
      // Legacy client bridge: a precommitted negative hypothesis explicitly placed
      // among experimentDesign contrasts is tested as a negative arm of this run.
      // This does not silently enroll unrelated negative hypotheses.
      if (!negativeInputs.length && Array.isArray(input.experimentDesign?.contrastedHypothesisIds)) {
        for (const hid of list(input.experimentDesign.contrastedHypothesisIds, 6, 20)) {
          const prior = value(await tx.get(itemRef(id, hid)));
          if (prior?.kind === 'hypothesis' && prior.polarity === NEGATIVE) {
            negativeHypotheses.set(hid, prior);
            negativeInputs.push({ hypothesisId: hid, prediction: text(prior.statement, 800, 'negative hypothesis statement', true) });
            negativeTargetOrigin = 'legacy_contrast';
          }
        }
      }
      if (!negativeInputs.length && cleanTargets.length) {
        const chosen = selectAutomaticNegativeTarget(automaticNegativeCandidates, input.experimentDesign?.changedStage, base.runCount);
        if (chosen) {
          negativeInputs.push(chosen);
          negativeTargetOrigin = 'automatic';
        }
      }
      for (const rawNegative of negativeInputs) {
        const hid = text(rawNegative?.hypothesisId, 20, 'negativeTargets.hypothesisId', true);
        if (!negativeHypotheses.has(hid)) negativeHypotheses.set(hid, value(await tx.get(itemRef(id, hid))));
      }
      const negativeTargets = checkNegativeTargets(negativeInputs, negativeHypotheses);
      if (negativeTargets.length && !cleanTargets.length) throw new Error('negativeTargets must accompany a positive target: test both directions together.');
      if (base.openRunId) {
        const age = openRun ? Date.now() - Date.parse(openRun.startedAt) : Infinity;
        if (input.takeover !== true && age < OPEN_RUN_TTL_MS) throw new Error('Run ' + base.openRunId + ' is open (started ' + openRun.startedAt + '). Finish it, or pass takeover=true if it was abandoned.');
        if (openRun) put(tx, runRef(id, base.openRunId), { ...openRun, status: 'abandoned', finishedAt: now() });
        pushEvent(tx, base, { type: 'run_abandoned', runId: base.openRunId, summary: 'Taken over by a new run', actor: input.actor });
      }
      const probe = text(input.unknownTerritoryProbe, 800, 'unknownTerritoryProbe', false);
      if (!cleanTargets.length && !probe) throw new Error('Declare at least one target hypothesis with a prediction, or unknownTerritoryProbe describing what unexplored area this run observes.');
      let experimentDesign = null;
      if (input.experimentDesign !== undefined) {
        const d = plain(input.experimentDesign, 'experimentDesign');
        const contrasted = list(d.contrastedHypothesisIds, 6, 20);
        if (!contrasted.length) throw new Error('experimentDesign.contrastedHypothesisIds requires a competing hypothesis.');
        if (!cleanTargets.length) throw new Error('experimentDesign requires a declared target hypothesis.');
        for (const hid of contrasted) {
          if (cleanTargets.some((t) => t.hypothesisId === hid)) throw new Error('experimentDesign must contrast a distinct hypothesis: ' + hid);
          const other = value(await tx.get(itemRef(id, hid)));
          if (!other || other.kind !== 'hypothesis' || other.status !== 'open') throw new Error('Competing hypothesis not open: ' + hid);
        }
        experimentDesign = {
          contrastedHypothesisIds: contrasted,
          changedStage: oneOf(d.changedStage, PIPELINE_STAGES.filter((x) => x !== 'unknown'), 'experimentDesign.changedStage'),
          intervention: text(d.intervention, 900, 'experimentDesign.intervention', true),
          comparison: text(d.comparison, 900, 'experimentDesign.comparison', true),
          controls: text(d.controls, 900, 'experimentDesign.controls', true),
          expectedDifference: text(d.expectedDifference, 900, 'experimentDesign.expectedDifference', true),
          refutingObservation: text(d.refutingObservation, 900, 'experimentDesign.refutingObservation', true),
        };
      }
      let crossDojoEvidence = [];
      if (input.crossDojoEvidence !== undefined) {
        if (!experimentDesign) throw new Error('crossDojoEvidence requires a controlled experimentDesign');
        if (!Array.isArray(input.crossDojoEvidence) || !input.crossDojoEvidence.length || input.crossDojoEvidence.length > 3)
          throw new Error('crossDojoEvidence requires 1 to 3 concrete source-dojo comparisons');
        for (const raw of input.crossDojoEvidence) {
          const entry = plain(raw, 'crossDojoEvidence entry');
          const sourceBaseId = requireBaseId(entry.sourceBaseId);
          if (sourceBaseId === id) throw new Error('Cross-dojo source must differ from the receiver');
          const sourceBase = value(await tx.get(baseRef(sourceBaseId)));
          if (!sourceBase) throw new Error('Cross-dojo source base not found: ' + sourceBaseId);
          const positiveTrialId = text(entry.positiveTrialId, 20, 'positiveTrialId', true);
          const negativeTrialId = text(entry.negativeTrialId, 20, 'negativeTrialId', true);
          if (positiveTrialId === negativeTrialId) throw new Error('Cross-dojo contrast needs two distinct trials');
          const positive = value(await tx.get(trialRef(sourceBaseId, positiveTrialId)));
          const negative = value(await tx.get(trialRef(sourceBaseId, negativeTrialId)));
          if (!positive || positive.baseId !== sourceBaseId || positive.status !== 'rated' || positive.verdict !== 'pass')
            throw new Error('Cross-dojo positive must be a real user-rated pass: ' + sourceBaseId + '/' + positiveTrialId);
          if (!negative || negative.baseId !== sourceBaseId || negative.status !== 'rated'
            || !['fail', 'partial'].includes(negative.verdict))
            throw new Error('Cross-dojo negative must be a real user-rated fail/partial: ' + sourceBaseId + '/' + negativeTrialId);
          crossDojoEvidence.push({
            sourceBaseId, sourceMethodVersion: sourceBase.method?.version || null,
            positiveTrialId, positiveVerdict: positive.verdict,
            negativeTrialId, negativeVerdict: negative.verdict,
            hypothesizedMechanism: text(entry.hypothesizedMechanism, 850, 'hypothesizedMechanism', true),
            applicabilityConditions: text(entry.applicabilityConditions, 850, 'applicabilityConditions', true),
            falsification: text(entry.falsification, 850, 'falsification', true),
            receiverValidation: 'untested',
          });
        }
      }
      base.counters.R = (base.counters.R || 0) + 1;
      runId = seqId('R', base.counters.R);
      const run = {
        id: runId, baseId: id, status: 'open', startedAt: now(), actor: text(input.actor, 120, 'actor', false) || 'agent',
        objective: text(input.objective, 800, 'objective', true),
        methodVersion: base.method.version, outcomeRevision: base.outcome.revision,
        targets: cleanTargets, ...(negativeTargets.length ? { negativeTargets, negativeTargetOrigin } : {}), unknownTerritoryProbe: probe, ...(experimentDesign ? { experimentDesign } : {}),
        ...(crossDojoEvidence.length ? { crossDojoEvidence } : {}),
      };
      put(tx, runRef(id, runId), run);
      base.openRunId = runId;
      receipt = { runId, methodVersion: run.methodVersion, outcomeRevision: run.outcomeRevision,
        crossDojoEvidenceCount: crossDojoEvidence.length, negativeTargetCount: negativeTargets.length,
        negativeTargetOrigin: negativeTargetOrigin || null };
      pushEvent(tx, base, { type: 'run_started', runId, summary: run.objective, actor: input.actor, detail: { targets: cleanTargets, negativeTargets, methodVersion: run.methodVersion } });
      saveBase(tx, base);
    });
    if (responseMode === 'compact') return receipt;
    return { runId, brief: await get({ id }) };
  }

  async function finishRun(input) {
    const id = requireBaseId(input?.baseId);
    const runId = text(input?.runId, 20, 'runId', true);
    const responseMode = oneOf(input?.responseMode, ['brief', 'compact'], 'responseMode', 'brief');
    const finishData = unpackFailureAnalysis(input);
    let summary;
    const [trials, items] = await Promise.all([loadTrials(id), loadItems(id)]);
    const hypotheses = new Map(items.filter(item => item.kind === 'hypothesis').map(item => [item.id, item]));
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      requireOpenRun(base, runId);
      const run = value(await tx.get(runRef(id, runId)));
      if (!run || run.status !== 'open') throw new Error('Run is not open: ' + runId);
      const rawVerdicts = Array.isArray(input.verdicts) ? input.verdicts : [];
      const verdicts = run.targets.map((target) => {
        const raw = rawVerdicts.find((entry) => entry && entry.hypothesisId === target.hypothesisId);
        if (!raw) throw new Error('Missing verdict for declared hypothesis ' + target.hypothesisId);
        // The user's rating of a trial that tested this hypothesis is the measurement: it decides the verdict.
        const rated = trials.filter((t) => t.runId === runId && t.status === 'rated' && t.verdict !== 'withdrawn' && (t.hypothesisIds || []).includes(target.hypothesisId));
        if (raw.result === 'inconclusive' && rated.length) {
          throw new Error('Hypothesis ' + target.hypothesisId + ' was tested by rated trial(s) ' + rated.map((t) => t.id + ':' + t.verdict).join(', ') + ' in this run. Give supported or contradicted against the prediction, not inconclusive.');
        }
        return {
          hypothesisId: target.hypothesisId, prediction: target.prediction,
          result: oneOf(raw.result, VERDICTS, 'verdict.result'),
          observed: text(raw.observed, 1200, 'verdict.observed (what was actually measured)', true),
        };
      });
      const negativeVerdicts = (run.negativeTargets || []).map(target => {
        const raw = [...(input.negativeVerdicts || []), ...(input.verdicts || [])].find(v => v && v.hypothesisId === target.hypothesisId);
        if (!raw && run.negativeTargetOrigin !== 'automatic') throw new Error('Missing negativeVerdict for declared failure hypothesis ' + target.hypothesisId);
        if (!raw) return { hypothesisId: target.hypothesisId, prediction: target.prediction,
          result: 'inconclusive', observed: 'Automatically selected failure hypothesis; no separate negative verdict was supplied. A human rating, if any, is stored on the trial and does not prove this cause.',
          evidenceKind: 'automatic_unreviewed_unconfirmed' };
        return { hypothesisId: target.hypothesisId, prediction: target.prediction,
          result: oneOf(raw.result, VERDICTS, 'negativeVerdict.result'),
          observed: text(raw.observed, 1200, 'negativeVerdict.observed', true),
          evidenceKind: 'agent_interpretation_pending_human_validation' };
      });
      const screenedOut = checkScreenedOut(input.screenedOut, run.negativeTargets, hypotheses);
      const failureAnalysis = finishData.failureAnalysis
        ? cleanFailureAnalysis(finishData.failureAnalysis, ratedEntries(trials, base.feedbackLog))
        : null;
      const achievements = (Array.isArray(input.achievements) ? input.achievements.slice(0, 20) : []).map((rawAchievement) => {
        const raw = plain(rawAchievement, 'achievement');
        base.counters.A = (base.counters.A || 0) + 1;
        return {
          id: seqId('A', base.counters.A), runId, foundAt: now(), methodVersion: run.methodVersion,
          label: text(raw.label, 300, 'achievement.label', true),
          ref: text(raw.ref, 600, 'achievement.ref (ID in the canonical operator data)', false),
          evidence: text(raw.evidence, 2000, 'achievement.evidence (how each acceptance check was met)', true),
          hypothesisIds: list(raw.hypothesisIds, 10, 20),
          sourceIds: list(raw.sourceIds, 10, 20),
          status: base.outcome.confirmedBy === 'measurement' ? 'confirmed' : 'candidate',
        };
      });
      base.progress = base.progress || { achievements: [], confirmedCount: 0 };
      base.progress.achievements = [...(base.progress.achievements || []), ...achievements].slice(-200);
      base.progress.confirmedCount = base.progress.achievements.filter((a) => a.status === 'confirmed').length;
      const itemChanges = run.movedItemIds || [];
      // Finds a submarine brought back with this run's gear count as movement too; they are decided on the
      // submarine and mirrored here as achievements once the user confirms them.
      const yieldRefs = list(input.yieldRefs, 30, 600);
      const moved = itemChanges.length > 0 || achievements.length > 0 || yieldRefs.length > 0 || (run.trialIds || []).length > 0 || screenedOut.length > 0;
      if (screenedOut.length) {
        const prior = base.negativeScreening || { rejectedUnverified: 0, byHypothesis: {} };
        const byHypothesis = { ...(prior.byHypothesis || {}) };
        screenedOut.forEach(({ hypothesisId }) => { byHypothesis[hypothesisId] = (byHypothesis[hypothesisId] || 0) + 1; });
        base.negativeScreening = { rejectedUnverified: (prior.rejectedUnverified || 0) + screenedOut.length, byHypothesis };
      }
      base.stalledRuns = moved ? 0 : (base.stalledRuns || 0) + 1;
      base.runCount = (base.runCount || 0) + 1;
      base.openRunId = null;
      const finished = {
        ...run, status: 'finished', finishedAt: now(),
        summary: finishData.summary,
        verdicts, negativeVerdicts, screenedOut, achievementIds: achievements.map((a) => a.id), failureAnalysis,
        movedItemIds: [...new Set(itemChanges)], yieldRefs, moved,
        notMovedReason: moved ? '' : text(input.notMovedReason, 1000, 'notMovedReason (this run changed no fixed point; say why and what that implies)', true),
        costNote: text(input.costNote, 400, 'costNote', false),
        nextStep: text(input.nextStep, 800, 'nextStep', false),
      };
      put(tx, runRef(id, runId), finished);
      summary = {
        id: runId, finishedAt: finished.finishedAt, methodVersion: run.methodVersion, objective: run.objective,
        summary: finished.summary.slice(0, 400), moved, movedItemIds: finished.movedItemIds,
        verdicts: verdicts.map((v) => v.hypothesisId + ':' + v.result), negativeVerdicts: negativeVerdicts.map((v) => v.hypothesisId + ':' + v.result), screenedOutUnverifiedCount: screenedOut.length,
        achievementIds: finished.achievementIds, yieldCount: yieldRefs.length,
        failureAnalysisRecorded: Boolean(failureAnalysis),
        nextStep: finished.nextStep,
      };
      base.lastRuns = [summary, ...(base.lastRuns || [])].slice(0, 5);
      pushEvent(tx, base, { type: moved ? 'run_finished' : 'run_stalled', runId, summary: summary.summary, actor: input.actor, detail: { verdicts: summary.verdicts, achievementIds: summary.achievementIds } });
      saveBase(tx, base);
    });
    const loop = await refreshLoop(id);
    if (responseMode === 'compact') return { run: summary, loop };
    return { run: summary, brief: await get({ id }) };
  }

  // A user's own reaction in an app (e.g. 好き in Discover) is the confirmation itself: liking records a
  // confirmed achievement keyed by the item; withdrawing the like declines it again. No-op without the base.
  async function recordUserReaction(input) {
    const id = requireBaseId(input?.baseId);
    const ref = text(input.ref, 600, 'ref', true);
    const liked = input.liked === true;
    let changed = false;
    await db().runTransaction(async (tx) => {
      const base = value(await tx.get(baseRef(id)));
      if (!base || base.status === 'closed') return;
      base.counters = base.counters || {};
      base.progress = base.progress || { achievements: [], confirmedCount: 0 };
      const achievements = base.progress.achievements || [];
      const existing = achievements.find((a) => a.ref === ref);
      const at = now();
      if (liked) {
        if (existing && existing.status === 'confirmed') return;
        if (existing) {
          existing.status = 'confirmed'; existing.decidedAt = at;
        } else {
          base.counters.A = (base.counters.A || 0) + 1;
          achievements.push({
            id: seqId('A', base.counters.A), runId: text(input.runId, 20, 'runId', false) || null, foundAt: at, decidedAt: at, methodVersion: base.method?.version || null,
            skillVersion: Number.isInteger(input.version) ? input.version : null,
            label: text(input.label, 300, 'label', true), ref,
            evidence: text(input.evidence, 2000, 'evidence', false) || 'The user reacted in the app.',
            hypothesisIds: [], sourceIds: list(input.sourceIds, 10, 20), status: 'confirmed',
            decisionNote: text(input.note, 800, 'note', false),
          });
        }
      } else {
        if (!existing || existing.status !== 'confirmed') return;
        existing.status = 'declined'; existing.decidedAt = at;
      }
      const target = liked ? (existing || achievements[achievements.length - 1]) : existing;
      base.progress.achievements = achievements.slice(-200);
      base.progress.confirmedCount = base.progress.achievements.filter((a) => a.status === 'confirmed').length;
      pushEvent(tx, base, { type: 'achievement_' + target.status, itemId: target.id, summary: target.label, actor: input.actor || 'user' });
      saveBase(tx, base);
      changed = true;
    });
    return { baseId: id, changed };
  }

  // The user's evaluation of something a trained gear produced (a submarine's haul): the action, the comment and
  // the skill/pack version that produced it. Kept per ref (latest wins) so the 道場 can compare released versions
  // by what the user actually said, not by self-scores. No-op without the base.
  async function recordFeedback(input) {
    const id = requireBaseId(input?.baseId);
    const ref = text(input.ref, 600, 'ref', true);
    const decision = ['confirmed', 'candidate', 'declined'].includes(input.decision) ? input.decision : '';
    const comment = text(input.comment, 1000, 'comment', false);
    const actionLabel = text(input.actionLabel, 40, 'actionLabel', false);
    if (!decision && !comment && !actionLabel) return { baseId: id, changed: false };
    let changed = false;
    await db().runTransaction(async (tx) => {
      const base = value(await tx.get(baseRef(id)));
      if (!base || base.status === 'closed') return;
      const log = base.feedbackLog || [];
      const previous = log.find((f) => f.ref === ref) || {};
      const entry = {
        at: now(), ref, label: text(input.label, 300, 'label', false) || previous.label || ref,
        version: Number.isInteger(input.version) ? input.version : (previous.version ?? null),
        gear: text(input.gear, 120, 'gear', false) || previous.gear || '',
        decision: decision || previous.decision || 'candidate',
        actionLabel: actionLabel || previous.actionLabel || '',
        comment: comment || previous.comment || '',
        comments: [...(comment ? [{ at: now(), text: comment }] : []), ...(previous.comments || [])].slice(0, 5),
        submarineId: text(input.submarineId, 80, 'submarineId', false) || previous.submarineId || '',
        haulId: text(input.haulId, 20, 'haulId', false) || previous.haulId || '',
        sortieId: text(input.sortieId, 20, 'sortieId', false) || previous.sortieId || '',
        runId: text(input.runId, 20, 'runId', false) || previous.runId || '',
      };
      base.feedbackLog = [entry, ...log.filter((f) => f.ref !== ref)].slice(0, 300);
      saveBase(tx, base);
      changed = true;
    });
    if (changed) await refreshLoop(id).catch(() => null);
    return { baseId: id, changed };
  }

  // The Buzz Editorial Harness protects production drafts; the 道場 trial path was
  // unprotected. This focused preflight closes that gap for text-first standalone
  // buzz posts, without changing the gates of other exploration bases.
  // Existing MCP tool schemas may not yet expose editorialScreen. In that case
  // predictionNote accepts screen:v1:<compact JSON> with identical validation.
  const BUZZ_SCREEN_PREFIX = 'screen:v1:';
  // derived_consequence: the last beat follows directly from the material.
  // author_added: the author added an analogy, counterfactual, title or other device.
  const BUZZ_CLOSING_TYPES = ['derived_consequence', 'author_added'];
  function cleanBuzzScreen(raw, sourceItems, previousTrials) {
    const note = text(raw.predictionNote, 600, 'trial.predictionNote', false);
    let packet = raw.editorialScreen;
    if (packet && note.startsWith(BUZZ_SCREEN_PREFIX)) {
      throw new Error('Buzz 道場: supply editorialScreen or the screen:v1 predictionNote envelope, not both.');
    }
    if (!packet) {
      if (!note.startsWith(BUZZ_SCREEN_PREFIX)) {
        throw new Error('Buzz 道場: a pre-submission screening packet is required before showing a standalone post (editorialScreen or screen:v1 predictionNote).');
      }
      try { packet = JSON.parse(note.slice(BUZZ_SCREEN_PREFIX.length)); }
      catch (error) { throw new Error('Buzz 道場: invalid screen:v1 JSON: ' + error.message); }
    }
    const data = plain(packet, 'editorialScreen');
    if (data.format !== 'standalone') {
      throw new Error('Buzz 道場: native quote/repost practice is retired by the user. New trial format must be standalone.');
    }
    const rawBody = text(raw.body, 4000, 'trial.body', false);
    if (rawBody.length < 25) {
      throw new Error('Buzz 道場: selected standalone text must be included in trial.body (25+ characters).');
    }
    // predictedPass is an honest forecast, not a submission gate. The former 0.60 floor made every
    // forecast 0.60-0.61 (R-104), so predictions could not tell passes from fails. Submission is now
    // gated by the screen itself plus a pre-registered classification of how the post closes.
    const closingType = oneOf(data.closingType, BUZZ_CLOSING_TYPES, 'editorialScreen.closingType');
    const pool = Array.isArray(data.pool) ? data.pool : [];
    if (pool.length < 3 || pool.length > 12) {
      throw new Error('Buzz 道場: compare 3-12 materially different candidates, and record why most were rejected before submitting one.');
    }
    const knownSources = new Map(sourceItems.filter((item) => item.kind === 'source' && item.status === 'open').map((item) => [item.id, item]));
    const selected = [];
    const rejected = [];
    const sourceIds = new Set();
    const titles = new Set();
    const reviewedPool = pool.map((entry) => {
      const row = plain(entry, 'editorialScreen.pool entry');
      const title = text(row.title, 100, 'candidate.title', true);
      const sourceId = text(row.sourceId, 20, 'candidate.sourceId', true);
      const decision = oneOf(row.decision, ['selected', 'rejected'], 'candidate.decision');
      const reason = text(row.reason, 350, 'candidate.reason', true);
      if (reason.length < 10) throw new Error('Buzz 道場: each candidate needs a concrete rejection/selection reason (10+ characters).');
      if (titles.has(title)) throw new Error('Buzz 道場: duplicate candidate in comparison pool: ' + title);
      titles.add(title);
      const source = knownSources.get(sourceId);
      if (!source || source.stage === 'conjecture') {
        throw new Error('Buzz 道場: source is not an observed active source in this base: ' + sourceId);
      }
      sourceIds.add(sourceId);
      (decision === 'selected' ? selected : rejected).push(title);
      return { title, sourceId, decision, reason };
    });
    if (selected.length !== 1 || rejected.length < 2 || sourceIds.size < 2) {
      throw new Error('Buzz 道場: exactly one selected candidate, at least two rejected candidates and at least two observed source lanes are required.');
    }
    const selectedSource = reviewedPool.find((item) => item.decision === 'selected').sourceId;
    if (!list(raw.sourceIds, 10, 20).includes(selectedSource)) {
      throw new Error('Buzz 道場: selected candidate source must appear in trial.sourceIds.');
    }
    const positiveCaseId = text(data.positiveCaseId, 20, 'editorialScreen.positiveCaseId', true);
    const negativeCaseIds = list(data.negativeCaseIds, 5, 20);
    const actualPass = previousTrials.find((t) => t.id === positiveCaseId && t.status === 'rated' && t.verdict === 'pass' && t.body);
    if (!actualPass) {
      throw new Error('Buzz 道場: positiveCaseId must cite a real user-accepted previous text, not an AI self-PASS.');
    }
    const actualNegatives = negativeCaseIds.filter((id) =>
      previousTrials.some((t) => t.id === id && t.status === 'rated' && t.verdict === 'fail' && t.body));
    if (actualNegatives.length < 2) {
      throw new Error('Buzz 道場: negativeCaseIds must cite two real rejected texts for contrast.');
    }
    const readerQuote = text(data.readerQuote, 120, 'editorialScreen.readerQuote', true);
    if (readerQuote.length < 8 || !rawBody.includes(readerQuote)) {
      throw new Error('Buzz 道場: readerQuote must point to an actual 8+ character span in the submitted text.');
    }
    const distinctValue = text(data.distinctValue, 300, 'editorialScreen.distinctValue', true);
    const strongestObjection = text(data.strongestObjection, 300, 'editorialScreen.strongestObjection', true);
    if (distinctValue.length < 12 || strongestObjection.length < 12) {
      throw new Error('Buzz 道場: spell out an original reader benefit and a concrete hostile reading (12+ characters each); self-ratings alone are not evidence.');
    }
    return {
      format: 'standalone',
      pool: reviewedPool,
      positiveCaseId,
      negativeCaseIds,
      readerQuote,
      distinctValue,
      strongestObjection,
      closingType,
      candidateCount: pool.length,
      rejectedCount: rejected.length,
      sourceLaneCount: sourceIds.size,
      reviewer: 'agent_screen_only_unverified',
    };
  }

  // Register samples before the user sees them. Each one names the hypotheses it tests and the predicted chance
  // of passing, so that the user's one-word rating settles something. backfill=true imports past samples with
  // their version and rating as they were.
  async function recordTrials(input) {
    const id = requireBaseId(input?.baseId);
    if (!Array.isArray(input.trials) || !input.trials.length) throw new Error('trials must be a non-empty array');
    if (input.trials.length > 30) throw new Error('At most 30 trials per call');
    const backfill = input.backfill === true;
    const [existing, items] = await Promise.all([loadTrials(id), loadItems(id)]);
    const hypotheses = new Map(items.filter((item) => item.kind === 'hypothesis').map((item) => [item.id, item]));
    const sourceItems = items.filter((item) => item.kind === 'source');
    const created = [];
    const skipped = [];
    const imaged = [];
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      const runId = requireOpenRun(base, text(input.runId, 20, 'runId', false));
      const run = runId ? value(await tx.get(runRef(id, runId))) : null;
      const fresh = input.trials.map((raw) => plain(raw, 'trial')).filter((raw) => {
        const ref = text(raw.ref, 600, 'trial.ref', false);
        const duplicate = ref && existing.find((t) => t.ref === ref);
        if (!duplicate) return true;
        // Keep the original trial and its prediction immutable while allowing
        // an unfinished visual artifact to be completed with a stable HTTPS URL.
        // Older connected MCP clients cannot send imageUrl/mediaUrl until reconnect.
        // For an existing awaiting ref only, accept a validated artifact URL in
        // predictionNote without altering the original prediction or case identity.
        const legacy = String(raw.predictionNote || '').trim();
        const picture = imageUrl(raw.imageUrl || (legacy.startsWith('artifact:image:')
          ? legacy.slice('artifact:image:'.length) : ''));
        const media = publicMediaUrl(raw.mediaUrl || (legacy.startsWith('artifact:media:')
          ? legacy.slice('artifact:media:'.length) : ''));
        if (duplicate.status === 'awaiting'
          && ((picture && duplicate.imageUrl !== picture) || (media && duplicate.mediaUrl !== media))) {
          put(tx, trialRef(id, duplicate.id), { ...duplicate,
            imageUrl: picture || duplicate.imageUrl || '',
            mediaUrl: media || duplicate.mediaUrl || '', updatedAt: now() });
          imaged.push({ ref, id: duplicate.id, imageUrl: picture || duplicate.imageUrl || '',
            ...((media || duplicate.mediaUrl) ? { mediaUrl: media || duplicate.mediaUrl } : {}) });
        } else {
          skipped.push({ ref, id: duplicate.id });
        }
        return false;
      });
      if (!backfill && fresh.length) {
        const loop = loopView({ trials: existing, feedbackLog: base.feedbackLog, base });
        if (loop.awaiting.length + fresh.length > LIMITS.maxAwaiting) {
          throw new Error(loop.awaiting.length + ' trial(s) are still waiting for the user (' + loop.awaiting.map((t) => t.id).join(', ') + '). At most ' + LIMITS.maxAwaiting + ' may wait: get them rated, or withdraw stale ones with exploration_trial_rate verdict=withdrawn, before showing more.');
        }
        if (loop.gates.researchDueBeforeNextTrial) {
          throw new Error('The last ' + loop.failStreak + ' rated samples did not pass. Finish the run with a verdict per hypothesis, then finish a run that re-derives the hypotheses from sourcing and selection (not wording) before recording new trials.');
        }
      }
      fresh.forEach((raw) => {
        const hypothesisIds = list(raw.hypothesisIds, 10, 20);
        hypothesisIds.forEach((hid) => {
          const hypothesis = hypotheses.get(hid);
          if (!hypothesis) throw new Error('Hypothesis not found: ' + hid);
          if (!backfill && hypothesis.status !== 'open') throw new Error('Hypothesis ' + hid + ' is ' + hypothesis.status + '; a trial tests open hypotheses.');
          if (!backfill && hypothesis.polarity === NEGATIVE) throw new Error('trial.hypothesisIds is for positive targets; evaluate negative hypotheses through negativeReview: ' + hid);
        });
        if (!backfill && !hypothesisIds.length) throw new Error('trial.hypothesisIds is required: name the hypothesis this sample tests (register it first with exploration_item_upsert). A sample tied to no hypothesis settles nothing when it is rated.');
        const predicted = raw.predictedPass === undefined || raw.predictedPass === null ? null : Number(raw.predictedPass);
        if (predicted !== null && !(predicted >= 0 && predicted <= 1)) throw new Error('trial.predictedPass must be between 0 and 1');
        if (!backfill && predicted === null) throw new Error('trial.predictedPass is required: the chance (0-1) that the user passes this sample, stated before they see it.');
        const editorialScreen = (!backfill && id === 'viral-post-method-discovery')
          ? cleanBuzzScreen(raw, sourceItems, existing) : null;
        // Every trial-based dojo with real positive AND negative cases must show
        // how the successful mechanism transfers, and why the failed case differs.
        // Buzz's old screen:v1 envelope remains compatible, but is flagged as a
        // limited comparison rather than an independently verified review.
        const learningAudit = (!backfill && base.outcome?.confirmedBy !== 'measurement')
          ? validateLearningAudit(raw, {
              trials: existing, feedbackLog: base.feedbackLog || [],
              body: text(raw.body, 4000, 'trial.body', false) || text(raw.label, 300, 'trial.label', false),
              buzzScreen: editorialScreen,
            }) : null;
        const legacyReview = !backfill && !raw.negativeReview
          ? legacyNegativeReviewFromAudit(run?.negativeTargets || [], learningAudit, editorialScreen) : null;
        const negativeReview = backfill ? null : checkNegativeReview(raw.negativeReview || legacyReview, {
          negativeTargets: run?.negativeTargets || [], hypotheses, trials: existing,
          body: text(raw.body, 4000, 'trial.body', false) || text(raw.label, 300, 'trial.label', false),
        });
        if (negativeReview && legacyReview) negativeReview.status = 'preflight_legacy_derived_unverified';
        base.counters.T = (base.counters.T || 0) + 1;
        const at = now();
        const trial = {
          id: seqId('T', base.counters.T), baseId: id, kind: 'trial', runId: runId || (backfill ? text(raw.runId, 20, 'trial.runId', false) || null : null),
          methodVersion: (backfill && text(raw.methodVersion, 60, 'trial.methodVersion', false)) || base.method?.version || null,
          version: backfill && Number.isInteger(raw.version) ? raw.version : (backfill && raw.version === null ? null : (base.method?.bodyRef?.versionNumber ?? null)),
          label: text(raw.label, 300, 'trial.label', true), body: text(raw.body, 4000, 'trial.body', false),
          ref: text(raw.ref, 600, 'trial.ref', false), imageUrl: imageUrl(raw.imageUrl),
          mediaUrl: publicMediaUrl(raw.mediaUrl), hypothesisIds, sourceIds: list(raw.sourceIds, 10, 20),
          predictedPass: predicted, predictionNote: text(raw.predictionNote, 600, 'trial.predictionNote', false),
          ...(editorialScreen ? { format: editorialScreen.format, editorialScreen } : {}),
          ...(learningAudit ? { learningAudit } : {}),
          ...(negativeReview ? { negativeReview } : {}),
          status: 'awaiting', verdict: null, createdAt: (backfill && text(raw.shownAt, 40, 'trial.shownAt', false)) || at,
          backfilled: backfill || undefined, actor: text(input.actor, 120, 'actor', false) || 'agent',
        };
        if (raw.rating !== undefined) {
          if (!backfill) throw new Error('trial.rating is only for backfill. Record the trial, show it, then exploration_trial_rate with what the user said.');
          Object.assign(trial, cleanRating(plain(raw.rating, 'trial.rating'), true));
        }
        put(tx, trialRef(id, trial.id), trial);
        created.push({ id: trial.id, label: trial.label, version: trial.version, status: trial.status, verdict: trial.verdict });
      });
      if (imaged.length) pushEvent(tx, base, { type: 'trial_images_added', runId, actor: input.actor, summary: imaged.length + ' 件の見本に画像を追加: ' + imaged.map((t) => t.id).join(', '), detail: { trialIds: imaged.map((t) => t.id) } });
      if (!created.length) { if (imaged.length) saveBase(tx, base); return; }
      if (run) put(tx, runRef(id, runId), { ...run, trialIds: [...new Set([...(run.trialIds || []), ...created.map((t) => t.id)])] });
      pushEvent(tx, base, { type: backfill ? 'trials_backfilled' : 'trials_recorded', runId, actor: input.actor, summary: created.length + ' 件: ' + created.map((t) => t.label).join(' / ').slice(0, 600), detail: { trialIds: created.map((t) => t.id) } });
      saveBase(tx, base);
    });
    const loop = created.length ? await refreshLoop(id) : null;
    return { baseId: id, created, skipped, imaged, loop: loop ? loopSummary(loop) : undefined };
  }

  // The user's words are the rating. A verdict without them would be the agent grading itself.
  function cleanRating(raw, backfill) {
    const verdict = oneOf(raw.verdict, TRIAL_VERDICTS, 'rating.verdict');
    const userWords = text(raw.userWords, 1500, 'rating.userWords', false);
    if (verdict !== 'withdrawn' && !userWords) throw new Error('rating.userWords is required: quote what the user said about this sample. Self-scores and silence are not ratings.');
    const reason = text(raw.reason, 600, 'rating.reason', false);
    if (verdict === 'withdrawn' && !reason) throw new Error('rating.reason is required to withdraw a trial (why it will not be rated).');
    return {
      status: 'rated', verdict, userWords, withdrawReason: verdict === 'withdrawn' ? reason : undefined,
      failStage: raw.failStage ? oneOf(raw.failStage, FAIL_STAGES, 'rating.failStage') : '',
      failStageNote: text(raw.failStageNote, 600, 'rating.failStageNote', false),
      ratedAt: (backfill && text(raw.ratedAt, 40, 'rating.ratedAt', false)) || now(),
    };
  }

  async function rateTrials(input) {
    const id = requireBaseId(input?.baseId);
    if (!Array.isArray(input.ratings) || !input.ratings.length) throw new Error('ratings must be a non-empty array');
    if (input.ratings.length > 30) throw new Error('At most 30 ratings per call');
    const rated = [];
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      // Firestore transactions read first: load every trial and every hypothesis they touch, then write.
      const loaded = [];
      for (const rawRating of input.ratings) {
        const raw = plain(rawRating, 'rating');
        const trialId = text(raw.id, 20, 'rating.id (T-nnn)', true);
        const trial = value(await tx.get(trialRef(id, trialId)));
        if (!trial) throw new Error('Trial not found: ' + trialId);
        const rating = cleanRating(raw, false);
        const artifact = trialArtifactStatus(trial);
        if (!artifact.ready && rating.verdict !== 'withdrawn')
          throw new Error('Trial ' + trialId + ' is not reviewable: ' + artifact.reason);
        loaded.push({ trial, rating });
      }
      const touched = new Map();
      for (const { trial } of loaded) {
        for (const hid of trial.hypothesisIds || []) {
          if (!touched.has(hid)) touched.set(hid, value(await tx.get(itemRef(id, hid))));
        }
      }
      loaded.forEach(({ trial, rating }) => {
        const previous = trial.status === 'rated' ? { verdict: trial.verdict, userWords: trial.userWords, ratedAt: trial.ratedAt } : null;
        const next = { ...trial, ...rating, ratingHistory: previous ? [previous, ...(trial.ratingHistory || [])].slice(0, 5) : trial.ratingHistory };
        put(tx, trialRef(id, trial.id), next);
        if (rating.verdict !== 'withdrawn') {
          (trial.hypothesisIds || []).forEach((hid) => {
            const item = touched.get(hid);
            if (!item) return;
            const line = trial.id + ' ' + ({ pass: '合格', partial: '惜しい', fail: 'ボツ' })[rating.verdict] + '：' + trial.label + ' — 本人「' + rating.userWords.slice(0, 300) + '」';
            if (rating.verdict === 'pass') {
              item.evidence = [...(item.evidence || []), { type: 'candidate', ref: line.slice(0, 600), source: trial.ref || '', date: rating.ratedAt.slice(0, 10), runId: trial.runId || null }].slice(-60);
              if (item.stage === 'conjecture') item.stage = 'observed';
            } else {
              item.counterexamples = [...new Set([...(item.counterexamples || []), line.slice(0, 800)])].slice(-40);
            }
            item.updatedAt = now();
          });
        }
        rated.push({ id: trial.id, label: trial.label, verdict: rating.verdict, version: trial.version, hypothesisIds: trial.hypothesisIds || [] });
      });
      touched.forEach((item, hid) => { if (item) put(tx, itemRef(id, hid), item); });
      pushEvent(tx, base, { type: 'trials_rated', actor: input.actor, summary: rated.map((t) => t.id + ':' + t.verdict).join(', '), detail: { rated } });
      saveBase(tx, base);
    });
    const loop = await refreshLoop(id);
    return { baseId: id, rated, loop };
  }

  // Samples waiting for the user across every 道場, oldest first, so they can be rated in one place.
  async function awaitingTrials(input) {
    const max = Math.min(Math.max(Number(input?.limit) || 60, 1), 200);
    const [snap, bases] = await Promise.all([
      db().collection(COLLECTIONS.trials).where('status', '==', 'awaiting').limit(500).get(),
      db().collection(COLLECTIONS.bases).limit(200).get(),
    ]);
    const titles = new Map(bases.docs.map((doc) => doc.data()).filter((b) => b.status !== 'closed').map((b) => [b.id, b.title]));
    const items = snap.docs.map((doc) => doc.data()).filter((t) => titles.has(t.baseId))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .slice(0, max)
      .map((t) => ({ baseId: t.baseId, baseTitle: titles.get(t.baseId), id: t.id,
        label: t.label, body: t.body || '', ref: t.ref || '', imageUrl: t.imageUrl || '',
        mediaUrl: t.mediaUrl || '', reviewStatus: trialArtifactStatus(t).status,
        reviewReason: trialArtifactStatus(t).reason,
        createdAt: t.createdAt, version: t.version ?? null }));
    return { items, count: items.length };
  }

  async function remove(input = {}) {
    if (input.confirm !== true) throw new Error('Explicit confirmation required');
    const id = requireBaseId(input?.id);
    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('A valid expectedRevision is required');
    const database = db();
    const ref = database.collection(COLLECTIONS.bases).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Exploration Base not found: ' + id);
    const base = snap.data();
    if ((Number(base.revision) || 0) !== expectedRevision) throw new Error('Exploration Base revision conflict; reload before deleting');
    if (base.status !== 'closed') throw new Error('Only closed Exploration Bases can be permanently deleted');
    if (base.openRunId) throw new Error('Cannot delete an Exploration Base with an open run: ' + base.openRunId);
    const [items, runs, events, trialDocs] = await Promise.all([
      database.collection(COLLECTIONS.items).where('baseId', '==', id).limit(1001).get(),
      database.collection(COLLECTIONS.runs).where('baseId', '==', id).limit(501).get(),
      database.collection(COLLECTIONS.events).where('baseId', '==', id).limit(2001).get(),
      database.collection(COLLECTIONS.trials).where('baseId', '==', id).limit(3000).get(),
    ]);
    if (items.docs.length > 1000 || runs.docs.length > 500 || events.docs.length > 2000) {
      throw new Error('This Exploration Base has too much history for a single cleanup operation; no records were deleted');
    }
    if (runs.docs.some(doc => doc.data().status === 'open')) {
      throw new Error('Cannot delete an Exploration Base while a run is still open');
    }
    // Closed bases are immutable. Delete their owned ledger/run/event records, then the base itself.
    for (const group of [items.docs, runs.docs, events.docs, trialDocs.docs]) {
      for (let i = 0; i < group.length; i += 25) {
        await Promise.all(group.slice(i, i + 25).map(doc => doc.ref.delete()));
      }
    }
    await ref.delete();
    return {
      id, title: base.title, deleted: true,
      deletedItems: items.docs.length, deletedRuns: runs.docs.length, deletedEvents: events.docs.length,
    };
  }

  // Which 道場 train this skill or pack, and which version each one releases for execution. Used to tell
  // whoever edits the skill/pack directly that execution stays on the released version until the 道場 releases more.
  async function trainersOf(input) {
    const kind = oneOf(input?.kind, [...TARGET_KINDS], 'kind');
    const targetId = text(input?.id, 90, 'id', true);
    const snap = await db().collection(COLLECTIONS.bases).limit(200).get();
    return snap.docs.map((doc) => doc.data())
      .filter((base) => base.status !== 'closed' && base.method?.bodyRef?.kind === kind && base.method.bodyRef.location === targetId)
      .map((base) => ({ baseId: base.id, title: base.title, releasedVersion: base.method.bodyRef.versionNumber || null }));
  }

  // Compact summary used by the Agent Intelligence bundle resolver.
  async function brief(input) { return get({ id: input?.id, view: 'brief' }); }

  return { create, list: listBases, get, remove, brief, setOutcome, setMethodVersion, upsertItems, startRun, finishRun, recordUserReaction, recordFeedback, recordTrials, rateTrials, awaitingTrials, refreshLoop, trainersOf };
}

const store = createStore();
module.exports = { ...store, createStore, defaultResolveTarget, cleanOutcome, COLLECTIONS, STAGES, PROTOCOL };
