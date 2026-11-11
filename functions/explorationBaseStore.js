'use strict';

// Exploration Base: the fixed points an agent carries while exploring unknown territory.
// One base per exploration. Intelligence Packs hold slow-moving cognition; the base holds
// what moves during the exploration: outcome contract, method pointer/version, hypothesis
// ledger, constraints and the run log.

const { getDocumentDb } = require('./documentDb');

const DEFAULT_DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTIONS = Object.freeze({
  bases: 'explorationBases',
  items: 'explorationBaseItems',
  runs: 'explorationBaseRuns',
  events: 'explorationBaseEvents',
});
const ID_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
const STAGES = ['conjecture', 'observed', 'reproduced', 'yielded_candidate', 'yielded_outcome'];
const WIN_STAGES = new Set(['yielded_candidate', 'yielded_outcome']);
const HYPOTHESIS_STATUS = ['open', 'rejected', 'retired'];
const CONSTRAINT_OWNERS = ['user', 'environment', 'agent'];
const CONSTRAINT_STATUS = ['active', 'relaxed', 'retired'];
const EVIDENCE_TYPES = ['observation', 'candidate', 'outcome'];
const VERDICTS = ['supported', 'contradicted', 'inconclusive'];
const OPEN_RUN_TTL_MS = 12 * 60 * 60 * 1000;
const STALL_WARNING_AT = 3;
const PROTOCOL = [
  'Read this base before exploring; do not rely on memory of an earlier version.',
  'exploration_run_start: declare which hypotheses this run tests and the predicted result before measuring.',
  'During the run, write every changed fixed point with the runId (exploration_item_upsert).',
  'exploration_run_finish: give a verdict per declared hypothesis. A run that moved no fixed point is recorded as stalled.',
  'Never change the method version during an open run. Bump it only between runs, with the motivating runs and a benchmark result.',
  'The outcome contract and user-owned constraints belong to the user: propose changes, never apply them without authorization.',
  'IDs are never reused. Rejected hypotheses stay in the ledger so the same inference is not repeated.',
];

function database() { return getDocumentDb(DEFAULT_DATABASE_ID); }
function now() { return new Date().toISOString(); }
function text(value, max, label, required) {
  const result = value === undefined || value === null ? '' : String(value).trim().slice(0, max);
  if (required && !result) throw new Error(label + ' is required');
  return result;
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

function cleanOutcome(raw) {
  const input = plain(raw, 'outcome');
  const target = input.target ? plain(input.target, 'outcome.target') : {};
  const min = Number(target.min);
  if (!Number.isInteger(min) || min < 1) throw new Error('outcome.target.min must be a positive integer');
  const max = target.max === undefined || target.max === null ? null : Number(target.max);
  if (max !== null && (!Number.isInteger(max) || max < min)) throw new Error('outcome.target.max must be an integer >= min');
  const budget = input.budget ? plain(input.budget, 'outcome.budget') : {};
  const maxRuns = budget.maxRuns === undefined || budget.maxRuns === null ? null : Number(budget.maxRuns);
  if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 1)) throw new Error('outcome.budget.maxRuns must be a positive integer');
  return {
    statement: text(input.statement, 1200, 'outcome.statement', true),
    unit: text(input.unit, 300, 'outcome.unit', true),
    target: { min, max },
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
function cleanMethod(raw, fallbackLocation) {
  const input = plain(raw, 'method');
  const ref = input.bodyRef ? plain(input.bodyRef, 'method.bodyRef') : {};
  const body = text(input.body, 20000, 'method.body', false);
  const bodyRef = {
    kind: oneOf(ref.kind, ['repo', 'inline', 'document', 'chat_skill', 'hq_method'], 'method.bodyRef.kind', body ? 'inline' : undefined),
    location: text(ref.location, 500, 'method.bodyRef.location', false) || fallbackLocation || '',
    path: text(ref.path, 500, 'method.bodyRef.path', false),
    commit: text(ref.commit, 80, 'method.bodyRef.commit', false),
  };
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
    id: item.id, title: item.title, stage: item.stage, statement: item.statement,
    limits: item.limits || '', evidenceCount: (item.evidence || []).length,
    counterexampleCount: (item.counterexamples || []).length, legacyIds: item.legacyIds || [],
  };
}

