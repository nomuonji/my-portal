'use strict';
/**
 * Discover = lightweight personal RSS reader.
 *
 * Sources:   curation_sources (情報源ライブラリ) — the single source registry.
 * Items:     discoverReaderItems — title/link/short excerpt only, kept ~7 days.
 * Signals:   discoverReaderSignals — compact per-item reaction features; never purged.
 * Model:     discoverReaderModel/current — feature counters derived from signals.
 *
 * Legacy AI-curated items (personalDiscoveryFeed, cur-*) are shown in the same
 * stream as the "AI選書" source and follow the same retention rule.
 */
const { createHash } = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { getDocumentDb, FieldValue, FieldPath } = require('./documentDb');
const { parseFeed, discoverFeedLinks, absolute } = require('./discoverFeedParser');
const model = require('./discoverReaderModel');
const { normalizedSource, sourceId } = require('./curationSourceRules');

const ITEMS = 'discoverReaderItems';
const SIGNALS = 'discoverReaderSignals';
const MODEL = 'discoverReaderModel';
const SOURCES = 'curation_sources';
const LEGACY = 'personalDiscoveryFeed';
const LEGACY_SOURCE_ID = 'agent-curation';
const DAY = 86400000;
const RETENTION_DAYS = 7;
const KEEP_MARKED_DAYS = 30;
const MAX_ITEMS_PER_FETCH = 40;
const FETCH_TIMEOUT_MS = 9000;
const MAX_FEED_BYTES = 2_500_000;
const DEFAULT_INTERVAL_MIN = 60;
const USER_AGENT = 'MyPortalReader/1.0 (+https://my-portal-agent.netlify.app; personal RSS reader)';

const itemsDb = () => getDocumentDb(process.env.AGENT_IDEAS_DATABASE_ID || '(default)');
const sourcesDb = () => getDocumentDb('(default)');
const trim = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
const hash = s => createHash('sha256').update(String(s)).digest('hex').slice(0, 30);
const iso = v => v?.toDate?.()?.toISOString?.() || (typeof v === 'string' ? v : null);
const nowIso = () => new Date().toISOString();

/**
 * Read documents by id with chunked `documentId in [...]` queries (30 per query).
 * Do NOT use db.getAll here: with the REST transport used on Netlify it measured about
 * 160ms per document (60 docs = 9.6s), which made fetches, paging and read marks time out.
 * A query returns all matches in one round trip. Returns Map(id -> data).
 */
async function getByIds(collection, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map(chunk =>
    itemsDb().collection(collection).where(FieldPath.documentId(), 'in', chunk).get()));
  const out = new Map();
  for (const snap of snaps) for (const doc of snap.docs) out.set(doc.id, doc.data());
  return out;
}

