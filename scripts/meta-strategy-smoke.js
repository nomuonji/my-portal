'use strict';
// Critical contract: later autonomous runs cannot override a human rejection.
const assert = require('node:assert/strict');
const path = require('node:path');
const storage = new Map();
function snapshot(id, row) { return { id, exists: !!row, data: () => row }; }
const collection = () => ({
  doc(id) {
    const key = id || 'random';
    return { id: key, get: async () => snapshot(key, storage.get(key)) };
  },
  orderBy() { return {
    limit() { return { get: async () => ({ docs: [...storage.entries()]
      .map(([id, row]) => snapshot(id, row)) }) }; },
  }; },
});
const fake = {
  getDocumentDb: () => ({
    collection,
    runTransaction: async callback => {
      const updates = [];
      const tx = {
        get: async ref => ref.get(),
        set: (ref, row) => updates.push(() => storage.set(ref.id, row)),
        update: (ref, patch) => updates.push(() => storage.set(ref.id, { ...storage.get(ref.id), ...patch })),
      };
      const result = await callback(tx);
      updates.forEach(f => f());
      return result;
    },
  }),
  FieldValue: { serverTimestamp: () => '2026-10-16T00:00:00.000Z' },
};
require.cache[require.resolve('../functions/documentDb')] = {
  id: path.resolve(__dirname, '../functions/documentDb.js'), filename: path.resolve(__dirname, '../functions/documentDb.js'),
  loaded: true, exports: fake,
};
const store = require('../functions/metaStrategyStore');
const sample = { ideaKey: 'review-automation-spend', title: '自動化にかけた工数を見直すべきではないか',
  summary: '既存の複数プロジェクトを横断し、管理機構の改修時間と実際に得られた成果を対比する。',
  reason: '進行中の複数ワークフローの問題が会話で繰り返されたため。',
  nextStep: '直近7日間で完成した成果物とシステム整備時間を一覧にする。', priority: 'soon' };
async function main() {
  const first = await store.create(sample);
  assert.equal(first.outcome, 'created');
  assert.equal(first.proposal.status, 'new');
  const rejected = await store.feedback({
    id: first.proposal.id, status: 'rejected', expectedRevision: 1, feedback: '対象が違うのでボツ',
  });
  assert.equal(rejected.revision, 2);
  const repeated = await store.create({ ...sample, title: sample.title + '（新たな表現）' });
  assert.equal(repeated.outcome, 'already_exists');
  assert.equal(repeated.proposal.status, 'rejected');
  assert.equal(repeated.proposal.feedback, '対象が違うのでボツ');
  await assert.rejects(store.feedback({ id: first.proposal.id, status: 'accepted', expectedRevision: 1 }),
    /revision conflict/);
  const listed = await store.list();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].status, 'rejected');
  assert.equal(store.fingerprint('ＡＢ  Ｃ'), store.fingerprint('ab c'));
  console.log('meta strategy: rejection/dedupe/revision contract OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
