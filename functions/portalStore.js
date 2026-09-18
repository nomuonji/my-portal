const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const DATABASE_ID = '(default)';

const COLLECTIONS = Object.freeze({
  memos: { label: 'メモ', tagsField: 'tags' },
  ideas: { label: 'アイデア', tagsField: 'tags' },
  tags: { label: 'アイデアタグ', documentIdsAsData: true },
  keywords: { label: 'キーワード' },
  featureRequests: { label: '機能改善' },
  reading_list_urls: { label: 'あとで読むURL', tagsField: 'tags' },
  reading_list_youtube: { label: 'あとで見るYouTube', tagsField: 'tags' },
  projects: { label: 'プロジェクト', tagsField: 'tags' },
  flashcards: { label: 'フラッシュカード' },
  decks: { label: 'デッキ' },
  groups: { label: 'デッキグループ' },
  stocks: { label: 'ストック', tagsField: 'tags' },
  stock_tags: { label: 'ストックタグ', documentIdsAsData: true },
  hobbies: { label: '趣味', tagsField: 'tags' },
  hobby_tags: { label: '趣味タグ', documentIdsAsData: true },
});

function db() {
  return getFirestore();
}

function clampString(value, max = 20000) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().slice(0, max);
}

function assertString(value, name, max = 300) {
  const normalized = clampString(value, max);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireConfirmation(input, action) {
  if (input.confirm !== true) {
    throw new Error(`Portal ${action} requires confirm=true. My Portal is read-mostly for agents; only write after explicit user confirmation.`);
  }
}

function jsonSafe(value, depth = 0) {
  if (depth > 8) return '[max-depth]';
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 50000);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => jsonSafe(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 300).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor', 'id'].includes(key)) return;
      out[String(key).slice(0, 160)] = jsonSafe(item, depth + 1);
    });
    return out;
  }
  return String(value).slice(0, 50000);
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

function isPortalIdea(item = {}) {
  return item?.owner === 'portal'
    || (Boolean(item?.content) && !item?.createdBy && !item?.maturity && !item?.spaceId);
}

function assertPortalOwned(config, item) {
  if (config.name === 'ideas' && !isPortalIdea(item)) {
    throw new Error(`Document not found: ${config.name}/${item?.id || ''}`);
  }
}

function collectionConfig(name) {
  const normalized = assertString(name, 'collection', 120);
  const config = COLLECTIONS[normalized];
  if (!config) {
    throw new Error(`Unsupported portal collection: ${normalized}. Use portal_status to list allowed collections.`);
  }
  return { name: normalized, ...config };
}

function searchableText(value, id = '') {
  return `${id}\n${JSON.stringify(serialize(value))}`.toLowerCase();
}

function timestampValue(item) {
  const raw = item.updatedAt || item.createdAt || item.startedAt || item.finishedAt;
  const time = raw ? Date.parse(raw) : 0;
  return Number.isFinite(time) ? time : 0;
}

async function status() {
  const started = Date.now();
  await db().collection('ideas').limit(1).get();
  return {
    ok: true,
    databaseId: DATABASE_ID,
    mode: 'read-mostly',
    writePolicy: 'portal_create, portal_update, and portal_delete require confirm=true after explicit user confirmation; use Agent Idea Space for normal agent writes.',
    collections: Object.entries(COLLECTIONS).map(([name, config]) => ({ name, ...config })),
    latencyMs: Date.now() - started,
  };
}

async function get(input = {}) {
  const config = collectionConfig(input.collection);
  const id = assertString(input.id, 'id', 500);
  const snapshot = await db().collection(config.name).doc(id).get();
  if (!snapshot.exists) throw new Error(`Document not found: ${config.name}/${id}`);
  const item = documentToObject(snapshot);
  assertPortalOwned(config, item);
  return { collection: config.name, item, databaseId: DATABASE_ID };
}

async function search(input = {}) {
  const config = collectionConfig(input.collection);
  const requestedLimit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(requestedLimit * 5, 100), requestedLimit), 500);
  const snapshot = await db().collection(config.name).limit(scanLimit).get();
  const needle = clampString(input.query, 500)?.toLowerCase();
  const tag = clampString(input.tag, 160)?.toLowerCase();

  const items = snapshot.docs
    .map((doc) => documentToObject(doc))
    .filter((item) => {
      if (config.name === 'ideas' && !isPortalIdea(item)) return false;
      if (tag) {
        const values = Array.isArray(item?.[config.tagsField || 'tags']) ? item[config.tagsField || 'tags'] : [];
        if (!values.some((value) => String(value).toLowerCase() === tag)) return false;
      }
      if (needle && !searchableText(item, item.id).includes(needle)) return false;
      return true;
    })
    .sort((a, b) => timestampValue(b) - timestampValue(a))
    .slice(0, requestedLimit);

  return {
    collection: config.name,
    items,
    count: items.length,
    scanned: snapshot.size,
    databaseId: DATABASE_ID,
  };
}

async function create(input = {}) {
  requireConfirmation(input, 'create');
  const config = collectionConfig(input.collection);
  const data = jsonSafe(input.data && typeof input.data === 'object' ? input.data : {});
  if (config.name === 'ideas') data.owner = 'portal';
  const explicitId = clampString(input.id, 500);
  const ref = explicitId
    ? db().collection(config.name).doc(explicitId)
    : db().collection(config.name).doc();
  if (explicitId) {
    const existing = await ref.get();
    if (existing.exists && input.overwrite !== true) {
      throw new Error(`Document already exists: ${config.name}/${explicitId}. Set overwrite=true to replace it.`);
    }
  }
  const now = FieldValue.serverTimestamp();
  await ref.set({
    ...data,
    ...(data.createdAt === undefined ? { createdAt: now } : {}),
    updatedAt: now,
  }, { merge: input.overwrite !== true });
  return { collection: config.name, item: documentToObject(await ref.get()), databaseId: DATABASE_ID };
}

async function update(input = {}) {
  requireConfirmation(input, 'update');
  const config = collectionConfig(input.collection);
  const id = assertString(input.id, 'id', 500);
  const patch = jsonSafe(input.patch && typeof input.patch === 'object' ? input.patch : {});
  if (!Object.keys(patch).length) throw new Error('patch must contain at least one field');
  const ref = db().collection(config.name).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new Error(`Document not found: ${config.name}/${id}`);
  assertPortalOwned(config, documentToObject(existing));
  if (config.name === 'ideas') patch.owner = 'portal';
  await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { collection: config.name, item: documentToObject(await ref.get()), databaseId: DATABASE_ID };
}

async function remove(input = {}) {
  requireConfirmation(input, 'delete');
  const config = collectionConfig(input.collection);
  const id = assertString(input.id, 'id', 500);
  const ref = db().collection(config.name).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new Error(`Document not found: ${config.name}/${id}`);
  const deleted = documentToObject(existing);
  assertPortalOwned(config, deleted);
  await ref.delete();
  return { collection: config.name, deleted, databaseId: DATABASE_ID };
}

module.exports = {
  DATABASE_ID,
  COLLECTIONS,
  status,
  get,
  search,
  create,
  update,
  remove,
};
