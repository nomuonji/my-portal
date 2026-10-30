'use strict';

const { getDocumentDb, FieldValue } = require('./documentDb');
const { canonicalJobUrl, jobOpportunityId, normalizeJobOpportunity } = require('./jobOpportunityRules');

const COLLECTION = 'job_opportunities';
const DATABASE_ID = '(default)';

function db() {
  return getDocumentDb(DATABASE_ID);
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

function searchableText(value) {
  return JSON.stringify(serialize(value)).toLowerCase();
}

function timestampValue(item) {
  const raw = item.lastVerifiedAt || item.updatedAt || item.firstSeenAt || item.createdAt;
  const value = raw ? Date.parse(raw) : 0;
  return Number.isFinite(value) ? value : 0;
}

async function get(input = {}) {
  let id = String(input.id || '').trim();
  if (!id && input.sourceUrl) id = jobOpportunityId(input.sourceUrl);
  if (!id) throw new Error('id or sourceUrl is required');
  const snapshot = await db().collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) throw new Error('Job opportunity not found: ' + id);
  return { collection: COLLECTION, item: documentToObject(snapshot), databaseId: DATABASE_ID };
}

async function search(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 5, 100), limit), 1000);
  const query = String(input.query || '').trim().toLowerCase();
  const status = String(input.status || '').trim().toLowerCase();
  const snapshot = await db().collection(COLLECTION).limit(scanLimit).get();
  const items = snapshot.docs
    .map(documentToObject)
    .filter((item) => {
      if (status && item.status !== status) return false;
      if (query && !searchableText(item).includes(query)) return false;
      return true;
    })
    .sort((a, b) => timestampValue(b) - timestampValue(a))
    .slice(0, limit);
  return {
    collection: COLLECTION,
    items,
    count: items.length,
    scanned: snapshot.size,
    databaseId: DATABASE_ID,
  };
}

async function upsert(input = {}) {
  const sourceUrl = canonicalJobUrl(input.sourceUrl);
  const id = jobOpportunityId(sourceUrl);
  const ref = db().collection(COLLECTION).doc(id);
  const existingSnapshot = await ref.get();
  const prior = existingSnapshot.exists ? documentToObject(existingSnapshot) : {};
  const normalized = normalizeJobOpportunity({ ...input, sourceUrl }, prior);
  const now = FieldValue.serverTimestamp();
  const record = {
    ...normalized,
    firstSeenAt: prior.firstSeenAt || prior.createdAt || now,
    lastVerifiedAt: now,
    createdAt: prior.createdAt || now,
    updatedAt: now,
  };
  await ref.set(record);
  const saved = documentToObject(await ref.get());
  return {
    collection: COLLECTION,
    item: saved,
    created: !existingSnapshot.exists,
    databaseId: DATABASE_ID,
  };
}

module.exports = { COLLECTION, DATABASE_ID, get, search, upsert };
