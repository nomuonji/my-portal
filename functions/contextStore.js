const { createHash } = require('node:crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const agentStore = require('./agentIdeasStore');

const DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTIONS = Object.freeze({
  spaces: 'spaces',
  profileFacts: 'profileFacts',
  decisions: 'decisions',
  opportunities: 'opportunities',
});

const SPACE_STATUSES = ['active', 'paused', 'completed', 'archived'];
const PROFILE_EVIDENCE_TYPES = ['explicit', 'inferred', 'confirmed_inference'];
const PROFILE_STABILITY = ['temporary', 'contextual', 'stable'];
const PROFILE_STATUSES = ['active', 'superseded', 'archived'];
const DECISION_TYPES = ['adopt', 'reject', 'hold', 'defer', 'supersede'];
const DECISION_STATUSES = ['active', 'superseded', 'reversed'];
const OPPORTUNITY_STATUSES = ['active', 'watching', 'paused', 'closed', 'rejected', 'completed'];

function db() {
  return DATABASE_ID === '(default)' ? getFirestore() : getFirestore(DATABASE_ID);
}

function clampString(value, max = 12000) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().slice(0, max);
}

function stringArray(value, maxItems = 50, maxLen = 240) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clampString(item, maxLen)).filter(Boolean))].slice(0, maxItems);
}

function jsonSafe(value, depth = 0) {
  if (depth > 6) return '[max-depth]';
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 30000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => jsonSafe(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
      out[String(key).slice(0, 120)] = jsonSafe(item, depth + 1);
    });
    return out;
  }
  return String(value).slice(0, 30000);
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

function sortRecent(items) {
  return [...items].sort((a, b) => {
    const left = Date.parse(a.updatedAt || a.createdAt || a.startedAt || '') || 0;
    const right = Date.parse(b.updatedAt || b.createdAt || b.startedAt || '') || 0;
    return right - left;
  });
}

function spacePayload(input) {
  return {
    title: assertString(input.title, 'title', { max: 300 }),
    summary: clampString(input.summary, 5000) || '',
    goal: clampString(input.goal, 8000) || '',
    status: assertEnum(input.status, SPACE_STATUSES, 'status', 'active'),
    currentBrief: clampString(input.currentBrief, 16000) || '',
    nextActions: stringArray(input.nextActions, 100, 3000),
    tags: stringArray(input.tags, 50, 100),
    domains: stringArray(input.domains, 30, 100),
    revision: 1,
  };
}