// ---------------------------------------------------------------- URLs / network
function youtubeId(value) {
  try {
    const u = new URL(value), h = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    const id = h === 'youtu.be' ? u.pathname.split('/')[1]
      : ['youtube.com', 'youtube-nocookie.com'].includes(h)
        ? (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/embed/')) ? u.pathname.split('/')[2] : u.searchParams.get('v') : '';
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : '';
  } catch { return ''; }
}
const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|_hs|spm$|from$|feature$)/i;
function canonicalUrl(raw) {
  const url = absolute(raw);
  if (!url) return '';
  const vid = youtubeId(url);
  if (vid) return 'https://www.youtube.com/watch?v=' + vid;
  const u = new URL(url);
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.toString();
}
function privateAddress(addr) {
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = addr.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateAddress(v.slice(7));
}
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Error('Invalid URL'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw Error('Only public HTTPS URLs can be fetched');
  if (u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) throw Error('Private host refused');
  if (net.isIP(u.hostname)) { if (privateAddress(u.hostname)) throw Error('Private address refused'); return u; }
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw Error('Host could not be resolved: ' + u.hostname);
  if (addrs.some(a => privateAddress(a.address))) throw Error('Private address refused');
  return u;
}
/** GET with SSRF checks on every redirect hop, timeout and size cap. */
async function safeFetch(url, { headers = {}, timeoutMs = FETCH_TIMEOUT_MS, accept = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.6, */*;q=0.3' } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: accept, ...headers } });
    } catch (error) {
      clearTimeout(timer);
      throw Error(error?.name === 'AbortError' ? 'Timed out after ' + Math.round(timeoutMs / 100) / 10 + 's' : 'Network error: ' + String(error?.message || error).slice(0, 160));
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      const next = new URL(res.headers.get('location'), current);
      if (next.protocol === 'http:') next.protocol = 'https:';
      current = next.toString();
      continue;
    }
    try {
      if (res.status === 304) return { status: 304, url: current, headers: res.headers, body: '' };
      const reader = res.body?.getReader?.();
      let size = 0; const chunks = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_FEED_BYTES) { controller.abort(); throw Error('Response too large'); }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
      return { status: res.status, url: current, headers: res.headers, body };
    } finally { clearTimeout(timer); }
  }
  throw Error('Too many redirects');
}

// ---------------------------------------------------------------- sources
function sourceView(doc) {
  const d = typeof doc.data === 'function' ? doc.data() : doc;
  return {
    id: doc.id || d.id, title: d.title, url: d.url, feedUrl: d.feedUrl || '', status: d.status,
    accessMethod: d.accessMethod, rightsStatus: d.rightsStatus, fetchVerification: d.fetchVerification,
    category: d.category || '', priority: Number(d.priority) || 0, fetchIntervalMinutes: Number(d.fetchIntervalMinutes) || DEFAULT_INTERVAL_MIN,
    tags: d.tags || [], notes: d.notes || '', selectionType: d.selectionType, selectionDescription: d.selectionDescription || '',
    reader: d.reader || {}, createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt),
  };
}
const readable = s => s.status === 'active' && s.accessMethod === 'rss' && s.feedUrl;
async function allSources() {
  const snap = await sourcesDb().collection(SOURCES).limit(500).get();
  return snap.docs.map(sourceView);
}
async function readModel() {
  const snap = await itemsDb().collection(MODEL).doc('current').get();
  return snap.exists ? (snap.data().entries || []) : [];
}
async function sourcesList(args = {}) {
  const [sources, entries] = await Promise.all([allSources(), readModel()]);
  const map = model.toMap(entries);
  const items = sources
    .filter(s => args.includeArchived || s.status !== 'archived')
    .map(s => {
      const v = map.get('src:' + s.id) || [0, 0];
      return { ...s, readable: Boolean(readable(s)), learned: { positive: v[0], negative: v[1], weight: Math.round(model.featureWeight(v[0], v[1]) * 1000) / 1000 } };
    })
    .sort((a, b) => Number(b.readable) - Number(a.readable) || (b.learned.weight - a.learned.weight) || String(a.title).localeCompare(String(b.title)));
  return { items, count: items.length, readableCount: items.filter(s => s.readable).length, registry: SOURCES };
}
/** Resolve a site or feed URL to a parsed feed. Accepts YouTube channel/@handle pages. */
async function resolveFeed(input) {
  const start = absolute(input);
  if (!start) throw Error('A valid https URL is required');
  const first = await safeFetch(start);
  if (first.status >= 400) throw Error('HTTP ' + first.status + ' from ' + start);
  try {
    const feed = parseFeed(first.body, first.url);
    return { feedUrl: first.url, feed, discoveredFrom: null };
  } catch {
    const links = discoverFeedLinks(first.body, first.url);
    if (!links.length) throw Error('No RSS/Atom feed found at ' + start + '. Give the feed URL directly.');
    const res = await safeFetch(links[0].url);
    if (res.status >= 400) throw Error('HTTP ' + res.status + ' from ' + links[0].url);
    return { feedUrl: res.url, feed: parseFeed(res.body, res.url), discoveredFrom: start, alternatives: links.slice(1) };
  }
}
async function sourceTest(args = {}) {
  const target = trim(args.feedUrl || args.url, 2048);
  const { feedUrl, feed, discoveredFrom, alternatives } = await resolveFeed(target);
  const recent = feed.items.filter(i => !i.publishedAt || Date.now() - Date.parse(i.publishedAt) < RETENTION_DAYS * DAY);
  return {
    ok: true, feedUrl, discoveredFrom, alternatives: alternatives || [], format: feed.kind, title: feed.title, siteUrl: feed.siteUrl,
    itemCount: feed.items.length, itemsWithinRetention: recent.length,
    sample: feed.items.slice(0, 6).map(i => ({ title: i.title, url: i.url, publishedAt: i.publishedAt || null, excerpt: i.excerpt.slice(0, 140) })),
  };
}
/**
 * Add or edit a reader source. The feed is fetched and parsed before it can be
 * active, so a typo never silently produces an empty source.
 */
async function sourceUpsert(args = {}) {
  const ref0 = trim(args.id, 80);
  let existing = null;
  if (ref0) {
    const snap = await sourcesDb().collection(SOURCES).doc(ref0).get();
    if (!snap.exists) throw Error('Source not found: ' + ref0);
    existing = snap.data();
  }
  const patch = {};
  for (const key of ['title', 'category', 'notes', 'selectionType', 'selectionDescription', 'useCase', 'rightsStatus', 'rightsEvidenceUrl'])
    if (args[key] !== undefined) patch[key] = args[key];
  if (args.tags !== undefined) patch.tags = args.tags;
  if (args.priority !== undefined) patch.priority = args.priority;
  if (args.fetchIntervalMinutes !== undefined) patch.fetchIntervalMinutes = args.fetchIntervalMinutes;
  if (args.status !== undefined) patch.status = args.status;
  let test = null;
  const wantsFeed = args.feedUrl !== undefined || (!existing && args.url);
  if (wantsFeed || (args.status === 'active' && existing && existing.fetchVerification !== 'verified')) {
    test = await sourceTest({ feedUrl: args.feedUrl || existing?.feedUrl, url: args.url || existing?.url });
    patch.feedUrl = test.feedUrl;
    patch.accessMethod = 'rss';
    patch.fetchVerification = 'verified';
    if (!existing && !patch.title) patch.title = test.title || new URL(test.feedUrl).hostname;
  }
  const siteUrl = existing?.url || absolute(args.url) || test?.siteUrl || test?.feedUrl;
  if (!existing) {
    if (!siteUrl) throw Error('url or feedUrl is required');
    if (patch.status === undefined) patch.status = 'active';
  }
  const data = normalizedSource({ ...patch, url: siteUrl }, existing || {});
  const id = existing ? ref0 : sourceId(data.url);
  if (!existing) {
    const dupe = await sourcesDb().collection(SOURCES).doc(id).get();
    if (dupe.exists) existing = dupe.data();
  }
  const ref = sourcesDb().collection(SOURCES).doc(id);
  const feedChanged = Boolean(existing && test && existing.feedUrl && existing.feedUrl !== test.feedUrl);
  // A new feed URL starts with a clean "already seen" list so its items are ingested.
  const resetReader = feedChanged ? { reader: { seen: [], lastFetchedAt: null, etag: '', lastModified: '' } } : {};
  await ref.set({ ...data, ...resetReader, ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  // Items from a replaced feed or an archived source are dropped unless the user reacted to them.
  const clear = (args.clearItems === true || feedChanged || (existing && data.status === 'archived' && existing.status !== 'archived'))
    ? await clearUnreactedItems(id) : null;
  const saved = sourceView(await ref.get());
  return { outcome: existing ? 'updated' : 'created', source: saved, readable: Boolean(readable(saved)), test,
    clearedItems: clear ? clear.cleared : 0, ...(clear ? { clearRemaining: clear.remaining, clearMs: clear.ms } : {}) };
}
/**
 * Delete a source's items the user hasn't reacted to (no like/save/skip, never opened),
 * in batches of 100 within a time budget so a web request never times out midway.
 * Call again while `remaining` > 0.
 */
async function clearUnreactedItems(sourceId, { budgetMs = 5000 } = {}) {
  const started = Date.now();
  const snap = await itemsDb().collection(ITEMS).where('sourceId', '==', sourceId).limit(600).get();
  const doomed = snap.docs.filter(doc => { const d = doc.data(); return (d.feedback || 'new') === 'new' && !d.opened; });
  let cleared = 0;
  for (let i = 0; i < doomed.length; i += 100) {
    if (i && Date.now() - started > budgetMs) break;
    const batch = itemsDb().batch();
    doomed.slice(i, i + 100).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    cleared += Math.min(100, doomed.length - i);
  }
  return { cleared, remaining: doomed.length - cleared, ms: Date.now() - started };
}

// ---------------------------------------------------------------- fetching
function itemIdFor(url) { return 'rss-' + hash(canonicalUrl(url)); }
function buildItem(source, entry, fetchedAt) {
  const url = canonicalUrl(entry.url);
  const videoId = entry.videoId && /^[a-zA-Z0-9_-]{11}$/.test(entry.videoId) ? entry.videoId : youtubeId(url);
  const publishedAt = entry.publishedAt || fetchedAt;
  const base = {
    id: itemIdFor(url), url, title: trim(entry.title, 300), excerpt: trim(entry.excerpt, 300),
    sourceId: source.id, sourceTitle: trim(source.title, 180), category: trim(source.category, 70),
    author: trim(entry.author, 120), categories: (entry.categories || []).slice(0, 8),
    thumbnail: videoId ? 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' : (entry.thumbnail || ''),
    type: videoId ? 'video' : 'article', videoId: videoId || '',
    publishedAt, publishedAtMs: Date.parse(publishedAt), dateEstimated: !entry.publishedAt,
    fetchedAt, feedback: 'new', readAt: null, opened: false, revision: 1, schemaVersion: 1,
  };
  return { ...base, features: model.featuresOf(base) };
}
async function fetchSource(source, { force = false, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const reader = source.reader || {};
  const headers = {};
  if (!force && reader.etag) headers['If-None-Match'] = reader.etag;
  if (!force && reader.lastModified) headers['If-Modified-Since'] = reader.lastModified;
  const ref = sourcesDb().collection(SOURCES).doc(source.id);
  let httpMs = 0;
  try {
    const res = await safeFetch(source.feedUrl, { headers, timeoutMs });
    httpMs = Date.now() - started;
    if (res.status === 304) {
      await ref.set({ reader: { lastFetchedAt: nowIso(), lastStatus: 'not_modified', lastError: '', consecutiveFailures: 0, lastNewCount: 0 } }, { merge: true });
      return { sourceId: source.id, status: 'not_modified', created: 0, httpMs, ms: Date.now() - started };
    }
    if (res.status >= 400) throw Error('HTTP ' + res.status);
    const feed = parseFeed(res.body, res.url);
    const fetchedAt = nowIso(), cutoff = Date.now() - RETENTION_DAYS * DAY;
    // Everything in this feed snapshot is remembered as seen, including entries outside the
    // retention window, so routine fetches skip them without any database reads and expired
    // items never come back while they are still listed in the feed.
    const seenBefore = new Set(Array.isArray(reader.seen) ? reader.seen : (Array.isArray(reader.undatedSeen) ? reader.undatedSeen : []));
    const feedIds = [];
    const fresh = [];
    for (const entry of feed.items) {
      if (entry.publishedAt && Date.parse(entry.publishedAt) > Date.now() + DAY) entry.publishedAt = '';
      const url = canonicalUrl(entry.url);
      if (!url) continue;
      const id = itemIdFor(url);
      if (feedIds.includes(id)) continue;
      feedIds.push(id);
      if (seenBefore.has(id) && !force) continue;
      if (entry.publishedAt && Date.parse(entry.publishedAt) < cutoff) continue;
      if (fresh.length < MAX_ITEMS_PER_FETCH) fresh.push(buildItem(source, entry, fetchedAt));
    }
    let created = 0;
    const dbStarted = Date.now();
    if (fresh.length) {
      // Only new-to-this-feed entries are checked: already stored (e.g. same URL in another
      // source, or a write that was cut off) or reacted to and expired (signal tombstone).
      const [existing, signals] = await Promise.all([
        getByIds(ITEMS, fresh.map(i => i.id)),
        getByIds(SIGNALS, fresh.map(i => 'sig-' + i.id)),
      ]);
      const batch = itemsDb().batch();
      for (const item of fresh) {
        if (existing.has(item.id) || signals.has('sig-' + item.id)) continue;
        batch.set(itemsDb().collection(ITEMS).doc(item.id), { ...item, createdAt: FieldValue.serverTimestamp() });
        created++;
      }
      if (created) await batch.commit();
    }
    const seen = [...feedIds, ...[...seenBefore].filter(id => !feedIds.includes(id))].slice(0, 400);
    const etag = res.headers.get('etag') || '', lastModified = res.headers.get('last-modified') || '';
    await ref.set({
      fetchVerification: 'verified',
      reader: { lastFetchedAt: fetchedAt, lastSuccessAt: fetchedAt, lastStatus: 'ok', lastError: '', consecutiveFailures: 0,
        lastNewCount: created, lastItemCount: feed.items.length, seen, undatedSeen: FieldValue.delete(),
        etag: etag.slice(0, 200), lastModified: lastModified.slice(0, 100), feedTitle: feed.title },
    }, { merge: true });
    return { sourceId: source.id, status: 'ok', created, inFeed: feed.items.length, newToFeed: fresh.length, httpMs, dbMs: Date.now() - dbStarted, ms: Date.now() - started };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 300);
    const failures = (Number(reader.consecutiveFailures) || 0) + 1;
    await ref.set({
      ...(failures >= 5 ? { fetchVerification: 'failed' } : {}),
      reader: { lastFetchedAt: nowIso(), lastStatus: 'error', lastError: message, consecutiveFailures: failures },
    }, { merge: true }).catch(() => {});
    return { sourceId: source.id, status: 'error', error: message, httpMs, ms: Date.now() - started };
  }
}
async function pool(list, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (i < list.length) { const idx = i++; out[idx] = await fn(list[idx]); }
  }));
  return out;
}
/**
 * Fetch due (or forced) sources within a time budget. Web requests on Netlify are
 * cut at ~10s, so callers pass budgetMs and repeat while `remaining` > 0; each
 * source's result is written as soon as it finishes, so partial progress is kept.
 */
async function fetchDue(args = {}) {
  const started = Date.now();
  const budgetMs = Math.max(3000, Math.min(60000, Number(args.budgetMs) || 7000));
  const deadline = started + budgetMs;
  const now = started;
  const only = trim(args.sourceId, 80);
  const sources = (await allSources()).filter(s => only ? s.id === only : readable(s));
  if (only && !sources.length) throw Error('Source not found: ' + only);
  if (only && !sources[0].feedUrl) throw Error('Source has no feedUrl');
  const due = sources.filter(s => args.force || only || !s.reader?.lastFetchedAt
    || now - Date.parse(s.reader.lastFetchedAt) >= Math.max(30, s.fetchIntervalMinutes) * 60000 * (s.reader.consecutiveFailures >= 3 ? 4 : 1) - 120000)
    .sort((a, b) => (Date.parse(a.reader?.lastFetchedAt || 0) || 0) - (Date.parse(b.reader?.lastFetchedAt || 0) || 0))
    .slice(0, Math.min(60, Number(args.maxSources) || 40));
  let skipped = 0;
  const results = (await pool(due, 4, async s => {
    const left = deadline - Date.now();
    // Each source needs the request plus up to three database round trips (~0.7s each in
    // production), so don't start one that can't finish inside the request limit.
    if (left < 4000) { skipped++; return null; }
    return fetchSource(s, { force: Boolean(args.force), timeoutMs: Math.max(1500, Math.min(FETCH_TIMEOUT_MS, left - 3000)) });
  })).filter(Boolean);
  return {
    checkedSources: sources.length, due: due.length, fetched: results.length, remaining: skipped,
    created: results.reduce((n, r) => n + (r.created || 0), 0),
    errors: results.filter(r => r.status === 'error'), results, ms: Date.now() - started,
  };
}

// ---------------------------------------------------------------- retention
function keepDays(feedback) { return ['loved', 'saved'].includes(feedback) ? KEEP_MARKED_DAYS : RETENTION_DAYS; }
async function purge() {
  await importLegacySignalsOnce();
  const now = Date.now();
  let deleted = 0, legacyDeleted = 0;
  const snap = await itemsDb().collection(ITEMS).where('publishedAtMs', '<', now - RETENTION_DAYS * DAY).limit(400).get();
  const batch = itemsDb().batch();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (now - (d.publishedAtMs || 0) > keepDays(d.feedback) * DAY) { batch.delete(doc.ref); deleted++; }
  }
  // Legacy AI picks: retention by ingestion time. Their reactions were already converted to signals.
  const legacy = await itemsDb().collection(LEGACY).orderBy('createdAt', 'asc').limit(300).get();
  for (const doc of legacy.docs) {
    const d = doc.data();
    const created = Date.parse(iso(d.createdAt) || '') || now;
    if (now - created > keepDays(d.feedback) * DAY) {
      batch.delete(doc.ref); legacyDeleted++;
    }
  }
  if (deleted || legacyDeleted) await batch.commit();
  return { deleted, legacyDeleted, retentionDays: RETENTION_DAYS, keepMarkedDays: KEEP_MARKED_DAYS };
}
async function runScheduled() {
  const started = Date.now();
  const runRef = itemsDb().collection(MODEL).doc('lastRun');
  // Written first, so a run that is cut off still shows up as "started, not finished".
  await runRef.set({ startedAt: nowIso(), status: 'running', at: null });
  const fetched = await fetchDue({ budgetMs: 20000 });
  const run = { startedAt: new Date(started).toISOString(), at: nowIso(), status: 'fetched', ms: Date.now() - started,
    fetched: fetched.fetched, remaining: fetched.remaining, created: fetched.created,
    errors: fetched.errors.map(e => ({ sourceId: e.sourceId, error: e.error })).slice(0, 20),
    timings: fetched.results.map(r => ({ sourceId: r.sourceId, ms: r.ms, httpMs: r.httpMs, dbMs: r.dbMs })).slice(0, 40) };
  await runRef.set(run);
  const purged = Date.now() - started < 24000 ? await purge() : { deleted: 0, legacyDeleted: 0, skipped: 'out of time' };
  const done = { ...run, ...purged, status: 'done', ms: Date.now() - started, at: nowIso() };
  await runRef.set(done);
  return done;
}

