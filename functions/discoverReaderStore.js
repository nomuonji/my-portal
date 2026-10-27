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
const { getDocumentDb, FieldValue } = require('./documentDb');
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
  await ref.set({ ...data, ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const saved = sourceView(await ref.get());
  return { outcome: existing ? 'updated' : 'created', source: saved, readable: Boolean(readable(saved)), test };
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
  try {
    const res = await safeFetch(source.feedUrl, { headers, timeoutMs });
    if (res.status === 304) {
      await ref.set({ reader: { ...reader, lastFetchedAt: nowIso(), lastStatus: 'not_modified', lastError: '', consecutiveFailures: 0, lastNewCount: 0 } }, { merge: true });
      return { sourceId: source.id, status: 'not_modified', created: 0, ms: Date.now() - started };
    }
    if (res.status >= 400) throw Error('HTTP ' + res.status);
    const feed = parseFeed(res.body, res.url);
    const fetchedAt = nowIso(), cutoff = Date.now() - RETENTION_DAYS * DAY;
    const seen = new Set();
    const candidates = [];
    for (const entry of feed.items) {
      if (candidates.length >= MAX_ITEMS_PER_FETCH) break;
      if (entry.publishedAt && Date.parse(entry.publishedAt) < cutoff) continue;
      if (entry.publishedAt && Date.parse(entry.publishedAt) > Date.now() + DAY) entry.publishedAt = '';
      const item = buildItem(source, entry, fetchedAt);
      if (!item.url || seen.has(item.id)) continue;
      seen.add(item.id); candidates.push(item);
    }
    let created = 0;
    if (candidates.length) {
      const refs = candidates.map(i => itemsDb().collection(ITEMS).doc(i.id));
      // Expired items must not come back: dated entries are filtered by the window above,
      // reacted ones by their persistent signal, undated ones by a per-source seen list.
      const undated = new Set(Array.isArray(reader.undatedSeen) ? reader.undatedSeen : []);
      // One round trip for both existence checks (items + reacted-item tombstones).
      const all = await itemsDb().getAll(...refs, ...candidates.map(i => itemsDb().collection(SIGNALS).doc('sig-' + i.id)));
      const snaps = all.slice(0, refs.length), signalSnaps = all.slice(refs.length);
      const batch = itemsDb().batch();
      candidates.forEach((item, i) => {
        const known = item.dateEstimated && undated.has(item.id);
        if (item.dateEstimated) undated.add(item.id);
        if (known || snaps[i].exists || signalSnaps[i].exists) return;
        batch.set(refs[i], { ...item, createdAt: FieldValue.serverTimestamp() });
        created++;
      });
      if (created) await batch.commit();
      reader.undatedSeen = [...undated].slice(-300);
    }
    const etag = res.headers.get('etag') || '', lastModified = res.headers.get('last-modified') || '';
    await ref.set({
      fetchVerification: 'verified',
      reader: { lastFetchedAt: fetchedAt, lastSuccessAt: fetchedAt, lastStatus: 'ok', lastError: '', consecutiveFailures: 0,
        lastNewCount: created, lastItemCount: feed.items.length, undatedSeen: reader.undatedSeen || [], etag: etag.slice(0, 200), lastModified: lastModified.slice(0, 100), feedTitle: feed.title },
    }, { merge: true });
    return { sourceId: source.id, status: 'ok', created, inFeed: feed.items.length, ms: Date.now() - started };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 300);
    const failures = (Number(reader.consecutiveFailures) || 0) + 1;
    await ref.set({
      ...(failures >= 5 ? { fetchVerification: 'failed' } : {}),
      reader: { ...reader, lastFetchedAt: nowIso(), lastStatus: 'error', lastError: message, consecutiveFailures: failures },
    }, { merge: true }).catch(() => {});
    return { sourceId: source.id, status: 'error', error: message, ms: Date.now() - started };
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
  const results = (await pool(due, 6, async s => {
    const left = deadline - Date.now();
    // Each source needs time for the request plus a few database round trips.
    if (left < 2500) { skipped++; return null; }
    return fetchSource(s, { force: Boolean(args.force), timeoutMs: Math.max(1500, Math.min(FETCH_TIMEOUT_MS, left - 1500)) });
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
  // Scheduled functions may run 30s; keep headroom for the purge.
  const fetched = await fetchDue({ budgetMs: 22000 });
  const purged = await purge();
  const run = { at: nowIso(), ms: Date.now() - started, fetched: fetched.fetched, remaining: fetched.remaining, created: fetched.created,
    errors: fetched.errors.map(e => ({ sourceId: e.sourceId, error: e.error })).slice(0, 20), ...purged };
  await itemsDb().collection(MODEL).doc('lastRun').set(run);
  return run;
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
async function importLegacySignalsOnce() {
  if (legacyImported) return;
  const marker = itemsDb().collection(MODEL).doc('legacy-import-v1');
  if ((await marker.get()).exists) { legacyImported = true; return; }
  const snap = await itemsDb().collection(LEGACY).limit(500).get();
  let imported = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.feedback || d.feedback === 'new') continue;
    await recordSignal(legacyToItem({ id: doc.id, ...d }), { label: d.feedback === 'seen' ? 'new' : d.feedback, opened: d.feedback === 'seen' });
    imported++;
  }
  await marker.set({ imported, at: nowIso() });
  legacyImported = true;
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
    readAt: d.feedback === 'seen' ? iso(d.updatedAt) : null, opened: d.feedback === 'seen', revision: d.revision || 1,
    origin: 'agent', features: model.featuresOf(base), editorialStatus: d.editorialStatus || null,
  };
}
async function list(args = {}) {
  const now = Date.now();
  const limit = Math.min(600, Math.max(1, Number(args.limit) || 400));
  const [snap, legacySnap, entries, sources, lastRun] = await Promise.all([
    itemsDb().collection(ITEMS).where('publishedAtMs', '>=', now - KEEP_MARKED_DAYS * DAY).orderBy('publishedAtMs', 'desc').limit(limit).get(),
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
  if (args.sourceId) items = items.filter(x => x.sourceId === args.sourceId);
  if (args.type === 'video' || args.type === 'article') items = items.filter(x => args.type === 'video' ? x.type === 'video' : x.type !== 'video');
  if (!args.includeSkipped) items = items.filter(x => x.feedback !== 'skipped');
  if (args.unreadOnly) items = items.filter(x => !x.readAt);
  if (args.savedOnly) items = items.filter(x => ['saved', 'loved'].includes(x.feedback));
  for (const item of items) {
    const s = model.scoreItem(map, item, { sourcePriority: priority.get(item.sourceId) || 0, now });
    item.score = s.score; item.why = s.why; item.exploration = s.exploration;
    delete item.features;
  }
  const sort = args.sort === 'new' ? 'new' : 'score';
  items.sort(sort === 'new'
    ? (a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)
    : (a, b) => b.score - a.score || (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  const max = Math.min(limit, Number(args.max) || limit);
  return {
    items: items.slice(0, max), count: Math.min(items.length, max), total: items.length, sort,
    retentionDays: RETENTION_DAYS, keepMarkedDays: KEEP_MARKED_DAYS,
    sources: sources.filter(readable).map(s => ({ id: s.id, title: s.title, category: s.category, priority: s.priority, reader: s.reader })),
    lastRun: lastRun.exists ? lastRun.data() : null,
  };
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
  await recordSignal(item, { opened: true });
  return { id, opened: true };
}
/** Read state only — never a taste signal. */
async function markRead(args = {}) {
  const ids = (Array.isArray(args.ids) ? args.ids : []).map(x => trim(x, 80)).filter(x => /^rss-[a-f0-9]{30}$/.test(x)).slice(0, 300);
  if (!ids.length) return { updated: 0 };
  const read = args.read !== false;
  const batch = itemsDb().batch();
  const snaps = await itemsDb().getAll(...ids.map(id => itemsDb().collection(ITEMS).doc(id)));
  let updated = 0;
  snaps.forEach(s => { if (s.exists) { batch.update(s.ref, { readAt: read ? (s.data().readAt || nowIso()) : null }); updated++; } });
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
  list, feedback, opened, markRead, modelGet, signalForLegacy, recordSignal,
};