async function spaceCreate(input) {
  const ref = db().collection(COLLECTIONS.spaces).doc();
  await ref.set({
    ...spacePayload(input),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function spaceGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.spaces).doc(id).get();
  if (!snapshot.exists) throw new Error(`Space not found: ${id}`);
  return documentToObject(snapshot);
}

async function spaceUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.spaces).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error(`Space not found: ${id}`);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, actual ${current.revision || 1}`);
    }
    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 300 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 5000) || '';
    if (patch.goal !== undefined) update.goal = clampString(patch.goal, 8000) || '';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, SPACE_STATUSES, 'patch.status', current.status || 'active');
    if (patch.currentBrief !== undefined) update.currentBrief = clampString(patch.currentBrief, 16000) || '';
    if (patch.nextActions !== undefined) update.nextActions = stringArray(patch.nextActions, 100, 3000);
    if (patch.tags !== undefined) update.tags = stringArray(patch.tags, 50, 100);
    if (patch.domains !== undefined) update.domains = stringArray(patch.domains, 30, 100);
    tx.update(ref, update);
  });
  return spaceGet({ id });
}

async function spaceSearch(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 5, 100), limit), 500);
  const snapshot = await db().collection(COLLECTIONS.spaces).limit(scanLimit).get();
  const q = clampString(input.query, 300)?.toLowerCase();
  const status = input.status;
  const tag = clampString(input.tag, 100)?.toLowerCase();
  const domain = clampString(input.domain, 100)?.toLowerCase();
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((space) => {
      if (status && space.status !== status) return false;
      if (tag && !(space.tags || []).some((item) => String(item).toLowerCase() === tag)) return false;
      if (domain && !(space.domains || []).some((item) => String(item).toLowerCase() === domain)) return false;
      if (q) {
        const haystack = [space.title, space.summary, space.goal, space.currentBrief, ...(space.tags || []), ...(space.domains || [])]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .slice(0, limit);
  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

function profileFactId(input) {
  const material = [
    clampString(input.scope, 240) || 'global',
    clampString(input.category, 120) || 'general',
    clampString(input.statement, 4000) || '',
  ].join('\n').toLowerCase();
  return createHash('sha256').update(material).digest('hex').slice(0, 40);
}

async function profileFactUpsert(input) {
  const statement = assertString(input.statement, 'statement', { max: 4000 });
  const scope = clampString(input.scope, 240) || 'global';
  const category = clampString(input.category, 120) || 'general';
  const evidenceType = assertEnum(input.evidenceType, PROFILE_EVIDENCE_TYPES, 'evidenceType', 'explicit');
  const stability = assertEnum(input.stability, PROFILE_STABILITY, 'stability', 'contextual');
  const status = assertEnum(input.status, PROFILE_STATUSES, 'status', 'active');
  const confidenceValue = Number(input.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.min(Math.max(confidenceValue, 0), 1)
    : evidenceType === 'explicit' ? 1 : 0.6;
  const id = profileFactId({ statement, scope, category });
  const ref = db().collection(COLLECTIONS.profileFacts).doc(id);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    statement,
    scope,
    category,
    evidenceType,
    confidence,
    stability,
    status,
    source: jsonSafe(input.source ?? null),
    sourceRunId: clampString(input.sourceRunId, 160) || null,
    lastConfirmedAt: evidenceType === 'inferred'
      ? (existing.exists ? existing.data().lastConfirmedAt || null : null)
      : now,
    createdAt: existing.exists ? existing.data().createdAt : now,
    updatedAt: now,
  }, { merge: true });
  return documentToObject(await ref.get());
}

async function profileFactUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.profileFacts).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error(`Profile fact not found: ${id}`);
  const update = { updatedAt: FieldValue.serverTimestamp() };
  if (patch.statement !== undefined) update.statement = assertString(patch.statement, 'patch.statement', { max: 4000 });
  if (patch.scope !== undefined) update.scope = clampString(patch.scope, 240) || 'global';
  if (patch.category !== undefined) update.category = clampString(patch.category, 120) || 'general';
  if (patch.evidenceType !== undefined) update.evidenceType = assertEnum(patch.evidenceType, PROFILE_EVIDENCE_TYPES, 'patch.evidenceType', snapshot.data().evidenceType);
  if (patch.stability !== undefined) update.stability = assertEnum(patch.stability, PROFILE_STABILITY, 'patch.stability', snapshot.data().stability);
  if (patch.status !== undefined) update.status = assertEnum(patch.status, PROFILE_STATUSES, 'patch.status', snapshot.data().status);
  if (patch.confidence !== undefined) {
    const value = Number(patch.confidence);
    if (!Number.isFinite(value)) throw new Error('patch.confidence must be a number');
    update.confidence = Math.min(Math.max(value, 0), 1);
  }
  if (patch.source !== undefined) update.source = jsonSafe(patch.source);
  if (patch.sourceRunId !== undefined) update.sourceRunId = clampString(patch.sourceRunId, 160) || null;
  if (patch.confirm === true) update.lastConfirmedAt = FieldValue.serverTimestamp();
  await ref.update(update);
  return documentToObject(await ref.get());
}

async function profileGetContext(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 80, 1), 200);
  const snapshot = await db().collection(COLLECTIONS.profileFacts).limit(400).get();
  const scopes = new Set(stringArray(input.scopes, 50, 240).map((item) => item.toLowerCase()));
  const categories = new Set(stringArray(input.categories, 50, 120).map((item) => item.toLowerCase()));
  let space = null;
  if (input.spaceId) {
    space = await spaceGet({ id: input.spaceId });
    scopes.add('global');
    scopes.add(`space:${space.id}`.toLowerCase());
    (space.domains || []).forEach((domain) => scopes.add(String(domain).toLowerCase()));
  }
  const useScopeFilter = scopes.size > 0;
  const useCategoryFilter = categories.size > 0;
  const includeInferred = input.includeInferred !== false;
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((fact) => {
      if (fact.status && fact.status !== 'active') return false;
      if (!includeInferred && fact.evidenceType === 'inferred') return false;
      if (useScopeFilter && !scopes.has(String(fact.scope || 'global').toLowerCase())) return false;
      if (useCategoryFilter && !categories.has(String(fact.category || 'general').toLowerCase())) return false;
      return true;
    })
    .slice(0, limit);
  return {
    items,
    count: items.length,
    filters: {
      spaceId: space?.id || null,
      scopes: [...scopes],
      categories: [...categories],
      includeInferred,
    },
  };
}

async function decisionCreate(input) {
  const spaceId = assertString(input.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });
  const ref = db().collection(COLLECTIONS.decisions).doc();
  await ref.set({
    spaceId,
    subjectType: clampString(input.subjectType, 80) || 'idea',
    subjectId: clampString(input.subjectId, 160) || null,
    decision: assertEnum(input.decision, DECISION_TYPES, 'decision', 'hold'),
    reason: assertString(input.reason, 'reason', { max: 12000 }),
    status: assertEnum(input.status, DECISION_STATUSES, 'status', 'active'),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    metadata: jsonSafe(input.metadata || {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function opportunityCreate(input) {
  const spaceId = assertString(input.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });
  const ref = db().collection(COLLECTIONS.opportunities).doc();
  await ref.set({
    spaceId,
    title: assertString(input.title, 'title', { max: 500 }),
    summary: clampString(input.summary, 8000) || '',
    type: clampString(input.type, 120) || 'opportunity',
    status: assertEnum(input.status, OPPORTUNITY_STATUSES, 'status', 'active'),
    sourceUrl: clampString(input.sourceUrl, 3000) || '',
    originIdeaId: clampString(input.originIdeaId, 160) || null,
    reward: clampString(input.reward, 500) || '',
    deadline: clampString(input.deadline, 120) || '',
    attributes: jsonSafe(input.attributes || {}),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    revision: 1,
  });
  return documentToObject(await ref.get());
}

async function opportunityUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.opportunities).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error(`Opportunity not found: ${id}`);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, actual ${current.revision || 1}`);
    }
    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 500 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 8000) || '';
    if (patch.type !== undefined) update.type = clampString(patch.type, 120) || 'opportunity';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, OPPORTUNITY_STATUSES, 'patch.status', current.status || 'active');
    if (patch.sourceUrl !== undefined) update.sourceUrl = clampString(patch.sourceUrl, 3000) || '';
    if (patch.reward !== undefined) update.reward = clampString(patch.reward, 500) || '';
    if (patch.deadline !== undefined) update.deadline = clampString(patch.deadline, 120) || '';
    if (patch.attributes !== undefined) update.attributes = jsonSafe(patch.attributes || {});
    if (patch.attributesPatch !== undefined) update.attributes = { ...(current.attributes || {}), ...jsonSafe(patch.attributesPatch || {}) };
    tx.update(ref, update);
  });
  return documentToObject(await ref.get());
}

