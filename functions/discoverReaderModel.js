'use strict';
/**
 * Lightweight, explainable interest model for the Discover RSS reader.
 *
 * Every user reaction leaves a compact signal (features only, no article body)
 * that is never purged with the 7-day item retention. The model is a counter of
 * positive/negative evidence per feature (source, host, author, feed category,
 * title term). It ranks what to read; it is NOT the canonical taste ledger.
 *   loved   = explicit positive (also mirrored to personalTasteEvidence)
 *   skipped = explicit negative (also mirrored to personalTasteEvidence)
 *   saved   = weak interest (watch later; never written as "like" anywhere)
 *   opened  = weak behavioural interest (clicked through)
 *   read / seen without opening = no signal
 */
const { tokenize } = require('./discoverFeedParser');

const LABELS = ['new', 'loved', 'saved', 'skipped'];
const MAX_FEATURES = 4000;
const WEIGHT = Object.freeze({ loved: 1, saved: 0.5, opened: 0.25, skipped: 1 });

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
/** Features describing an item. Prefixes keep kinds separate in one counter map. */
function featuresOf(item = {}) {
  const f = [];
  if (item.sourceId) f.push('src:' + item.sourceId);
  const h = host(item.url);
  if (h) f.push('host:' + h);
  if (item.author) f.push('author:' + String(item.author).toLocaleLowerCase('ja-JP').slice(0, 60));
  if (item.type === 'video') f.push('type:video');
  for (const c of (item.categories || []).slice(0, 6)) f.push('cat:' + String(c).toLocaleLowerCase('ja-JP').slice(0, 50));
  for (const t of tokenize(item.title, 14)) f.push('term:' + t);
  for (const t of tokenize(item.excerpt, 8)) if (!f.includes('term:' + t)) f.push('term:' + t);
  return [...new Set(f)].slice(0, 40);
}
/** Evidence a signal contributes, given its explicit label and whether it was opened. */
function evidenceOf(label, opened) {
  if (label === 'skipped') return { p: 0, n: WEIGHT.skipped };
  let p = 0;
  if (label === 'loved') p += WEIGHT.loved;
  else if (label === 'saved') p += WEIGHT.saved;
  if (opened) p += WEIGHT.opened;
  return { p, n: 0 };
}
function toMap(entries) {
  const m = new Map();
  for (const e of entries || []) if (Array.isArray(e) && e[0]) m.set(e[0], [Number(e[1]) || 0, Number(e[2]) || 0]);
  return m;
}
function toEntries(map) {
  let list = [...map.entries()].filter(([, v]) => v[0] > 1e-6 || v[1] > 1e-6)
    .map(([k, v]) => [k, Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000]);
  if (list.length > MAX_FEATURES) {
    // Keep features with the most evidence; source-level features are always kept.
    list.sort((a, b) => (Number(b[0].startsWith('src:')) - Number(a[0].startsWith('src:'))) || (b[1] + b[2]) - (a[1] + a[2]));
    list = list.slice(0, MAX_FEATURES);
  }
  return list;
}
/** Apply the difference between an old and a new evidence for the same features. */
function applyDelta(entries, features, before, after) {
  const map = toMap(entries);
  const dp = (after?.p || 0) - (before?.p || 0), dn = (after?.n || 0) - (before?.n || 0);
  if (!dp && !dn) return toEntries(map);
  for (const f of features || []) {
    const v = map.get(f) || [0, 0];
    map.set(f, [Math.max(0, v[0] + dp), Math.max(0, v[1] + dn)]);
  }
  return toEntries(map);
}
/** Smoothed, confidence-damped preference in [-1, 1]. */
function featureWeight(p, n) {
  const total = p + n;
  if (!total) return 0;
  return ((p - n) / (total + 2)) * Math.min(1, Math.log2(1 + total) / 2.5);
}
const KIND_WEIGHT = { src: 1.2, host: 0.6, author: 0.7, cat: 0.6, type: 0.4, term: 1 };
const LABEL = { src: '情報源', host: 'サイト', author: '書き手', cat: 'カテゴリ', type: '動画', term: '話題' };
/**
 * Score an item. Returns score plus the top human-readable reasons so the UI
 * can show why something ranks high or low.
 */
function scoreItem(model, item, { sourcePriority = 0, now = Date.now() } = {}) {
  const map = model instanceof Map ? model : toMap(model);
  const feats = item.features?.length ? item.features : featuresOf(item);
  const contributions = [];
  let termSum = 0, termCount = 0, other = 0, evidence = 0;
  for (const f of feats) {
    const v = map.get(f);
    if (!v) continue;
    evidence += v[0] + v[1];
    const kind = f.slice(0, f.indexOf(':'));
    const w = featureWeight(v[0], v[1]) * (KIND_WEIGHT[kind] || 0.5);
    if (!w) continue;
    if (kind === 'term') { termSum += w; termCount += 1; } else other += w;
    contributions.push({ feature: f, weight: w });
  }
  const terms = termCount ? termSum / Math.sqrt(termCount) : 0;
  const published = Date.parse(item.publishedAt || item.fetchedAt || '') || now;
  const ageHours = Math.max(0, (now - published) / 3600000);
  const freshness = -Math.min(1, ageHours / 168) * 0.6; // linear decay across the 7-day window
  const priority = Math.max(-2, Math.min(2, Number(sourcePriority) || 0)) * 0.4;
  const exploration = evidence < 1 ? 0.12 : 0; // unknown territory gets a small, honest nudge
  const score = other + terms + freshness + priority + exploration;
  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const why = contributions.slice(0, 3).map(c => {
    const kind = c.feature.slice(0, c.feature.indexOf(':'));
    return { label: (LABEL[kind] || kind) + '「' + (kind === 'src' ? (item.sourceTitle || c.feature.slice(4)) : c.feature.slice(c.feature.indexOf(':') + 1)) + '」', direction: c.weight > 0 ? 'up' : 'down' };
  });
  if (priority) why.push({ label: '情報源の優先度 ' + (sourcePriority > 0 ? '+' : '') + sourcePriority, direction: priority > 0 ? 'up' : 'down' });
  return { score: Math.round(score * 1000) / 1000, why, exploration: Boolean(exploration) };
}
/** Readable summary of what the model has learned (for MCP/agent conversations). */
function summarize(entries, { limit = 20 } = {}) {
  const rows = (entries || []).map(([f, p, n]) => ({ feature: f, positive: p, negative: n, weight: Math.round(featureWeight(p, n) * 1000) / 1000 }))
    .filter(r => r.weight);
  const by = kind => rows.filter(r => r.feature.startsWith(kind + ':'));
  const top = (list, dir) => list.filter(r => dir > 0 ? r.weight > 0 : r.weight < 0)
    .sort((a, b) => dir * (b.weight - a.weight)).slice(0, limit);
  return {
    featureCount: (entries || []).length,
    likedTerms: top(by('term'), 1), dislikedTerms: top(by('term'), -1),
    sources: by('src').sort((a, b) => b.weight - a.weight),
    categories: top(by('cat'), 1).concat(top(by('cat'), -1)),
    authors: top(by('author'), 1).concat(top(by('author'), -1)),
  };
}
module.exports = { LABELS, WEIGHT, featuresOf, evidenceOf, applyDelta, featureWeight, scoreItem, summarize, toMap, host };
