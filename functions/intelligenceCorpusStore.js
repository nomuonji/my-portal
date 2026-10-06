const { createHash } = require('node:crypto');
const { getDocumentDb, FieldValue } = require('./documentDb');

const DATABASE_ID = '(default)';
const COLLECTIONS = Object.freeze({
  rawDocuments: 'intelligence_raw_documents',
  importRuns: 'intelligence_import_runs',
});
const MURAKAMI_RADIO_INDEX_URL = 'https://www.tfm.co.jp/murakamiradio/';
const DATASET = 'murakami_radio';
const MAX_RAW_BYTES = 850000;
const MAX_SYNC_LIMIT = 6;

function db() {
  return getDocumentDb(DATABASE_ID);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function text(value, max = 5000) {
  if (value === undefined || value === null) return '';
  return String(value).slice(0, max);
}

function requireConfirmation(input, action) {
  if (input.confirm !== true) throw new Error(`${action} requires confirm=true after explicit user approval`);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractDerivedText(html) {
  const raw = String(html || '');
  const primaryMatch = raw.match(/<section\b[^>]*class=["'][^"']*\bbnArea\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i);
  const source = primaryMatch ? primaryMatch[1] : raw;
  return decodeEntities(source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|section|article|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function canonicalMurakamiUrl(value, baseUrl = MURAKAMI_RADIO_INDEX_URL) {
  const url = new URL(String(value || ''), baseUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'www.tfm.co.jp') return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (/^\/murakamiradio\/report\/\d+$/.test(path)) return `https://www.tfm.co.jp${path}`;
  if (/^\/murakamiradio\/index_\d{8}\.html$/.test(path)) return `https://www.tfm.co.jp${path}`;
  if (path === '/murakamiradio/toshikoshisp2020') return 'https://www.tfm.co.jp/murakamiradio/toshikoshisp2020/';
  return null;
}

function sourceDocId(url) {
  const parsed = new URL(url);
  const report = parsed.pathname.match(/\/report\/(\d+)/);
  if (report) return `murakami_radio_report_${report[1]}`;
  const legacy = parsed.pathname.match(/index_(\d{8})\.html/);
  if (legacy) return `murakami_radio_${legacy[1]}`;
  if (parsed.pathname.replace(/\/+$/, '') === '/murakamiradio/toshikoshisp2020') return 'murakami_radio_toshikoshisp2020';
  return `murakami_radio_${sha256(url).slice(0, 24)}`;
}

function lastMatch(value, regex) {
  let found = null;
  for (const match of String(value || '').matchAll(regex)) found = match;
  return found;
}

function discoverMurakamiRadioLinks(html, indexUrl = MURAKAMI_RADIO_INDEX_URL) {
  const found = [];
  const seen = new Set();
  const anchor = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchor.exec(String(html || '')))) {
    const url = canonicalMurakamiUrl(match[2], indexUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const before = String(html || '').slice(Math.max(0, match.index - 700), match.index);
    const contextText = stripTags(before);
    const episodeMatch = lastMatch(contextText, /第\s*(\d+)\s*回/g);
    const dateMatch = lastMatch(contextText, /(20\d{2})[.年\/-]\s*(\d{1,2})[.月\/-]\s*(\d{1,2})/g);
    const title = stripTags(match[3]);
    found.push({
      url,
      episodeNumber: episodeMatch ? Number(episodeMatch[1]) : null,
      broadcastDate: dateMatch
        ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
        : null,
      title: title || null,
      discoveryOrder: found.length,
    });
  }
  return found;
}

function pageTitle(html) {
  const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : null;
}

function serialize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = serialize(item);
    return out;
  }
  return value;
}

function snapshotObject(snapshot) {
  return snapshot.exists ? serialize({ id: snapshot.id, ...snapshot.data() }) : null;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'MyPortal-Intelligence-Corpus/1.0 (private research archive sync)',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_RAW_BYTES) {
    throw new Error(`Raw page exceeds safe inline storage limit (${buffer.byteLength} bytes): ${url}`);
  }
  return {
    html: buffer.toString('utf8'),
    bytes: buffer.byteLength,
    finalUrl: response.url || url,
    contentType: response.headers.get('content-type') || null,
    etag: response.headers.get('etag') || null,
    lastModified: response.headers.get('last-modified') || null,
  };
}

async function upsertRawDocument(meta, fetched) {
  const id = sourceDocId(meta.url);
  const ref = db().collection(COLLECTIONS.rawDocuments).doc(id);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;
  const rawSha256 = sha256(fetched.html);
  const unchanged = existing && existing.rawSha256 === rawSha256;
  const now = FieldValue.serverTimestamp();

  const base = {
    schemaVersion: 1,
    dataset: DATASET,
    sourceAuthority: 'TOKYO FM',
    sourceUrl: meta.url,
    finalUrl: fetched.finalUrl,
    sourceId: id,
    contentKind: 'episode',
    episodeNumber: meta.episodeNumber ?? existing?.episodeNumber ?? null,
    broadcastDate: meta.broadcastDate ?? existing?.broadcastDate ?? null,
    title: meta.title || pageTitle(fetched.html) || existing?.title || null,
    discoveryOrder: meta.discoveryOrder ?? null,
    rawCanonicalField: 'rawHtml',
    rawSha256,
    rawBytes: fetched.bytes,
    contentType: fetched.contentType,
    httpEtag: fetched.etag,
    httpLastModified: fetched.lastModified,
    lastCheckedAt: now,
    updatedAt: now,
  };

  if (unchanged) {
    await ref.set(base, { merge: true });
    return { id, state: 'unchanged', rawSha256, rawBytes: fetched.bytes };
  }

  await ref.set({
    ...base,
    rawHtml: fetched.html,
    derivedText: extractDerivedText(fetched.html),
    firstImportedAt: existing?.firstImportedAt || now,
    importedAt: now,
    version: Number(existing?.version || 0) + 1,
    previousRawSha256: existing?.rawSha256 || null,
  }, { merge: true });
  return { id, state: existing ? 'updated' : 'created', rawSha256, rawBytes: fetched.bytes };
}

async function storeIndexDocument(fetched, discoveredCount) {
  const ref = db().collection(COLLECTIONS.rawDocuments).doc('murakami_radio_index');
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;
  const rawSha256 = sha256(fetched.html);
  const now = FieldValue.serverTimestamp();
  const unchanged = existing && existing.rawSha256 === rawSha256;
  const base = {
    schemaVersion: 1,
    dataset: DATASET,
    sourceAuthority: 'TOKYO FM',
    sourceUrl: MURAKAMI_RADIO_INDEX_URL,
    finalUrl: fetched.finalUrl,
    sourceId: 'murakami_radio_index',
    contentKind: 'index',
    discoveredEpisodeCount: discoveredCount,
    rawCanonicalField: 'rawHtml',
    rawSha256,
    rawBytes: fetched.bytes,
    contentType: fetched.contentType,
    httpEtag: fetched.etag,
    httpLastModified: fetched.lastModified,
    lastCheckedAt: now,
    updatedAt: now,
  };
  if (unchanged) {
    await ref.set(base, { merge: true });
    return;
  }
  await ref.set({
    ...base,
    rawHtml: fetched.html,
    derivedText: extractDerivedText(fetched.html),
    firstImportedAt: existing?.firstImportedAt || now,
    importedAt: now,
    version: Number(existing?.version || 0) + 1,
    previousRawSha256: existing?.rawSha256 || null,
  }, { merge: true });
}

async function status() {
  const [rawSnapshot, runs] = await Promise.all([
    db().collection(COLLECTIONS.rawDocuments).where('dataset', '==', DATASET).get(),
    db().collection(COLLECTIONS.importRuns).where('dataset', '==', DATASET).count().get(),
  ]);
  return {
    ok: true,
    dataset: DATASET,
    databaseId: DATABASE_ID,
    collections: COLLECTIONS,
    counts: {
      rawDocuments: rawSnapshot.size,
      episodes: rawSnapshot.docs.filter((doc) => doc.get('contentKind') === 'episode').length,
      importRuns: runs.data().count,
    },
  };
}

async function getRawDocument(input = {}) {
  const id = text(input.id, 300);
  if (!id) throw new Error('id is required');
  const snap = await db().collection(COLLECTIONS.rawDocuments).doc(id).get();
  if (!snap.exists) throw new Error(`Raw document not found: ${id}`);
  const item = snapshotObject(snap);
  if (input.includeRawHtml !== true) delete item.rawHtml;
  if (input.includeDerivedText !== true) delete item.derivedText;
  return { item, databaseId: DATABASE_ID };
}

async function searchRawDocuments(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || 200, limit), 1000);
  const snapshot = await db().collection(COLLECTIONS.rawDocuments).limit(scanLimit).get();
  const needle = text(input.query, 500).toLowerCase();
  const kind = text(input.contentKind, 40).toLowerCase();
  const episodeNumber = Number(input.episodeNumber) || null;

  const items = snapshot.docs
    .map(snapshotObject)
    .filter((item) => item?.dataset === DATASET)
    .filter((item) => !kind || String(item.contentKind || '').toLowerCase() === kind)
    .filter((item) => !episodeNumber || Number(item.episodeNumber) === episodeNumber)
    .filter((item) => {
      if (!needle) return true;
      return [
        item.id, item.title, item.sourceUrl, item.broadcastDate,
        input.searchDerivedText === true ? item.derivedText : '',
      ].filter(Boolean).join('\n').toLowerCase().includes(needle);
    })
    .sort((a, b) => Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0))
    .slice(0, limit)
    .map((item) => {
      const result = { ...item };
      delete result.rawHtml;
      if (input.includeDerivedText !== true) {
        if (result.derivedText) result.derivedTextPreview = result.derivedText.slice(0, 1600);
        delete result.derivedText;
      }
      return result;
    });

  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

