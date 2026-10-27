// End-to-end flow of the Discover reader against an in-memory document DB and a
// stubbed network: add source -> fetch -> list ranked -> react -> purge keeps signals.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const dns = require('node:dns');

// ---- minimal in-memory Firestore-like adapter
const SERVER_TS = { __ts: true };
const store = new Map(); // "col/id" -> data
const clone = v => JSON.parse(JSON.stringify(v));
const resolve = (data) => { const out = {}; for (const [k, v] of Object.entries(data)) out[k] = v === SERVER_TS ? new Date().toISOString() : v; return out; };
function docRef(col, id) {
  const key = col + '/' + id;
  return {
    id, path: key,
    async get() { return snap(this, store.get(key)); },
    async set(data, opts) { store.set(key, opts?.merge ? deepMerge(store.get(key) || {}, resolve(data)) : clone(resolve(data))); },
    async update(data) { if (!store.has(key)) throw Error('missing ' + key); store.set(key, { ...store.get(key), ...resolve(data) }); },
    async delete() { store.delete(key); },
  };
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deepMerge(a[k], v) : clone(v);
  return out;
}
function snap(ref, data) { return { id: ref.id, ref, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)) }; }
function query(col, filters = [], order = null, lim = Infinity) {
  return {
    where(f, op, v) { return query(col, [...filters, [f, op, v]], order, lim); },
    orderBy(f, dir = 'asc') { return query(col, filters, [f, dir], lim); },
    limit(n) { return query(col, filters, order, n); },
    count() { return { get: async () => ({ data: () => ({ count: (rows()).length }) }) }; },
    async get() { const docs = rows().slice(0, lim); return { docs, size: docs.length }; },
  };
  function rows() {
    let list = [...store.entries()].filter(([k]) => k.startsWith(col + '/') && !k.slice(col.length + 1).includes('/'))
      .map(([k, d]) => snap(docRef(col, k.slice(col.length + 1)), d));
    for (const [f, op, v] of filters) list = list.filter(s => { const x = s.data()[f]; return op === '<' ? x < v : op === '>=' ? x >= v : op === '==' ? x === v : true; });
    if (order) list.sort((a, b) => { const x = a.data()[order[0]] ?? '', y = b.data()[order[0]] ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
    return list;
  }
}
const fakeDb = {
  collection(col) { return Object.assign(query(col), { doc: id => docRef(col, id) }); },
  async getAll(...refs) { return Promise.all(refs.map(r => r.get())); },
  batch() { const ops = []; return { set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)), delete: r => ops.push(() => r.delete()), commit: async () => { for (const op of ops) await op(); } }; },
  async runTransaction(fn) { const ops = []; await fn({ get: r => r.get(), set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)) }); for (const op of ops) await op(); },
};
const dbPath = path.resolve(__dirname, '../functions/documentDb.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDocumentDb: () => fakeDb, FieldValue: { serverTimestamp: () => SERVER_TS } } };

// ---- stubbed network
dns.promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const now = Date.now();
const iso = h => new Date(now - h * 3600000).toUTCString();
const FEEDS = {
  'https://music.example/': '<html><head><link rel="alternate" type="application/rss+xml" href="https://music.example/feed"></head></html>',
  'https://music.example/feed': `<rss version="2.0"><channel><title>Music Blog</title><link>https://music.example/</link>
    <item><title>ボカロ 新曲 レビュー</title><link>https://music.example/a</link><pubDate>${iso(2)}</pubDate><description>新曲の話</description></item>
    <item><title>ボカロ ライブ 映像</title><link>https://music.example/b</link><pubDate>${iso(5)}</pubDate></item>
    <item><title>Too old</title><link>https://music.example/old</link><pubDate>${iso(24 * 10)}</pubDate></item>
  </channel></rss>`,
  'https://news.example/rss': `<rss version="2.0"><channel><title>News</title><link>https://news.example/</link>
    <item><title>株価 決算 速報</title><link>https://news.example/x?utm_source=rss</link><pubDate>${iso(1)}</pubDate></item>
    <item><title>株価 為替 速報</title><link>https://news.example/y</link><pubDate>${iso(3)}</pubDate></item>
  </channel></rss>`,
};
global.fetch = async (url) => {
  const body = FEEDS[url];
  if (body === undefined) return new Response('nope', { status: 404 });
  return new Response(body, { status: 200, headers: { 'content-type': url.endsWith('/') ? 'text/html' : 'application/rss+xml', etag: '"v1"' } });
};

const reader = require('../functions/discoverReaderStore');

test('add sources via site discovery and direct feed, fetch, rank, react, purge', async () => {
  const music = await reader.sourceUpsert({ url: 'https://music.example/', category: '音楽' });
  assert.equal(music.outcome, 'created');
  assert.equal(music.source.status, 'active');
  assert.equal(music.source.feedUrl, 'https://music.example/feed');
  assert.equal(music.source.fetchVerification, 'verified');
  const news = await reader.sourceUpsert({ feedUrl: 'https://news.example/rss' });
  assert.equal(news.source.title, 'News');

  const run1 = await reader.fetchDue({ force: true });
  assert.equal(run1.fetched, 2);
  assert.equal(run1.created, 4, 'item older than 7 days is not ingested');
  const run2 = await reader.fetchDue({ force: true });
  assert.equal(run2.created, 0, 'no duplicates on refetch');
  const notDue = await reader.fetchDue({});
  assert.equal(notDue.fetched, 0, 'interval respected');

  let list = await reader.list({});
  assert.equal(list.total, 4);
  assert.ok(list.items.every(i => i.score !== undefined && Array.isArray(i.why)));
  assert.ok(list.items.some(i => i.url === 'https://news.example/x'), 'tracking params stripped');

  const liked = list.items.find(i => i.title === 'ボカロ 新曲 レビュー');
  const skipped = list.items.find(i => i.title === '株価 決算 速報');
  await reader.feedback({ id: liked.id, status: 'loved', expectedRevision: liked.revision });
  await reader.feedback({ id: skipped.id, status: 'skipped' });
  await assert.rejects(reader.feedback({ id: liked.id, status: 'saved', expectedRevision: 1 }), /revision conflict/);

  list = await reader.list({});
  const ranked = list.items.map(i => i.title);
  assert.ok(ranked.indexOf('ボカロ ライブ 映像') < ranked.indexOf('株価 為替 速報'), 'similar to loved ranks above similar to skipped: ' + ranked.join(' | '));
  assert.ok(!ranked.includes('株価 決算 速報'), 'skipped hidden by default');

  const modelSummary = await reader.modelGet({});
  assert.equal(modelSummary.signalCount, 2);
  assert.ok(modelSummary.sources.find(s => s.title === 'Music Blog').weight > 0);
  assert.ok(modelSummary.sources.find(s => s.title === 'News').weight < 0);

  const marked = await reader.markRead({ ids: [list.items[0].id] });
  assert.equal(marked.updated, 1);
  assert.equal((await reader.list({ unreadOnly: true })).items.length, list.items.length - 1);

  // Age everything past the window: unreacted + skipped go, loved stays (30d), signals survive.
  for (const [k, d] of store) if (k.startsWith('discoverReaderItems/')) store.set(k, { ...d, publishedAtMs: now - 8 * 86400000, publishedAt: new Date(now - 8 * 86400000).toISOString() });
  const purged = await reader.purge();
  assert.equal(purged.deleted, 3);
  const left = [...store.keys()].filter(k => k.startsWith('discoverReaderItems/'));
  assert.deepEqual(left, ['discoverReaderItems/' + liked.id]);
  assert.equal([...store.keys()].filter(k => k.startsWith('discoverReaderSignals/')).length, 2, 'learning signals are kept');
  assert.ok((await reader.modelGet({})).likedTerms.length > 0, 'model still learned after purge');

  // An expired, reacted item does not come back on refetch even if still in the feed and in-window.
  FEEDS['https://news.example/rss'] = FEEDS['https://news.example/rss'];
  const again = await reader.fetchDue({ force: true });
  assert.equal(again.created, 2, 'only unreacted items with in-window dates can re-enter; loved still exists, skipped is blocked by its signal');
  assert.ok(!(await reader.list({ includeSkipped: true })).items.some(i => i.id === skipped.id), 'skipped item not re-added');
});

test('pausing a source stops fetching; archived sources are hidden', async () => {
  const list = await reader.sourcesList({});
  const news = list.items.find(s => s.title === 'News');
  await reader.sourceUpsert({ id: news.id, status: 'paused' });
  const run = await reader.fetchDue({ force: true });
  assert.equal(run.fetched, 1);
  await reader.sourceUpsert({ id: news.id, status: 'archived' });
  assert.ok(!(await reader.sourcesList({})).items.some(s => s.id === news.id));
});

test('fetch errors are recorded per source without failing the run', async () => {
  const bad = await reader.sourceUpsert({ feedUrl: 'https://music.example/feed', title: 'dup' }).catch(e => e);
  assert.ok(!(bad instanceof Error));
  FEEDS['https://music.example/feed'] = 'not xml at all';
  const run = await reader.fetchDue({ force: true });
  assert.equal(run.errors.length, 1);
  const src = (await reader.sourcesList({})).items.find(s => s.feedUrl === 'https://music.example/feed');
  assert.equal(src.reader.lastStatus, 'error');
  assert.equal(src.reader.consecutiveFailures, 1);
});