// ---------------------------------------------------------------- signals / model
function legacyToItem(d) {
  return {
    id: d.id, url: d.url, title: d.title, excerpt: d.description || '', sourceId: LEGACY_SOURCE_ID, sourceTitle: 'AI選書',
    author: d.creator || '', categories: [d.category, ...(d.tags || [])].filter(Boolean), type: d.type === 'video' ? 'video' : 'article',
  };
}
/** Persist a reaction as a compact signal and update the model counters atomically. */
async function recordSignal(item, { label, opened }) {
  const sigRef = itemsDb().collection(SIGNALS).doc('sig-' + item.id);
  const modelRef = itemsDb().collection(MODEL).doc('current');
  const features = item.features?.length ? item.features : model.featuresOf(item);
  await itemsDb().runTransaction(async tx => {
    const [sig, cur] = await Promise.all([tx.get(sigRef), tx.get(modelRef)]);
    const prev = sig.exists ? sig.data() : null;
    const nextLabel = label ?? prev?.label ?? 'new';
    const nextOpened = Boolean(opened ?? prev?.opened);
    const before = prev?.applied || { p: 0, n: 0 };
    const after = model.evidenceOf(nextLabel, nextOpened);
    const entries = model.applyDelta(cur.exists ? cur.data().entries : [], prev?.features || features, before, after);
    tx.set(modelRef, { entries, updatedAt: nowIso(), signalVersion: 1 });
    tx.set(sigRef, {
      itemId: item.id, url: trim(item.url, 1600), title: trim(item.title, 300), sourceId: item.sourceId || '', sourceTitle: trim(item.sourceTitle, 180),
      features: prev?.features || features, label: nextLabel, opened: nextOpened, applied: after,
      firstAt: prev?.firstAt || nowIso(), updatedAt: nowIso(),
    });
  });
}
let legacyImported = false;
/** Convert reactions on old AI picks into signals, a few per run so it never blocks a run. */
async function importLegacySignalsOnce(maxPerRun = 15) {
  if (legacyImported) return;
  const marker = itemsDb().collection(MODEL).doc('legacy-import-v1');
  const m = await marker.get();
  if (m.exists && m.data().done) { legacyImported = true; return; }
  const done = new Set(m.exists ? (m.data().ids || []) : []);
  const snap = await itemsDb().collection(LEGACY).limit(500).get();
  const todo = snap.docs.filter(doc => { const f = doc.data().feedback; return f && f !== 'new' && !done.has(doc.id); });
  for (const doc of todo.slice(0, maxPerRun)) {
    const d = doc.data();
    await recordSignal(legacyToItem({ id: doc.id, ...d }), { label: d.feedback === 'seen' ? 'new' : d.feedback, opened: d.feedback === 'seen' });
    done.add(doc.id);
  }
  const finished = todo.length <= maxPerRun;
  await marker.set({ ids: [...done].slice(-600), done: finished, imported: done.size, at: nowIso() });
  if (finished) legacyImported = true;
}