async function getRecentCollection(name, limit = 300) {
  const snapshot = await db().collection(name).limit(limit).get();
  return sortRecent(snapshot.docs.map(documentToObject));
}

function activeOpportunity(item) {
  return ['active', 'watching'].includes(item.status || 'active');
}

async function spaceGetContext(input) {
  const space = await spaceGet({ id: input.id });
  const database = db();
  const ideaLimit = Math.min(Math.max(Number(input.ideaLimit) || 80, 1), 200);
  const opportunityLimit = Math.min(Math.max(Number(input.opportunityLimit) || 80, 1), 200);
  const recentLimit = Math.min(Math.max(Number(input.recentLimit) || 30, 1), 100);

  const [ideaSnapshot, decisionSnapshot, opportunitySnapshot, profileContext] = await Promise.all([
    database.collection('ideas').where('spaceId', '==', space.id).limit(ideaLimit).get(),
    database.collection(COLLECTIONS.decisions).where('spaceId', '==', space.id).limit(100).get(),
    database.collection(COLLECTIONS.opportunities).where('spaceId', '==', space.id).limit(opportunityLimit).get(),
    profileGetContext({ spaceId: space.id, includeInferred: input.includeInferred !== false, limit: 120 }),
  ]);

  const ideas = sortRecent(ideaSnapshot.docs.map(documentToObject));
  const ideaIds = new Set(ideas.map((item) => item.id));
  const runIds = new Set(ideas.map((item) => item.createdInRunId).filter(Boolean));
  const decisions = sortRecent(decisionSnapshot.docs.map(documentToObject));
  decisions.forEach((item) => { if (item.createdInRunId) runIds.add(item.createdInRunId); });
  const opportunities = sortRecent(opportunitySnapshot.docs.map(documentToObject));
  opportunities.forEach((item) => { if (item.createdInRunId) runIds.add(item.createdInRunId); });

  const [sourcesAll, runsAll, artifactsAll, projectsSnapshot] = await Promise.all([
    getRecentCollection('sources', 300),
    getRecentCollection('runs', 220),
    input.includeArtifacts === false ? Promise.resolve([]) : getRecentCollection('artifacts', 220),
    database.collection('projects').where('spaceId', '==', space.id).limit(50).get().catch(() => ({ docs: [] })),
  ]);

  const sources = sourcesAll
    .filter((item) => item.spaceId === space.id || ideaIds.has(item.ideaId))
    .slice(0, recentLimit);
  sources.forEach((item) => { if (item.createdInRunId) runIds.add(item.createdInRunId); });

  const runs = runsAll
    .filter((item) => item.spaceId === space.id
      || runIds.has(item.id)
      || (item.seedIdeaIds || []).some((id) => ideaIds.has(id)))
    .slice(0, recentLimit);

  const artifacts = artifactsAll
    .filter((item) => item.spaceId === space.id || ideaIds.has(item.ideaId) || runIds.has(item.createdInRunId))
    .slice(0, recentLimit);

  const projects = sortRecent((projectsSnapshot.docs || []).map(documentToObject));
  const themeLocalConstraints = profileContext.items.filter((fact) => String(fact.scope || '') === `space:${space.id}`);
  const relevantProfileFacts = profileContext.items.filter((fact) => String(fact.scope || '') !== `space:${space.id}`);
  const activeIdeas = ideas.filter((item) => item.status === 'active' && !['wild_gig', 'opportunity_source'].includes(item.type));
  const activeOpportunities = opportunities.filter(activeOpportunity);
  const importantDecisions = decisions.filter((item) => !item.status || item.status === 'active');

  return {
    contextVersion: 1,
    space,
    goal: space.goal || '',
    currentBrief: space.currentBrief || '',
    themeLocalConstraints,
    relevantProfileFacts,
    importantDecisions,
    activeIdeas,
    activeOpportunities,
    recentSources: sources,
    recentRuns: runs,
    artifacts,
    projects,
    nextActions: space.nextActions || [],
    resumeBrief: [
      space.title,
      space.goal ? `Goal: ${space.goal}` : '',
      space.currentBrief ? `Current: ${space.currentBrief}` : '',
      (space.nextActions || []).length ? `Next: ${space.nextActions.join(' / ')}` : '',
    ].filter(Boolean).join('\n'),
  };
}

