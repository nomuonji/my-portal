'use strict';
/**
 * Pure helpers for the Discover RSS reader: feed parsing, feed discovery,
 * HTML-to-excerpt and lightweight Japanese/English tokenization.
 * No network or database access here so they can be unit-tested directly.
 */
const { XMLParser } = require('fast-xml-parser');

const EXCERPT_MAX = 280;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  // Entities are decoded by our own bounded decoder (stripHtml), which also avoids
  // the parser's entity-expansion limit on large Japanese feeds.
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  // Feeds are untrusted input: refuse unreasonable nesting instead of recursing forever.
  stopNodes: ['*.content:encoded', '*.description', '*.summary', '*.content'],
});

const arr = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? v['@_href'] ?? '');
  return '';
}
function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
function safeChar(code) {
  try { return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; } catch { return ''; }
}
function stripHtml(html) {
  let source = String(html || '');
  // Atom/RSS often carry entity-escaped HTML (&lt;p&gt;); unescape once before removing tags.
  if (/&lt;\/?[a-z]/i.test(source)) source = decodeEntities(source);
  return decodeEntities(source
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function excerpt(html, max = EXCERPT_MAX) {
  const plain = stripHtml(html);
  if (plain.length <= max) return plain;
  return plain.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}
function firstImage(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(String(html || ''));
  return m ? decodeEntities(m[1]) : '';
}
function absolute(value, base) {
  if (!String(value || '').trim()) return '';
  try {
    const u = new URL(decodeEntities(String(value || '').trim()), base || undefined);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.protocol === 'http:') u.protocol = 'https:';
    u.hash = '';
    return u.toString();
  } catch { return ''; }
}
function dateIso(...values) {
  for (const v of values) {
    const raw = text(v).trim();
    if (!raw) continue;
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return '';
}
function atomLink(links, base) {
  const list = arr(links);
  const pick = list.find(l => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate') && (!l['@_type'] || /html/.test(l['@_type'])))
    || list.find(l => typeof l === 'object' && !l['@_rel'])
    || list[0];
  return absolute(typeof pick === 'string' ? pick : pick?.['@_href'], base);
}
function mediaThumb(entry) {
  const group = entry['media:group'] || {};
  const thumb = arr(entry['media:thumbnail'] || group['media:thumbnail'])[0];
  if (thumb?.['@_url']) return thumb['@_url'];
  const content = arr(entry['media:content'] || group['media:content']).find(c => /^image\//.test(c?.['@_type'] || '') || c?.['@_medium'] === 'image');
  if (content?.['@_url']) return content['@_url'];
  const enclosure = arr(entry.enclosure).find(e => /^image\//.test(e?.['@_type'] || ''));
  return enclosure?.['@_url'] || '';
}
function categories(entry) {
  return [...new Set([...arr(entry.category), ...arr(entry['dc:subject'])]
    .map(c => stripHtml(typeof c === 'object' ? (c['@_term'] || c['@_label'] || c['#text'] || '') : c))
    .flatMap(c => c.split(/\s*[,、]\s*/)).filter(Boolean).map(c => c.slice(0, 50)))].slice(0, 8);
}
function normalizeEntry(entry, base, kind) {
  const isAtom = kind === 'atom';
  const url = isAtom ? atomLink(entry.link, base) : absolute(text(entry.link) || (entry.guid?.['@_isPermaLink'] !== 'false' ? text(entry.guid) : ''), base);
  const rawBody = text(entry['media:group']?.['media:description']) || text(entry.summary) || text(entry.description) || text(entry.content) || text(entry['content:encoded']);
  const fullBody = text(entry['content:encoded']) || rawBody;
  const author = stripHtml(isAtom ? text(arr(entry.author)[0]?.name) : (text(entry['dc:creator']) || text(entry.author))).slice(0, 120);
  return {
    guid: text(entry.id) || text(entry.guid) || url,
    url,
    title: stripHtml(text(entry.title)).slice(0, 300),
    excerpt: excerpt(rawBody),
    publishedAt: dateIso(entry.published, entry.pubDate, entry['dc:date'], entry.updated, entry.issued),
    author,
    categories: categories(entry),
    thumbnail: absolute(mediaThumb(entry) || firstImage(fullBody), base),
    videoId: text(entry['yt:videoId']),
  };
}
/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom. Throws on anything else. */
function parseFeed(xml, feedUrl = '') {
  const body = String(xml || '');
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 5000))) throw new Error('Not an RSS/Atom feed');
  const doc = parser.parse(body);
  let kind, channel, entries;
  if (doc.rss) { kind = 'rss'; channel = arr(doc.rss.channel)[0] || {}; entries = arr(channel.item); }
  else if (doc.feed) { kind = 'atom'; channel = doc.feed; entries = arr(doc.feed.entry); }
  else if (doc['rdf:RDF']) { kind = 'rdf'; channel = arr(doc['rdf:RDF'].channel)[0] || {}; entries = arr(doc['rdf:RDF'].item); }
  else throw new Error('Unsupported feed format');
  const siteUrl = kind === 'atom' ? atomLink(channel.link, feedUrl) : absolute(text(channel.link), feedUrl);
  const items = entries.slice(0, 80).map(e => normalizeEntry(e || {}, siteUrl || feedUrl, kind)).filter(e => e.url && e.title);
  return { kind, title: stripHtml(text(channel.title)).slice(0, 180), siteUrl, items };
}
/** Find feed links advertised by an HTML page (<link rel="alternate" type="application/rss+xml">). */
function discoverFeedLinks(html, baseUrl) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 8) {
    const tag = m[0];
    const attr = name => (new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(tag) || [])[1] || '';
    if (!/alternate/i.test(attr('rel'))) continue;
    if (!/(rss|atom)\+xml|application\/xml|text\/xml/i.test(attr('type'))) continue;
    const href = absolute(attr('href'), baseUrl);
    if (href && !out.some(x => x.url === href)) out.push({ url: href, title: decodeEntities(attr('title')).slice(0, 160) });
  }
  return out;
}

const STOP = new Set(('the and for with that this from your you are was were have has had not but all can will just more about into than then them they what when where which who why how its our out new one two get got via over also after before here there been being some most much many very only other their his her she him it is in on of to a an at by as or be we us my me so if no do up off too may'
  + ' こと もの これ それ あれ ため よう さん など から まで より について として による ので のは です ます でした する した して いる ある なる れる られ').split(' '));
let segmenter = null;
function getSegmenter() {
  if (segmenter === null) {
    try { segmenter = new Intl.Segmenter('ja', { granularity: 'word' }); } catch { segmenter = false; }
  }
  return segmenter;
}
/** Content terms used by the preference model. Deterministic and dependency-free. */
function tokenize(value, max = 24) {
  const s = String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP');
  const seg = getSegmenter();
  const parts = seg ? [...seg.segment(s)].filter(p => p.isWordLike).map(p => p.segment) : s.split(/[^\p{L}\p{N}]+/u);
  const out = [];
  for (const raw of parts) {
    const t = raw.replace(/^[-_.']+|[-_.']+$/g, '');
    if (!t || STOP.has(t) || /^\d+$/.test(t)) continue;
    if (/^[\p{Script=Hiragana}ー]+$/u.test(t)) continue; // particles / inflections
    if (/^[a-z0-9]+$/.test(t) ? t.length < 3 : (t.length < 2 && !/^\p{Script=Han}$/u.test(t))) continue;
    if (!out.includes(t)) out.push(t.slice(0, 40));
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { parseFeed, discoverFeedLinks, tokenize, stripHtml, excerpt, absolute, EXCERPT_MAX };