function createStore(options) {
  const getDb = (options && options.getDb) || database;
  const db = () => getDb();
  const baseRef = (id) => db().collection(COLLECTIONS.bases).doc(id);
  const itemRef = (baseId, id) => db().collection(COLLECTIONS.items).doc(docId(baseId, id));
  const runRef = (baseId, id) => db().collection(COLLECTIONS.runs).doc(docId(baseId, id));
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
        id: base.id, title: base.title, summary: base.summary, status: base.status,
        projectIds: base.projectIds || [], packRefs: base.packRefs || [],
        outcome: base.outcome ? { statement: base.outcome.statement, target: base.outcome.target, deadline: base.outcome.deadline } : null,
        confirmedCount: base.progress?.confirmedCount || 0,
        methodVersion: base.method?.version || null,
        runCount: base.runCount || 0, stalledRuns: base.stalledRuns || 0, openRunId: base.openRunId || null,
        updatedAt: base.updatedAt,
      }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return { items, count: items.length, collection: COLLECTIONS.bases };
  }

  async function loadItems(baseId) {
    const snap = await db().collection(COLLECTIONS.items).where('baseId', '==', baseId).limit(1000).get();
    return snap.docs.map((doc) => doc.data()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  async function get(input) {
    const id = requireBaseId(input?.id);
    const view = oneOf(input?.view, ['brief', 'full'], 'view', 'brief');
    const base = value(await baseRef(id).get());
    if (!base) throw new Error('Exploration Base not found: ' + id);
    const items = await loadItems(id);
    const hypotheses = items.filter((item) => item.kind === 'hypothesis');
    const constraints = items.filter((item) => item.kind === 'constraint');
    const open = hypotheses.filter((item) => item.status === 'open');
    const target = base.outcome?.target || {};
    const confirmed = base.progress?.confirmedCount || 0;
    const warnings = [];
    if ((base.stalledRuns || 0) >= STALL_WARNING_AT) {
      warnings.push(base.stalledRuns + ' consecutive runs moved no fixed point. Stop measuring and re-examine: is the constraint set satisfiable, is the method measuring the outcome, is the outcome still the right one? Report which constraint binds.');
    }
    if (base.outcome?.budget?.maxRuns && (base.runCount || 0) >= base.outcome.budget.maxRuns && confirmed < (target.min || 1)) {
      warnings.push('Run budget (' + base.outcome.budget.maxRuns + ') is used up without reaching the outcome. Report to the user before running again.');
    }
    if (base.openRunId) warnings.push('Run ' + base.openRunId + ' is still open. Finish it, or take it over if abandoned.');
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
        reached: confirmed >= (target.min || 1),
        awaitingConfirmation: (base.progress?.achievements || []).filter((a) => a.status === 'candidate'),
        confirmed: (base.progress?.achievements || []).filter((a) => a.status === 'confirmed'),
      },
      method: base.method ? {
        title: base.method.title, version: base.method.version, summary: base.method.summary,
        bodyRef: base.method.bodyRef, benchmarkRef: base.method.benchmarkRef || '', setAt: base.method.setAt,
        ...(base.method.bodyRef?.kind === 'inline' || view === 'full' ? { body: base.method.body || '' } : {}),
        recentChanges: (base.methodHistory || []).slice(-3),
      } : null,
      constraints: Object.fromEntries(CONSTRAINT_OWNERS.map((owner) => [owner, constraints
        .filter((item) => item.owner === owner && item.status === 'active')
        .map((item) => ({ id: item.id, statement: item.statement, check: item.check || '', legacyIds: item.legacyIds || [] }))])),
      hypotheses: {
        winPatterns: open.filter((item) => WIN_STAGES.has(item.stage)).map(hypothesisBrief),
        reproduced: open.filter((item) => item.stage === 'reproduced').map(hypothesisBrief),
        observed: open.filter((item) => item.stage === 'observed').map(hypothesisBrief),
        conjectures: open.filter((item) => item.stage === 'conjecture').map(hypothesisBrief),
        rejected: hypotheses.filter((item) => item.status === 'rejected')
          .map((item) => ({ id: item.id, title: item.title, reason: item.statusReason || '', legacyIds: item.legacyIds || [] })),
        // Retired: the phenomenon may be real but it does not lead to the outcome. Listed so it is not rediscovered.
        retired: hypotheses.filter((item) => item.status === 'retired')
          .map((item) => ({ id: item.id, title: item.title, stage: item.stage, reason: item.statusReason || '', legacyIds: item.legacyIds || [] })),
      },
      position: {
        runCount: base.runCount || 0, stalledRuns: base.stalledRuns || 0,
        openRunId: base.openRunId || null, lastRuns: base.lastRuns || [],
      },
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
        hypotheses, constraints,
        relaxedOrRetiredConstraints: constraints.filter((item) => item.status !== 'active').map((item) => item.id),
        methodHistory: base.methodHistory || [],
        proposals: base.proposals || [],
        runs: runs.docs.map((doc) => doc.data()).sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 50),
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
    if (!hasOutcome && !decisions.length && !resolve.length && !input.status) throw new Error('Nothing to change');
    const authorized = input.userAuthorized === true;
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      if (!authorized) {
        if (!hasOutcome) authorization(input, 'Confirming achievements, resolving proposals or changing status');
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
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      if (base.openRunId) throw new Error('Run ' + base.openRunId + ' is open. The method version cannot change during a run; finish the run first.');
      const method = cleanMethod(input.method, base.method?.bodyRef?.location);
      if ((base.methodHistory || []).some((entry) => entry.version === method.version)) {
        throw new Error('Method version label already used: ' + method.version + '. Version labels are never reused.');
      }
      const motivating = list(input.motivatingRunIds, 20, 20);
      if (base.method) {
        if (!motivating.length) throw new Error('motivatingRunIds is required: name the finished runs whose results justify this version.');
        for (const runId of motivating) {
          const run = value(await tx.get(runRef(id, runId)));
          if (!run || run.status !== 'finished') throw new Error('Motivating run not found or not finished: ' + runId);
        }
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
      base.methodHistory = [...(base.methodHistory || []), { version: method.version, summary: method.summary, setAt: at, motivatingRunIds: motivating, benchmark }].slice(-100);
      pushEvent(tx, base, { type: 'method_version_set', summary: method.version + ': ' + method.summary, actor: input.actor, detail: { motivatingRunIds: motivating, benchmark, bodyRef: method.bodyRef } });
      saveBase(tx, base);
    });
    return get({ id });
  }

  function applyHypothesis(prior, raw, runId, base) {
    const creating = !prior;
    const item = prior ? { ...prior } : {
      kind: 'hypothesis', stage: 'conjecture', status: 'open', evidence: [], counterexamples: [], legacyIds: [], createdAt: now(),
    };
    if (creating || raw.title !== undefined) item.title = text(raw.title, 160, 'hypothesis.title', true);
    if (creating || raw.statement !== undefined) item.statement = text(raw.statement, 1500, 'hypothesis.statement', true);
    if (creating || raw.mechanism !== undefined) item.mechanism = text(raw.mechanism, 2000, 'hypothesis.mechanism (why it would hold)', true);
    if (raw.limits !== undefined) item.limits = text(raw.limits, 1500, 'hypothesis.limits', false);
    if (raw.legacyIds !== undefined) item.legacyIds = list(raw.legacyIds, 12, 60);
    const added = cleanEvidence(raw.addEvidence, runId);
    item.evidence = [...(item.evidence || []), ...added].slice(-60);
    item.counterexamples = [...new Set([...(item.counterexamples || []), ...list(raw.addCounterexamples, 20, 800)])].slice(-40);
    const reason = text(raw.reason, 1500, 'reason', false);
    const previousStage = item.stage;
    if (raw.stage !== undefined) item.stage = oneOf(raw.stage, STAGES, 'hypothesis.stage');
    const rank = STAGES.indexOf(item.stage);
    const previousRank = STAGES.indexOf(previousStage);
    const count = (type) => item.evidence.filter((entry) => !type || entry.type === type).length;
    if (rank >= 1 && count() < 1) throw new Error('Stage ' + item.stage + ' needs at least one evidence entry.');
    if (rank >= 2 && count() < 2) throw new Error('Stage reproduced needs two independent evidence entries.');
    if (rank >= 3 && count('candidate') + count('outcome') < 1) throw new Error('Stage yielded_candidate needs evidence of type candidate: a candidate that passed the acceptance checks because of this hypothesis.');
    if (rank >= 4 && count('outcome') < 1) throw new Error('Stage yielded_outcome needs evidence of type outcome: a confirmed achievement of this base.');
    if (rank >= 4 && !(base.progress?.confirmedCount > 0)) throw new Error('Stage yielded_outcome is impossible while the base has no confirmed achievement.');
    if (!creating && rank > previousRank && !added.length) throw new Error('Advancing a stage requires addEvidence in the same call.');
    if (!creating && rank < previousRank && !reason) throw new Error('Demoting a stage requires a reason.');
    if (raw.status !== undefined) {
      const status = oneOf(raw.status, HYPOTHESIS_STATUS, 'hypothesis.status');
      if (status !== item.status) {
        if (status !== 'open' && !reason) throw new Error('Rejecting or retiring a hypothesis requires a reason.');
        if (status === 'open' && !reason) throw new Error('Reopening a hypothesis requires a reason.');
        item.status = status; item.statusReason = reason; item.statusChangedAt = now();
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
    const kind = oneOf(input.kind, ['hypothesis', 'constraint'], 'kind');
    if (!Array.isArray(input.items) || !input.items.length) throw new Error('items must be a non-empty array');
    if (input.items.length > 40) throw new Error('At most 40 items per call');
    const prefix = kind === 'hypothesis' ? 'H' : 'K';
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
        const result = kind === 'hypothesis' ? applyHypothesis(prior, raw, runId, base) : applyConstraint(prior, raw, input);
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
    let runId;
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
        cleanTargets.push({ hypothesisId, prediction: text(target.prediction, 800, 'target.prediction (what you expect to measure, stated before measuring)', true) });
      }
      if (base.openRunId) {
        const age = openRun ? Date.now() - Date.parse(openRun.startedAt) : Infinity;
        if (input.takeover !== true && age < OPEN_RUN_TTL_MS) throw new Error('Run ' + base.openRunId + ' is open (started ' + openRun.startedAt + '). Finish it, or pass takeover=true if it was abandoned.');
        if (openRun) put(tx, runRef(id, base.openRunId), { ...openRun, status: 'abandoned', finishedAt: now() });
        pushEvent(tx, base, { type: 'run_abandoned', runId: base.openRunId, summary: 'Taken over by a new run', actor: input.actor });
      }
      const probe = text(input.unknownTerritoryProbe, 800, 'unknownTerritoryProbe', false);
      if (!cleanTargets.length && !probe) throw new Error('Declare at least one target hypothesis with a prediction, or unknownTerritoryProbe describing what unexplored area this run observes.');
      base.counters.R = (base.counters.R || 0) + 1;
      runId = seqId('R', base.counters.R);
      const run = {
        id: runId, baseId: id, status: 'open', startedAt: now(), actor: text(input.actor, 120, 'actor', false) || 'agent',
        objective: text(input.objective, 800, 'objective', true),
        methodVersion: base.method.version, outcomeRevision: base.outcome.revision,
        targets: cleanTargets, unknownTerritoryProbe: probe,
      };
      put(tx, runRef(id, runId), run);
      base.openRunId = runId;
      pushEvent(tx, base, { type: 'run_started', runId, summary: run.objective, actor: input.actor, detail: { targets: cleanTargets, methodVersion: run.methodVersion } });
      saveBase(tx, base);
    });
    return { runId, brief: await get({ id }) };
  }

  async function finishRun(input) {
    const id = requireBaseId(input?.baseId);
    const runId = text(input?.runId, 20, 'runId', true);
    let summary;
    await db().runTransaction(async (tx) => {
      const base = await loadBase(tx, id);
      requireOpenRun(base, runId);
      const run = value(await tx.get(runRef(id, runId)));
      if (!run || run.status !== 'open') throw new Error('Run is not open: ' + runId);
      const rawVerdicts = Array.isArray(input.verdicts) ? input.verdicts : [];
      const verdicts = run.targets.map((target) => {
        const raw = rawVerdicts.find((entry) => entry && entry.hypothesisId === target.hypothesisId);
        if (!raw) throw new Error('Missing verdict for declared hypothesis ' + target.hypothesisId);
        return {
          hypothesisId: target.hypothesisId, prediction: target.prediction,
          result: oneOf(raw.result, VERDICTS, 'verdict.result'),
          observed: text(raw.observed, 1200, 'verdict.observed (what was actually measured)', true),
        };
      });
      const achievements = (Array.isArray(input.achievements) ? input.achievements.slice(0, 20) : []).map((rawAchievement) => {
        const raw = plain(rawAchievement, 'achievement');
        base.counters.A = (base.counters.A || 0) + 1;
        return {
          id: seqId('A', base.counters.A), runId, foundAt: now(), methodVersion: run.methodVersion,
          label: text(raw.label, 300, 'achievement.label', true),
          ref: text(raw.ref, 600, 'achievement.ref (ID in the canonical operator data)', false),
          evidence: text(raw.evidence, 2000, 'achievement.evidence (how each acceptance check was met)', true),
          hypothesisIds: list(raw.hypothesisIds, 10, 20),
          status: base.outcome.confirmedBy === 'measurement' ? 'confirmed' : 'candidate',
        };
      });
      base.progress = base.progress || { achievements: [], confirmedCount: 0 };
      base.progress.achievements = [...(base.progress.achievements || []), ...achievements].slice(-200);
      base.progress.confirmedCount = base.progress.achievements.filter((a) => a.status === 'confirmed').length;
      const itemChanges = run.movedItemIds || [];
      const moved = itemChanges.length > 0 || achievements.length > 0;
      base.stalledRuns = moved ? 0 : (base.stalledRuns || 0) + 1;
      base.runCount = (base.runCount || 0) + 1;
      base.openRunId = null;
      const finished = {
        ...run, status: 'finished', finishedAt: now(),
        summary: text(input.summary, 2500, 'summary', true),
        verdicts, achievementIds: achievements.map((a) => a.id),
        movedItemIds: [...new Set(itemChanges)], moved,
        notMovedReason: moved ? '' : text(input.notMovedReason, 1000, 'notMovedReason (this run changed no fixed point; say why and what that implies)', true),
        costNote: text(input.costNote, 400, 'costNote', false),
        nextStep: text(input.nextStep, 800, 'nextStep', false),
      };
      put(tx, runRef(id, runId), finished);
      summary = {
        id: runId, finishedAt: finished.finishedAt, methodVersion: run.methodVersion, objective: run.objective,
        summary: finished.summary.slice(0, 400), moved, movedItemIds: finished.movedItemIds,
        verdicts: verdicts.map((v) => v.hypothesisId + ':' + v.result), achievementIds: finished.achievementIds,
        nextStep: finished.nextStep,
      };
      base.lastRuns = [summary, ...(base.lastRuns || [])].slice(0, 5);
      pushEvent(tx, base, { type: moved ? 'run_finished' : 'run_stalled', runId, summary: summary.summary, actor: input.actor, detail: { verdicts: summary.verdicts, achievementIds: summary.achievementIds } });
      saveBase(tx, base);
    });
    return { run: summary, brief: await get({ id }) };
  }

  // Compact summary used by the Agent Intelligence bundle resolver.
  async function brief(input) { return get({ id: input?.id, view: 'brief' }); }

  return { create, list: listBases, get, brief, setOutcome, setMethodVersion, upsertItems, startRun, finishRun };
}

const store = createStore();
module.exports = { ...store, createStore, COLLECTIONS, STAGES, PROTOCOL };
