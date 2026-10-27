const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseFeed, discoverFeedLinks, tokenize, excerpt } = require('../functions/discoverFeedParser');
const model = require('../functions/discoverReaderModel');
const store = require('../functions/discoverReaderStore');

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Example &amp; Co</title><link>https://example.org/</link>
<item><title><![CDATA[猫が自分でドアを開ける方法を学んだ]]></title><link>https://example.org/cat?utm_source=rss&amp;id=3</link>
<description><![CDATA[<p>ある日 <b>猫</b> が<br/>ドアを開けた。<script>alert(1)</script></p><img src="https://example.org/cat.jpg">]]></description>
<pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate><dc:creator>Taro</dc:creator><category>動物</category><category>ネット文化</category></item>
<item><title>No date entry</title><link>https://example.org/nodate</link><description>plain</description></item>
<item><title>Missing link</title></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
<title>Some Channel</title><link rel="alternate" href="https://www.youtube.com/channel/UCxyz"/>
<entry><id>yt:video:dQw4w9WgXcQ</id><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>A video title</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/><author><name>Creator</name></author>
<published>2026-10-26T12:00:00+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" width="480" height="360"/><media:description>Video description here</media:description></media:group></entry>
<entry><title type="html">Escaped &lt;em&gt;HTML&lt;/em&gt; title</title><link href="/post/1"/><updated>2026-10-25T00:00:00Z</updated>
<summary type="html">&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</summary></entry>
</feed>`;
const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>はてな</title><link>https://b.hatena.ne.jp/</link></channel>
<item rdf:about="https://example.jp/a"><title>記事A</title><link>https://example.jp/a</link><dc:date>2026-10-27T09:00:00+09:00</dc:date><dc:subject>テクノロジー</dc:subject></item>
</rdf:RDF>`;

