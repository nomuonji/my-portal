'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createStore } = require('../functions/explorationBaseStore');

class Snapshot {
  constructor(id, value) { this.id = id; this.value = value === undefined ? null : value; this.exists = this.value !== null; }
  data() { return this.exists ? JSON.parse(JSON.stringify(this.value)) : undefined; }
}
class DocumentRef {
  constructor(db, collection, id) { this.db = db; this.collectionPath = collection; this.id = id; }
  async get() { return new Snapshot(this.id, this.db.records.get(this.collectionPath + '/' + this.id)); }
}
class CollectionRef {
  constructor(db, path, filters, max) { this.db = db; this.path = path; this.filters = filters || []; this.max = max || null; }
  doc(id) { return new DocumentRef(this.db, this.path, id); }
  where(field, op, value) { return new CollectionRef(this.db, this.path, this.filters.concat([{ field, value }]), this.max); }
  limit(value) { return new CollectionRef(this.db, this.path, this.filters, value); }
  async get() {
    const prefix = this.path + '/';
    const docs = [...this.db.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .filter(([, value]) => this.filters.every((filter) => value[filter.field] === filter.value))
      .slice(0, this.max || 5000)
      .map(([key, value]) => new Snapshot(key.slice(prefix.length), value));
    return { docs, size: docs.length };
  }
}
class MemoryDb {
  constructor() { this.records = new Map(); }
  collection(path) { return new CollectionRef(this, path); }
  async runTransaction(callback) {
    const writes = [];
    const tx = { get: (ref) => ref.get(), set: (ref, value) => { writes.push({ ref, value }); } };
    const result = await callback(tx);
    writes.forEach((write) => this.records.set(write.ref.collectionPath + '/' + write.ref.id, JSON.parse(JSON.stringify(write.value))));
    return result;
  }
}

const auth = { userAuthorized: true, authorizationNote: 'User said: go ahead, 2-3 keywords' };
const outcome = {
  statement: 'Find keywords the user decides to write.', unit: 'one keyword', target: { min: 2, max: 3 },
  acceptance: 'Passes every check and the user confirms.', proxies: ['search volume'],
};
const method = { title: 'Method', version: 'm-v1', summary: 'Initial', bodyRef: { kind: 'repo', location: 'owner/repo', path: 'docs/method.md' } };
async function setup() {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  await store.create({ id: 'test-base', title: 'Test', summary: 'Smoke', outcome, method, ...auth });
  return store;
}
const hypothesis = { title: 'Emotional terms are open', statement: 'Emotional queries have weak page-one slots.', mechanism: 'Professionals only write transactional pages.' };

test('the outcome contract belongs to the user', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  await assert.rejects(store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method }), /owned by the user/);
  await store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method, ...auth });
  await store.setOutcome({ baseId: 'test-base', outcome: { ...outcome, target: { min: 1 } }, reason: 'Two looks unreachable' });
  let brief = await store.get({ id: 'test-base' });
  assert.equal(brief.outcome.target.min, 2, 'an unauthorized change must not apply');
  assert.equal(brief.proposals.length, 1);
  await store.setOutcome({ baseId: 'test-base', outcome: { ...outcome, target: { min: 1 } }, resolveProposalIds: ['PR-001'], ...auth });
  brief = await store.get({ id: 'test-base' });
  assert.equal(brief.outcome.target.min, 1);
  assert.equal(brief.outcome.revision, 2);
  assert.equal(brief.proposals.length, 0);
});

test('title, summary and domains are user-owned and can be revised without touching the outcome', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  await store.create({ id: 'test-base', title: 'T', summary: 'S', domains: ['a'], outcome, method, ...auth });
  await assert.rejects(store.setOutcome({ baseId: 'test-base', title: 'New' }), /owned by the user/);
  // Older client schemas send domains as one string.
  const renamed = await store.setOutcome({ baseId: 'test-base', title: 'New', summary: 'New summary', domains: 'x, y', reason: 'Not for one channel', ...auth });
  assert.equal(renamed.base.title, 'New');
  assert.equal(renamed.base.summary, 'New summary');
  assert.deepEqual(renamed.base.domains, ['x', 'y']);
  assert.equal(renamed.outcome.revision, 1, 'renaming must not revise the outcome contract');
  const full = await store.get({ id: 'test-base', view: 'full' });
  const event = full.full.events.find((entry) => entry.type === 'base_described');
  assert.equal(event.detail.before.title, 'T');
  await assert.rejects(store.setOutcome({ baseId: 'test-base', title: '', ...auth }), /title/);
});