// ---------------------------------------------------------------- reading API
function itemView(d, id) {
  return {
    id: id || d.id, url: d.url, title: d.title, excerpt: d.excerpt || '', sourceId: d.sourceId, sourceTitle: d.sourceTitle,
    category: d.category || '', author: d.author || '', categories: d.categories || [], thumbnail: d.thumbnail || '',
    type: d.type, videoId: d.videoId || '', publishedAt: d.publishedAt || null, dateEstimated: Boolean(d.dateEstimated),
    feedback: d.feedback || 'new', readAt: d.readAt || null, opened: Boolean(d.opened), revision: d.revision || 1,
    features: d.features || [], origin: 'rss',
  };
}
function legacyView(doc) {
  const d = doc.data();
  const base = legacyToItem({ id: doc.id, ...d });
  const published = d.publishedAt || iso(d.createdAt);
  return {
    ...base, excerpt: d.description || '', reason: d.reason || '', category: d.category || '', thumbnail: d.thumbnail || '',
    videoId: d.videoId || '', publishedAt: published || null, ingestedAt: iso(d.createdAt), feedback: d.feedback === 'seen' ? 'new' : (d.feedback || 'new'),
    readAt: d.readerReadAt || (d.feedback === 'seen' ? iso(d.updatedAt) : null), opened: d.feedback === 'seen' || Boolean(d.readerOpened), revision: d.revision || 1,
    origin: 'agent', features: model.featuresOf(base), editorialStatus: d.editorialStatus || null,
  };
}
/**
 * Build the reading queue: filter, score, and interleave sources. Returns the ordered ids
 * plus the first page of full items; the client then pages through the ids with
 * itemsByIds(), so a session costs one scan and small follow-up reads.
 */