async function syncMurakamiRadio(input = {}) {
  requireConfirmation(input, 'intelligence_sync_murakami_radio');
  const offset = Math.max(0, Number(input.offset) || 0);
  const limit = Math.min(Math.max(Number(input.limit) || 6, 1), MAX_SYNC_LIMIT);
  const indexFetched = await fetchHtml(MURAKAMI_RADIO_INDEX_URL);
  const discovered = discoverMurakamiRadioLinks(indexFetched.html);
  if (!discovered.length) throw new Error('No Murakami RADIO archive links discovered from the official index');
  await storeIndexDocument(indexFetched, discovered.length);

  const selected = discovered.slice(offset, offset + limit);
  const outcomes = [];
  const failures = [];

  for (let i = 0; i < selected.length; i += 3) {
    const wave = selected.slice(i, i + 3);
    const waveResults = await Promise.all(wave.map(async (meta) => {
      try {
        const fetched = await fetchHtml(meta.url);
        return { ok: true, meta, result: await upsertRawDocument(meta, fetched) };
      } catch (error) {
        return { ok: false, meta, error: String(error?.message || error) };
      }
    }));
    for (const item of waveResults) {
      if (item.ok) outcomes.push({ ...item.meta, ...item.result });
      else failures.push({ url: item.meta.url, episodeNumber: item.meta.episodeNumber, error: item.error });
    }
    if (i + 3 < selected.length) await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const counts = outcomes.reduce((acc, item) => {
    acc[item.state] = (acc[item.state] || 0) + 1;
    return acc;
  }, { created: 0, updated: 0, unchanged: 0 });

  const runId = `murakami_radio_${Date.now()}`;
  await db().collection(COLLECTIONS.importRuns).doc(runId).set({
    schemaVersion: 1,
    dataset: DATASET,
    sourceUrl: MURAKAMI_RADIO_INDEX_URL,
    discoveredCount: discovered.length,
    offset,
    limit,
    selectedCount: selected.length,
    created: counts.created,
    updated: counts.updated,
    unchanged: counts.unchanged,
    failed: failures.length,
    failures,
    completedAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: failures.length === 0,
    dataset: DATASET,
    runId,
    discoveredCount: discovered.length,
    offset,
    limit,
    nextOffset: offset + selected.length < discovered.length ? offset + selected.length : null,
    selectedCount: selected.length,
    created: counts.created,
    updated: counts.updated,
    unchanged: counts.unchanged,
    failed: failures.length,
    failures,
    documents: outcomes.map((item) => ({
      id: item.id,
      episodeNumber: item.episodeNumber,
      broadcastDate: item.broadcastDate,
      title: item.title,
      url: item.url,
      state: item.state,
      rawBytes: item.rawBytes,
      rawSha256: item.rawSha256,
    })),
  };
}

module.exports = {
  DATABASE_ID,
  COLLECTIONS,
  MURAKAMI_RADIO_INDEX_URL,
  DATASET,
  canonicalMurakamiUrl,
  sourceDocId,
  discoverMurakamiRadioLinks,
  extractDerivedText,
  status,
  getRawDocument,
  searchRawDocuments,
  syncMurakamiRadio,
};