test('hypothesis stages need the evidence they claim, and rejections are kept', async () => {
  const store = await setup();
  const created = await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [{ ...hypothesis, legacyIds: ['P22'] }, { ...hypothesis, title: 'CPC predicts competition' }] });
  assert.deepEqual(created.changed.map((c) => c.id), ['H-001', 'H-002']);
  const upsert = (item) => store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [item] });
  await assert.rejects(upsert({ id: 'H-001', stage: 'observed' }), /at least one evidence/);
  await upsert({ id: 'H-001', stage: 'observed', addEvidence: [{ ref: 'seen once' }] });
  await assert.rejects(upsert({ id: 'H-001', stage: 'reproduced' }), /two independent/);
  await upsert({ id: 'H-001', stage: 'reproduced', addEvidence: [{ ref: 'seen again elsewhere' }] });
  await assert.rejects(upsert({ id: 'H-001', stage: 'yielded_candidate', addEvidence: [{ ref: 'third sighting' }] }), /type candidate/);
  await assert.rejects(upsert({ id: 'H-001', stage: 'yielded_outcome', addEvidence: [{ type: 'outcome', ref: 'claimed win' }] }), /no confirmed achievement/);
  await assert.rejects(upsert({ id: 'H-002', status: 'rejected' }), /requires a reason/);
  await upsert({ id: 'H-002', status: 'rejected', reason: 'Pet loss is the counterexample', addCounterexamples: ['pet loss: CPC 37, weak 3'] });
  await assert.rejects(upsert({ id: 'H-009', title: 'x' }), /not found/);
  const brief = await store.get({ id: 'test-base' });
  assert.equal(brief.hypotheses.winPatterns.length, 0, 'reproduced is not yet a win pattern');
  assert.equal(brief.hypotheses.reproduced[0].id, 'H-001');
  assert.equal(brief.hypotheses.rejected[0].reason, 'Pet loss is the counterexample');
  const next = await upsert({ ...hypothesis, title: 'Third' });
  assert.equal(next.changed[0].id, 'H-003', 'IDs are never reused');
});

test('constraints are split by owner', async () => {
  const store = await setup();
  const add = (item, extra) => store.upsertItems({ baseId: 'test-base', kind: 'constraint', items: [item], ...(extra || {}) });
  await assert.rejects(add({ owner: 'user', statement: 'No invented experiences' }), /owned by the user/);
  await add({ owner: 'user', statement: 'No invented experiences' }, auth);
  await assert.rejects(add({ owner: 'environment', statement: 'Only real Google decides competition' }), /basis/);
  await add({ owner: 'environment', statement: 'Only real Google decides competition', basis: 'Brave 3 vs Google 6 on the same query' });
  await add({ owner: 'agent', statement: 'Weak slots >= 6' });
  await assert.rejects(add({ id: 'K-001', status: 'relaxed', reason: 'it blocks everything' }), /owned by the user/);
  await assert.rejects(add({ id: 'K-003', statement: 'Weak slots >= 5' }), /requires a reason/);
  await add({ id: 'K-003', statement: 'Weak slots >= 5', reason: 'Benchmark cases still pass at 5' });
  const brief = await store.get({ id: 'test-base' });
  assert.equal(brief.constraints.user.length, 1);
  assert.equal(brief.constraints.environment.length, 1);
  assert.equal(brief.constraints.agent[0].statement, 'Weak slots >= 5');
});

