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

test('a method version can be justified by an explicit user decision instead of runs', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  await store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method, ...auth });
  const next = { title: 'M', version: 'm-v2', summary: 'Dropped a criterion', bodyRef: { kind: 'inline' }, body: '# Method\n\n1. Measure' };
  await assert.rejects(store.setMethodVersion({ baseId: 'test-base', method: next, noBenchmarkReason: 'no benchmark yet' }), /motivatingRunIds is required/);
  // Older client schemas deliver the flag as a string.
  const updated = await store.setMethodVersion({ baseId: 'test-base', method: next, noBenchmarkReason: 'text moved, nothing to benchmark', userAuthorized: 'true', authorizationNote: 'chat 2026-11-12: drop C6' });
  assert.equal(updated.method.version, 'm-v2');
  assert.equal(updated.method.bodyRef.kind, 'inline');
  assert.equal(updated.method.bodyRef.location, '', 'an inline body must not inherit the previous repo location');
  assert.ok(updated.method.body.startsWith('# Method'));
  const full = await store.get({ id: 'test-base', view: 'full' });
  assert.equal(full.full.methodHistory.at(-1).authorizationNote, 'chat 2026-11-12: drop C6');
  await assert.rejects(store.setMethodVersion({ baseId: 'test-base', method: { ...next, version: 'm-v3' }, noBenchmarkReason: 'x'.repeat(10), userAuthorized: true, authorizationNote: '' }), /owned by the user/);
});

test('title, summary and domains are user-owned and can be revised without touching the outcome', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  await store.create({ id: 'test-base', title: 'T', summary: 'S', domains: ['a'], outcome, method, ...auth });
  await assert.rejects(store.setOutcome({ baseId: 'test-base', title: 'New' }), /owned by the user/);
  // Older client schemas send domains as one string.
  const renamed = await store.setOutcome({ baseId: 'test-base', title: 'New', summary: 'New summary', domains: 'x, y', canonicalData: 'Operator A\nrepo/path', reason: 'Not for one channel', ...auth });
  assert.deepEqual(renamed.base.canonicalData, ['Operator A', 'repo/path']);
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

test('sources are a verified ledger like hypotheses', async () => {
  const store = await setup();
  await assert.rejects(store.upsertItems({ baseId: 'test-base', kind: 'source', items: [{ title: 'No locator', coverage: 'x' }] }), /locator/);
  const created = await store.upsertItems({ baseId: 'test-base', kind: 'source', items: [
    { title: 'Hatena hot', locator: 'https://b.hatena.ne.jp/hotentry/fun', coverage: 'Light Japanese web finds the user liked in the RSS reader.' },
    { title: 'Know Your Meme', locator: 'https://knowyourmeme.com', coverage: 'Meme histories.' },
  ] });
  assert.deepEqual(created.changed.map((c) => c.id), ['S-001', 'S-002']);
  await assert.rejects(store.upsertItems({ baseId: 'test-base', kind: 'source', items: [{ id: 'S-001', stage: 'observed' }] }), /evidence/);
  await store.upsertItems({ baseId: 'test-base', kind: 'source', items: [{ id: 'S-001', stage: 'observed', addEvidence: [{ ref: 'User liked 3 items from it' }] }] });
  await assert.rejects(store.upsertItems({ baseId: 'test-base', kind: 'source', items: [{ id: 'S-002', status: 'rejected' }] }), /reason/);
  await store.upsertItems({ baseId: 'test-base', kind: 'source', items: [{ id: 'S-002', status: 'rejected', reason: '17 picks, all skipped', addCounterexamples: ['all skipped'] }] });
  // The hypothesis counter is separate from the source counter.
  const h = await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis] });
  assert.equal(h.changed[0].id, 'H-001');
  const brief = await store.get({ id: 'test-base' });
  assert.equal(brief.sources.observed[0].id, 'S-001');
  assert.equal(brief.sources.observed[0].locator, 'https://b.hatena.ne.jp/hotentry/fun');
  assert.equal(brief.sources.rejected[0].reason, '17 picks, all skipped');
  assert.equal(brief.hypotheses.conjectures[0].id, 'H-001');
  const full = await store.get({ id: 'test-base', view: 'full' });
  assert.equal(full.full.sources.length, 2);
  // Achievements record which source they came from.
  const { runId } = await store.startRun({ baseId: 'test-base', objective: 'try', unknownTerritoryProbe: 'new sources' });
  const done = await store.finishRun({ baseId: 'test-base', runId, summary: 'found one', achievements: [{ label: 'item', evidence: 'passed', sourceIds: ['S-001'] }] });
  assert.deepEqual(done.brief.outcome.awaitingConfirmation[0].sourceIds, ['S-001']);
});

