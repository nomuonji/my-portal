const { getDocumentDb, FieldValue } = require('./documentDb');

const DATABASE_ID = '(default)';
const COLLECTIONS = Object.freeze({
  sites: 'public_sites',
  content: 'public_content',
  revisions: 'public_content_revisions',
});

function db() { return getDocumentDb(DATABASE_ID); }
function env(name) {
  try {
    const value = globalThis?.Netlify?.env?.get?.(name);
    if (value) return String(value).trim();
  } catch {}
  if (typeof process !== 'undefined' && process.env && process.env[name]) return String(process.env[name]).trim();
  return '';
}
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
function safeLocale(value, slug = '') {
  const explicit = str(value, 10).toLowerCase();
  if (['ja','en'].includes(explicit)) return explicit;
  return String(slug || '').replace(/^\/+|\/+$/g, '').startsWith('en/') ? 'en' : 'ja';
}
function translationGroupId(value, slug = '') {
  const explicit = str(value, 300);
  if (explicit) return explicit;
  const normalized = String(slug || '').replace(/^\/+|\/+$/g, '');
  return normalized.replace(/^en\//, '') || normalized;
}
function safeRevision(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function safeDraft(input = {}, context = {}) {
  const locale = safeLocale(input.locale, context.slug);
  return {
    title: required(input.title, 'title', 300),
    summary: str(input.summary, 3000),
    bodyMarkdown: str(input.bodyMarkdown, 100000),
    contentType: str(input.contentType, 80) || 'article',
    tags: strings(input.tags, 50, 120),
    keyTakeaways: strings(input.keyTakeaways, 8, 500),
    locale,
    translationGroupId: translationGroupId(input.translationGroupId, context.slug),
    originalLocale: safeLocale(input.originalLocale || locale, context.slug),
    translatedFromRevision: safeRevision(input.translatedFromRevision),
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
function deployHookEnvName(siteId) {
  return 'PUBLIC_CMS_DEPLOY_HOOK_' + normalizeSiteId(siteId).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}
function isAllowedDeployHookUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      url.hostname === 'api.cloudflare.com' &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      /^\/client\/v4\/workers\/builds\/deploy_hooks\/[A-Za-z0-9-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}
async function triggerDeployHookUrl(value, fetchImpl = globalThis.fetch) {
  const hookUrl = str(value, 2000);
  if (!hookUrl) return { configured: false, triggered: false, ok: null, reason: 'not_configured' };
  if (!isAllowedDeployHookUrl(hookUrl)) return { configured: true, triggered: false, ok: false, reason: 'invalid_hook_url' };
  if (typeof fetchImpl !== 'function') return { configured: true, triggered: false, ok: false, reason: 'fetch_unavailable' };
  try {
    const response = await fetchImpl(hookUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    return {
      configured: true,
      triggered: true,
      ok: response.ok && payload?.success !== false,
      status: response.status,
      buildUuid: str(payload?.result?.build_uuid, 160),
      buildStatus: str(payload?.result?.status, 80),
      alreadyExists: payload?.result?.already_exists === true,
    };
  } catch (error) {
    return {
      configured: true,
      triggered: true,
      ok: false,
      status: null,
      error: str(error?.message || error, 1000),
    };
  }
}
async function deployStatus(input = {}) {
  const siteId = normalizeSiteId(input.siteId);
  const envName = deployHookEnvName(siteId);
  const hookUrl = env(envName);
  return { siteId, envName, configured: Boolean(hookUrl), valid: Boolean(hookUrl && isAllowedDeployHookUrl(hookUrl)) };
}
async function triggerSiteDeploy(input = {}, fetchImpl = globalThis.fetch) {
  const siteId = normalizeSiteId(input.siteId);
  const envName = deployHookEnvName(siteId);
  return { siteId, envName, ...(await triggerDeployHookUrl(env(envName), fetchImpl)) };
}
async function siteDeployTrigger(input = {}) {
  confirm(input, 'site_trigger_deploy');
  return triggerSiteDeploy(input);
}

function publicProjection(record) {
  if (!record || record.status !== 'published' || !record.published) return null;
  const p = safeDraft(record.published, { slug: record.slug });
  return {
    id: record.id,
    siteId: record.siteId,
    slug: record.slug,
    revision: Number(record.revision) || 0,
    ...p,
    publishedAt: record.publishedAt || record.published?.publishedAt || null,
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
  const item = obj(await ref.get());
  return { item, deploy: await deployStatus({ siteId }) };
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
    draft: safeDraft(input.content || {}, { slug }),
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
  if (input.content) patch.draft = safeDraft({ ...(current.draft||{}), ...input.content, seo: { ...(current.draft?.seo||{}), ...(input.content.seo||{}) } }, { slug: current.slug });
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
  const published = { ...safeDraft(current.draft || {}, { slug: current.slug }), publishedAt };
  const batch = db().batch();
  batch.set(db().collection(COLLECTIONS.revisions).doc(id + '__r' + revision), {
    contentId: id, siteId: current.siteId, slug: current.slug, revision, published, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(ref, { status: 'published', revision, published, publishedAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  const item = obj(await ref.get());
  return { item, deploy: await triggerSiteDeploy({ siteId: current.siteId }) };
}
async function contentArchive(input = {}) {
  confirm(input, 'content_archive');
  const siteId = normalizeSiteId(input.siteId);
  const ref = db().collection(COLLECTIONS.content).doc(contentDocId(siteId, input.slug));
  if (!(await ref.get()).exists) throw new Error('Public content not found');
  await ref.set({ status: 'archived', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const item = obj(await ref.get());
  return { item, deploy: await triggerSiteDeploy({ siteId }) };
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
  deployStatus, siteDeployTrigger,
  _test: { normalizeSiteId, normalizeSlug, contentDocId, safeDraft, safeLocale, translationGroupId, publicProjection, deployHookEnvName, isAllowedDeployHookUrl, triggerDeployHookUrl },
};