test('runs declare predictions, lock the method, and report movement', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis] });
  await assert.rejects(store.startRun({ baseId: 'test-base', objective: 'look around' }), /Declare at least one target/);
  await assert.rejects(store.startRun({ baseId: 'test-base', objective: 'test', targets: [{ hypothesisId: 'H-001' }] }), /prediction/);
  const started = await store.startRun({ baseId: 'test-base', objective: 'test H-001', targets: [{ hypothesisId: 'H-001', prediction: 'weak slots >= 6 on 3 emotional queries' }] });
  assert.equal(started.runId, 'R-001');
  await assert.rejects(store.startRun({ baseId: 'test-base', objective: 'second', unknownTerritoryProbe: 'elsewhere' }), /is open/);
  const nextMethod = { method: { ...method, version: 'm-v2', summary: 'Changed mid-run' } };
  await assert.rejects(store.setMethodVersion({ baseId: 'test-base', ...nextMethod }), /cannot change during a run/);
  await assert.rejects(store.finishRun({ baseId: 'test-base', runId: 'R-001', summary: 'done' }), /Missing verdict/);
  const verdicts = [{ hypothesisId: 'H-001', result: 'inconclusive', observed: 'quota ran out after one query' }];
  await assert.rejects(store.finishRun({ baseId: 'test-base', runId: 'R-001', summary: 'done', verdicts }), /notMovedReason/);
  const stalled = await store.finishRun({ baseId: 'test-base', runId: 'R-001', summary: 'done', verdicts, notMovedReason: 'SERP quota exhausted' });
  assert.equal(stalled.run.moved, false);
  assert.equal(stalled.brief.position.stalledRuns, 1);

  await assert.rejects(store.setMethodVersion({ baseId: 'test-base', ...nextMethod }), /motivatingRunIds/);
  await assert.rejects(store.setMethodVersion({ baseId: 'test-base', ...nextMethod, motivatingRunIds: ['R-001'] }), /benchmark/);
  await assert.rejects(store.setMethodVersion({ baseId: 'test-base', method: { ...method, summary: 'Same label' }, motivatingRunIds: ['R-001'], benchmark: { passed: true } }), /already used/);
  const bumped = await store.setMethodVersion({ baseId: 'test-base', ...nextMethod, motivatingRunIds: ['R-001'], benchmark: { passed: true, ref: 'npm run test:method' } });
  assert.equal(bumped.method.version, 'm-v2');
  assert.equal(bumped.method.bodyRef.location, 'owner/repo');

  const second = await store.startRun({ baseId: 'test-base', objective: 'retest', targets: [{ hypothesisId: 'H-001', prediction: 'weak slots >= 6' }] });
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', runId: second.runId, items: [{ id: 'H-001', stage: 'observed', addEvidence: [{ type: 'candidate', ref: 'query A: weak 7' }] }] });
  const finished = await store.finishRun({
    baseId: 'test-base', runId: second.runId, summary: 'One candidate',
    verdicts: [{ hypothesisId: 'H-001', result: 'supported', observed: 'weak 7' }],
    achievements: [{ label: 'query A', evidence: 'all checks pass', hypothesisIds: ['H-001'] }],
  });
  assert.equal(finished.run.moved, true);
  assert.deepEqual(finished.run.movedItemIds, ['H-001']);
  assert.equal(finished.brief.position.stalledRuns, 0);
  assert.equal(finished.brief.outcome.awaitingConfirmation.length, 1);
  assert.equal(finished.brief.outcome.confirmedCount, 0, 'a candidate is not an achievement until the user confirms');
  await assert.rejects(store.setOutcome({ baseId: 'test-base', confirmAchievements: [{ id: 'A-001', decision: 'confirmed' }] }), /owned by the user/);
  const confirmed = await store.setOutcome({ baseId: 'test-base', confirmAchievements: [{ id: 'A-001', decision: 'confirmed' }], ...auth });
  assert.equal(confirmed.outcome.confirmedCount, 1);
  assert.equal(confirmed.outcome.reached, false);
  const full = await store.get({ id: 'test-base', view: 'full' });
  assert.equal(full.full.runs.length, 2);
  assert.ok(full.full.events.some((event) => event.type === 'run_stalled'));
  assert.equal((await store.list({})).items[0].methodVersion, 'm-v2');
});

test('three stalled runs raise a warning', async () => {
  const store = await setup();
  for (let i = 0; i < 3; i += 1) {
    const run = await store.startRun({ baseId: 'test-base', objective: 'probe ' + i, unknownTerritoryProbe: 'somewhere new' });
    await store.finishRun({ baseId: 'test-base', runId: run.runId, summary: 'nothing', notMovedReason: 'no signal' });
  }
  const brief = await store.get({ id: 'test-base' });
  assert.ok(brief.warnings.some((warning) => /consecutive runs moved no fixed point/.test(warning)));
});