test('a like in the app is a confirmed achievement, and withdrawing it declines it', async () => {
  const store = await setup();
  const like = { baseId: 'test-base', ref: 'personal_feed:cur-1', label: 'Foot bath', liked: true };
  assert.equal((await store.recordUserReaction(like)).changed, true);
  assert.equal((await store.recordUserReaction(like)).changed, false); // idempotent
  let brief = await store.get({ id: 'test-base' });
  assert.equal(brief.outcome.confirmedCount, 1);
  assert.equal(brief.outcome.confirmed[0].label, 'Foot bath');
  await store.recordUserReaction({ ...like, liked: false });
  brief = await store.get({ id: 'test-base' });
  assert.equal(brief.outcome.confirmedCount, 0);
  await store.recordUserReaction(like);
  brief = await store.get({ id: 'test-base' });
  assert.equal(brief.outcome.confirmedCount, 1);
  assert.equal(brief.outcome.confirmed.length, 1); // re-confirmed, not duplicated
  assert.deepEqual(await store.recordUserReaction({ ...like, baseId: 'missing-base' }), { baseId: 'missing-base', changed: false });
});

test('a base trains a DB skill or pack and releases one pinned version', async () => {
  const db = new MemoryDb();
  const versions = { 'discover-curation': { 1: 'Version one body of the curation skill.', 2: 'Version two body, edited outside the base.' } };
  const resolveTarget = async ({ kind, id, versionNumber }) => {
    const known = versions[id];
    if (kind !== 'chat_skill' || !known || !known[versionNumber]) throw new Error('not found ' + id + ' v' + versionNumber);
    return { title: id, latestVersion: Math.max(...Object.keys(known).map(Number)), body: known[versionNumber] };
  };
  const store = createStore({ getDb: () => db, resolveTarget });
  const skillMethod = (versionNumber) => ({ title: 'Curation', version: 'disc-s' + versionNumber, summary: 'Skill v' + versionNumber, bodyRef: { kind: 'chat_skill', location: 'discover-curation', versionNumber } });
  await assert.rejects(store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method: { ...skillMethod(1), bodyRef: { kind: 'chat_skill', location: 'discover-curation' } }, ...auth }), /versionNumber/);
  await assert.rejects(store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method: skillMethod(9), ...auth }), /not found/);
  await store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method: skillMethod(1), ...auth });
  let brief = await store.get({ id: 'test-base' });
  assert.equal(brief.method.target.releasedVersion, 1);
  assert.equal(brief.method.body, 'Version one body of the curation skill.');
  assert.ok(brief.warnings.some((w) => /newer than v1/.test(w)));
  assert.equal(brief.method.target.unreleasedNewer, true);
  await store.setMethodVersion({ baseId: 'test-base', method: skillMethod(2), noBenchmarkReason: 'user decided in chat', userAuthorized: true, authorizationNote: 'User said: release v2' });
  brief = await store.get({ id: 'test-base' });
  assert.equal(brief.method.body, 'Version two body, edited outside the base.');
  assert.ok(!brief.warnings.some((w) => /newer than/.test(w)));
});
