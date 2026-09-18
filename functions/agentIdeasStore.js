const { createHash } = require('node:crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTIONS = Object.freeze({
  ideas: 'agent_ideas',
  categories: 'agent_idea_categories',
  relations: 'agent_idea_relations',
  runs: 'agent_idea_runs',
  sources: 'agent_idea_sources',
  evaluations: 'agent_idea_evaluations',
  artifacts: 'agent_idea_artifacts',
});

const IDEA_STATUSES = ['active', 'paused', 'archived', 'promoted'];
const IDEA_MATURITY = ['seed', 'exploring', 'developed', 'validated', 'execution_ready'];
const RUN_STATUSES = ['active', 'completed', 'paused', 'failed'];

function db() {
  return DATABASE_ID === '(default)' ? getFirestore() : getFirestore(DATABASE_ID);
}

function clampString(value, max = 12000) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().slice(0, max);
}

function stringArray(value, maxItems = 50, maxLen = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => clampString(item, maxLen))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function jsonSafe(value, depth = 0) {
  if (depth > 6) return '[max-depth]';
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 20000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => jsonSafe(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
      out[String(key).slice(0, 120)] = jsonSafe(item, depth + 1);
    });
    return out;
  }
  return String(value).slice(0, 20000);
}

function serialize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = serialize(item);
    return out;
  }
  return value;
}

function documentToObject(snapshot) {
  return snapshot.exists ? serialize({ id: snapshot.id, ...snapshot.data() }) : null;
}

function assertString(value, name, { min = 1, max = 12000 } = {}) {
  const normalized = clampString(value, max);
  if (!normalized || normalized.length < min) throw new Error(`${name} is required`);
  return normalized;
}