async function queue(args = {}) {
  const now = Date.now();
  const scanLimit = Math.min(1500, Math.max(50, Number(args.scanLimit) || 900));
  const pageSize = Math.min(100, Math.max(5, Number(args.pageSize) || 30));
  const view = ['unread', 'all', 'saved'].includes(args.view) ? args.view : 'unread';
  const [snap, legacySnap, entries, sources, lastRun] = await Promise.all([
    itemsDb().collection(ITEMS).where('publishedAtMs', '>=', now - KEEP_MARKED_DAYS * DAY).orderBy('publishedAtMs', 'desc').limit(scanLimit).get(),
    args.includeAgentPicks === false ? null : itemsDb().collection(LEGACY).orderBy('createdAt', 'desc').limit(80).get(),
    readModel(), allSources(),
    itemsDb().collection(MODEL).doc('lastRun').get(),
  ]);
  const priority = new Map(sources.map(s => [s.id, s.priority]));
  const map = model.toMap(entries);
  let items = snap.docs.map(doc => itemView(doc.data(), doc.id))
    .filter(x => now - (Date.parse(x.publishedAt) || now) <= keepDays(x.feedback) * DAY);
  if (legacySnap) {
    const legacy = legacySnap.docs.map(legacyView).filter(x => x.editorialStatus !== 'retired'
      && now - (Date.parse(x.ingestedAt) || now) <= keepDays(x.feedback) * DAY);
    const urls = new Set(items.map(i => i.url));
    items = items.concat(legacy.filter(x => !urls.has(canonicalUrl(x.url))));
  }
  if (!args.includeSkipped) items = items.filter(x => x.feedback !== 'skipped');
  // Per-source counts before the source/type/search filters, for the source chips.
  const counts = {};
  for (const x of items) {
    const c = counts[x.sourceId] || (counts[x.sourceId] = { id: x.sourceId, title: x.sourceTitle, unread: 0, total: 0 });
    c.total++; if (!x.readAt) c.unread++;
  }
  const unreadTotal = items.filter(x => !x.readAt).length;
  if (view === 'unread' || args.unreadOnly) items = items.filter(x => !x.readAt);
  if (view === 'saved' || args.savedOnly) items = items.filter(x => ['saved', 'loved'].includes(x.feedback));
  if (args.sourceId) items = items.filter(x => x.sourceId === args.sourceId);
  if (args.type === 'video' || args.type === 'article') items = items.filter(x => args.type === 'video' ? x.type === 'video' : x.type !== 'video');
  const q = trim(args.q, 100).normalize('NFKC').toLocaleLowerCase('ja-JP');
  if (q) items = items.filter(x => [x.title, x.excerpt, x.sourceTitle, x.author, ...(x.categories || [])].join(' ')
    .normalize('NFKC').toLocaleLowerCase('ja-JP').includes(q));
  for (const item of items) {
    const s = model.scoreItem(map, item, { sourcePriority: priority.get(item.sourceId) || 0, now });
    item.score = s.score; item.why = s.why; item.exploration = s.exploration;
    delete item.features;
  }
  const sort = args.sort === 'new' ? 'new' : 'score';
  // Both orders interleave sources; 新着 only lightly, so it stays close to time order.
  const ordered = sort === 'new'
    ? model.diversify(items, { scoreOf: x => -((now - (Date.parse(x.publishedAt) || now)) / 3600000) / 6, penalty: 0.6, window: 5 })
    : model.diversify(items, { penalty: 0.45, window: 8 });
  return {
    ids: ordered.map(x => x.id), items: ordered.slice(0, pageSize), total: ordered.length, unreadTotal, sort, view,
    retentionDays: RETENTION_DAYS, keepMarkedDays: KEEP_MARKED_DAYS,
    sources: Object.values(counts).sort((a, b) => b.unread - a.unread),
    lastRun: lastRun.exists ? lastRun.data() : null,
  };
}
/** Next page of the queue, in the requested order. */
async function itemsByIds(args = {}) {
  const ids = (Array.isArray(args.ids) ? args.ids : String(args.ids || '').split(','))
    .map(x => trim(x, 80)).filter(x => /^(rss|cur)-[a-f0-9]{30}$/.test(x)).slice(0, 60);
  if (!ids.length) return { items: [] };
  const [feedDocs, legacyDocs, entries, sources] = await Promise.all([
    getByIds(ITEMS, ids.filter(id => id.startsWith('rss-'))),
    getByIds(LEGACY, ids.filter(id => id.startsWith('cur-'))),
    readModel(), allSources(),
  ]);
  const priority = new Map(sources.map(s => [s.id, s.priority]));
  const map = model.toMap(entries);
  const now = Date.now();
  const items = [];
  ids.forEach(id => {
    const data = id.startsWith('rss-') ? feedDocs.get(id) : legacyDocs.get(id);
    if (!data) return;
    const item = id.startsWith('rss-') ? itemView(data, id) : legacyView({ id, data: () => data });
    const s = model.scoreItem(map, item, { sourcePriority: priority.get(item.sourceId) || 0, now });
    item.score = s.score; item.why = s.why; item.exploration = s.exploration;
    delete item.features;
    items.push(item);
  });
  return { items };
}
/** MCP/agent view: same ranking as the app, one page. */
async function list(args = {}) {
  const max = Math.min(200, Math.max(1, Number(args.max) || 60));
  const view = args.savedOnly ? 'saved' : args.unreadOnly ? 'unread' : 'all';
  const r = await queue({ ...args, view, pageSize: max });
  return { items: r.items, count: r.items.length, total: r.total, unreadTotal: r.unreadTotal, sort: r.sort,
    retentionDays: r.retentionDays, keepMarkedDays: r.keepMarkedDays, sources: r.sources, lastRun: r.lastRun };
}
async function loadAny(id) {
  if (/^rss-[a-f0-9]{30}$/.test(id)) {
    const ref = itemsDb().collection(ITEMS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw Error('Item not found (it may have expired after ' + RETENTION_DAYS + ' days)');
    return { ref, item: itemView(snap.data(), id), legacy: false };
  }
  if (/^cur-[a-f0-9]{30}$/.test(id)) {
    const ref = itemsDb().collection(LEGACY).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw Error('Item not found');
    return { ref, item: legacyView(snap), legacy: true };
  }
  throw Error('Invalid item id');
}
/**
 * Explicit reaction on an RSS item. Legacy cur-* items keep using personalFeedStore.feedback
 * (callers route by prefix) and then call recordSignal via signalForLegacy.
 */
async function feedback(args = {}) {
  const id = trim(args.id, 80), status = trim(args.status, 20);
  if (!model.LABELS.includes(status)) throw Error('status must be new, loved, saved or skipped');
  if (!/^rss-[a-f0-9]{30}$/.test(id)) throw Error('Use an rss-* item id (AI picks: personal_feed_feedback)');
  const { ref } = await loadAny(id);
  const expected = Number(args.expectedRevision);
  let updated;
  await itemsDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (Number.isInteger(expected) && expected > 0 && d.revision !== expected) throw Error('Item revision conflict; refresh');
    updated = { ...d, feedback: status, feedbackNote: trim(args.note, 500), readAt: d.readAt || (status !== 'new' ? nowIso() : null), revision: (d.revision || 1) + 1 };
    tx.update(ref, { feedback: status, feedbackNote: updated.feedbackNote, readAt: updated.readAt, revision: updated.revision });
  });
  const view = itemView(updated, id);
  await recordSignal(view, { label: status });
  return view;
}
async function signalForLegacy(legacyRecord) {
  const item = legacyToItem(legacyRecord);
  const label = legacyRecord.feedback === 'seen' ? undefined : legacyRecord.feedback;
  await recordSignal(item, { label: label || 'new', opened: legacyRecord.feedback === 'seen' ? true : undefined });
}
/** Click-through: marks read and adds a weak interest signal. */
async function opened(args = {}) {
  const id = trim(args.id, 80);
  const { ref, item, legacy } = await loadAny(id);
  if (!legacy) await ref.update({ opened: true, readAt: item.readAt || nowIso() });
  else await ref.update({ readerOpened: true, readerReadAt: item.readAt || nowIso() });
  await recordSignal(item, { opened: true });
  return { id, opened: true };
}
/** Read state only — never a taste signal. Accepts feed items and old AI picks. */
async function markRead(args = {}) {
  const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).map(x => trim(x, 80)))]
    .filter(x => /^(rss|cur)-[a-f0-9]{30}$/.test(x)).slice(0, 300);
  if (!ids.length) return { updated: 0 };
  const read = args.read !== false;
  const [feedDocs, legacyDocs] = await Promise.all([
    getByIds(ITEMS, ids.filter(id => id.startsWith('rss-'))),
    getByIds(LEGACY, ids.filter(id => id.startsWith('cur-'))),
  ]);
  const batch = itemsDb().batch();
  const at = read ? nowIso() : null;
  let updated = 0;
  for (const id of ids) {
    const feed = id.startsWith('rss-');
    const data = feed ? feedDocs.get(id) : legacyDocs.get(id);
    if (!data) continue; // expired or deleted meanwhile
    const field = feed ? 'readAt' : 'readerReadAt';
    if (read && data[field]) continue;
    batch.update(itemsDb().collection(feed ? ITEMS : LEGACY).doc(id), { [field]: at });
    updated++;
  }
  if (updated) await batch.commit();
  return { updated, read };
}
async function modelGet(args = {}) {
  const [entries, sources, signalCount, lastRun] = await Promise.all([
    readModel(), allSources(),
    itemsDb().collection(SIGNALS).count().get().then(c => c.data().count).catch(() => null),
    itemsDb().collection(MODEL).doc('lastRun').get(),
  ]);
  const titles = new Map(sources.map(s => [s.id, s.title]));
  titles.set(LEGACY_SOURCE_ID, 'AI選書');
  const summary = model.summarize(entries, { limit: Math.min(50, Number(args.limit) || 20) });
  summary.sources = summary.sources.map(s => ({ ...s, title: titles.get(s.feature.slice(4)) || s.feature.slice(4) }));
  return {
    ...summary, signalCount, lastRun: lastRun.exists ? lastRun.data() : null,
    note: 'Ranking model for the reader. loved/skipped are explicit; saved and click-through are weak interest only and are not written to the taste ledger as likes.',
  };
}

module.exports = {
  ITEMS, SIGNALS, MODEL, RETENTION_DAYS, KEEP_MARKED_DAYS,
  canonicalUrl, youtubeId, buildItem, privateAddress, keepDays,
  sourcesList, sourceTest, sourceUpsert, fetchDue, fetchSource, purge, runScheduled,
  list, queue, itemsByIds, feedback, opened, markRead, clearUnreactedItems, modelGet, signalForLegacy, recordSignal,
};