async function spaceDistillRun(input) {
  const spaceId = assertString(input.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });

  const spacePatch = {};
  ['summary', 'goal', 'currentBrief', 'status'].forEach((key) => {
    if (input[key] !== undefined) spacePatch[key] = input[key];
  });
  if (input.nextActions !== undefined) spacePatch.nextActions = input.nextActions;
  if (input.tags !== undefined) spacePatch.tags = input.tags;
  if (input.domains !== undefined) spacePatch.domains = input.domains;
  if (Object.keys(spacePatch).length) await spaceUpdate({ id: spaceId, patch: spacePatch });

  const database = db();
  const attachedIdeaIds = stringArray(input.attachIdeaIds, 200, 160);
  if (attachedIdeaIds.length) {
    const refs = await database.getAll(...attachedIdeaIds.map((id) => database.collection('ideas').doc(id)));
    const batch = database.batch();
    refs.filter((snapshot) => snapshot.exists).forEach((snapshot) => {
      batch.update(snapshot.ref, { spaceId, updatedAt: FieldValue.serverTimestamp() });
    });
    await batch.commit();
  }

  const runId = clampString(input.runId, 160);
  if (runId) {
    const runRef = database.collection('runs').doc(runId);
    const runSnapshot = await runRef.get();
    if (runSnapshot.exists) {
      await runRef.update({
        spaceId,
        metadata: { ...(runSnapshot.data().metadata || {}), distilledToSpaceId: spaceId },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  const createdProfileFacts = [];
  for (const fact of Array.isArray(input.profileFacts) ? input.profileFacts.slice(0, 50) : []) {
    createdProfileFacts.push(await profileFactUpsert({ ...fact, sourceRunId: fact.sourceRunId || runId || null }));
  }

  const createdDecisions = [];
  for (const decision of Array.isArray(input.decisions) ? input.decisions.slice(0, 50) : []) {
    createdDecisions.push(await decisionCreate({ ...decision, spaceId, createdInRunId: decision.createdInRunId || runId || null }));
  }

  const createdOpportunities = [];
  for (const opportunity of Array.isArray(input.opportunities) ? input.opportunities.slice(0, 50) : []) {
    createdOpportunities.push(await opportunityCreate({ ...opportunity, spaceId, createdInRunId: opportunity.createdInRunId || runId || null }));
  }

  const createdIdeas = [];
  for (const idea of Array.isArray(input.ideas) ? input.ideas.slice(0, 50) : []) {
    createdIdeas.push(await agentStore.ideaCreate({ ...idea, spaceId, createdInRunId: idea.createdInRunId || runId || null }));
  }

  return {
    ok: true,
    spaceId,
    attachedIdeaIds,
    created: {
      profileFacts: createdProfileFacts.map((item) => item.id),
      decisions: createdDecisions.map((item) => item.id),
      opportunities: createdOpportunities.map((item) => item.id),
      ideas: createdIdeas.map((item) => item.id),
    },
    context: await spaceGetContext({ id: spaceId, includeArtifacts: true }),
  };
}

async function bootstrapIncomeSearchMigration() {
  const rootIdeaId = 'wCaYjTvbYlO55KM3kNO5';
  const spaceId = 'income-search';
  const database = db();
  const rootSnapshot = await database.collection('ideas').doc(rootIdeaId).get();
  if (!rootSnapshot.exists) {
    return { migrated: false, reason: 'legacy-root-not-found', rootIdeaId };
  }

  const spaceRef = database.collection(COLLECTIONS.spaces).doc(spaceId);
  const existingSpace = await spaceRef.get();
  if (existingSpace.exists && existingSpace.data().migrationState === 'complete') {
    return { migrated: false, reason: 'already-migrated', spaceId, rootIdeaId };
  }

  const root = documentToObject(rootSnapshot);
  const now = FieldValue.serverTimestamp();
  if (!existingSpace.exists) {
    await spaceRef.set({
      title: 'お金を稼ぐ方法を探す',
      summary: '在宅・ネット完結・非同期を前提に、営業や重い選考を避けながら、需要が先に存在する収益機会を継続探索する長期テーマ。',
      goal: 'まず1万円程度の初回収益を現実的に作る。正社員就職を主目的にせず、ネット上に既に存在する需要へ成果物を提出する形を優先する。',
      status: 'active',
      currentBrief: 'AI評価プラットフォームや自前マーケティング中心の案から、OSS bounty・microgrant・公開懸賞・research bountyなど「インターネット上にすでに金が置かれている未解決問題をAIで採掘する」方向へ転換。野良案件レーダーを軸に、source-of-truth、競合、支払可能性、日本からの参加可否、AIでの圧縮余地を検証して候補化する。',
      nextActions: [
        'OSS bounty / microgrant / research bounty の新規候補を追加探索する',
        '候補ごとに未アサイン・競合PR・支払実績・日本からの受領可否を検証する',
        '作業量に対する期待報酬が低い案件は早めに除外する',
      ],
      tags: ['収益化', '野良案件', 'bounty', '非同期'],
      domains: ['work', 'business', 'income'],
      legacyRootIdeaId: rootIdeaId,
      migrationState: 'running',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await spaceRef.set({ migrationState: 'running', updatedAt: now }, { merge: true });
  }

  const ideaIds = new Set([rootIdeaId]);
  let frontier = [rootIdeaId];
  for (let depth = 0; depth < 2 && frontier.length; depth += 1) {
    const next = new Set();
    for (const ideaId of frontier) {
      const [outgoing, incoming] = await Promise.all([
        database.collection('relations').where('fromIdeaId', '==', ideaId).limit(100).get(),
        database.collection('relations').where('toIdeaId', '==', ideaId).limit(100).get(),
      ]);
      [...outgoing.docs, ...incoming.docs].forEach((snapshot) => {
        const relation = snapshot.data();
        const otherId = relation.fromIdeaId === ideaId ? relation.toIdeaId : relation.fromIdeaId;
        if (otherId && !ideaIds.has(otherId)) next.add(otherId);
      });
    }
    [...next].forEach((id) => ideaIds.add(id));
    frontier = [...next];
  }

  const ideaSnapshots = await database.getAll(...[...ideaIds].map((id) => database.collection('ideas').doc(id)));
  const ideas = ideaSnapshots.filter((snapshot) => snapshot.exists).map(documentToObject);
  const attachBatch = database.batch();
  ideaSnapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => {
    attachBatch.update(snapshot.ref, { spaceId, updatedAt: FieldValue.serverTimestamp() });
  });
  await attachBatch.commit();

  const runIds = new Set(ideas.map((idea) => idea.createdInRunId).filter(Boolean));
  if (runIds.size) {
    const runSnapshots = await database.getAll(...[...runIds].map((id) => database.collection('runs').doc(id)));
    const runBatch = database.batch();
    runSnapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => {
      runBatch.update(snapshot.ref, {
        spaceId,
        metadata: { ...(snapshot.data().metadata || {}), migratedToSpaceId: spaceId },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await runBatch.commit();
  }

  const sourceRunId = root.createdInRunId || null;
  const profileFacts = [
    { statement: '仕事では対人コミュニケーションがかなり少ない働き方を好む', scope: 'work', category: 'work_preferences', stability: 'stable' },
    { statement: '仕事では非同期で進められる作業を好む', scope: 'work', category: 'work_preferences', stability: 'stable' },
    { statement: '営業・マーケティング負荷の低い収益方法を好む', scope: 'work', category: 'work_preferences', stability: 'stable' },
    { statement: '登録・試験・選考負荷の大きいプラットフォームを好まない', scope: 'work', category: 'work_preferences', stability: 'contextual' },
    { statement: 'AIで手作業を大きく圧縮できる仕事を好む', scope: 'work', category: 'technical_preferences', stability: 'stable' },
    { statement: '当面の初回収益目標は1万円程度', scope: `space:${spaceId}`, category: 'temporary_context', stability: 'temporary' },
    { statement: '現在は正社員就職を優先していない', scope: `space:${spaceId}`, category: 'temporary_context', stability: 'temporary' },
  ];
  for (const fact of profileFacts) {
    await profileFactUpsert({
      ...fact,
      evidenceType: 'explicit',
      confidence: 1,
      source: { type: 'legacy_space_migration', rootIdeaId },
      sourceRunId,
    });
  }

  const byTitle = new Map(ideas.map((idea) => [idea.title, idea]));
  const existingDecisions = await database.collection(COLLECTIONS.decisions).where('spaceId', '==', spaceId).limit(100).get();
  if (existingDecisions.empty) {
    const outlier = byTitle.get('AIトレーニング：Outlier 日本語×Coding');
    const mercor = byTitle.get('AI評価：Mercor 日本語バイリンガル AI Safety');
    const radar = byTitle.get('野良案件レーダー：需要先行・成果物提出型');
    await decisionCreate({
      spaceId,
      subjectType: 'idea',
      subjectId: outlier?.id || null,
      decision: 'reject',
      reason: '登録・試験・選考負荷が高く、案件発生も不定期で継続監視が必要なため、AI評価プラットフォーム系を主軸から外す。',
      createdInRunId: sourceRunId,
    });
    await decisionCreate({
      spaceId,
      subjectType: 'idea',
      subjectId: mercor?.id || null,
      decision: 'reject',
      reason: '高単価でもオンボーディング負荷と案件供給の不透明さが現在の希望条件に合わないため、主軸から外す。',
      createdInRunId: sourceRunId,
    });
    await decisionCreate({
      spaceId,
      subjectType: 'idea',
      subjectId: radar?.id || null,
      decision: 'adopt',
      reason: '自分で需要を作るより、すでに金が置かれている未解決問題を探し、非同期で成果物を提出する需要先行型を優先する。',
      createdInRunId: sourceRunId,
    });
  }

  const existingOpportunities = await database.collection(COLLECTIONS.opportunities).where('spaceId', '==', spaceId).limit(100).get();
  const migratedOriginIds = new Set(existingOpportunities.docs.map((snapshot) => snapshot.data().originIdeaId).filter(Boolean));
  const opportunityIdeas = ideas.filter((idea) => ['wild_gig', 'opportunity_source'].includes(idea.type));
  for (const idea of opportunityIdeas) {
    if (migratedOriginIds.has(idea.id)) continue;
    const attrs = idea.attributes || {};
    await opportunityCreate({
      spaceId,
      title: idea.title,
      summary: idea.summary || idea.content || '',
      type: idea.type === 'wild_gig' ? 'concrete_gig' : 'opportunity_source',
      status: idea.status === 'paused' ? 'paused' : 'active',
      originIdeaId: idea.id,
      reward: attrs.reward || attrs.historicalReward || attrs.rewardModel || '',
      deadline: attrs.deadline || '',
      attributes: attrs,
      createdInRunId: idea.createdInRunId || sourceRunId,
    });
  }

  await spaceRef.set({
    migrationState: 'complete',
    migratedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    migrated: true,
    spaceId,
    rootIdeaId,
    attachedIdeaCount: ideas.length,
    runCount: runIds.size,
    profileFactCount: profileFacts.length,
    opportunityCount: opportunityIdeas.length,
  };
}

async function healthCheck() {
  const started = Date.now();
  const [spaceSample, profileSample] = await Promise.all([
    db().collection(COLLECTIONS.spaces).limit(1).get(),
    db().collection(COLLECTIONS.profileFacts).limit(1).get(),
  ]);
  return {
    ok: true,
    databaseId: DATABASE_ID,
    collections: Object.values(COLLECTIONS),
    sampleSpaceCount: spaceSample.size,
    sampleProfileFactCount: profileSample.size,
    latencyMs: Date.now() - started,
  };
}

module.exports = {
  DATABASE_ID,
  COLLECTIONS,
  SPACE_STATUSES,
  PROFILE_EVIDENCE_TYPES,
  PROFILE_STABILITY,
  PROFILE_STATUSES,
  DECISION_TYPES,
  DECISION_STATUSES,
  OPPORTUNITY_STATUSES,
  healthCheck,
  spaceCreate,
  spaceGet,
  spaceUpdate,
  spaceSearch,
  spaceGetContext,
  profileFactUpsert,
  profileFactUpdate,
  profileGetContext,
  decisionCreate,
  opportunityCreate,
  opportunityUpdate,
  spaceDistillRun,
  bootstrapIncomeSearchMigration,
};
