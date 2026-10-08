'use strict';

const { getDocumentDb, FieldValue } = require('./documentDb');
const policy = require('./organizationLifecycle');

const DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const ORGANIZATIONS = 'memos/agent-control/organizations';
const JOBS = 'memos/agent-control/managerJobs';
const RUNS = 'memos/agent-control/managerRuns';
const WORK = 'memos/agent-control/workItems';

const db = () => getDocumentDb(DATABASE_ID);
const clean = (value, max = 12000) => String(value ?? '').trim().slice(0, max);
const safe = (value) => JSON.parse(JSON.stringify(value === undefined ? {} : value));
const obj = (snapshot) => snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
const idOf = (value) => {
  const id = clean(value, 80);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)) {
    throw new Error('Organization ID must be a stable lowercase slug (3-80 chars)');
  }
  return id;
};

async function organizationGet(input) {
  const id = idOf(input.id);
  const snapshot = await db().collection(ORGANIZATIONS).doc(id).get();
  if (!snapshot.exists) throw new Error('Organization not found: ' + id);
  return obj(snapshot);
}

async function organizationList(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const status = clean(input.status, 60);
  const q = clean(input.query, 250).toLowerCase();
  const snapshot = await db().collection(ORGANIZATIONS).limit(250).get();
  const items = snapshot.docs.map(obj)
    .filter(item => (!status || item.status === status)
      && (!q || [item.id, item.title, item.mission, item.domain].some(v => String(v || '').toLowerCase().includes(q))))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit);
  return { items, count: items.length, scanned: snapshot.size };
}

async function organizationCreate(input) {
  const id = idOf(input.id);
  const title = clean(input.title, 300);
  const mission = clean(input.mission, 12000);
  if (!title || !mission) throw new Error('title and mission are required');
  const ref = db().collection(ORGANIZATIONS).doc(id);
  const now = FieldValue.serverTimestamp();
  await db().runTransaction(async tx => {
    const old = await tx.get(ref);
    if (old.exists) throw new Error('Organization already exists: ' + id);
    tx.set(ref, {
      title, mission,
      domain: clean(input.domain, 120),
      status: 'incubating',
      controlPlane: 'my-portal-agent-hq',
      projectId: clean(input.projectId, 160) || null,
      systemOfRecord: clean(input.systemOfRecord, 240),
      outcomeContract: safe(input.outcomeContract || {}),
      operatingPolicy: safe(input.operatingPolicy || {}),
      evidenceSources: (Array.isArray(input.evidenceSources) ? input.evidenceSources : []).map(v => clean(v, 500)).filter(Boolean).slice(0, 30),
      graduation: null,
      history: [{ event: 'created', at: new Date().toISOString(), reason: 'Incubation started' }],
      revision: 1, createdAt: now, updatedAt: now,
    });
  });
  return organizationGet({ id });
}