function assertEnum(value, allowed, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function createdBy(input = {}) {
  return {
    type: clampString(input.type, 30) || 'agent',
    agent: clampString(input.agent, 120) || 'chatgpt',
    model: clampString(input.model, 120) || null,
  };
}

function ideaPayload(input, actor = {}) {
  return {
    title: assertString(input.title, 'title', { max: 300 }),
    summary: clampString(input.summary, 3000) || '',
    content: clampString(input.content, 30000) || '',
    type: clampString(input.type, 80) || 'idea',
    status: assertEnum(input.status, IDEA_STATUSES, 'status', 'active'),
    maturity: assertEnum(input.maturity, IDEA_MATURITY, 'maturity', 'seed'),
    tags: stringArray(input.tags, 50, 80),
    domains: stringArray(input.domains, 30, 80),
    attributes: jsonSafe(input.attributes || {}),
    categoryId: clampString(input.categoryId, 160) || null,
    createdBy: createdBy(input.createdBy || actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    revision: 1,
  };
}

async function ideaCreate(input, actor = {}) {
  const database = db();
  const ref = database.collection(COLLECTIONS.ideas).doc();
  const payload = ideaPayload(input, actor);
  await ref.set({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (payload.categoryId) {
    const categoryRef = database.collection(COLLECTIONS.categories).doc(payload.categoryId);
    await database.runTransaction(async (tx) => {
      const categorySnapshot = await tx.get(categoryRef);
      if (!categorySnapshot.exists) return;
      const requestedCount = Math.max(0, Number(categorySnapshot.data().requestedCount || 0));
      if (requestedCount > 0) {
        tx.update(categoryRef, {
          requestedCount: requestedCount - 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  }

  return documentToObject(await ref.get());
}

async function ideaGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.ideas).doc(id).get();
  if (!snapshot.exists) throw new Error(`Idea not found: ${id}`);
  return documentToObject(snapshot);
}

async function ideaSearch(input = {}) {
  const requestedLimit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(requestedLimit * 5, 100), requestedLimit), 500);
  const snapshot = await db().collection(COLLECTIONS.ideas)
    .orderBy('updatedAt', 'desc')
    .limit(scanLimit)
    .get();

  const q = clampString(input.query, 300)?.toLowerCase();
  const status = input.status;
  const maturity = input.maturity;
  const tag = clampString(input.tag, 80)?.toLowerCase();
  const domain = clampString(input.domain, 80)?.toLowerCase();
  const agent = clampString(input.createdByAgent, 120)?.toLowerCase();
  const categoryId = clampString(input.categoryId, 160);

  const items = snapshot.docs
    .map(documentToObject)
    .filter((idea) => {
      if (status && idea.status !== status) return false;
      if (maturity && idea.maturity !== maturity) return false;
      if (tag && !(idea.tags || []).some((item) => String(item).toLowerCase() === tag)) return false;
      if (domain && !(idea.domains || []).some((item) => String(item).toLowerCase() === domain)) return false;
      if (agent && String(idea.createdBy?.agent || '').toLowerCase() !== agent) return false;
      if (categoryId && idea.categoryId !== categoryId) return false;
      if (q) {
        const haystack = [idea.title, idea.summary, idea.content, ...(idea.tags || []), ...(idea.domains || [])]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .slice(0, requestedLimit);

  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

async function ideaUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.ideas).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error(`Idea not found: ${id}`);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, actual ${current.revision || 1}`);
    }

    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 300 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 3000) || '';
    if (patch.content !== undefined) update.content = clampString(patch.content, 30000) || '';
    if (patch.type !== undefined) update.type = clampString(patch.type, 80) || 'idea';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, IDEA_STATUSES, 'patch.status', current.status);
    if (patch.maturity !== undefined) update.maturity = assertEnum(patch.maturity, IDEA_MATURITY, 'patch.maturity', current.maturity);
    if (patch.tags !== undefined) update.tags = stringArray(patch.tags, 50, 80);
    if (patch.domains !== undefined) update.domains = stringArray(patch.domains, 30, 80);
    if (patch.categoryId !== undefined) update.categoryId = clampString(patch.categoryId, 160) || null;
    if (patch.attributes !== undefined) update.attributes = jsonSafe(patch.attributes || {});
    if (patch.attributesPatch !== undefined) update.attributes = {
      ...(current.attributes || {}),
      ...jsonSafe(patch.attributesPatch || {}),
    };

    tx.update(ref, update);
  });

  return ideaGet({ id });
}

function relationId(fromIdeaId, type, toIdeaId) {
  return createHash('sha256').update(`${fromIdeaId}\n${type}\n${toIdeaId}`).digest('hex').slice(0, 40);
}

async function ideaLink(input, actor = {}) {
  const fromIdeaId = assertString(input.fromIdeaId, 'fromIdeaId', { max: 160 });
  const toIdeaId = assertString(input.toIdeaId, 'toIdeaId', { max: 160 });
  if (fromIdeaId === toIdeaId) throw new Error('Cannot link an idea to itself');
  const type = assertString(input.type, 'type', { max: 80 });
  const database = db();
  const [fromSnapshot, toSnapshot] = await database.getAll(
    database.collection(COLLECTIONS.ideas).doc(fromIdeaId),
    database.collection(COLLECTIONS.ideas).doc(toIdeaId),
  );
  if (!fromSnapshot.exists) throw new Error(`Idea not found: ${fromIdeaId}`);
  if (!toSnapshot.exists) throw new Error(`Idea not found: ${toIdeaId}`);

  const id = relationId(fromIdeaId, type, toIdeaId);
  const ref = database.collection(COLLECTIONS.relations).doc(id);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    fromIdeaId,
    toIdeaId,
    type,
    description: clampString(input.description, 3000) || '',
    createdBy: createdBy(input.createdBy || actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: existing.exists ? existing.data().createdAt : now,
    updatedAt: now,
  }, { merge: true });
  return documentToObject(await ref.get());
}

async function ideaExpand(input, actor = {}) {
  const parentIdeaId = assertString(input.parentIdeaId, 'parentIdeaId', { max: 160 });
  const candidates = Array.isArray(input.ideas) ? input.ideas.slice(0, 20) : [];
  if (!candidates.length) throw new Error('ideas must contain at least one idea');
  const database = db();
  const parent = await database.collection(COLLECTIONS.ideas).doc(parentIdeaId).get();
  if (!parent.exists) throw new Error(`Idea not found: ${parentIdeaId}`);
  const batch = database.batch();
  const createdRefs = [];
  const relationType = clampString(input.relationType, 80) || 'derived_from';

  candidates.forEach((candidate) => {
    const ideaRef = database.collection(COLLECTIONS.ideas).doc();
    const payload = ideaPayload({
      ...candidate,
      createdInRunId: candidate.createdInRunId || input.createdInRunId,
    }, actor);
    batch.set(ideaRef, {
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const relId = relationId(ideaRef.id, relationType, parentIdeaId);
    batch.set(database.collection(COLLECTIONS.relations).doc(relId), {
      fromIdeaId: ideaRef.id,
      toIdeaId: parentIdeaId,
      type: relationType,
      description: clampString(candidate.relationDescription || input.relationDescription, 3000) || '',
      createdBy: createdBy(actor),
      createdInRunId: clampString(input.createdInRunId, 160) || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    createdRefs.push(ideaRef);
  });
  await batch.commit();
  const snapshots = await database.getAll(...createdRefs);
  return { parentIdeaId, items: snapshots.map(documentToObject), count: snapshots.length };
}

async function ideaMerge(input, actor = {}) {
  const sourceIdeaIds = stringArray(input.sourceIdeaIds, 20, 160);
  if (sourceIdeaIds.length < 2) throw new Error('sourceIdeaIds must contain at least two idea IDs');
  const database = db();
  const refs = sourceIdeaIds.map((id) => database.collection(COLLECTIONS.ideas).doc(id));
  const snapshots = await database.getAll(...refs);
  const missing = snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.id);
  if (missing.length) throw new Error(`Ideas not found: ${missing.join(', ')}`);

  const merged = await ideaCreate({
    ...input.idea,
    createdInRunId: input.createdInRunId || input.idea?.createdInRunId,
  }, actor);
  const batch = database.batch();
  sourceIdeaIds.forEach((sourceId) => {
    const type = clampString(input.relationType, 80) || 'combined_from';
    const id = relationId(merged.id, type, sourceId);
    batch.set(database.collection(COLLECTIONS.relations).doc(id), {
      fromIdeaId: merged.id,
      toIdeaId: sourceId,
      type,
      description: clampString(input.relationDescription, 3000) || '',
      createdBy: createdBy(actor),
      createdInRunId: clampString(input.createdInRunId, 160) || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return { idea: merged, sourceIdeaIds };
}

async function ideaArchive(input) {
  const reason = clampString(input.reason, 2000);
  return ideaUpdate({
    id: input.id,
    expectedRevision: input.expectedRevision,
    patch: {
      status: 'archived',
      attributesPatch: reason ? { archiveReason: reason } : {},
    },
  });
}

async function loadRelationsForIdea(ideaId) {
  const database = db();
  const [outgoing, incoming] = await Promise.all([
    database.collection(COLLECTIONS.relations).where('fromIdeaId', '==', ideaId).limit(100).get(),
    database.collection(COLLECTIONS.relations).where('toIdeaId', '==', ideaId).limit(100).get(),
  ]);
  const map = new Map();
  [...outgoing.docs, ...incoming.docs].forEach((snapshot) => map.set(snapshot.id, documentToObject(snapshot)));
  return [...map.values()];
}

async function ideaGetContext(input) {
  const rootId = assertString(input.id, 'id', { max: 160 });
  const depth = Math.min(Math.max(Number(input.depth) || 1, 0), 2);
  const maxNeighbors = Math.min(Math.max(Number(input.maxNeighbors) || 40, 1), 80);
  const database = db();
  const rootSnapshot = await database.collection(COLLECTIONS.ideas).doc(rootId).get();
  if (!rootSnapshot.exists) throw new Error(`Idea not found: ${rootId}`);

  const ideas = new Map([[rootId, documentToObject(rootSnapshot)]]);
  const relations = new Map();
  let frontier = [rootId];

  for (let level = 0; level < depth && frontier.length && ideas.size <= maxNeighbors; level += 1) {
    const nextIds = new Set();
    for (const ideaId of frontier) {
      const linked = await loadRelationsForIdea(ideaId);
      linked.forEach((relation) => {
        relations.set(relation.id, relation);
        const otherId = relation.fromIdeaId === ideaId ? relation.toIdeaId : relation.fromIdeaId;
        if (!ideas.has(otherId)) nextIds.add(otherId);
      });
      if (ideas.size + nextIds.size >= maxNeighbors) break;
    }
    const ids = [...nextIds].slice(0, Math.max(0, maxNeighbors - ideas.size));
    if (!ids.length) break;
    const snapshots = await database.getAll(...ids.map((id) => database.collection(COLLECTIONS.ideas).doc(id)));
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => ideas.set(snapshot.id, documentToObject(snapshot)));
    frontier = snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id);
  }

  async function listByIdea(collectionName, enabled) {
    if (!enabled) return [];
    const snapshot = await database.collection(collectionName).where('ideaId', '==', rootId).limit(100).get();
    return snapshot.docs.map(documentToObject);
  }

  const [sources, evaluations, artifacts] = await Promise.all([
    listByIdea(COLLECTIONS.sources, input.includeSources !== false),
    listByIdea(COLLECTIONS.evaluations, input.includeEvaluations !== false),
    listByIdea(COLLECTIONS.artifacts, Boolean(input.includeArtifacts)),
  ]);

  const runIds = new Set();
  if (input.includeRuns !== false) {
    ideas.forEach((idea) => { if (idea.createdInRunId) runIds.add(idea.createdInRunId); });
    relations.forEach((relation) => { if (relation.createdInRunId) runIds.add(relation.createdInRunId); });
  }
  const runSnapshots = runIds.size
    ? await database.getAll(...[...runIds].slice(0, 30).map((id) => database.collection(COLLECTIONS.runs).doc(id)))
    : [];

  return {
    root: ideas.get(rootId),
    ideas: [...ideas.values()],
    relations: [...relations.values()],
    sources,
    evaluations,
    artifacts,
    runs: runSnapshots.filter((snapshot) => snapshot.exists).map(documentToObject),
    depth,
  };
}

async function runStart(input, actor = {}) {
  const ref = db().collection(COLLECTIONS.runs).doc();
  await ref.set({
    agent: clampString(input.agent, 120) || actor.agent || 'chatgpt',
    model: clampString(input.model, 120) || actor.model || null,
    objective: assertString(input.objective, 'objective', { max: 6000 }),
    instructions: clampString(input.instructions, 12000) || '',
    trigger: clampString(input.trigger, 80) || 'chat',
    status: 'active',
    seedIdeaIds: stringArray(input.seedIdeaIds, 50, 160),
    spaceId: clampString(input.spaceId, 160) || null,
    createdIdeaIds: [],
    updatedIdeaIds: [],
    findings: [],
    nextActions: [],
    metadata: jsonSafe(input.metadata || {}),
    revision: 1,
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function runFinish(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const status = assertEnum(input.status, RUN_STATUSES, 'status', 'completed');
  const ref = db().collection(COLLECTIONS.runs).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error(`Run not found: ${id}`);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, actual ${current.revision || 1}`);
    }
    tx.update(ref, {
      status,
      createdIdeaIds: [...new Set([...(current.createdIdeaIds || []), ...stringArray(input.createdIdeaIds, 200, 160)])],
      updatedIdeaIds: [...new Set([...(current.updatedIdeaIds || []), ...stringArray(input.updatedIdeaIds, 200, 160)])],
      findings: [...(current.findings || []), ...stringArray(input.findings, 100, 3000)].slice(-200),
      nextActions: [...(current.nextActions || []), ...stringArray(input.nextActions, 100, 3000)].slice(-200),
      metadata: { ...(current.metadata || {}), ...jsonSafe(input.metadataPatch || {}) },
      revision: Number(current.revision || 1) + 1,
      finishedAt: ['completed', 'failed'].includes(status) ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return documentToObject(await ref.get());
}

async function sourceAdd(input, actor = {}) {
  const ideaId = assertString(input.ideaId, 'ideaId', { max: 160 });
  const idea = await ideaGet({ id: ideaId });
  const ref = db().collection(COLLECTIONS.sources).doc();
  await ref.set({
    ideaId,
    spaceId: clampString(input.spaceId, 160) || idea.spaceId || null,
    type: clampString(input.type, 80) || 'web',
    url: clampString(input.url, 3000) || '',
    title: clampString(input.title, 1000) || '',
    quote: clampString(input.quote, 5000) || '',
    summary: clampString(input.summary, 12000) || '',
    metadata: jsonSafe(input.metadata || {}),
    addedBy: createdBy(input.addedBy || actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function evaluationAdd(input, actor = {}) {
  const ideaId = assertString(input.ideaId, 'ideaId', { max: 160 });
  const idea = await ideaGet({ id: ideaId });
  const ref = db().collection(COLLECTIONS.evaluations).doc();
  await ref.set({
    ideaId,
    spaceId: clampString(input.spaceId, 160) || idea.spaceId || null,
    evaluator: clampString(input.evaluator, 120) || actor.agent || 'chatgpt',
    criteria: jsonSafe(input.criteria || {}),
    comment: clampString(input.comment, 12000) || '',
    metadata: jsonSafe(input.metadata || {}),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function artifactAdd(input, actor = {}) {
  const ideaId = clampString(input.ideaId, 160) || null;
  const idea = ideaId ? await ideaGet({ id: ideaId }) : null;
  const ref = db().collection(COLLECTIONS.artifacts).doc();
  await ref.set({
    ideaId,
    spaceId: clampString(input.spaceId, 160) || idea?.spaceId || null,
    type: clampString(input.type, 80) || 'document',
    title: assertString(input.title, 'title', { max: 1000 }),
    content: clampString(input.content, 50000) || '',
    url: clampString(input.url, 3000) || '',
    metadata: jsonSafe(input.metadata || {}),
    createdBy: createdBy(input.createdBy || actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}


function categoryIdFromName(name) {
  return createHash('sha256').update(String(name || '').trim().toLowerCase()).digest('hex').slice(0, 24);
}

async function categoryUpsert(input = {}) {
  const database = db();
  const name = assertString(input.name, 'name', { max: 160 });
  const id = clampString(input.id, 160) || categoryIdFromName(name);
  const ref = database.collection(COLLECTIONS.categories).doc(id);

  await database.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? snapshot.data() : {};
    const currentRevision = Number(current.revision || 0);
    if (input.expectedRevision !== undefined && currentRevision > 0
      && Number(input.expectedRevision) !== currentRevision) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, actual ${currentRevision}`);
    }

    const payload = {
      name,
      description: clampString(input.description, 3000) ?? current.description ?? '',
      instructions: clampString(input.instructions, 12000) ?? current.instructions ?? '',
      tags: input.tags !== undefined ? stringArray(input.tags, 30, 80) : (current.tags || []),
      targetCount: input.targetCount !== undefined
        ? Math.min(Math.max(Number(input.targetCount) || 0, 0), 500)
        : Math.min(Math.max(Number(current.targetCount) || 12, 0), 500),
      requestedCount: Math.min(Math.max(Number(current.requestedCount) || 0, 0), 500),
      status: ['active', 'paused', 'archived'].includes(input.status)
        ? input.status
        : (current.status || 'active'),
      revision: currentRevision + 1 || 1,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (snapshot.exists) {
      tx.set(ref, payload, { merge: true });
    } else {
      tx.set(ref, { ...payload, createdAt: FieldValue.serverTimestamp() });
    }
  });

  return documentToObject(await ref.get());
}

async function categoryList(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 300);
  const snapshot = await db().collection(COLLECTIONS.categories).limit(limit).get();
  const items = snapshot.docs
    .map(documentToObject)
    .filter((item) => !input.status || item.status === input.status)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
  return { items, count: items.length };
}

async function requestReplenishment(input = {}) {
  const categoryId = assertString(input.categoryId, 'categoryId', { max: 160 });
  const count = Math.min(Math.max(Number(input.count) || 5, 1), 100);
  const database = db();
  const ref = database.collection(COLLECTIONS.categories).doc(categoryId);

  await database.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error(`Category not found: ${categoryId}`);
    const current = snapshot.data();
    tx.update(ref, {
      requestedCount: Math.min(500, Math.max(0, Number(current.requestedCount || 0)) + count),
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return documentToObject(await ref.get());
}

async function generationWork(input = {}) {
  const database = db();
  const [categorySnapshot, ideaSnapshot] = await Promise.all([
    database.collection(COLLECTIONS.categories).limit(300).get(),
    database.collection(COLLECTIONS.ideas).limit(1000).get(),
  ]);

  const activeCounts = new Map();
  ideaSnapshot.docs.map(documentToObject).forEach((idea) => {
    if (!idea.categoryId || idea.status !== 'active') return;
    activeCounts.set(idea.categoryId, (activeCounts.get(idea.categoryId) || 0) + 1);
  });

  const categoryId = clampString(input.categoryId, 160);
  const items = categorySnapshot.docs
    .map(documentToObject)
    .filter((category) => category.status === 'active')
    .filter((category) => !categoryId || category.id === categoryId)
    .map((category) => {
      const activeCount = activeCounts.get(category.id) || 0;
      const targetCount = Math.max(0, Number(category.targetCount || 0));
      const requestedCount = Math.max(0, Number(category.requestedCount || 0));
      const targetShortage = Math.max(0, targetCount - activeCount);
      return {
        ...category,
        activeCount,
        targetShortage,
        neededCount: Math.max(targetShortage, requestedCount),
      };
    })
    .filter((category) => input.includeSatisfied === true || category.neededCount > 0)
    .sort((a, b) => b.neededCount - a.neededCount || String(a.name || '').localeCompare(String(b.name || ''), 'ja'));

  return {
    items,
    count: items.length,
    totalNeeded: items.reduce((sum, item) => sum + item.neededCount, 0),
  };
}

async function healthCheck() {
  const started = Date.now();
  const snapshot = await db().collection(COLLECTIONS.ideas).limit(1).get();
  return {
    ok: true,
    databaseId: DATABASE_ID,
    collections: Object.values(COLLECTIONS),
    sampleIdeaCount: snapshot.size,
    latencyMs: Date.now() - started,
  };
}

module.exports = {
  DATABASE_ID,
  COLLECTIONS,
  IDEA_STATUSES,
  IDEA_MATURITY,
  RUN_STATUSES,
  serialize,
  healthCheck,
  ideaCreate,
  ideaGet,
  ideaSearch,
  ideaUpdate,
  ideaExpand,
  ideaLink,
  ideaGetContext,
  ideaMerge,
  ideaArchive,
  runStart,
  runFinish,
  sourceAdd,
  evaluationAdd,
  artifactAdd,
  categoryUpsert,
  categoryList,
  requestReplenishment,
  generationWork,
};
