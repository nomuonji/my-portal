const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const DATABASE_ID = '(default)';
const COLLECTIONS = Object.freeze({
  posts: 'social_posts',
  accounts: 'social_accounts',
  importRuns: 'social_import_runs',
});

const DEFAULT_CATEGORY = '未分類';
const POST_TYPES = new Set(['post', 'reply', 'quote', 'repost']);

function db() {
  return getFirestore();
}

function text(value, max = 20000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function optionalText(value, max = 20000) {
  const normalized = text(value, max);
  return normalized || null;
}

function int(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
  return value === true;
}

function stringArray(value, maxItems = 50, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function docId(platform, postId) {
  return `${text(platform || 'x', 30).toLowerCase()}_${text(postId, 200).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function importRunId(value) {
  const raw = text(value || `social-${Date.now()}`, 160);
  return raw.replace(/[^A-Za-z0-9._-]/g, '_');
}

function jsonSafe(value, depth = 0) {
  if (depth > 7) return '[max-depth]';
  if (value === null || value === undefined) return value ?? null;
  if (['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 20000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => jsonSafe(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
      out[text(key, 120)] = jsonSafe(item, depth + 1);
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
    Object.entries(value).forEach(([key, item]) => { out[key] = serialize(item); });
    return out;
  }
  return value;
}

function snapshotObject(snapshot) {
  return snapshot.exists ? serialize({ id: snapshot.id, ...snapshot.data() }) : null;
}

function normalizeMedia(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => ({
    type: text(item?.type || 'unknown', 40),
    mediaUrl: optionalText(item?.mediaUrl || item?.media_url_https || item?.media_url, 2000),
    expandedUrl: optionalText(item?.expandedUrl || item?.expanded_url, 2000),
    displayUrl: optionalText(item?.displayUrl || item?.display_url, 1000),
    archivePath: optionalText(item?.archivePath, 1000),
  }));
}

function normalizeLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => ({
    url: optionalText(item?.url, 2000),
    expandedUrl: optionalText(item?.expandedUrl || item?.expanded_url, 2000),
    displayUrl: optionalText(item?.displayUrl || item?.display_url, 1000),
  }));
}

function normalizePost(raw = {}, source = {}) {
  const platform = text(raw.platform || 'x', 30).toLowerCase();
  const postId = text(raw.postId || raw.id || raw.id_str, 200);
  if (!postId) throw new Error('postId is required');

  const postedAtDate = isoDate(raw.postedAt || raw.createdAt || raw.created_at);
  if (!postedAtDate) throw new Error(`postedAt is invalid for post ${postId}`);

  const type = POST_TYPES.has(raw.type) ? raw.type : 'post';
  const accountId = text(raw.accountId || source.accountId, 200);
  const username = text(raw.username || source.username, 200);

  return {
    id: docId(platform, postId),
    platform,
    postId,
    accountId: accountId || null,
    username: username || null,
    text: text(raw.text || raw.fullText || raw.full_text, 20000),
    postedAt: Timestamp.fromDate(postedAtDate),
    url: optionalText(raw.url, 2000),
    type,
    conversationId: optionalText(raw.conversationId, 200),
    replyToPostId: optionalText(raw.replyToPostId || raw.inReplyToStatusId, 200),
    replyToUsername: optionalText(raw.replyToUsername || raw.inReplyToUsername, 200),
    quotedPostId: optionalText(raw.quotedPostId, 200),
    language: optionalText(raw.language || raw.lang, 30),
    sourceClient: optionalText(raw.sourceClient, 500),
    hashtags: stringArray(raw.hashtags, 30, 160),
    mentions: stringArray(raw.mentions, 50, 200),
    links: normalizeLinks(raw.links),
    media: normalizeMedia(raw.media),
    metrics: {
      likes: int(raw.metrics?.likes ?? raw.likes ?? raw.favoriteCount),
      reposts: int(raw.metrics?.reposts ?? raw.reposts ?? raw.retweetCount),
      replies: int(raw.metrics?.replies ?? raw.replies),
      quotes: int(raw.metrics?.quotes ?? raw.quotes),
      views: int(raw.metrics?.views ?? raw.views),
    },
    category: text(raw.category || DEFAULT_CATEGORY, 160) || DEFAULT_CATEGORY,
    tags: stringArray(raw.tags, 30, 160),
    starred: bool(raw.starred),
    note: text(raw.note, 4000),
    classificationSource: optionalText(raw.classificationSource, 80),
    source: {
      kind: text(source.kind || 'x-archive', 80),
      archiveName: optionalText(source.archiveName, 500),
      importKey: optionalText(source.importKey, 160),
    },
    schemaVersion: 1,
  };
}

function requireConfirmation(input, action) {
  if (input.confirm !== true) {
    throw new Error(`${action} requires confirm=true after explicit user approval`);
  }
}

async function status() {
  const [postCount, accountCount, runCount] = await Promise.all([
    db().collection(COLLECTIONS.posts).count().get(),
    db().collection(COLLECTIONS.accounts).count().get(),
    db().collection(COLLECTIONS.importRuns).count().get(),
  ]);
  return {
    ok: true,
    databaseId: DATABASE_ID,
    collections: COLLECTIONS,
    counts: {
      posts: postCount.data().count,
      accounts: accountCount.data().count,
      importRuns: runCount.data().count,
    },
  };
}

async function getPost(input = {}) {
  const id = text(input.id, 300);
  if (!id) throw new Error('id is required');
  const snap = await db().collection(COLLECTIONS.posts).doc(id).get();
  if (!snap.exists) throw new Error(`Post not found: ${id}`);
  return { item: snapshotObject(snap), databaseId: DATABASE_ID };
}

function searchableText(item) {
  return [
    item.id, item.text, item.category, item.note, item.username,
    ...(Array.isArray(item.tags) ? item.tags : []),
    ...(Array.isArray(item.hashtags) ? item.hashtags : []),
  ].filter(Boolean).join('\n').toLowerCase();
}

async function searchPosts(input = {}) {
  const requestedLimit = Math.min(Math.max(int(input.limit) || 50, 1), 200);
  const scanLimit = Math.min(Math.max(int(input.scanLimit) || 2000, requestedLimit), 5000);
  const snapshot = await db().collection(COLLECTIONS.posts).orderBy('postedAt', 'desc').limit(scanLimit).get();

  const needle = text(input.query, 500).toLowerCase();
  const account = text(input.account, 200).toLowerCase();
  const category = text(input.category, 160).toLowerCase();
  const type = text(input.type, 30).toLowerCase();
  const tag = text(input.tag, 160).toLowerCase();
  const year = int(input.year);
  const starred = input.starred;

  const items = snapshot.docs.map(snapshotObject).filter((item) => {
    if (needle && !searchableText(item).includes(needle)) return false;
    if (account && ![item.accountId, item.username].some((value) => String(value || '').toLowerCase() === account)) return false;
    if (category && String(item.category || '').toLowerCase() !== category) return false;
    if (type && String(item.type || '').toLowerCase() !== type) return false;
    if (tag && !(item.tags || []).some((value) => String(value).toLowerCase() === tag)) return false;
    if (year && new Date(item.postedAt).getUTCFullYear() !== year) return false;
    if (typeof starred === 'boolean' && Boolean(item.starred) !== starred) return false;
    return true;
  }).slice(0, requestedLimit);

  return {
    items,
    count: items.length,
    scanned: snapshot.size,
    databaseId: DATABASE_ID,
  };
}

async function importPosts(input = {}) {
  requireConfirmation(input, 'social_import_posts');
  if (!Array.isArray(input.posts) || !input.posts.length) throw new Error('posts must contain at least one item');
  if (input.posts.length > 200) throw new Error('posts supports at most 200 items per call');

  const source = {
    kind: 'x-archive',
    archiveName: text(input.archiveName, 500),
    importKey: importRunId(input.importKey),
    accountId: text(input.account?.accountId, 200),
    username: text(input.account?.username, 200),
  };
  const normalized = input.posts.map((post) => normalizePost(post, source));
  const refs = normalized.map((post) => db().collection(COLLECTIONS.posts).doc(post.id));
  const existingSnaps = refs.length ? await db().getAll(...refs) : [];
  const batch = db().batch();
  let created = 0;
  let updated = 0;

  normalized.forEach((post, index) => {
    const existing = existingSnaps[index]?.exists ? existingSnaps[index].data() : null;
    const metadata = existing && input.overwriteMetadata !== true
      ? {
        category: existing.category || DEFAULT_CATEGORY,
        tags: Array.isArray(existing.tags) ? existing.tags : [],
        starred: Boolean(existing.starred),
        note: existing.note || '',
        classificationSource: existing.classificationSource || null,
      }
      : {
        category: post.category,
        tags: post.tags,
        starred: post.starred,
        note: post.note,
        classificationSource: post.classificationSource,
      };

    batch.set(refs[index], {
      ...post,
      ...metadata,
      importedAt: existing?.importedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (existing) updated += 1;
    else created += 1;
  });

  if (input.account && typeof input.account === 'object') {
    const accountKey = text(input.account.accountId || input.account.username, 200);
    if (accountKey) {
      const accountRef = db().collection(COLLECTIONS.accounts).doc(docId('x', accountKey));
      batch.set(accountRef, {
        platform: 'x',
        accountId: optionalText(input.account.accountId, 200),
        username: optionalText(input.account.username, 200),
        displayName: optionalText(input.account.displayName, 500),
        bio: optionalText(input.account.bio, 4000),
        archiveName: optionalText(input.archiveName, 500),
        archiveCapturedAt: isoDate(input.account.archiveCapturedAt)
          ? Timestamp.fromDate(isoDate(input.account.archiveCapturedAt))
          : null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  const runRef = db().collection(COLLECTIONS.importRuns).doc(source.importKey);
  batch.set(runRef, {
    importKey: source.importKey,
    platform: 'x',
    archiveName: source.archiveName || null,
    accountId: source.accountId || null,
    username: source.username || null,
    status: input.complete === true ? 'complete' : 'partial',
    batches: FieldValue.increment(1),
    received: FieldValue.increment(normalized.length),
    created: FieldValue.increment(created),
    updated: FieldValue.increment(updated),
    lastImportedAt: FieldValue.serverTimestamp(),
    ...(input.complete === true ? { completedAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });

  await batch.commit();

  return {
    ok: true,
    importKey: source.importKey,
    received: normalized.length,
    created,
    updated,
    complete: input.complete === true,
    ids: normalized.slice(0, 20).map((item) => item.id),
  };
}

async function updateMetadata(input = {}) {
  requireConfirmation(input, 'social_post_update_metadata');
  const id = text(input.id, 300);
  if (!id) throw new Error('id is required');
  const patch = {};
  if (input.category !== undefined) patch.category = text(input.category, 160) || DEFAULT_CATEGORY;
  if (input.tags !== undefined) patch.tags = stringArray(input.tags, 30, 160);
  if (input.starred !== undefined) patch.starred = Boolean(input.starred);
  if (input.note !== undefined) patch.note = text(input.note, 4000);
  if (input.classificationSource !== undefined) patch.classificationSource = optionalText(input.classificationSource, 80);
  if (!Object.keys(patch).length) throw new Error('No metadata fields supplied');

  const ref = db().collection(COLLECTIONS.posts).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Post not found: ${id}`);
  await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { item: snapshotObject(await ref.get()), databaseId: DATABASE_ID };
}

async function bulkUpdateMetadata(input = {}) {
  requireConfirmation(input, 'social_posts_update_metadata');
  if (!Array.isArray(input.updates) || !input.updates.length) throw new Error('updates must contain at least one item');
  if (input.updates.length > 200) throw new Error('updates supports at most 200 items per call');

  const refs = input.updates.map((item) => {
    const id = text(item.id, 300);
    if (!id) throw new Error('Each update requires id');
    return db().collection(COLLECTIONS.posts).doc(id);
  });
  const snaps = await db().getAll(...refs);
  const batch = db().batch();
  let changed = 0;

  input.updates.forEach((item, index) => {
    if (!snaps[index].exists) return;
    const patch = {};
    if (item.category !== undefined) patch.category = text(item.category, 160) || DEFAULT_CATEGORY;
    if (item.tags !== undefined) patch.tags = stringArray(item.tags, 30, 160);
    if (item.starred !== undefined) patch.starred = Boolean(item.starred);
    if (item.note !== undefined) patch.note = text(item.note, 4000);
    if (item.classificationSource !== undefined) patch.classificationSource = optionalText(item.classificationSource, 80);
    if (!Object.keys(patch).length) return;
    batch.set(refs[index], { ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    changed += 1;
  });

  if (changed) await batch.commit();
  return { ok: true, received: input.updates.length, changed };
}

module.exports = {
  DATABASE_ID,
  COLLECTIONS,
  status,
  getPost,
  searchPosts,
  importPosts,
  updateMetadata,
  bulkUpdateMetadata,
};
