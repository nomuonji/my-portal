const { getDocumentDb, FieldValue } = require('./documentDb');

const DATABASE_ID = '(default)';
const COLLECTIONS = Object.freeze({
  sites: 'public_sites',
  content: 'public_content',
  revisions: 'public_content_revisions',
});

function db() { return getDocumentDb(DATABASE_ID); }
function str(value, max = 300) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}
function required(value, name, max = 300) {
  const v = str(value, max);
  if (!v) throw new Error(name + ' is required');
  return v;
}
function confirm(input, action) {
  if (input.confirm !== true) throw new Error('Public CMS ' + action + ' requires confirm=true');
}
function serial(value) {
  if (value === null || value === undefined) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serial);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, serial(v)]));
  return value;
}
function obj(snap) { return snap.exists ? serial({ id: snap.id, ...snap.data() }) : null; }
function normalizeSiteId(value) {
  const v = required(value, 'siteId', 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(v)) throw new Error('siteId must use lowercase letters, numbers, _ or -');
  return v;
}
function normalizeSlug(value) {
  const v = required(value, 'slug', 300).replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(v)) throw new Error('slug must be lowercase URL path segments');
  return v;
}
function contentDocId(siteId, slug) { return normalizeSiteId(siteId) + '__' + normalizeSlug(slug).replaceAll('/', '~'); }
function strings(value, maxItems = 30, maxLen = 160) {
  return [...new Set((Array.isArray(value) ? value : []).map((x) => str(x, maxLen)).filter(Boolean))].slice(0, maxItems);
}
function safeSeo(input = {}) {
  return {
    primaryKeyword: str(input.primaryKeyword, 240),
    secondaryKeywords: strings(input.secondaryKeywords, 30, 240),
    searchIntent: str(input.searchIntent, 120),
    title: str(input.title, 300),
    description: str(input.description, 500),
    canonicalPath: str(input.canonicalPath, 500),
    noindex: input.noindex === true,
  };
}
function safeDraft(input = {}) {
  return {
    title: required(input.title, 'title', 300),
    summary: str(input.summary, 3000),
    bodyMarkdown: str(input.bodyMarkdown, 100000),
    contentType: str(input.contentType, 80) || 'article',
    tags: strings(input.tags, 50, 120),
    seo: safeSeo(input.seo || {}),
  };
}
function safeSources(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => ({
    type: str(item?.type, 80),
    id: str(item?.id, 200),
    spaceId: str(item?.spaceId, 200),
    note: str(item?.note, 1000),
  })).filter((item) => item.type || item.id || item.spaceId || item.note);
}
function publicProjection(record) {
  if (!record || record.status !== 'published' || !record.published) return null;
  const p = record.published;
  return {
    id: record.id,
    siteId: record.siteId,
    slug: record.slug,
    revision: Number(record.revision) || 0,
    title: p.title || '',
    summary: p.summary || '',
    bodyMarkdown: p.bodyMarkdown || '',
    contentType: p.contentType || 'article',
    tags: Array.isArray(p.tags) ? p.tags : [],
    seo: safeSeo(p.seo || {}),
    publishedAt: record.publishedAt || p.publishedAt || null,
    updatedAt: record.updatedAt || null,
  };
}

