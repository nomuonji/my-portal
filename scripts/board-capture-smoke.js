// node --test scripts/board-capture-smoke.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { capture, listBoards, normalizeTags, cleanUrl } = require('../functions/boardCapture');

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed)); // "col/id" -> data
  let n = 0;
  const docsOf = (col) => [...store.entries()]
    .filter(([key]) => key.startsWith(`${col}/`) && key.split('/').length === 2)
    .map(([key, data]) => ({ id: key.split('/')[1], data: () => data }));
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
  assert.deepEqual(boards.map((b) => b.id), ['stocks', 'ideas', 'hobbies']);
  assert.deepEqual(boards[0].tags, ['B', 'A', 'Z']);
});

test('helpers', () => {
  assert.equal(cleanUrl('javascript:alert(1)'), undefined);
  assert.equal(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 20);
});
