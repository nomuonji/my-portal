// node --test scripts/board-capture-smoke.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { capture, listBoards, listItems, normalizeTags, cleanUrl } = require('../functions/boardCapture');

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed)); // "col/id" -> data
  let n = 0;
  const docsOf = (col) => [...store.entries()]
    .filter(([key]) => key.startsWith(`${col}/`) && key.split('/').length === col.split('/').length + 1)
    .map(([key, data]) => ({ id: key.split('/').pop(), data: () => data }));
  const collection = (col) => ({
    doc: (id = `auto${(n += 1)}`) => ({
      id,
      set: async (data, opts = {}) => { store.set(`${col}/${id}`, opts.merge ? { ...(store.get(`${col}/${id}`) || {}), ...data } : data); },
    }),
    get: async () => ({ docs: docsOf(col) }),
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: docsOf(col) }) }) }),
  });
  return { store, collection };
}

test('capture writes a board item like the UI does', async () => {
  const db = fakeDb();
  const result = await capture({
    board: 'ideas', content: '  思いつき  ', tags: ['#企画', '企画', 'a/b', ' 新規 '],
    sourceUrl: 'https://example.com/x', sourceTitle: 'Example',
  }, { db });
  const item = db.store.get(`ideas/${result.id}`);
  assert.equal(item.content, '思いつき');
  assert.deepEqual(item.tags, ['企画', '新規']);
  assert.equal(item.owner, 'portal');
  assert.equal(item.sourceUrl, 'https://example.com/x');
  assert.ok(db.store.has('tags/企画'));
  assert.ok(db.store.has('tags/新規'));
});

test('capture validates board and content', async () => {
  const db = fakeDb();
  await assert.rejects(capture({ board: 'nope', content: 'x' }, { db }), /Unknown board/);
  await assert.rejects(capture({ board: 'stocks', content: '   ' }, { db }), /content is required/);
});

test('listBoards orders tags by usage and includes unused registered tags', async () => {
  const db = fakeDb({
    'stocks/1': { tags: ['B', 'A'] },
    'stocks/2': { tags: ['B'] },
    'stock_tags/A': {},
    'stock_tags/Z': {},
  });
  const boards = await listBoards({ db });
  assert.deepEqual(boards.map((b) => b.id), ['stocks', 'ideas', 'hobbies', 'memos']);
  assert.deepEqual(boards[0].tags, ['B', 'A', 'Z']);
});

test('listItems returns board items and keeps agent ideas out of ideas', async () => {
  const db = fakeDb({
    'ideas/1': { content: 'portal idea', owner: 'portal', tags: ['x'], sourceUrl: 'https://a.example/' },
    'ideas/2': { content: 'agent idea', createdBy: 'agent', maturity: 'seed' },
    'stocks/9': { content: 'ネタ', tags: [] },
  });
  const ideas = await listItems({ board: 'ideas' }, { db });
  assert.deepEqual(ideas.items.map((i) => i.id), ['1']);
  assert.equal(ideas.items[0].sourceUrl, 'https://a.example/');
  const stocks = await listItems({ board: 'stocks', limit: 1 }, { db });
  assert.equal(stocks.items[0].content, 'ネタ');
  await assert.rejects(listItems({ board: 'nope' }, { db }), /Unknown board/);
});

test('memos board writes under memos/board/', async () => {
  const db = fakeDb();
  const result = await capture({ board: 'memos', content: 'ただのメモ', tags: ['買い物'] }, { db });
  assert.ok(db.store.has(`memos/board/items/${result.id}`));
  assert.ok(db.store.has('memos/board/tags/買い物'));
});

test('helpers', () => {
  assert.equal(cleanUrl('javascript:alert(1)'), undefined);
  assert.equal(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 20);
});