async function status() {
  const [sites, content] = await Promise.all([
    db().collection(COLLECTIONS.sites).limit(1).get(),
    db().collection(COLLECTIONS.content).limit(1).get(),
  ]);
  return { ok: true, databaseId: DATABASE_ID, collections: COLLECTIONS, reachable: sites.size >= 0 && content.size >= 0 };
}
async function siteList() {
  const snap = await db().collection(COLLECTIONS.sites).limit(200).get();
  return { items: snap.docs.map(obj).sort((a,b) => String(a.name||a.id).localeCompare(String(b.name||b.id))) };
}
async function siteUpsert(input = {}) {
  confirm(input, 'site_upsert');
  const siteId = normalizeSiteId(input.siteId);
  const data = input.site || {};
  const ref = db().collection(COLLECTIONS.sites).doc(siteId);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    name: required(data.name || siteId, 'name', 300),
    baseUrl: str(data.baseUrl, 1000),
    locale: str(data.locale, 40) || 'ja-JP',
    frontendRepo: str(data.frontendRepo, 300),
    description: str(data.description, 3000),
    status: ['active','paused','archived'].includes(data.status) ? data.status : 'active',
    ...(existing.exists ? {} : { createdAt: now }),
    updatedAt: now,
  }, { merge: true });
  return { item: obj(await ref.get()) };
}
async function contentList(input = {}) {
  const siteId = normalizeSiteId(input.siteId);
  const snap = await db().collection(COLLECTIONS.content).where('siteId','==',siteId).limit(Math.min(Number(input.limit)||200,500)).get();
  let items = snap.docs.map(obj);
  if (input.status) items = items.filter((x) => x.status === input.status);
  items.sort((a,b) => Date.parse(b.updatedAt||b.createdAt||0)-Date.parse(a.updatedAt||a.createdAt||0));
  return { items };
}
async function contentGet(input = {}) {
  const id = contentDocId(input.siteId, input.slug);
  const snap = await db().collection(COLLECTIONS.content).doc(id).get();
  if (!snap.exists) throw new Error('Public content not found');
  return { item: obj(snap) };
}
async function contentCreate(input = {}) {
  confirm(input, 'content_create');
  const siteId = normalizeSiteId(input.siteId);
  const slug = normalizeSlug(input.slug);
  const id = contentDocId(siteId, slug);
  const ref = db().collection(COLLECTIONS.content).doc(id);
  if ((await ref.get()).exists) throw new Error('Public content already exists: ' + siteId + '/' + slug);
  const now = FieldValue.serverTimestamp();
  await ref.set({
    siteId, slug, status: 'draft', revision: 0,
    draft: safeDraft(input.content || {}),
    published: null,
    sourceRefs: safeSources(input.sourceRefs),
    seoResearch: input.seoResearch && typeof input.seoResearch === 'object' ? input.seoResearch : {},
    createdAt: now, updatedAt: now, publishedAt: null,
  });
  return { item: obj(await ref.get()) };
}
async function contentUpdate(input = {}) {
  confirm(input, 'content_update');
  const id = contentDocId(input.siteId, input.slug);
  const ref = db().collection(COLLECTIONS.content).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new Error('Public content not found');
  const current = obj(existing);
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (input.content) patch.draft = safeDraft({ ...(current.draft||{}), ...input.content, seo: { ...(current.draft?.seo||{}), ...(input.content.seo||{}) } });
  if (input.sourceRefs) patch.sourceRefs = safeSources(input.sourceRefs);
  if (input.seoResearch && typeof input.seoResearch === 'object') patch.seoResearch = input.seoResearch;
  await ref.set(patch, { merge: true });
  return { item: obj(await ref.get()) };
}
async function contentPublish(input = {}) {
  confirm(input, 'content_publish');
  const id = contentDocId(input.siteId, input.slug);
  const ref = db().collection(COLLECTIONS.content).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new Error('Public content not found');
  const current = obj(existing);
  const revision = (Number(current.revision) || 0) + 1;
  const publishedAt = new Date().toISOString();
  const published = { ...safeDraft(current.draft || {}), publishedAt };
  const batch = db().batch();
  batch.set(db().collection(COLLECTIONS.revisions).doc(id + '__r' + revision), {
    contentId: id, siteId: current.siteId, slug: current.slug, revision, published, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(ref, { status: 'published', revision, published, publishedAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { item: obj(await ref.get()) };
}
async function contentArchive(input = {}) {
  confirm(input, 'content_archive');
  const ref = db().collection(COLLECTIONS.content).doc(contentDocId(input.siteId, input.slug));
  if (!(await ref.get()).exists) throw new Error('Public content not found');
  await ref.set({ status: 'archived', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { item: obj(await ref.get()) };
}
async function publicGet(input = {}) {
  const siteId = normalizeSiteId(input.siteId);
  const site = await db().collection(COLLECTIONS.sites).doc(siteId).get();
  if (!site.exists || site.data()?.status !== 'active') return null;
  const snap = await db().collection(COLLECTIONS.content).doc(contentDocId(siteId, input.slug)).get();
  return snap.exists ? publicProjection(obj(snap)) : null;
}
async function publicList(input = {}) {
  const siteId = normalizeSiteId(input.siteId);
  const site = await db().collection(COLLECTIONS.sites).doc(siteId).get();
  if (!site.exists || site.data()?.status !== 'active') return [];
  const snap = await db().collection(COLLECTIONS.content).where('siteId','==',siteId).limit(Math.min(Number(input.limit)||100,500)).get();
  return snap.docs.map(obj).map(publicProjection).filter(Boolean).sort((a,b) => Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0));
}

module.exports = {
  DATABASE_ID, COLLECTIONS, status, siteList, siteUpsert, contentList, contentGet,
  contentCreate, contentUpdate, contentPublish, contentArchive, publicGet, publicList,
  _test: { normalizeSiteId, normalizeSlug, contentDocId, safeDraft, publicProjection },
};
