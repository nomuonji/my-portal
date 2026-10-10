const { getDocumentDb, FieldValue } = require('./documentDb');
const { createHash, randomUUID } = require('node:crypto');

const DATABASE_ID = '(default)';
const COLLECTIONS = Object.freeze({
  sites: 'public_sites',
  content: 'public_content',
  revisions: 'public_content_revisions',
  editorialReviews: 'public_content_editorial_reviews',
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
function blockId(value, fallback) {
  const v = str(value, 120).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return v || fallback;
}
function safeScalar(value, max = 1000) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return str(value, max);
}
function safeDatasetColumn(input = {}, index = 0) {
  const key = str(input.key, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || ('field_' + (index + 1));
  return {
    key,
    label: str(input.label || key, 120),
    type: ['text','status','date','url','number','boolean'].includes(input.type) ? input.type : 'text',
    primary: input.primary === true,
  };
}
function safeDatasetRecord(input = {}, columns = []) {
  const out = {};
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(input || {}, column.key)) continue;
    out[column.key] = safeScalar(input[column.key], 2000);
  }
  return out;
}
function safeBlock(input = {}, index = 0) {
  const type = ['markdown','dataset','timeline','summary','diagram'].includes(input.type) ? input.type : 'markdown';
  const base = {
    id: blockId(input.id, type + '-' + (index + 1)),
    type,
    placement: input.placement === 'before-body' ? 'before-body' : 'after-body',
    title: str(input.title, 300),
  };
  if (type === 'markdown') return { ...base, markdown: str(input.markdown, 50000) };
  if (type === 'summary') return {
    ...base,
    text: str(input.text, 5000),
    items: strings(input.items, 12, 800),
    status: str(input.status, 120),
  };
  if (type === 'diagram') return { ...base, mermaid: str(input.mermaid, 30000) };
  if (type === 'timeline') return {
    ...base,
    items: (Array.isArray(input.items) ? input.items : []).slice(0, 200).map((item) => ({
      date: str(item?.date, 80),
      label: str(item?.label, 120),
      title: str(item?.title, 300),
      body: str(item?.body, 3000),
      status: str(item?.status, 120),
    })).filter((item) => item.date || item.label || item.title || item.body),
  };
  const columns = (Array.isArray(input.columns) ? input.columns : []).slice(0, 20).map(safeDatasetColumn);
  const sortKey = str(input.sort?.key, 80);
  return {
    ...base,
    description: str(input.description, 3000),
    view: ['table','cards','matrix','tracker'].includes(input.view) ? input.view : 'table',
    columns,
    records: (Array.isArray(input.records) ? input.records : []).slice(0, 500).map((record) => safeDatasetRecord(record, columns)),
    sort: sortKey && columns.some((column) => column.key === sortKey)
      ? { key: sortKey, direction: input.sort?.direction === 'desc' ? 'desc' : 'asc' }
      : null,
  };
}
function safeBlocks(value) {
  return (Array.isArray(value) ? value : []).slice(0, 40).map(safeBlock);
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
    blocks: safeBlocks(input.blocks),
    locale,
    translationGroupId: translationGroupId(input.translationGroupId, context.slug),
    originalLocale: safeLocale(input.originalLocale || locale, context.slug),
    translatedFromRevision: safeRevision(input.translatedFromRevision),
    seo: safeSeo(input.seo || {}),
  };
}
const PRIVACY_PATTERNS = Object.freeze([
  { type: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'phone', pattern: /(?:\+81[-\s]?(?:\d[-\s]?){9,10}|0(?:50|70|80|90)[-\s]?\d{4}[-\s]?\d{4}|0\d{1,4}-\d{1,4}-\d{4})/g },
  { type: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { type: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { type: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { type: 'openai_style_token', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi },
  { type: 'credential_assignment', pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/gi },
  { type: 'credentialed_url', pattern: /https?:\/\/[^\s<>"']+[?&](?:access_token|auth|api[_-]?key|apikey|token|secret|password)=[^\s&#<>"']+/gi },
]);

function publicTextFields(content = {}) {
  const seo = content.seo || {};
  return {
    title: content.title,
    summary: content.summary,
    bodyMarkdown: content.bodyMarkdown,
    tags: Array.isArray(content.tags) ? content.tags.join('\n') : '',
    keyTakeaways: Array.isArray(content.keyTakeaways) ? content.keyTakeaways.join('\n') : '',
    blocks: JSON.stringify(content.blocks || []),
    translationGroupId: content.translationGroupId,
    seoTitle: seo.title,
    seoDescription: seo.description,
    seoCanonicalPath: seo.canonicalPath,
  };
}

function scanPublicContent(content = {}) {
  const issues = [];
  const fields = publicTextFields(content);
  for (const [field, raw] of Object.entries(fields)) {
    const value = String(raw || '');
    if (!value) continue;
    for (const rule of PRIVACY_PATTERNS) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(value)) issues.push({ field, type: rule.type });
      rule.pattern.lastIndex = 0;
    }
  }
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    note: 'Deterministic scan only. Semantic privacy review is still required for names, addresses, affiliations, quasi-identifiers, and context-dependent secrets.',
  };
}

function assertPrivacySafe(content = {}) {
  const scan = scanPublicContent(content);
  if (!scan.ok) {
    const summary = scan.issues.slice(0, 12).map((issue) => issue.type + ' in ' + issue.field).join('; ');
    throw new Error('Public CMS privacy gate blocked publish: ' + summary + '. Redact/generalize before publishing.');
  }
  return scan;
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
// Site-specific routing and editorial ownership; the public API still serves only published projections.
function safePublicationContract(input = {}) {
  const routePrefix = str(input.routePrefix || '/notes/', 80);
  if (!/^\/[a-z0-9-]+\/$/.test(routePrefix)) throw new Error('publicationContract.routePrefix must be one URL segment such as /features/');
  const owner = str(input.owner || 'editorial-cms', 80);
  if (!['agent-hq','editorial-cms'].includes(owner)) throw new Error('Invalid publicationContract.owner');
  return {
    routePrefix,
    owner,
    mode: 'additive',
    // Frontends render this route only. The CMS never replaces repo-owned routes or files.
    editorialScope: str(input.editorialScope, 2500),
    excludedPaths: strings(input.excludedPaths, 20, 120),
  };
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
    publicationContract: safePublicationContract(data.publicationContract || (existing.exists ? existing.data()?.publicationContract : {}) || {}),
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
  const editing = await requireEditingSession(input,siteId,slug);
  const now = FieldValue.serverTimestamp();
  await ref.set({
    siteId, slug, status: 'draft', revision: 0,
    draft: safeDraft(input.content || {}, { slug }),
    published: null,
    sourceRefs: safeSources(input.sourceRefs),
    seoResearch: input.seoResearch && typeof input.seoResearch === 'object' ? input.seoResearch : {},
    editorialStart: editing,
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
  const editing = input.content ? await requireEditingSession(input,current.siteId,current.slug) : null;
  const patch = { updatedAt: FieldValue.serverTimestamp(), ...(editing ? {editorialStart:editing} : {}) };
  if (input.content) patch.draft = safeDraft({ ...(current.draft||{}), ...input.content, seo: { ...(current.draft?.seo||{}), ...(input.content.seo||{}) } }, { slug: current.slug });
  if (input.sourceRefs) patch.sourceRefs = safeSources(input.sourceRefs);
  if (input.seoResearch && typeof input.seoResearch === 'object') patch.seoResearch = input.seoResearch;
  await ref.set(patch, { merge: true });
  return { item: obj(await ref.get()) };
}
async function contentPrivacyScan(input = {}) {
  const id = contentDocId(input.siteId, input.slug);
  const ref = db().collection(COLLECTIONS.content).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new Error('Public content not found');
  const current = obj(existing);
  const draft = safeDraft(current.draft || {}, { slug: current.slug });
  return { siteId: current.siteId, slug: current.slug, revision: Number(current.revision) || 0, scan: scanPublicContent(draft) };
}


const EDITORIAL_METHOD_ID = 'TbvbUVFjkC2xPAbNqU2Q'; // Public Content Publishing: active version remains the source of truth
const EDITORIAL_CHECKS = Object.freeze([
  'readerContract','narrativeStructure','concreteExampleOrRationale',
  'terminologyExplained','wholeArticleEdit','factsAndUncertainty','semanticPrivacy'
]);
function draftFingerprint(draft) {
  return createHash('sha256').update(JSON.stringify(draft)).digest('hex');
}
function validateEditingSession(session,siteId,slug,policyVersion,now=Date.now()) {
  if (!session || !['begun','prepared'].includes(session.status))
    throw new Error('Editorial gate: writing session missing; call public_content_editorial_prepare before creating/editing content.');
  if (session.siteId!==siteId || session.slug!==slug ||
      session.methodId!==EDITORIAL_METHOD_ID || session.methodVersionId!==policyVersion)
    throw new Error('Editorial gate: writing session does not match the site, slug, or active Method.');
  if (!session.preparedAt || !Number.isFinite(Date.parse(session.preparedAt)) ||
      now < Date.parse(session.preparedAt) || now-Date.parse(session.preparedAt)>86400000)
    throw new Error('Editorial gate: writing session expired; read the active Method again.');
  return true;
}
async function requireEditingSession(input,siteId,slug) {
  const sessionId = required(input.editorialSessionId,'editorialSessionId',100);
  const sessionSnap = await db().collection(COLLECTIONS.editorialReviews).doc(sessionId).get();
  const method = await activeEditorialMethod();
  validateEditingSession(sessionSnap.exists ? obj(sessionSnap) : null,siteId,slug,method.methodVersionId);
  return {sessionId,methodVersionId:method.methodVersionId};
}
function validateEditorialReceipt(receipt, review, policyVersion, fingerprint, now = Date.now()) {
  if (!receipt || !review || review.status !== 'approved' || receipt.reviewId !== review.id)
    throw new Error('Editorial gate: no completed review. Call public_content_editorial_prepare then public_content_editorial_approve.');
  if (review.methodId !== EDITORIAL_METHOD_ID || review.methodVersionId !== policyVersion ||
      receipt.methodVersionId !== policyVersion)
    throw new Error('Editorial gate: active writing Method changed; retrieve and review the latest rules.');
  if (review.draftFingerprint !== fingerprint || receipt.draftFingerprint !== fingerprint)
    throw new Error('Editorial gate: draft changed after review; repeat the full editorial review.');
  if (!review.approvedAt || !Number.isFinite(Date.parse(review.approvedAt)) ||
      now - Date.parse(review.approvedAt) > 7 * 86400000 || now < Date.parse(review.approvedAt))
    throw new Error('Editorial gate: editorial receipt expired; review the draft again.');
  if (!EDITORIAL_CHECKS.every(check => review.checks?.[check] === true))
    throw new Error('Editorial gate: not all required reader and privacy checks were attested.');
  return { reviewId: receipt.reviewId, methodVersionId: policyVersion, draftFingerprint: fingerprint };
}
async function activeEditorialMethod() {
  const database = db();
  const methodDoc = await database.collection('methods').doc(EDITORIAL_METHOD_ID).get();
  if (!methodDoc.exists || methodDoc.data()?.status !== 'active' || !methodDoc.data()?.currentVersionId)
    throw new Error('Editorial gate: no active Public Content Publishing Method; publishing is blocked.');
  const version = await database.collection('methodVersions').doc(methodDoc.data().currentVersionId).get();
  if (!version.exists || version.data()?.methodId !== EDITORIAL_METHOD_ID || version.data()?.status !== 'active')
    throw new Error('Editorial gate: active Method version unavailable; publishing is blocked.');
  return { methodId: EDITORIAL_METHOD_ID, methodVersionId: version.id,
    versionNumber: Number(version.data().versionNumber), instructions: version.data().instructions || '',
    protocol: version.data().protocol || {}, qualityGates: version.data().qualityGates || [] };
}
async function contentEditorialPrepare(input = {}) {
  const siteId = normalizeSiteId(input.siteId);
  const slug = normalizeSlug(input.slug);
  const contentSnap = await db().collection(COLLECTIONS.content).doc(contentDocId(siteId,slug)).get();
  const current = contentSnap.exists ? obj(contentSnap) : null;
  const draft = current ? safeDraft(current.draft || {}, {slug}) : null;
  const method = await activeEditorialMethod();
  const reviewId = randomUUID();
  const now = new Date().toISOString();
  await db().collection(COLLECTIONS.editorialReviews).doc(reviewId).set({
    id: reviewId, siteId, slug, methodId: method.methodId, methodVersionId: method.methodVersionId,
    draftFingerprint: draft ? draftFingerprint(draft) : null,
    status: draft ? 'prepared' : 'begun', preparedAt: now
  });
  const siteSnap = await db().collection(COLLECTIONS.sites).doc(siteId).get();
  if (!siteSnap.exists || siteSnap.data()?.status !== 'active') throw new Error('Editorial gate: target CMS site unavailable or inactive.');
  return { reviewId, mode: draft ? 'review_draft' : 'begin_writing',
    draftFingerprint: draft ? draftFingerprint(draft) : null, preparedAt: now,
    requiredChecks: EDITORIAL_CHECKS, method,
    // Editorial Method is global; additionally read the organization-specific contract.
    publicationContract: safePublicationContract(siteSnap.data()?.publicationContract || {}) };
}

// Only Antonbase Notes uses this versioned, genre-sensitive private angle brief.
// It is a review-process audit, NOT an automated verdict that prose is engaging.
// Never publish these notes or expose their contents in an error message.
function assertEditorialAngleEvidence(siteId, versionNumber, notes) {
  if (siteId !== 'antonbase-notes' || versionNumber < 9) return true;
  const required = [
    ['sourceMotive', 24],
    ['readerPull', 24],
    ['angleAlternatives', 32],
    ['leadCheck', 24],
  ];
  const evidence = [];
  for (const [label, minChars] of required) {
    const match = String(notes).match(new RegExp('(?:^|\\n)' + label + '\\s*:\\s*([^\\n]+)', 'i'));
    const value = match?.[1]?.trim() || '';
    if (value.length < minChars || /^(?:n\/?a|none|なし|確認済み|問題なし|ok|yes|pass|todo)$/i.test(value)) {
      throw new Error('Editorial angle gate: private reviewNotes must include substantive ' + label +
        ': evidence before approving Antonbase Notes; revise angle and lead rather than attesting without review.');
    }
    // Distinct editorial questions must not be answered by copying the same
    // generic paragraph. This is a mechanical sanity check, not a prose score.
    const normalized = value.normalize('NFKC').toLowerCase()
      .replace(/[\\s\\p{P}\\p{S}]+/gu, '');
    if (normalized.length < 12 || evidence.includes(normalized) ||
        /(.)\\1{15,}/u.test(normalized)) {
      throw new Error('Editorial angle gate: each section needs distinct, non-placeholder evidence; revise ' + label + '.');
    }
    evidence.push(normalized);
  }
  return true;
}

async function contentEditorialApprove(input = {}) {
  confirm(input, 'editorial_approve');
  const siteId = normalizeSiteId(input.siteId);
  const slug = normalizeSlug(input.slug);
  const reviewId = required(input.reviewId, 'reviewId', 100);
  const checks = input.checks || {};
  if (!EDITORIAL_CHECKS.every(check=>checks[check]===true))
    throw new Error('Editorial gate: all required semantic checks must be completed before approval.');
  const notes = required(input.reviewNotes, 'reviewNotes', 3000);
  if (notes.length < 80) throw new Error('Editorial gate: reviewNotes must explain the reader test and evidence (80+ characters).');
  const ref = db().collection(COLLECTIONS.editorialReviews).doc(reviewId);
  const reviewSnap = await ref.get();
  if (!reviewSnap.exists || reviewSnap.data()?.status !== 'prepared' ||
      reviewSnap.data()?.siteId !== siteId || reviewSnap.data()?.slug !== slug)
    throw new Error('Editorial gate: no matching prepared review.');
  const prepared = reviewSnap.data();
  if (!Number.isFinite(Date.parse(prepared.preparedAt)) ||
      Date.now() - Date.parse(prepared.preparedAt) > 86400000)
    throw new Error('Editorial gate: prepared review expired; retrieve the latest rules again.');
  const [method, contentSnap] = await Promise.all([
    activeEditorialMethod(),db().collection(COLLECTIONS.content).doc(contentDocId(siteId,slug)).get()
  ]);
  if (!contentSnap.exists) throw new Error('Public content not found');
  const fingerprint = draftFingerprint(safeDraft(contentSnap.data()?.draft || {}, {slug}));
  if (method.methodVersionId !== prepared.methodVersionId || fingerprint !== prepared.draftFingerprint)
    throw new Error('Editorial gate: Method version or draft changed; prepare and review again.');
  assertPrivacySafe(safeDraft(contentSnap.data()?.draft || {}, {slug}));
  assertEditorialAngleEvidence(siteId, method.versionNumber, notes);
  const approvedAt = new Date().toISOString();
  const receipt = { reviewId, methodVersionId: method.methodVersionId, draftFingerprint: fingerprint, approvedAt };
  const batch = db().batch();
  batch.set(ref,{status:'approved',checks:Object.fromEntries(EDITORIAL_CHECKS.map(key=>[key,true])),
    reviewNotes:notes,reviewer:required(input.reviewer,'reviewer',120),approvedAt},{merge:true});
  batch.set(contentSnap.ref,{editorialReview:receipt,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await batch.commit();
  return { siteId,slug, editorialReview:receipt, approved:true,
    note:'Human-readable clarity was attested by the reviewer, not automatically proven by software.' };
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
  const candidate = safeDraft(current.draft || {}, { slug: current.slug });
  const privacyScan = assertPrivacySafe(candidate);
  const method = await activeEditorialMethod();
  const receipt = current.editorialReview;
  const reviewSnap = receipt?.reviewId
    ? await db().collection(COLLECTIONS.editorialReviews).doc(receipt.reviewId).get()
    : null;
  const editorialReview = validateEditorialReceipt(receipt, reviewSnap?.exists ? obj(reviewSnap) : null,
    method.methodVersionId, draftFingerprint(candidate));
  const published = { ...candidate, publishedAt };
  const batch = db().batch();
  batch.set(db().collection(COLLECTIONS.revisions).doc(id + '__r' + revision), {
    contentId: id, siteId: current.siteId, slug: current.slug, revision, published, editorialReview, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(ref, { status: 'published', revision, published, publishedAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  const item = obj(await ref.get());
  return { item, privacyScan, editorialReview, deploy: await triggerSiteDeploy({ siteId: current.siteId }) };
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
  contentCreate, contentUpdate, contentPrivacyScan, contentEditorialPrepare, contentEditorialApprove, contentPublish, contentArchive, publicGet, publicList,
  deployStatus, siteDeployTrigger,
  _test: { EDITORIAL_METHOD_ID, EDITORIAL_CHECKS, assertEditorialAngleEvidence, draftFingerprint, validateEditingSession, validateEditorialReceipt, normalizeSiteId, normalizeSlug, contentDocId, safePublicationContract, safeDraft, safeBlocks, safeBlock, safeLocale, translationGroupId, publicProjection, scanPublicContent, assertPrivacySafe, deployHookEnvName, isAllowedDeployHookUrl, triggerDeployHookUrl },
};
