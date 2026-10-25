// Quick capture into the three Portal boards (used by the Chrome extension).
// Writes the same documents the /boards UI writes: { content, tags, createdAt, updatedAt }
// plus `owner: 'portal'` for ideas, and registers new tags in the board's tag collection.
const { getDocumentDb, FieldValue } = require('./documentDb');

const DATABASE_ID = '(default)';

const BOARDS = Object.freeze({
  stocks: { id: 'stocks', label: 'ネタ・表現', collection: 'stocks', tagsCollection: 'stock_tags' },
  ideas: { id: 'ideas', label: '企画・ビジネス', collection: 'ideas', tagsCollection: 'tags', extra: { owner: 'portal' } },
  hobbies: { id: 'hobbies', label: '興味・趣味', collection: 'hobbies', tagsCollection: 'hobby_tags' },
});
const BOARD_ORDER = ['stocks', 'ideas', 'hobbies'];
const MAX_CONTENT = 20000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 60;

function boardConfig(id) {
  const board = BOARDS[String(id || '')];
  if (!board) throw new Error(`Unknown board: ${id}. Use one of ${BOARD_ORDER.join(', ')}`);
  return board;
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const raw of list) {
    const tag = String(raw ?? '').replace(/^#+/, '').trim().slice(0, MAX_TAG_LENGTH);
    // Tags are also document IDs in the tag collections.
    if (!tag || tag.includes('/') || tag === '.' || tag === '..' || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function cleanUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 2000) : undefined;
  } catch {
    return undefined;
  }
}

/** Boards with their known tags, most used first. */
async function listBoards({ db = getDocumentDb(DATABASE_ID), usageLimit = 500 } = {}) {
  return Promise.all(BOARD_ORDER.map(async (id) => {
    const board = BOARDS[id];
    const [tagSnap, itemSnap] = await Promise.all([
      db.collection(board.tagsCollection).get(),
      db.collection(board.collection).orderBy('createdAt', 'desc').limit(usageLimit).get(),
    ]);
    const counts = new Map();
    itemSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (board.extra?.owner && data.owner && data.owner !== board.extra.owner) return;
      (Array.isArray(data.tags) ? data.tags : []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    tagSnap.docs.forEach((doc) => { if (!counts.has(doc.id)) counts.set(doc.id, 0); });
    const tags = [...counts.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'ja'))
      .map(([tag]) => tag);
    return { id, label: board.label, tags };
  }));
}

async function capture(input = {}, { db = getDocumentDb(DATABASE_ID) } = {}) {
  const board = boardConfig(input.board);
  const content = String(input.content ?? '').trim().slice(0, MAX_CONTENT);
  if (!content) throw new Error('content is required');
  const tags = normalizeTags(input.tags);
  const sourceUrl = cleanUrl(input.sourceUrl);
  const sourceTitle = String(input.sourceTitle ?? '').trim().slice(0, 300) || undefined;

  await Promise.all(tags.map((tag) => db.collection(board.tagsCollection).doc(tag).set({}, { merge: true })));

  const now = FieldValue.serverTimestamp();
  const ref = db.collection(board.collection).doc();
  await ref.set({
    content,
    tags,
    ...(board.extra || {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    capturedVia: 'chrome-extension',
    createdAt: now,
    updatedAt: now,
  });
  return { board: board.id, id: ref.id, tags };
}

module.exports = { BOARDS, BOARD_ORDER, normalizeTags, cleanUrl, listBoards, capture };