async function organizationUpdate(input) {
  const id = idOf(input.id);
  const patch = input.patch || {};
  if (patch.controlPlane !== undefined || patch.graduation !== undefined || patch.handoff !== undefined) {
    throw new Error('Control plane ownership is managed only by organization_graduate');
  }
  if (patch.status === 'independent') throw new Error('Use organization_graduate');
  const allowed = new Set(['title', 'mission', 'domain', 'status', 'projectId', 'systemOfRecord', 'outcomeContract', 'operatingPolicy', 'evidenceSources']);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error('Unsupported organization field: ' + key);
  const ref = db().collection(ORGANIZATIONS).doc(id);
  await db().runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Organization not found: ' + id);
    const current = snapshot.data();
    if (current.status === 'independent') throw new Error('Independent organization is read-only in HQ');
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) throw new Error('Revision conflict');
    if (patch.status !== undefined) policy.validateLifecycleTransition(current.status, patch.status);
    const changingMission = patch.mission !== undefined && clean(patch.mission) !== current.mission;
    if (changingMission && !input.humanApproval) throw new Error('Mission change needs explicit human approval');
    const next = {};
    if (patch.title !== undefined) next.title = clean(patch.title, 300);
    if (patch.mission !== undefined) next.mission = clean(patch.mission, 12000);
    if (patch.domain !== undefined) next.domain = clean(patch.domain, 120);
    if (patch.projectId !== undefined) next.projectId = clean(patch.projectId, 160) || null;
    if (patch.systemOfRecord !== undefined) next.systemOfRecord = clean(patch.systemOfRecord, 240);
    if (patch.outcomeContract !== undefined) next.outcomeContract = safe(patch.outcomeContract);
    if (patch.operatingPolicy !== undefined) next.operatingPolicy = safe(patch.operatingPolicy);
    if (patch.evidenceSources !== undefined) next.evidenceSources = (patch.evidenceSources || []).map(v => clean(v, 500)).filter(Boolean).slice(0, 30);
    if (patch.status !== undefined) next.status = patch.status;
    if (Object.keys(next).length === 0) throw new Error('No organization fields to update');
    const history = [...(current.history || []), {
      event: next.status && next.status !== current.status ? 'status_changed' : 'updated',
      at: new Date().toISOString(),
      from: current.status, to: next.status || current.status,
      reason: clean(input.reason, 1000),
      previous: { mission: current.mission, outcomeContract: current.outcomeContract, operatingPolicy: current.operatingPolicy },
    }].slice(-30);
    tx.update(ref, { ...next, history, revision: Number(current.revision || 1) + 1, updatedAt: FieldValue.serverTimestamp() });
  });
  return organizationGet({ id });
}

async function organizationGraduate(input) {
  const id = idOf(input.id);
  const handoff = input.handoff || {};
  const normalizedHandoff = {
    targetSystem: clean(handoff.targetSystem, 240),
    canonicalOwner: clean(handoff.canonicalOwner, 240),
    verifiedAt: clean(handoff.verifiedAt, 80),
    evidence: (Array.isArray(handoff.evidence) ? handoff.evidence : []).map(v => clean(v, 1200)).filter(Boolean).slice(0, 30),
    humanApproval: clean(handoff.humanApproval, 500),
  };
  const database = db();
  const ref = database.collection(ORGANIZATIONS).doc(id);
  const jobQuery = database.collection(JOBS).where('organizationId', '==', id).limit(200);
  // Execute graduation checks and ownership change in one transaction; Manager
  // start/delegation also reads this organization doc in its transaction.
  await database.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Organization not found: ' + id);
    const current = snap.data();
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) throw new Error('Revision conflict');
    const jobSnapshot = await tx.get(jobQuery);
    if (jobSnapshot.size >= 200) throw new Error('Graduation check incomplete: too many linked Manager Jobs');
    const jobs = jobSnapshot.docs.map(obj);
    const managerRuns = [];
    const workItems = [];
    for (const job of jobs) {
      const runs = await tx.get(database.collection(RUNS).where('managerJobId', '==', job.id).limit(1000));
      const work = await tx.get(database.collection(WORK).where('sourceId', '==', job.id).limit(1000));
      if (runs.size >= 1000 || work.size >= 1000) {
        throw new Error('Graduation check incomplete: bounded history limit reached');
      }
      managerRuns.push(...runs.docs.map(obj));
      workItems.push(...work.docs.map(obj));
    }
    policy.validateGraduation({
      organization: current, managerJobs: jobs,
      managerRuns, workItems, handoff: normalizedHandoff,
    });
    tx.update(ref, {
      status: 'independent',
      controlPlane: normalizedHandoff.targetSystem,
      graduation: normalizedHandoff,
      independentAt: FieldValue.serverTimestamp(),
      history: [...(current.history || []), {
        event: 'graduated', at: new Date().toISOString(),
        reason: 'HQ authority ended; ownership transferred to ' + normalizedHandoff.canonicalOwner,
      }].slice(-30),
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return organizationGet({ id });
}

module.exports = { ORGANIZATIONS, organizationGet, organizationList, organizationCreate, organizationUpdate, organizationGraduate };
