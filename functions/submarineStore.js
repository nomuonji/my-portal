'use strict';

// Project Submarine: exploration jobs as submarines. A submarine carries a mission (what to find, owned by the
// user), a loadout (skills/packs; versions released by their スキル錬成道場), a logbook of sorties and the haul
// it brought back. The 道場 trains how to explore; the submarine holds what is being looked for and what was
// found. A sortie opens a practice run in the 道場 of every trained gear, closes it on return, and a confirmed
// haul is mirrored to those 道場 as their achievement, so the user decides once, on the submarine.

const { getDocumentDb } = require('./documentDb');

const DEFAULT_DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTIONS = Object.freeze({ subs: 'submarines', sorties: 'submarineSorties', haul: 'submarineHaul' });
const ID_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
const GEAR_KINDS = ['chat_skill', 'skill_pack', 'intelligence_pack'];
const GEAR_ROLES = ['primary', 'support'];
const STATUSES = ['active', 'paused', 'decommissioned'];
const MODES = ['standing', 'one_shot'];
const OPEN_SORTIE_TTL_MS = 12 * 60 * 60 * 1000;
const STALL_WARNING_AT = 3;
const SYNC_EVERY_MS = 15 * 60 * 1000;
const PROTOCOL = [
  'Read the submarine (submarine_get) before every sortie. Use the loadout bodies it returns: they are the versions the 道場 released, not the latest edits.',
  'The sortie is the run: where a gear body says exploration_run_start / exploration_run_finish, do submarine_sortie_start / submarine_sortie_finish instead (declare its hypotheses in dojoRuns, give their verdicts in dojoReports, and bring its achievements back as haul). Do not open a second 道場 run.',
  'submarine_sortie_start opens the sortie and a practice run in the 道場 of every trained gear. Write 道場 ledger changes (sources, hypotheses) with the dojoRuns runId it returns.',
  'Judge every find against mission.acceptance before bringing it back. Write finds to their canonical store first when the submarine has one (haulCanonical), then list them as haul with ref = that ID.',
  'submarine_sortie_finish closes the sortie and the 道場 runs. Give each 道場 its verdicts. A sortie that brought nothing back and changed no chart or ledger is recorded as stalled.',
  'The mission belongs to the user: never change it without authorization. Haul stays a candidate until the user confirms it (unless mission.confirmedBy is measurement).',
  'Findings about the waters (what the target turned out to be like) go on the chart. Findings about how to search (sources, method) go to the 道場 ledger.',
  'Never edit gear during a sortie. Change a skill/pack in its 道場, which releases the version every submarine then carries.',
  'Read recentFeedback before sailing: it is what the user said about earlier haul (the action and the comment). It outranks your own scoring.',
  'When haulCanonical names a store (personal_feed, job_opportunities), every record in it is indexed as haul automatically; still list what this sortie added as haul with its ref so it is linked to the sortie and its gear.',
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
function requireId(value, label) {
  const id = text(value, 80, label || 'submarineId', true);
  if (!ID_PATTERN.test(id)) throw new Error((label || 'submarineId') + ' must be lowercase kebab-case');
  return id;
}
function seqId(prefix, number) { return prefix + '-' + String(number).padStart(3, '0'); }
function docId(subId, localId) { return subId + '__' + localId; }
function value(snapshot) { return snapshot && snapshot.exists ? snapshot.data() : null; }
function authorization(input, what) {
  const note = text(input?.authorizationNote, 600, 'authorizationNote', false);
  if (!(input?.userAuthorized === true || input?.userAuthorized === 'true') || note.length < 8) {
    throw new Error(what + ' is owned by the user. Pass userAuthorized=true with authorizationNote quoting where the user approved it.');
  }
  return note;
}

function cleanGear(raw, index) {
  const gear = plain(raw, 'loadout[' + index + ']');
  const versionNumber = gear.versionNumber === undefined || gear.versionNumber === null || gear.versionNumber === '' ? null : Number(gear.versionNumber);
  if (versionNumber !== null && (!Number.isInteger(versionNumber) || versionNumber < 1)) throw new Error('loadout[' + index + '].versionNumber must be a positive integer');
  const id = text(gear.id, 90, 'loadout[' + index + '].id', true);
  if (!ID_PATTERN.test(id)) throw new Error('loadout[' + index + '].id must be the skill/pack id');
  const dojoId = text(gear.dojoId, 80, 'loadout[' + index + '].dojoId', false);
  if (dojoId && !ID_PATTERN.test(dojoId)) throw new Error('loadout[' + index + '].dojoId must be a 道場 id');
  const role = oneOf(gear.role, GEAR_ROLES, 'loadout[' + index + '].role', index === 0 ? 'primary' : 'support');
  return {
    kind: oneOf(gear.kind, GEAR_KINDS, 'loadout[' + index + '].kind'), id, role,
    use: text(gear.use, 300, 'loadout[' + index + '].use', false),
    dojoId: dojoId || null, versionNumber,
    train: gear.train === undefined ? role === 'primary' : gear.train === true,
  };
}
function cleanLoadout(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('loadout needs at least one skill or pack');
  if (raw.length > 8) throw new Error('At most 8 gear per submarine');
  const gear = raw.map(cleanGear);
  if (!gear.some((g) => g.role === 'primary')) gear[0].role = 'primary';
  const keys = new Set();
  gear.forEach((g) => { const key = g.kind + ':' + g.id; if (keys.has(key)) throw new Error('Duplicate gear: ' + key); keys.add(key); });
  return gear;
}
function cleanCanonical(raw) {
  if (!raw) return { where: 'here', note: '' };
  const input = plain(raw, 'haulCanonical');
  return { where: text(input.where, 120, 'haulCanonical.where', false) || 'here', note: text(input.note, 500, 'haulCanonical.note', false) };
}
function cleanChartEntry(raw, sortieId) {
  const entry = plain(raw, 'chart entry');
  return {
    statement: text(entry.statement, 1200, 'chart.statement', true),
    basis: text(entry.basis, 1200, 'chart.basis (what was observed)', true),
    limits: text(entry.limits, 800, 'chart.limits', false),
    sortieId: sortieId || null,
  };
}

const DECISIONS = ['confirmed', 'candidate', 'declined'];
const TONES = ['good', 'neutral', 'bad'];
// Hosts whose cached tool schema lacks a field may send an object/array as a JSON string.
function parsed(raw) {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!/^[[{]/.test(trimmed)) return raw;
  try { return JSON.parse(trimmed); } catch (error) { return raw; }
}
function cleanActions(input) {
  const raw = parsed(input);
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) throw new Error('feedbackActions needs 2 to 6 actions');
  const actions = raw.map((a, i) => {
    const item = plain(a, 'feedbackActions[' + i + ']');
    const key = text(item.key, 30, 'feedbackActions.key', true);
    if (!/^[a-z][a-z0-9_-]{0,29}$/.test(key)) throw new Error('feedbackActions.key must be lowercase');
    return { key, label: text(item.label, 20, 'feedbackActions.label', true), decision: oneOf(item.decision, DECISIONS, 'feedbackActions.decision'), tone: oneOf(item.tone, TONES, 'feedbackActions.tone', 'neutral') };
  });
  if (new Set(actions.map((a) => a.key)).size !== actions.length) throw new Error('feedbackActions keys must be unique');
  if (!actions.some((a) => a.decision === 'confirmed')) throw new Error('feedbackActions needs one action that confirms');
  return actions;
}
// What a find is, in words the user reads on the card. Used when the haul has no canonical record to render.
function cleanDetails(input) {
  const raw = parsed(input);
  if (!raw) return null;
  const d = plain(raw, 'haul.details');
  const out = {
    summary: text(d.summary, 1200, 'details.summary', false), why: text(d.why, 1000, 'details.why', false),
    bridge: text(d.bridge, 600, 'details.bridge', false), firstStep: text(d.firstStep, 600, 'details.firstStep', false),
    caution: text(d.caution, 600, 'details.caution', false), source: text(d.source, 120, 'details.source', false),
  };
  return Object.values(out).some(Boolean) ? out : null;
}
// The exact versions a sortie carried, with the 道場 run each trained gear practised in.
function gearVersionsOf(sortie) {
  const runs = new Map((sortie.dojoRuns || []).map((r) => [r.dojoId, r.runId]));
  return (sortie.loadout || []).map((g) => ({
    gear: g.kind + ':' + g.id, role: g.role, version: g.version ?? null, versionFrom: g.versionFrom || null,
    dojoId: g.dojoId || null, dojoRunId: g.dojoId ? runs.get(g.dojoId) || null : null,
  }));
}
function recordOf(h) {
  if (!h.details) return null;
  return { kind: 'note', title: h.label, url: h.url || '', summary: h.details.summary || h.evidence || '', reason: h.details.why, bridge: h.details.bridge, firstStep: h.details.firstStep, weakness: h.details.caution, source: h.details.source };
}

function createStore(options) {
  const getDb = (options && options.getDb) || database;
  const dojo = () => (options && options.dojo) || require('./explorationBaseStore');
  const resolveTarget = (options && options.resolveTarget) || ((input) => require('./explorationBaseStore').defaultResolveTarget(input));
  const canonical = (options && options.canonical) || require('./submarineCanonical').createCanonical();
  const routines = () => (options && options.routines) || require('./routineJobStore');
  const db = () => getDb();
  const subRef = (id) => db().collection(COLLECTIONS.subs).doc(id);
  const sortieRef = (subId, id) => db().collection(COLLECTIONS.sorties).doc(docId(subId, id));
  const haulRef = (subId, id) => db().collection(COLLECTIONS.haul).doc(docId(subId, id));
  const put = (tx, ref, data) => tx.set(ref, JSON.parse(JSON.stringify(data)));
  // The evaluation buttons for a submarine: its canonical store's, or its own when it keeps the haul itself.
  const actionsFor = (sub) => {
    const where = sub.haulCanonical?.where || 'here';
    if (where === 'here' && Array.isArray(sub.feedbackActions) && sub.feedbackActions.length) return sub.feedbackActions;
    return canonical.adapterFor(where).actions;
  };
  const withRecord = (h, records) => (records && records.has(h.ref) ? { ...h, record: records.get(h.ref) } : (h.details ? { ...h, record: recordOf(h) } : h));

  // Which 道場 train which gear, from one read of the 道場 list.
  async function dojoIndex() {
    const result = await dojo().list({});
    const byTarget = new Map();
    (result.items || []).filter((base) => base.status !== 'closed' && base.target).forEach((base) => {
      const key = base.target.kind + ':' + base.target.id;
      byTarget.set(key, [...(byTarget.get(key) || []), { dojoId: base.id, title: base.title, releasedVersion: base.target.versionNumber, status: base.status }]);
    });
    return byTarget;
  }
  function bind(gear, index) {
    const trainers = index.get(gear.kind + ':' + gear.id) || [];
    const chosen = gear.dojoId ? trainers.find((t) => t.dojoId === gear.dojoId) : (trainers.length === 1 ? trainers[0] : null);
    if (gear.dojoId && !chosen) return { ...gear, error: '道場 ' + gear.dojoId + ' does not train ' + gear.kind + ' ' + gear.id };
    if (!gear.dojoId && trainers.length > 1) return { ...gear, error: 'Several 道場 train ' + gear.id + ' (' + trainers.map((t) => t.dojoId).join(', ') + '); set loadout dojoId' };
    if (chosen) return { ...gear, dojoId: chosen.dojoId, dojoTitle: chosen.title, version: chosen.releasedVersion, versionFrom: 'dojo', train: gear.train && chosen.status === 'active' };
    if (!gear.versionNumber) return { ...gear, error: 'No 道場 trains ' + gear.id + ': pin versionNumber in the loadout, or train it in a 道場' };
    return { ...gear, dojoId: null, version: gear.versionNumber, versionFrom: 'pinned', train: false };
  }
  async function validateLoadout(loadout) {
    const index = await dojoIndex();
    const bound = loadout.map((g) => bind(g, index));
    const broken = bound.find((g) => g.error);
    if (broken) throw new Error(broken.error);
    for (const g of bound) await resolveTarget({ kind: g.kind, id: g.id, versionNumber: g.version });
    return bound;
  }
  async function loadGearBodies(bound) {
    return Promise.all(bound.map(async (g) => {
      if (g.error) return g;
      try {
        const resolved = await resolveTarget({ kind: g.kind, id: g.id, versionNumber: g.version });
        return { ...g, title: resolved.title, latestVersion: resolved.latestVersion, body: resolved.body, unreleasedNewer: resolved.latestVersion > g.version };
      } catch (error) {
        return { ...g, error: String(error?.message || error).slice(0, 300) };
      }
    }));
  }

  async function loadSub(tx, id) {
    const sub = value(await tx.get(subRef(id)));
    if (!sub) throw new Error('Submarine not found: ' + id);
    sub.counters = sub.counters || {};
    return sub;
  }
  function saveSub(tx, sub) {
    sub.revision = (Number(sub.revision) || 0) + 1;
    sub.updatedAt = now();
    put(tx, subRef(sub.id), sub);
  }
  function logEvent(sub, type, summary, actor) {
    sub.events = [{ at: now(), type, summary: text(summary, 400, 'summary', false), actor: text(actor, 120, 'actor', false) || 'agent' }, ...(sub.events || [])].slice(0, 60);
  }

  async function commission(input) {
    const id = requireId(input?.id, 'id');
    const note = authorization(input, 'Commissioning a submarine (it fixes the mission)');
    const { cleanOutcome } = require('./explorationBaseStore');
    let mission = input.mission ? cleanOutcome(input.mission) : null;
    let imported = [];
    const fromDojo = input.migrateFromDojo ? requireId(input.migrateFromDojo, 'migrateFromDojo') : '';
    if (fromDojo) {
      const base = await dojo().get({ id: fromDojo, view: 'brief' });
      if (!mission) {
        const o = base.outcome || {};
        mission = cleanOutcome({ statement: o.statement, unit: o.unit, target: o.target, acceptance: o.acceptance, confirmedBy: o.confirmedBy, finalIndicator: o.finalIndicator, proxies: o.proxies, deadline: o.deadline, budget: o.budget, stopConditions: o.stopConditions, priority: o.priority });
      }
      imported = [...(base.outcome?.awaitingConfirmation || []), ...(base.outcome?.confirmed || [])];
    }
    if (!mission) throw new Error('mission is required (or migrateFromDojo to copy the 道場 goal)');
    const loadout = await validateLoadout(cleanLoadout(input.loadout));
    await db().runTransaction(async (tx) => {
      if (value(await tx.get(subRef(id)))) throw new Error('Submarine already exists: ' + id);
      const at = now();
      const sub = {
        id, schemaVersion: 1, kind: 'submarine', status: 'active',
        hull: text(input.hull, 20, 'hull', false),
        name: text(input.name, 120, 'name', true),
        summary: text(input.summary, 1500, 'summary', true),
        mode: oneOf(input.mode, MODES, 'mode', 'standing'),
        projectIds: list(input.projectIds, 20, 140),
        routineJobIds: list(input.routineJobIds, 10, 120),
        haulCanonical: cleanCanonical(input.haulCanonical),
        ...(cleanActions(input.feedbackActions) ? { feedbackActions: cleanActions(input.feedbackActions) } : {}),
        mission: { ...mission, revision: 1, setAt: at, authorizationNote: note },
        loadout: loadout.map(({ kind, id: gid, role, use, dojoId, versionNumber, train }) => ({ kind, id: gid, role, use, dojoId: dojoId || null, versionNumber: dojoId ? null : versionNumber, train })),
        chart: [], openSortieId: null, sortieCount: 0, stalledSorties: 0, lastSorties: [],
        progress: { confirmedCount: 0, candidateCount: 0 },
        counters: { S: 0, C: 0, F: 0 }, revision: 0, createdAt: at,
      };
      imported.forEach((a) => {
        sub.counters.C += 1;
        put(tx, haulRef(id, seqId('C', sub.counters.C)), {
          id: seqId('C', sub.counters.C), submarineId: id, label: a.label, ref: a.ref || '', url: '',
          evidence: a.evidence || '', status: a.status === 'confirmed' ? 'confirmed' : 'candidate',
          sortieId: null, foundAt: a.foundAt || at, decidedAt: a.decidedAt || null,
          dojoRef: a.ref || '', importedFrom: fromDojo + ':' + a.id, gear: [],
        });
      });
      sub.progress.confirmedCount = imported.filter((a) => a.status === 'confirmed').length;
      sub.progress.candidateCount = imported.length - sub.progress.confirmedCount;
      logEvent(sub, 'commissioned', sub.name + (fromDojo ? '（道場 ' + fromDojo + ' から任務と成果 ' + imported.length + ' 件を移行）' : ''), input.actor);
      saveSub(tx, sub);
    });
    return get({ id });
  }

  async function listSubs(input) {
    const status = text(input?.status, 20, 'status', false);
    const [snap, index] = await Promise.all([db().collection(COLLECTIONS.subs).limit(200).get(), dojoIndex().catch(() => new Map())]);
    const items = snap.docs.map((doc) => doc.data())
      .filter((sub) => !status || sub.status === status)
      .map((sub) => ({
        id: sub.id, hull: sub.hull || '', name: sub.name, summary: sub.summary, status: sub.status, mode: sub.mode,
        mission: sub.mission ? { statement: sub.mission.statement, unit: sub.mission.unit, target: sub.mission.target, deadline: sub.mission.deadline } : null,
        confirmedCount: sub.progress?.confirmedCount || 0, candidateCount: sub.progress?.candidateCount || 0,
        loadout: (sub.loadout || []).map((g) => { const b = bind(g, index); return { kind: g.kind, id: g.id, role: g.role, version: b.version || null, dojoId: b.dojoId || null, error: b.error || null }; }),
        openSortieId: sub.openSortieId || null, sortieCount: sub.sortieCount || 0, stalledSorties: sub.stalledSorties || 0,
        lastSortie: (sub.lastSorties || [])[0] || null, haulCanonical: sub.haulCanonical, routineJobIds: sub.routineJobIds || [],
        updatedAt: sub.updatedAt,
      }))
      .sort((a, b) => String(a.hull || a.name).localeCompare(String(b.hull || b.name)));
    return { items, count: items.length, collection: COLLECTIONS.subs };
  }

  // Lightweight workspace gate: reconcile canonical sources on the same cadence as get(),
  // without loading gear bodies, confirmed haul records or a full submarine view.
  async function workspaceStatus(input) {
    const id = requireId(input?.id, 'id');
    let sub = value(await subRef(id).get());
    if (!sub) throw new Error('Submarine not found: ' + id);
    const where = sub.haulCanonical?.where || 'here';
    if (canonical.syncable(where) && (!sub.syncedAt || Date.now() - Date.parse(sub.syncedAt) > SYNC_EVERY_MS)) {
      const synced = await syncCanonical(sub, canonical.adapterFor(where));
      if (synced.error) throw new Error('Could not read the canonical store ' + where + ': ' + synced.error);
      sub = value(await subRef(id).get());
    }
    return {id, candidateCount: sub.progress?.candidateCount || 0, openSortieId: sub.openSortieId || null};
  }

  async function haulOf(subId, limit) {
    const snap = await db().collection(COLLECTIONS.haul).where('submarineId', '==', subId).limit(limit || 1000).get();
    return snap.docs.map((doc) => doc.data()).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }

  async function get(input) {
    const id = requireId(input?.id, 'id');
    const view = oneOf(input?.view, ['brief', 'full'], 'view', 'brief');
    let sub = value(await subRef(id).get());
    if (!sub) throw new Error('Submarine not found: ' + id);
    const where = sub.haulCanonical?.where || 'here';
    const adapter = canonical.adapterFor(where);
    // Re-index the canonical store at most every SYNC_EVERY_MS (or when asked); otherwise read only the shown records.
    const due = input?.sync === true || !sub.syncedAt || Date.now() - Date.parse(sub.syncedAt) > SYNC_EVERY_MS;
    const synced = !canonical.syncable(where) ? { records: new Map(), error: null }
      : due ? await syncCanonical(sub, adapter) : { records: null, error: null };
    if (synced.changed) sub = value(await subRef(id).get());
    const index = await dojoIndex();
    const loadout = await loadGearBodies((sub.loadout || []).map((g) => bind(g, index)));
    let haulRows = await haulOf(id);
    if (!synced.records) {
      // Only the records this view shows: waiting items and the latest decided ones.
      const shown = [...haulRows.filter((h) => h.status === 'candidate'), ...haulRows.filter((h) => h.status === 'confirmed').slice(0, view === 'full' ? 60 : 30)];
      const records = new Map();
      await Promise.all(shown.filter((h) => h.ref && h.ref.startsWith(where + ':') && !h.details).slice(0, 80).map(async (h) => {
        try { const row = await adapter.one(h.ref.slice(where.length + 1)); if (row) records.set(h.ref, row.record); } catch (error) { /* shown without the record */ }
      }));
      synced.records = records;
    }
    const haul = haulRows.map((h) => withRecord(h, synced.records));
    const target = sub.mission?.target || {};
    const confirmed = haul.filter((h) => h.status === 'confirmed');
    const awaiting = haul.filter((h) => h.status === 'candidate');
    const warnings = [];
    loadout.forEach((g) => {
      if (g.error) warnings.push('Gear ' + g.id + ': ' + g.error);
      else if (g.unreleasedNewer && g.versionFrom === 'dojo') warnings.push(g.id + ' has v' + g.latestVersion + ' not yet released by 道場 ' + g.dojoId + '. This submarine carries v' + g.version + ' until the 道場 releases more.');
    });
    if (sub.openSortieId) warnings.push('Sortie ' + sub.openSortieId + ' is still at sea. Finish it, or take it over if abandoned.');
    if ((sub.stalledSorties || 0) >= STALL_WARNING_AT) warnings.push(sub.stalledSorties + ' sorties in a row brought nothing back. Stop and re-examine the mission, the loadout and the waters before sailing again.');
    if (awaiting.length) warnings.push(awaiting.length + ' haul item(s) wait for the user.');
    if (synced.error) warnings.push('Could not read the canonical store ' + where + ': ' + synced.error);
    const result = {
      submarine: {
        id: sub.id, hull: sub.hull || '', name: sub.name, summary: sub.summary, status: sub.status, mode: sub.mode,
        revision: sub.revision, projectIds: sub.projectIds || [], routineJobIds: sub.routineJobIds || [],
        haulCanonical: sub.haulCanonical || { where: 'here', note: '' }, updatedAt: sub.updatedAt,
      },
      mission: { ...sub.mission, confirmedCount: confirmed.length, reached: confirmed.length >= (target.min || 1) },
      loadout: loadout.map((g) => ({
        kind: g.kind, id: g.id, role: g.role, use: g.use || '', train: !!g.train, version: g.version || null,
        versionFrom: g.versionFrom || null, dojoId: g.dojoId || null, dojoTitle: g.dojoTitle || '', title: g.title || '',
        latestVersion: g.latestVersion || null, unreleasedNewer: !!g.unreleasedNewer, error: g.error || null,
        ...(view === 'full' || input?.includeBodies !== false ? { body: g.body || '' } : {}),
      })),
      haul: { awaiting, confirmed: confirmed.slice(0, view === 'full' ? 200 : 30), declinedCount: haul.filter((h) => h.status === 'declined').length },
      chart: (sub.chart || []).filter((entry) => entry.status !== 'retired'),
      actions: actionsFor(sub),
      recentFeedback: (sub.recentFeedback || []).slice(0, 30),
      position: { sortieCount: sub.sortieCount || 0, stalledSorties: sub.stalledSorties || 0, openSortieId: sub.openSortieId || null, lastSorties: sub.lastSorties || [] },
      warnings,
      protocol: PROTOCOL,
    };
    if (view === 'full') {
      const sorties = await db().collection(COLLECTIONS.sorties).where('submarineId', '==', id).limit(500).get();
      result.full = {
        sorties: sorties.docs.map((doc) => doc.data()).sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 50),
        declined: haul.filter((h) => h.status === 'declined').slice(0, 100),
        chartRetired: (sub.chart || []).filter((entry) => entry.status === 'retired'),
        events: sub.events || [],
        schedule: await scheduleOf(sub).catch((error) => ({ error: String(error?.message || error).slice(0, 200) })),
      };
    }
    return result;
  }

  // The routine jobs that launch this submarine, with their slots and last runs.
  async function scheduleOf(sub) {
    const ids = sub.routineJobIds || [];
    if (!ids.length) return { jobs: [] };
    const listed = await routines().list({});
    const jobs = [];
    for (const job of (listed.items || []).filter((j) => ids.includes(j.id))) {
      const runs = await routines().runs({ jobId: job.id, limit: 5 }).catch(() => ({ items: [] }));
      jobs.push({
        id: job.id, title: job.title, status: job.status, slots: job.slots || [], timeZone: job.timeZone || 'Asia/Tokyo',
        revision: job.revision, lastRuns: (runs.items || []).map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, summary: String(r.resultSummary || '').slice(0, 300) })),
      });
    }
    return { jobs };
  }

  // Index every record of the canonical store as haul, and let the store's own state (e.g. a 好き in Discover)
  // decide the haul status when the adapter is authoritative. Writes only when something is missing or differs.
  async function syncCanonical(sub, adapter) {
    let rows;
    try { rows = await adapter.list(); } catch (error) { return { records: new Map(), error: String(error?.message || error).slice(0, 200) }; }
    const records = new Map(rows.map((r) => [r.ref, r.record]));
    const haul = await haulOf(sub.id);
    const byRef = new Map(haul.filter((h) => h.ref).map((h) => [h.ref, h]));
    const missing = rows.filter((r) => !byRef.has(r.ref));
    let changed = false;
    if (missing.length) {
      const primary = (sub.loadout || []).filter((g) => g.role === 'primary').map((g) => g.kind + ':' + g.id);
      const added = [];
      await db().runTransaction(async (tx) => {
        const fresh = await loadSub(tx, sub.id);
        if (fresh.revision !== sub.revision) return; // someone else synced meanwhile
        fresh.progress = fresh.progress || { confirmedCount: 0, candidateCount: 0 };
        missing.forEach((r) => {
          fresh.counters.C = (fresh.counters.C || 0) + 1;
          const haulId = seqId('C', fresh.counters.C);
          const item = {
            id: haulId, submarineId: sub.id, label: r.record.title || r.ref, ref: r.ref, url: r.record.url || '',
            evidence: r.evidence || '', status: r.status, sortieId: null, foundAt: r.foundAt || now(),
            decidedAt: r.status === 'candidate' ? null : now(), dojoRef: r.ref, gear: primary, dojoIds: [], importedFrom: 'canonical:' + adapter.where,
          };
          put(tx, haulRef(sub.id, haulId), item);
          if (r.status === 'confirmed') fresh.progress.confirmedCount = (fresh.progress.confirmedCount || 0) + 1;
          if (r.status === 'candidate') fresh.progress.candidateCount = (fresh.progress.candidateCount || 0) + 1;
          added.push(item);
        });
        logEvent(fresh, 'haul_indexed', missing.length + ' 件を ' + adapter.where + ' から索引', 'sync');
        saveSub(tx, fresh);
      });
      for (const item of added.filter((h) => h.status === 'confirmed')) await mirror(sub, item, true, 'sync');
      changed = added.length > 0;
    }
    if (adapter.authoritative) {
      for (const h of haul) {
        const row = rows.find((r) => r.ref === h.ref);
        if (row && row.status !== h.status) { await decide(sub, h, row.status, '台帳（' + adapter.where + '）の状態に合わせた', 'sync'); changed = true; }
      }
    }
    await db().runTransaction(async (tx) => {
      const fresh = await loadSub(tx, sub.id);
      fresh.syncedAt = now();
      put(tx, subRef(sub.id), fresh); // not a revision bump: syncing is bookkeeping
    });
    return { records, changed, error: null };
  }

  // The user's evaluation of one haul item: an action from the adapter (好き / 応募する / 見送る …) and/or a
  // comment. The action is written back to the canonical store when it has a field for it, decides the haul
  // status (mirrored to the 道場) and is kept, with the comment, as feedback the next sortie reads.
  async function haulFeedback(input) {
    const id = requireId(input?.submarineId, 'submarineId');
    authorization(input, 'Feedback on haul');
    const haulId = text(input.haulId, 20, 'haulId', true);
    const comment = text(input.comment, 1000, 'comment', false);
    const actionKey = text(input.action, 30, 'action', false);
    if (!actionKey && !comment) throw new Error('Give an action, a comment, or both');
    const sub = value(await subRef(id).get());
    if (!sub) throw new Error('Submarine not found: ' + id);
    const haul = value(await haulRef(id, haulId).get());
    if (!haul) throw new Error('Haul not found: ' + haulId);
    const adapter = canonical.adapterFor(sub.haulCanonical?.where || 'here');
    const actions = actionsFor(sub);
    const action = actionKey ? actions.find((a) => a.key === actionKey) : null;
    if (actionKey && !action) throw new Error('action must be one of: ' + actions.map((a) => a.key).join(', '));
    if (action && adapter.where !== 'here' && haul.ref && haul.ref.startsWith(adapter.where + ':')) {
      await adapter.apply(haul.ref.slice(adapter.where.length + 1), action.key, comment);
    }
    if (action && action.decision !== haul.status) await decide(sub, haul, action.decision, comment || action.label, input.actor || 'user');
    const entry = { at: now(), action: action ? action.key : '', actionLabel: action ? action.label : '', comment, actor: text(input.actor, 120, 'actor', false) || 'user' };
    await db().runTransaction(async (tx) => {
      const fresh = await loadSub(tx, id);
      const current = value(await tx.get(haulRef(id, haulId)));
      put(tx, haulRef(id, haulId), { ...current, feedback: [entry, ...(current.feedback || [])].slice(0, 20) });
      fresh.recentFeedback = [{ ...entry, haulId, label: current.label, ref: current.ref || '' }, ...(fresh.recentFeedback || [])].slice(0, 40);
      logEvent(fresh, 'haul_feedback', haulId + ': ' + (entry.actionLabel || 'コメント') + (comment ? '「' + comment.slice(0, 80) + '」' : ''), entry.actor);
      saveSub(tx, fresh);
    });
    const after = value(await haulRef(id, haulId).get()) || haul;
    await forwardFeedback(sub, after, { decision: action ? action.decision : after.status, actionLabel: action ? action.label : '', comment }, entry.actor);
    // The timeline only needs the updated item back; reading the whole submarine again is the expensive path.
    if (input.light === true) return { haul: after, actions: actionsFor(sub) };
    return get({ id });
  }

  async function update(input) {
    const id = requireId(input?.submarineId, 'submarineId');
    const hasMission = input.mission !== undefined;
    const reason = text(input.reason, 1000, 'reason', false);
    const loadout = input.loadout !== undefined ? await validateLoadout(cleanLoadout(input.loadout)) : null;
    if (loadout && !reason) throw new Error('Changing the loadout requires a reason.');
    const note = hasMission || input.status === 'decommissioned' ? authorization(input, 'The mission') : '';
    const mission = hasMission ? require('./explorationBaseStore').cleanOutcome(input.mission) : null;
    const chartEdits = Array.isArray(input.chartEdits) ? input.chartEdits.slice(0, 20) : [];
    await db().runTransaction(async (tx) => {
      const sub = await loadSub(tx, id);
      if (loadout && sub.openSortieId) throw new Error('Sortie ' + sub.openSortieId + ' is at sea. Change the loadout between sorties.');
      if (mission) {
        sub.mission = { ...mission, revision: (Number(sub.mission?.revision) || 0) + 1, setAt: now(), authorizationNote: note };
        logEvent(sub, 'mission_set', reason || '任務を変更', input.actor);
      }
      if (loadout) {
        sub.loadout = loadout.map(({ kind, id: gid, role, use, dojoId, versionNumber, train }) => ({ kind, id: gid, role, use, dojoId: dojoId || null, versionNumber: dojoId ? null : versionNumber, train }));
        logEvent(sub, 'loadout_set', reason, input.actor);
      }
      ['name', 'summary', 'hull'].forEach((field) => { if (input[field] !== undefined) sub[field] = text(input[field], field === 'summary' ? 1500 : 120, field, field !== 'hull'); });
      if (input.routineJobIds !== undefined) sub.routineJobIds = list(input.routineJobIds, 10, 120);
      if (input.feedbackActions !== undefined) { sub.feedbackActions = cleanActions(input.feedbackActions) || []; logEvent(sub, 'feedback_actions', sub.feedbackActions.map((a) => a.label).join(' / '), input.actor); }
      if (input.haulCanonical !== undefined) sub.haulCanonical = cleanCanonical(input.haulCanonical);
      if (input.mode !== undefined) sub.mode = oneOf(input.mode, MODES, 'mode');
      if (input.status !== undefined) {
        sub.status = oneOf(input.status, STATUSES, 'status');
        logEvent(sub, 'status_' + sub.status, reason || note, input.actor);
      }
      chartEdits.forEach((raw) => {
        const edit = plain(raw, 'chartEdits item');
        if (edit.id) {
          const entry = (sub.chart || []).find((c) => c.id === edit.id);
          if (!entry) throw new Error('Chart entry not found: ' + edit.id);
          if (edit.status === 'retired') {
            entry.status = 'retired'; entry.statusReason = text(edit.reason, 800, 'reason (why the chart entry no longer holds)', true); entry.updatedAt = now();
          } else {
            if (edit.statement !== undefined) entry.statement = text(edit.statement, 1200, 'chart.statement', true);
            if (edit.basis !== undefined) entry.basis = text(edit.basis, 1200, 'chart.basis', true);
            if (edit.limits !== undefined) entry.limits = text(edit.limits, 800, 'chart.limits', false);
            entry.updatedAt = now();
          }
        } else {
          sub.counters.F = (sub.counters.F || 0) + 1;
          sub.chart = [...(sub.chart || []), { id: seqId('F', sub.counters.F), status: 'open', createdAt: now(), ...cleanChartEntry(edit, null), legacyRef: text(edit.legacyRef, 120, 'legacyRef', false) }].slice(-80);
        }
      });
      if (chartEdits.length) logEvent(sub, 'chart_edited', chartEdits.length + ' 件', input.actor);
      saveSub(tx, sub);
    });
    return get({ id });
  }

  async function sortieStart(input) {
    const id = requireId(input?.submarineId, 'submarineId');
    const objective = text(input.objective, 800, 'objective (what this sortie looks for)', true);
    const snap = value(await subRef(id).get());
    if (!snap) throw new Error('Submarine not found: ' + id);
    if (snap.status !== 'active') throw new Error('Submarine is ' + snap.status + '; only an active submarine can sail.');
    if (snap.openSortieId) {
      const open = value(await sortieRef(id, snap.openSortieId).get());
      const age = open ? Date.now() - Date.parse(open.startedAt) : Infinity;
      if (input.takeover !== true && age < OPEN_SORTIE_TTL_MS) throw new Error('Sortie ' + snap.openSortieId + ' is at sea (since ' + open.startedAt + '). Finish it, or pass takeover=true if it was abandoned.');
    }
    const bound = await validateLoadout(snap.loadout || []);
    const reports = Array.isArray(input.dojoRuns) ? input.dojoRuns : [];
    const label = (snap.hull ? snap.hull + ' ' : '') + snap.name;
    const dojoRuns = [];
    try {
      for (const gear of bound.filter((g) => g.train && g.dojoId)) {
        if (dojoRuns.some((r) => r.dojoId === gear.dojoId)) continue;
        const plan = reports.find((r) => r && r.dojoId === gear.dojoId) || {};
        const started = await dojo().startRun({
          baseId: gear.dojoId, actor: input.actor, takeover: input.takeover === true,
          objective: '潜水艦「' + label + '」の出航: ' + objective,
          targets: Array.isArray(plan.targets) ? plan.targets : [],
          unknownTerritoryProbe: text(plan.unknownTerritoryProbe, 800, 'unknownTerritoryProbe', false)
            || (Array.isArray(plan.targets) && plan.targets.length ? '' : '潜水艦「' + label + '」の任務で ' + gear.id + ' v' + gear.version + ' を使う: ' + objective),
        });
        dojoRuns.push({ dojoId: gear.dojoId, runId: started.runId, gear: gear.kind + ':' + gear.id, version: gear.version });
      }
    } catch (error) {
      // Close what was opened, so a failed launch leaves no 道場 run at sea.
      for (const run of dojoRuns) {
        await dojo().finishRun({ baseId: run.dojoId, runId: run.runId, actor: input.actor, summary: '出航できなかったため中止', verdicts: [], notMovedReason: 'Sortie launch failed: ' + String(error?.message || error).slice(0, 300) }).catch(() => null);
      }
      throw error;
    }
    let sortieId;
    await db().runTransaction(async (tx) => {
      const sub = await loadSub(tx, id);
      const nativeLock = value(await tx.get(db().collection("submarineExecutionLocks").doc(id)));
      if (nativeLock?.runId && Date.parse(nativeLock.expiresAt) > Date.now()) throw new Error("Native execution is at sea");
      if (sub.openSortieId) {
        const open = value(await tx.get(sortieRef(id, sub.openSortieId)));
        if (open && open.status === 'open') put(tx, sortieRef(id, sub.openSortieId), { ...open, status: 'abandoned', finishedAt: now() });
        logEvent(sub, 'sortie_abandoned', sub.openSortieId, input.actor);
      }
      sub.counters.S = (sub.counters.S || 0) + 1;
      sortieId = seqId('S', sub.counters.S);
      put(tx, sortieRef(id, sortieId), {
        id: sortieId, submarineId: id, status: 'open', startedAt: now(), actor: text(input.actor, 120, 'actor', false) || 'agent',
        objective, missionRevision: sub.mission?.revision || 1,
        loadout: bound.map((g) => ({ kind: g.kind, id: g.id, role: g.role, version: g.version, versionFrom: g.versionFrom, dojoId: g.dojoId || null })),
        dojoRuns,
      });
      sub.openSortieId = sortieId;
      logEvent(sub, 'sortie_started', sortieId + ': ' + objective, input.actor);
      saveSub(tx, sub);
    });
    return { sortieId, dojoRuns, brief: await get({ id }) };
  }

  async function sortieFinish(input) {
    const id = requireId(input?.submarineId, 'submarineId');
    const sortieId = text(input?.sortieId, 20, 'sortieId', true);
    const summary = text(input.summary, 2500, 'summary', true);
    const sortie = value(await sortieRef(id, sortieId).get());
    if (!sortie || sortie.status !== 'open') throw new Error('Sortie is not at sea: ' + sortieId);
    const rawHaul = (Array.isArray(input.haul) ? input.haul.slice(0, 30) : []).map((raw, i) => {
      const h = plain(raw, 'haul[' + i + ']');
      return {
        label: text(h.label, 300, 'haul.label', true), ref: text(h.ref, 600, 'haul.ref', false), url: text(h.url, 1000, 'haul.url', false),
        evidence: text(h.evidence, 2000, 'haul.evidence (how it meets mission.acceptance)', true),
        sourceIds: list(h.sourceIds, 10, 20), gear: list(h.gear, 8, 90), details: cleanDetails(h.details),
      };
    });
    const chartAdds = (Array.isArray(input.chart) ? input.chart.slice(0, 12) : []).map((raw) => cleanChartEntry(raw, sortieId));
    const existing = await haulOf(id);
    const byRef = new Map(existing.filter((h) => h.ref).map((h) => [h.ref, h]));
    // A record the canonical sync already indexed (no sortie yet) is linked to this sortie, not duplicated.
    const linkable = rawHaul.filter((h) => h.ref && byRef.has(h.ref) && !byRef.get(h.ref).sortieId && String(byRef.get(h.ref).importedFrom || '').startsWith('canonical:')).map((h) => ({ raw: h, haul: byRef.get(h.ref) }));
    const fresh = rawHaul.filter((h) => !h.ref || !byRef.has(h.ref));
    const duplicates = rawHaul.length - fresh.length - linkable.length;
    const reports = Array.isArray(input.dojoReports) ? input.dojoReports : [];
    const dojoResults = [];
    for (const run of sortie.dojoRuns || []) {
      const report = reports.find((r) => r && r.dojoId === run.dojoId) || {};
      try {
        const finished = await dojo().finishRun({
          baseId: run.dojoId, runId: run.runId, actor: input.actor,
          summary: text(report.summary, 2500, 'dojoReports.summary', false) || summary,
          verdicts: Array.isArray(report.verdicts) ? report.verdicts : [],
          yieldRefs: [...fresh.map((h, i) => h.ref || ('submarine:' + id + ':' + sortieId + ':' + (i + 1))), ...linkable.map((l) => l.raw.ref)],
          notMovedReason: text(report.notMovedReason, 1000, 'notMovedReason', false) || text(input.notMovedReason, 1000, 'notMovedReason', false) || '潜水艦の出航で成果も台帳の変化もなかった',
          nextStep: text(report.nextStep, 800, 'nextStep', false),
        });
        dojoResults.push({ dojoId: run.dojoId, runId: run.runId, moved: finished.run.moved });
      } catch (error) {
        dojoResults.push({ dojoId: run.dojoId, runId: run.runId, error: String(error?.message || error).slice(0, 300) });
      }
    }
    let result;
    await db().runTransaction(async (tx) => {
      const sub = await loadSub(tx, id);
      if (sub.openSortieId !== sortieId) throw new Error('Sortie ' + sortieId + ' is not the open sortie of this submarine');
      const confirmedBy = sub.mission?.confirmedBy || 'user';
      const haulIds = fresh.map((h, i) => {
        sub.counters.C = (sub.counters.C || 0) + 1;
        const haulId = seqId('C', sub.counters.C);
        put(tx, haulRef(id, haulId), {
          id: haulId, submarineId: id, ...h, status: confirmedBy === 'measurement' ? 'confirmed' : 'candidate',
          sortieId, foundAt: now(), decidedAt: confirmedBy === 'measurement' ? now() : null,
          dojoRef: h.ref || ('submarine:' + id + ':' + sortieId + ':' + (i + 1)),
          gear: h.gear.length ? h.gear : (sortie.loadout || []).filter((g) => g.role === 'primary').map((g) => g.kind + ':' + g.id),
          gearVersions: gearVersionsOf(sortie), missionRevision: sortie.missionRevision || null,
          dojoIds: (sortie.dojoRuns || []).map((r) => r.dojoId),
        });
        return haulId;
      });
      linkable.forEach(({ raw, haul }) => {
        put(tx, haulRef(id, haul.id), {
          ...haul, sortieId, evidence: raw.evidence || haul.evidence, sourceIds: raw.sourceIds,
          ...(raw.details ? { details: raw.details } : {}), gearVersions: gearVersionsOf(sortie), missionRevision: sortie.missionRevision || null,
          gear: raw.gear.length ? raw.gear : (sortie.loadout || []).filter((g) => g.role === 'primary').map((g) => g.kind + ':' + g.id),
          dojoIds: (sortie.dojoRuns || []).map((r) => r.dojoId),
        });
        haulIds.push(haul.id);
      });
      const chartIds = chartAdds.map((entry) => {
        sub.counters.F = (sub.counters.F || 0) + 1;
        const chartId = seqId('F', sub.counters.F);
        sub.chart = [...(sub.chart || []), { id: chartId, status: 'open', createdAt: now(), ...entry }].slice(-80);
        return chartId;
      });
      const moved = haulIds.length > 0 || chartIds.length > 0 || dojoResults.some((r) => r.moved);
      const newHaul = haulIds.length - linkable.length;
      sub.stalledSorties = moved ? 0 : (sub.stalledSorties || 0) + 1;
      sub.sortieCount = (sub.sortieCount || 0) + 1;
      sub.openSortieId = null;
      if (confirmedBy === 'measurement') sub.progress.confirmedCount = (sub.progress.confirmedCount || 0) + newHaul;
      else sub.progress.candidateCount = (sub.progress.candidateCount || 0) + newHaul;
      const finished = {
        ...sortie, status: 'finished', finishedAt: now(), summary, haulIds, chartIds, duplicates, dojoResults, moved,
        notMovedReason: moved ? '' : text(input.notMovedReason, 1000, 'notMovedReason (nothing came back; say why)', true),
        nextStep: text(input.nextStep, 800, 'nextStep', false), costNote: text(input.costNote, 400, 'costNote', false),
      };
      put(tx, sortieRef(id, sortieId), finished);
      result = {
        id: sortieId, finishedAt: finished.finishedAt, objective: sortie.objective, summary: summary.slice(0, 400),
        haulCount: haulIds.length, chartCount: chartIds.length, duplicates, moved, dojoResults, nextStep: finished.nextStep,
      };
      sub.lastSorties = [result, ...(sub.lastSorties || [])].slice(0, 5);
      logEvent(sub, moved ? 'sortie_finished' : 'sortie_stalled', sortieId + ': ' + summary, input.actor);
      saveSub(tx, sub);
    });
    return { sortie: result, brief: await get({ id }) };
  }

  // The 道場 a haul item reports to, with the version of their gear that produced it (null when it was not
  // brought back by a recorded sortie, e.g. a Discover entry indexed from before the submarine existed).
  async function dojoTargets(sub, haul) {
    const fromSortie = (haul.gearVersions || []).filter((g) => g.dojoId);
    if (fromSortie.length) return fromSortie;
    const index = await dojoIndex().catch(() => new Map());
    return (sub.loadout || []).filter((g) => g.train).map((g) => bind(g, index)).filter((b) => b.dojoId)
      .map((b) => ({ gear: b.kind + ':' + b.id, dojoId: b.dojoId, version: null, dojoRunId: null }));
  }

  // Send the user's evaluation (action and/or comment) to every 道場 whose gear produced the item.
  async function forwardFeedback(sub, haul, feedback, actor) {
    if (typeof dojo().recordFeedback !== 'function') return;
    const seen = new Set();
    for (const t of await dojoTargets(sub, haul)) {
      if (seen.has(t.dojoId)) continue; seen.add(t.dojoId);
      await dojo().recordFeedback({
        baseId: t.dojoId, ref: haul.dojoRef || haul.ref || ('submarine:' + sub.id + ':' + haul.id), label: haul.label,
        version: t.version, gear: t.gear, decision: feedback.decision, actionLabel: feedback.actionLabel, comment: feedback.comment,
        submarineId: sub.id, haulId: haul.id, sortieId: haul.sortieId || '', runId: t.dojoRunId || '', actor,
      }).catch(() => null);
    }
  }

  // Mirror a decision on a haul item to the 道場 that trained the gear used to find it.
  async function mirror(sub, haul, liked, actor) {
    const versioned = (haul.gearVersions || []).filter((g) => g.dojoId);
    if (versioned.length) {
      for (const t of versioned) {
        await dojo().recordUserReaction({ baseId: t.dojoId, ref: haul.dojoRef || haul.ref || ('submarine:' + sub.id + ':' + haul.id), label: haul.label, liked, version: t.version, runId: t.dojoRunId || '', evidence: '潜水艦「' + sub.name + '」の成果 ' + haul.id + '（' + t.gear + ' v' + t.version + '）を本人が確定: ' + (haul.evidence || '').slice(0, 300), actor }).catch(() => null);
      }
      return;
    }
    const dojoIds = haul.dojoIds && haul.dojoIds.length ? haul.dojoIds
      : (sub.loadout || []).filter((g) => g.train && g.role === 'primary').map((g) => g.dojoId).filter(Boolean);
    let ids = dojoIds;
    if (!ids.length) {
      const index = await dojoIndex().catch(() => new Map());
      ids = (sub.loadout || []).filter((g) => g.train).map((g) => bind(g, index).dojoId).filter(Boolean);
    }
    for (const dojoId of [...new Set(ids)]) {
      await dojo().recordUserReaction({ baseId: dojoId, ref: haul.dojoRef || haul.ref || ('submarine:' + sub.id + ':' + haul.id), label: haul.label, liked, evidence: '潜水艦「' + sub.name + '」の成果 ' + haul.id + ' を本人が確定: ' + (haul.evidence || '').slice(0, 300), actor }).catch(() => null);
    }
  }

  async function decide(sub, haul, decision, note, actor) {
    const at = now();
    await db().runTransaction(async (tx) => {
      const fresh = await loadSub(tx, sub.id);
      const current = value(await tx.get(haulRef(sub.id, haul.id)));
      const before = current.status;
      if (before === decision) return;
      put(tx, haulRef(sub.id, haul.id), { ...current, status: decision, decidedAt: at, decisionNote: note });
      const counts = { confirmed: 'confirmedCount', candidate: 'candidateCount' };
      fresh.progress = fresh.progress || { confirmedCount: 0, candidateCount: 0 };
      if (counts[before]) fresh.progress[counts[before]] = Math.max(0, (fresh.progress[counts[before]] || 0) - 1);
      if (counts[decision]) fresh.progress[counts[decision]] = (fresh.progress[counts[decision]] || 0) + 1;
      logEvent(fresh, 'haul_' + decision, haul.id + ': ' + haul.label, actor);
      saveSub(tx, fresh);
    });
    await mirror(sub, haul, decision === 'confirmed', actor);
  }

  async function haulDecide(input) {
    const id = requireId(input?.submarineId, 'submarineId');
    const note = authorization(input, 'Confirming or declining haul');
    const decision = oneOf(input.decision, ['confirmed', 'declined'], 'decision');
    const sub = value(await subRef(id).get());
    if (!sub) throw new Error('Submarine not found: ' + id);
    const haulId = text(input.haulId, 20, 'haulId', true);
    const haul = value(await haulRef(id, haulId).get());
    if (!haul) throw new Error('Haul not found: ' + haulId);
    await decide(sub, haul, decision, text(input.note, 800, 'note', false) || note, input.actor || 'user');
    return get({ id });
  }

  // A reaction the user gives in an app (e.g. 好き in Discover) decides the haul item with that ref. A like on
  // something the submarine never logged is brought aboard as confirmed haul. No-op without the submarine.
  async function recordReaction(input) {
    const id = requireId(input?.submarineId, 'submarineId');
    const ref = text(input.ref, 600, 'ref', true);
    const liked = input.liked === true;
    const sub = value(await subRef(id).get());
    if (!sub || sub.status === 'decommissioned') return { submarineId: id, changed: false };
    const snap = await db().collection(COLLECTIONS.haul).where('ref', '==', ref).limit(20).get();
    let haul = snap.docs.map((doc) => doc.data()).find((h) => h.submarineId === id) || null;
    if (!haul) {
      if (!liked) return { submarineId: id, changed: false };
      await db().runTransaction(async (tx) => {
        const fresh = await loadSub(tx, id);
        fresh.counters.C = (fresh.counters.C || 0) + 1;
        haul = {
          id: seqId('C', fresh.counters.C), submarineId: id, label: text(input.label, 300, 'label', true), ref, url: text(input.url, 1000, 'url', false),
          evidence: text(input.evidence, 2000, 'evidence', false) || 'The user reacted in the app.', status: 'candidate', sortieId: null,
          foundAt: now(), decidedAt: null, dojoRef: ref, gear: [], dojoIds: [],
        };
        put(tx, haulRef(id, haul.id), haul);
        fresh.progress = fresh.progress || { confirmedCount: 0, candidateCount: 0 };
        fresh.progress.candidateCount = (fresh.progress.candidateCount || 0) + 1;
        saveSub(tx, fresh);
      });
    }
    const decision = liked ? 'confirmed' : (haul.status === 'confirmed' ? 'candidate' : haul.status);
    if (decision === haul.status) return { submarineId: id, changed: false, haulId: haul.id };
    await decide(sub, haul, decision, text(input.note, 800, 'note', false) || 'アプリでの本人の反応', input.actor || 'user');
    return { submarineId: id, changed: true, haulId: haul.id, status: decision };
  }

  // The whole fleet's haul as a timeline, one page at a time. Only the page's own records are read from the
  // canonical stores (never a full scan), and the per-submarine counts come from each submarine's own counters.
  async function haulList(input) {
    const status = text(input?.status, 20, 'status', false);
    const submarineId = text(input?.submarineId, 80, 'submarineId', false);
    const limit = Math.min(Math.max(Number(input?.limit) || 15, 1), 50);
    const offset = Math.max(Number.parseInt(text(input?.cursor, 12, 'cursor', false) || '0', 10) || 0, 0);
    const subsSnap = await db().collection(COLLECTIONS.subs).limit(200).get();
    const subList = subsSnap.docs.map((doc) => doc.data());
    const names = new Map(subList.map((s) => [s.id, { id: s.id, name: s.name, hull: s.hull || '', where: s.haulCanonical?.where || 'here' }]));
    const actionsBySubmarine = Object.fromEntries(subList.map((s) => [s.id, actionsFor(s)]));
    let query = db().collection(COLLECTIONS.haul);
    if (submarineId) query = query.where('submarineId', '==', submarineId);
    else if (DECISIONS.includes(status)) query = query.where('status', '==', status);
    const snap = await query.limit(3000).get();
    const decided = status === 'decided';
    const matching = snap.docs.map((doc) => doc.data())
      .filter((h) => (!status || status === 'all' ? true : decided ? h.status !== 'candidate' : h.status === status))
      .filter((h) => !submarineId || h.submarineId === submarineId)
      .sort((a, b) => String((decided ? b.decidedAt : null) || b.foundAt).localeCompare(String((decided ? a.decidedAt : null) || a.foundAt)));
    const page = matching.slice(offset, offset + limit);
    const items = await Promise.all(page.map(async (h) => {
      const where = names.get(h.submarineId)?.where || 'here';
      let record = h.details ? recordOf(h) : null;
      if (!record && canonical.syncable(where) && h.ref && h.ref.startsWith(where + ':')) {
        const adapter = canonical.adapterFor(where);
        if (typeof adapter.one === 'function') {
          try { record = (await adapter.one(h.ref.slice(where.length + 1)))?.record || null; } catch (error) { record = null; }
        }
      }
      return { ...h, record, submarine: names.get(h.submarineId) || { id: h.submarineId, name: h.submarineId, hull: '', where: 'here' } };
    }));
    const counts = Object.fromEntries(subList.map((s) => [s.id, { candidate: s.progress?.candidateCount || 0, confirmed: s.progress?.confirmedCount || 0 }]));
    const next = offset + limit < matching.length ? String(offset + limit) : null;
    return { items, count: items.length, total: matching.length, nextCursor: next, actionsBySubmarine, counts };
  }

  return { commission, list: listSubs, workspaceStatus, get, update, sortieStart, sortieFinish, haulDecide, haulFeedback, recordReaction, haulList };
}

const store = createStore();
module.exports = { ...store, createStore, COLLECTIONS, PROTOCOL };