test('RSS 2.0: CDATA, HTML stripping, dates, author, categories, thumbnail', () => {
  const f = parseFeed(RSS, 'https://example.org/feed');
  assert.equal(f.kind, 'rss');
  assert.equal(f.title, 'Example & Co');
  assert.equal(f.items.length, 2, 'items without a link are dropped');
  const a = f.items[0];
  assert.equal(a.title, '猫が自分でドアを開ける方法を学んだ');
  assert.equal(a.excerpt, 'ある日 猫 が ドアを開けた。');
  assert.equal(a.publishedAt, '2026-10-27T10:00:00.000Z');
  assert.equal(a.author, 'Taro');
  assert.deepEqual(a.categories, ['動物', 'ネット文化']);
  assert.equal(a.thumbnail, 'https://example.org/cat.jpg');
  assert.equal(f.items[1].publishedAt, '');
});
test('Atom/YouTube: video id, thumbnail, relative links, escaped HTML', () => {
  const f = parseFeed(ATOM, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCxyz');
  assert.equal(f.kind, 'atom');
  assert.equal(f.items[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(f.items[0].author, 'Creator');
  assert.equal(f.items[0].excerpt, 'Video description here');
  assert.equal(f.items[1].title, 'Escaped HTML title');
  assert.equal(f.items[1].excerpt, 'Hello & welcome');
  assert.equal(f.items[1].url, 'https://www.youtube.com/post/1');
});
test('RSS 1.0 (RDF) is supported; non-feeds are refused', () => {
  const f = parseFeed(RDF, 'https://b.hatena.ne.jp/hotentry.rss');
  assert.equal(f.kind, 'rdf');
  assert.equal(f.items[0].title, '記事A');
  assert.deepEqual(f.items[0].categories, ['テクノロジー']);
  assert.throws(() => parseFeed('<html><body>hi</body></html>'), /Not an RSS/);
});
test('feed discovery reads <link rel=alternate> from HTML pages', () => {
  const html = '<head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed/"><link rel="stylesheet" href="/x.css"><link type="application/atom+xml" rel="alternate" href="https://example.org/atom"></head>';
  assert.deepEqual(discoverFeedLinks(html, 'https://example.org/blog/').map(x => x.url), ['https://example.org/feed/', 'https://example.org/atom']);
});
test('excerpt is short metadata, never a full body copy', () => {
  assert.ok(excerpt('x '.repeat(1000)).length <= 280);
});
test('tokenizer keeps content words and drops particles/stopwords', () => {
  const t = tokenize('猫がドアを開ける方法を学んだ The cat and the door');
  assert.ok(t.includes('猫') || t.some(x => x.includes('猫')), t.join(','));
  assert.ok(t.includes('cat') && t.includes('door'));
  assert.ok(!t.includes('the') && !t.includes('が') && !t.includes('を'));
});
test('canonical URL removes tracking parameters and unifies YouTube forms', () => {
  assert.equal(store.canonicalUrl('https://www.example.org/a/?utm_source=x&id=3#top'), 'https://example.org/a?id=3');
  assert.equal(store.canonicalUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(store.canonicalUrl('http://example.org/x'), 'https://example.org/x');
});
test('private network addresses are refused (SSRF guard)', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(store.privateAddress(a), a);
  for (const a of ['8.8.8.8', '151.101.1.1', '2001:4860::8888']) assert.ok(!store.privateAddress(a), a);
});
test('retention: 7 days by default, 30 days for loved/saved', () => {
  assert.equal(store.keepDays('new'), 7);
  assert.equal(store.keepDays('skipped'), 7);
  assert.equal(store.keepDays('saved'), 30);
  assert.equal(store.keepDays('loved'), 30);
});
test('built item stores only metadata and precomputed features', () => {
  const entry = parseFeed(RSS, 'https://example.org/feed').items[0];
  const item = store.buildItem({ id: 'curation_abc', title: 'Example', category: 'ネット文化' }, entry, '2026-10-28T00:00:00.000Z');
  assert.match(item.id, /^rss-[a-f0-9]{30}$/);
  assert.equal(item.url, 'https://example.org/cat?id=3');
  assert.equal(item.type, 'article');
  assert.ok(item.features.includes('src:curation_abc'));
  assert.ok(item.features.includes('host:example.org'));
  assert.ok(item.features.includes('cat:動物'));
  for (const forbidden of ['content', 'body', 'html', 'description']) assert.ok(!Object.hasOwn(item, forbidden));
});

test('model: loved raises, skipped lowers, changing a label reverses its evidence', () => {
  const liked = { sourceId: 's1', url: 'https://a.example/x', title: 'ボカロ 新曲 MV' };
  const f = model.featuresOf(liked);
  let entries = model.applyDelta([], f, { p: 0, n: 0 }, model.evidenceOf('loved', false));
  entries = model.applyDelta(entries, f, model.evidenceOf('loved', false), model.evidenceOf('loved', true));
  const similar = { sourceId: 's1', url: 'https://a.example/y', title: 'ボカロ 新曲 公開', publishedAt: new Date().toISOString() };
  const other = { sourceId: 's2', url: 'https://b.example/z', title: '株価 決算 速報', publishedAt: new Date().toISOString() };
  assert.ok(model.scoreItem(entries, similar).score > model.scoreItem(entries, other).score);
  const why = model.scoreItem(entries, similar).why;
  assert.ok(why.length && why[0].direction === 'up');
  // Undo: loved -> new restores neutrality for that signal.
  const undone = model.applyDelta(entries, f, model.evidenceOf('loved', true), model.evidenceOf('new', false));
  assert.equal(undone.length, 0);
  // Skips push down.
  const skipped = model.applyDelta([], model.featuresOf(other), { p: 0, n: 0 }, model.evidenceOf('skipped', false));
  assert.ok(model.scoreItem(skipped, other).score < model.scoreItem([], other).score);
});
test('model: saved and opened are weaker than loved; skip ignores clicks', () => {
  assert.ok(model.evidenceOf('saved', false).p < model.evidenceOf('loved', false).p);
  assert.ok(model.evidenceOf('new', true).p < model.evidenceOf('saved', false).p);
  assert.deepEqual(model.evidenceOf('skipped', true), { p: 0, n: 1 });
  assert.deepEqual(model.evidenceOf('new', false), { p: 0, n: 0 });
});
test('model: freshness and source priority affect ranking; unknown items get exploration', () => {
  const now = Date.parse('2026-10-28T00:00:00Z');
  const fresh = model.scoreItem([], { sourceId: 'a', url: 'https://x.example/1', title: 'x', publishedAt: '2026-10-27T23:00:00Z' }, { now });
  const old = model.scoreItem([], { sourceId: 'a', url: 'https://x.example/2', title: 'y', publishedAt: '2026-10-22T00:00:00Z' }, { now });
  assert.ok(fresh.score > old.score);
  assert.ok(fresh.exploration);
  const boosted = model.scoreItem([], { sourceId: 'a', url: 'https://x.example/2', title: 'y', publishedAt: '2026-10-22T00:00:00Z' }, { now, sourcePriority: 2 });
  assert.ok(boosted.score > old.score);
});
test('model: feature map is capped', () => {
  const many = Array.from({ length: 4100 }, (_, i) => 'term:t' + i);
  const entries = model.applyDelta([], many, { p: 0, n: 0 }, { p: 1, n: 0 });
  assert.ok(entries.length <= 4000);
});
console.log('discover reader tests passed');
