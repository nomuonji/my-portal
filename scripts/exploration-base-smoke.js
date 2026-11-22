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
  assert.equal(confirmed.outcome.reached, undefined, 'a 道場 has no count target to reach');
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

test('a skill pointer from before pinning warns instead of failing', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db, resolveTarget: async () => { throw new Error('should not resolve'); } });
  await store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method, ...auth });
  // Simulate a base stored by the older code: chat_skill pointer without versionNumber.
  const key = [...db.records.keys()].find((k) => k.startsWith('explorationBases/'));
  const stored = db.records.get(key);
  stored.method.bodyRef = { kind: 'chat_skill', location: 'some-skill', path: '', commit: '' };
  const brief = await store.get({ id: 'test-base' });
  assert.ok(brief.warnings.some((w) => /without a released version/.test(w)));
  assert.equal(brief.method.target, undefined);
});

test('trainersOf lists the bases that train a skill and the version each releases', async () => {
  const db = new MemoryDb();
  const resolveTarget = async () => ({ title: 's', latestVersion: 3, body: 'body text long enough' });
  const store = createStore({ getDb: () => db, resolveTarget });
  await store.create({ id: 'test-base', title: 'Dojo', summary: 'S', outcome, method: { title: 'M', version: 's2', summary: 'x', bodyRef: { kind: 'chat_skill', location: 'my-skill', versionNumber: 2 } }, ...auth });
  assert.deepEqual(await store.trainersOf({ kind: 'chat_skill', id: 'my-skill' }), [{ baseId: 'test-base', title: 'Dojo', releasedVersion: 2 }]);
  assert.deepEqual(await store.trainersOf({ kind: 'chat_skill', id: 'other' }), []);
});

test('a 道場 is measured by pass rate per version, and needs no count target', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  const { target, ...noTarget } = outcome;
  await store.create({ id: 'test-base', title: 'T', summary: 'S', outcome: noTarget, method, ...auth });
  const brief = await store.get({ id: 'test-base' });
  assert.equal(brief.outcome.target, null);
  assert.equal(brief.loop.metric, 'pass_rate');
  assert.equal(brief.loop.overall.passRate, null);
  const listed = await store.list({});
  assert.equal(listed.items[0].loop.rated, 0);
});

test('a trial names its hypothesis and prediction before the user rates it', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis, { ...hypothesis, title: 'Second' }] });
  const { runId } = await store.startRun({ baseId: 'test-base', objective: 'Show two samples', targets: [{ hypothesisId: 'H-001', prediction: 'the sample passes' }] });
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [{ label: 'No hypothesis', predictedPass: 0.6 }] }), /hypothesisIds is required/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [{ label: 'No prediction', hypothesisIds: ['H-001'] }] }), /predictedPass is required/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [{ label: 'Rated at birth', hypothesisIds: ['H-001'], predictedPass: 0.5, rating: { verdict: 'pass', userWords: 'ok' } }] }), /only for backfill/);
  const recorded = await store.recordTrials({ baseId: 'test-base', runId, trials: [
    { label: 'Sample A', body: 'text A', ref: 'out-a', hypothesisIds: ['H-001'], predictedPass: 0.7 },
    { label: 'Sample B', ref: 'https://item.rakuten.co.jp/shop/b/', imageUrl: 'https://thumbnail.image.rakuten.co.jp/b.jpg', hypothesisIds: ['H-001', 'H-002'], predictedPass: 0.6 },
  ] });
  assert.deepEqual(recorded.created.map((t) => t.id), ['T-001', 'T-002']);
  assert.equal(recorded.loop.awaiting, 2);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [{ label: 'Bad image', imageUrl: 'javascript:alert(1)', hypothesisIds: ['H-001'], predictedPass: 0.5 }] }), /imageUrl must be a public https URL/);
  const waiting = await store.awaitingTrials({});
  const sampleB = waiting.items.find((t) => t.id === 'T-002');
  assert.equal(sampleB.imageUrl, 'https://thumbnail.image.rakuten.co.jp/b.jpg', 'the picture reaches the rating card');
  assert.equal(sampleB.ref, 'https://item.rakuten.co.jp/shop/b/');
  const pictured = await store.recordTrials({ baseId: 'test-base', trials: [{ label: 'Sample A', ref: 'out-a', imageUrl: 'https://example.com/a.png' }] });
  assert.deepEqual(pictured.imaged, [{ ref: 'out-a', id: 'T-001', imageUrl: 'https://example.com/a.png' }], 'a waiting sample gets its picture by re-recording the same ref');
  assert.equal(pictured.created.length, 0);
  assert.equal((await store.awaitingTrials({})).items.find((t) => t.id === 'T-001').imageUrl, 'https://example.com/a.png');
  const again = await store.recordTrials({ baseId: 'test-base', runId, trials: [{ label: 'Sample A', ref: 'out-a', hypothesisIds: ['H-001'], predictedPass: 0.7 }] });
  assert.deepEqual(again.skipped, [{ ref: 'out-a', id: 'T-001' }], 'the same output is not recorded twice');

  await assert.rejects(store.rateTrials({ baseId: 'test-base', ratings: [{ id: 'T-001', verdict: 'pass' }] }), /userWords is required/);
  const rated = await store.rateTrials({ baseId: 'test-base', ratings: [
    { id: 'T-001', verdict: 'pass', userWords: 'めっちゃいい。合格' },
    { id: 'T-002', verdict: 'fail', userWords: 'ボツ。つまらない', failStage: 'transform' },
  ] });
  assert.equal(rated.loop.overall.passRate, 0.5);
  assert.equal(rated.loop.current.rated, 2);
  assert.equal(rated.loop.calibration.hitRate, 0.5, 'both were predicted to pass; one did');
  assert.deepEqual(rated.loop.hypotheses.map((h) => [h.id, h.pass, h.fail]), [['H-001', 1, 1], ['H-002', 0, 1]]);
  assert.equal(rated.loop.failStages.transform, 1);

  const full = await store.get({ id: 'test-base', view: 'full' });
  const h1 = full.full.hypotheses.find((h) => h.id === 'H-001');
  assert.equal(h1.stage, 'observed', 'a pass is evidence on the hypothesis');
  assert.equal(h1.evidence.at(-1).type, 'candidate');
  assert.equal(h1.counterexamples.length, 1);
  assert.equal(full.full.trials.length, 2);

  // The rating is the measurement, so the hypothesis cannot be closed as inconclusive.
  await assert.rejects(store.finishRun({ baseId: 'test-base', runId, summary: 'Two samples', verdicts: [{ hypothesisId: 'H-001', result: 'inconclusive', observed: 'unsure' }] }), /not inconclusive/);
  const finished = await store.finishRun({ baseId: 'test-base', runId, summary: 'Two samples', verdicts: [{ hypothesisId: 'H-001', result: 'supported', observed: '1 of 2 passed' }] });
  assert.equal(finished.run.moved, true);
  const listed = await store.list({});
  assert.equal(listed.items[0].loop.passRate, 0.5);
});

test('measured-outcome dojos release from two evidence-bearing runs, not legacy user ratings', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  await store.create({
    id: 'test-base', title: 'Measured SEO', summary: 'GSC observations',
    outcome: { ...outcome, confirmedBy: 'measurement' }, method, ...auth,
  });
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis] });

  const first = await store.startRun({
    baseId: 'test-base', objective: 'Audit cache classifications',
    targets: [{ hypothesisId: 'H-001', prediction: 'Misclassified URLs exist' }],
  });
  // A withdrawn, outdated editorial sample must not block a measurement-only dojo.
  await store.recordTrials({
    baseId: 'test-base', runId: first.runId,
    trials: [{ label: 'Obsolete editorial review', hypothesisIds: ['H-001'], predictedPass: 0.5 }],
  });
  await store.rateTrials({
    baseId: 'test-base', ratings: [{ id: 'T-001', verdict: 'withdrawn', reason: 'Outcome changed to external measurement' }],
  });
  await store.upsertItems({
    baseId: 'test-base', runId: first.runId, kind: 'hypothesis',
    items: [{ id: 'H-001', stage: 'observed', addEvidence: [{ ref: 'GSC cache identified mislabeled category URLs' }] }],
  });
  await store.finishRun({
    baseId: 'test-base', runId: first.runId, summary: 'Measured categories',
    verdicts: [{ hypothesisId: 'H-001', result: 'supported', observed: 'Mislabeled category URLs' }],
  });

  const next = { ...method, version: 'm-v2', summary: 'Require exact page types' };
  const benchmark = { passed: true, ref: 'Measured URL fixture', cases: 'Category URLs remain separate from articles' };
  await assert.rejects(
    store.setMethodVersion({ baseId: 'test-base', method: next, motivatingRunIds: [first.runId], benchmark }),
    /two distinct finished evidence-bearing runs/,
  );

  const second = await store.startRun({
    baseId: 'test-base', objective: 'Verify routes in repository',
    targets: [{ hypothesisId: 'H-001', prediction: 'Static routes confirm the categories' }],
  });
  await store.upsertItems({
    baseId: 'test-base', runId: second.runId, kind: 'hypothesis',
    items: [{ id: 'H-001', stage: 'reproduced', addEvidence: [{ ref: 'GitHub Astro category route matches classified URLs' }] }],
  });
  await store.finishRun({
    baseId: 'test-base', runId: second.runId, summary: 'Confirmed dynamic route',
    verdicts: [{ hypothesisId: 'H-001', result: 'supported', observed: 'Route implementation matches observed URLs' }],
  });
  const motivatingRunIds = [first.runId, second.runId];
  await assert.rejects(
    store.setMethodVersion({ baseId: 'test-base', method: next, motivatingRunIds, noBenchmarkReason: 'Need more data' }),
    /passed, referenced case benchmark/,
  );
  await assert.rejects(
    store.setMethodVersion({ baseId: 'test-base', method: next, motivatingRunIds, benchmark: { passed: true } }),
    /passed, referenced case benchmark/,
  );
  const updated = await store.setMethodVersion({ baseId: 'test-base', method: next, motivatingRunIds, benchmark });
  assert.equal(updated.method.version, 'm-v2');
  assert.equal(updated.loop.metric, 'measured_outcome');
  assert.equal(updated.loop.gates.measurementMode, true);
  assert.equal(updated.loop.gates.usesTrials, false);
  assert.equal(updated.loop.current.rated, 0, 'no user rating was fabricated');
  const full = await store.get({ id: 'test-base', view: 'full' });
  assert.deepEqual(full.full.methodHistory.at(-1).motivatingRunIds, motivatingRunIds);
});

test('a version is not replaced before it has enough ratings, unless the user directs it', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis] });
  const first = await store.startRun({ baseId: 'test-base', objective: 'One sample', targets: [{ hypothesisId: 'H-001', prediction: 'passes' }] });
  await store.recordTrials({ baseId: 'test-base', runId: first.runId, trials: [{ label: 'A', hypothesisIds: ['H-001'], predictedPass: 0.6 }] });
  await store.rateTrials({ baseId: 'test-base', ratings: [{ id: 'T-001', verdict: 'fail', userWords: 'ボツ' }] });
  await store.finishRun({ baseId: 'test-base', runId: first.runId, summary: 'One', verdicts: [{ hypothesisId: 'H-001', result: 'contradicted', observed: 'failed' }] });
  const next = { ...method, version: 'm-v2', summary: 'Patched after one rejection' };
  await assert.rejects(store.setMethodVersion({ baseId: 'test-base', method: next, motivatingRunIds: ['R-001'], noBenchmarkReason: 'none yet, first loop' }), /has 1 rated trial/);
  const directed = await store.setMethodVersion({ baseId: 'test-base', method: next, noBenchmarkReason: 'none yet, first loop', userAuthorized: true, authorizationNote: 'User: change the sourcing step' });
  assert.equal(directed.method.version, 'm-v2');
  const full = await store.get({ id: 'test-base', view: 'full' });
  assert.deepEqual(full.full.methodHistory.at(-1).replaced, { version: 'm-v1', rated: 1, pass: 0, passRate: 0 });
});

test('three user non-passes cannot be cleared by a ceremonial run or self-PASS', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis] });
  const first = await store.startRun({ baseId: 'test-base', objective: 'Three samples', targets: [{ hypothesisId: 'H-001', prediction: 'passes' }] });
  const trial = (label) => ({ label, hypothesisIds: ['H-001'], predictedPass: 0.65 });
  await store.recordTrials({ baseId: 'test-base', runId: first.runId, trials: [trial('A'), trial('B'), trial('C')] });
  const rated = await store.rateTrials({ baseId: 'test-base', ratings: ['T-001', 'T-002', 'T-003'].map((id) => ({ id, verdict: 'fail', userWords: 'ボツ' })) });
  assert.equal(rated.loop.failStreak, 3);
  assert.equal(rated.loop.gates.researchDueBeforeNextTrial, true);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: first.runId, trials: [trial('D')] }), /did not pass/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.finishRun({ baseId: 'test-base', runId: first.runId, summary: 'All failed; no analysis', verdicts: [{ hypothesisId: 'H-001', result: 'contradicted', observed: '0 of 3' }] });
  const afterCeremonialRun = await store.get({ id: 'test-base' });
  assert.equal(afterCeremonialRun.loop.gates.researchDueBeforeNextTrial, true, 'closing a run without diagnosis must NOT clear the gate');
  const next = { ...method, version: 'm-v2', summary: 'Moved to new method without a diagnosis' };
  await assert.rejects(store.setMethodVersion({
    baseId: 'test-base', method: next, motivatingRunIds: [first.runId], benchmark: { passed: true, ref: 'self review' },
  }), /Cannot release.*failureAnalysis/);

  const second = await store.startRun({ baseId: 'test-base', objective: 'Investigate source versus gate errors', unknownTerritoryProbe: 'Compare real negative evidence and alternatives' });
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: second.runId, trials: [trial('D')] }), /did not pass/);
  const valid = {
    caseRefs: ['T-001', 'T-002', 'T-003'],
    contrastRefs: ['https://example.org/real-success-comparator'],
    alternatives: [
      { stage: 'source', claim: 'The first source family missed actual user needs entirely.',
        forEvidence: 'All three failures used source family A with no user acceptance.',
        againstEvidence: 'The user gave no reasons, so source quality is still uncertain.',
        falsification: 'A second user-scored batch from source A passes without changing the copy.' },
      { stage: 'gate', claim: 'The AI quality review accepted an irrelevant or weak finished sample.',
        forEvidence: 'AI predicted 0.65 but the user rejected each of the three examples.',
        againstEvidence: 'The source materials themselves may have offered no useful value.',
        falsification: 'Independent human blind review also passes but later users still reject.' },
    ],
    uncertainty: 'The user only said ボツ; no motive for any rejection was explicitly stated or confirmed.',
    falsePositiveAudit: 'Three predictions of 0.65 were false positives: the agent quality gate was not calibrated.',
    nextTest: {
      sourcingChange: 'Compare first-person observational sources with official documents.',
      selectionChange: 'Reject candidates that offer no independently visible reader reaction.',
      predictedDifference: 'In a blinded next batch, source mix will yield a higher accepted proportion.',
      refutingObservation: 'All user-rated samples still fail despite distinct source and gate checks.',
    },
  };
  await assert.rejects(store.finishRun({
    baseId: 'test-base', runId: second.runId, summary: 'Fake analysis',
    failureAnalysis: { ...valid, caseRefs: ['T-001', 'T-998', 'T-999'] },
    notMovedReason: 'Investigating',
  }), /real, user-rated non-pass/);
  await assert.rejects(store.finishRun({
    baseId: 'test-base', runId: second.runId, summary: 'One explanation only',
    failureAnalysis: { ...valid, alternatives: valid.alternatives.slice(0, 1) },
    notMovedReason: 'Investigating',
  }), /competing explanations/);
  await assert.rejects(store.finishRun({
    baseId: 'test-base', runId: second.runId, summary: 'No false-positive audit',
    failureAnalysis: { ...valid, falsePositiveAudit: '' }, notMovedReason: 'Investigating',
  }), /falsePositiveAudit/);
  // An old MCP client may only expose summary (not failureAnalysis). The versioned
  // envelope must obey the identical hard gate; it may never silently unlock the run.
  const envelope = (failureAnalysis) => 'failureAnalysis:v1:' + JSON.stringify({
    summary: 'Actual comparisons with alternatives and uncertainty', failureAnalysis,
  });
  await assert.rejects(store.finishRun({
    baseId: 'test-base', runId: second.runId,
    summary: envelope({ ...valid, caseRefs: ['T-001', 'T-998', 'T-999'] }),
    notMovedReason: 'Invalid historical case',
  }), /real, user-rated non-pass/);
  await assert.rejects(store.finishRun({
    baseId: 'test-base', runId: second.runId, summary: 'failureAnalysis:v1:garbled',
    notMovedReason: 'Invalid JSON',
  }), /Invalid legacy failureAnalysis envelope/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.finishRun({
    baseId: 'test-base', runId: second.runId, summary: envelope(valid),
    notMovedReason: 'Research completed but no user-approved output yet',
  });
  const afterAudit = await store.get({ id: 'test-base' });
  assert.equal(afterAudit.position.lastRuns[0].summary, 'Actual comparisons with alternatives and uncertainty');
  assert.equal(afterAudit.loop.gates.researchDueBeforeNextTrial, false, 'only the evidence-audited run clears the gate');
  assert.equal(afterAudit.position.lastRuns[0].failureAnalysisRecorded, true);
  const third = await store.startRun({ baseId: 'test-base', objective: 'Compare two new paths', unknownTerritoryProbe: 'New experiment' });
  const ok = await store.recordTrials({ baseId: 'test-base', runId: third.runId, trials: [trial('D')] });
  assert.equal(ok.created.length, 1);
});

test('every evidence-rich dojo refuses a trial that skips positive/negative transfer review', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis] });
  await store.recordTrials({ baseId: 'test-base', backfill: true, trials: [
    { label: 'Accepted keyword', body: 'The accepted example had an observable audience and weak search competitors.',
      hypothesisIds: ['H-001'], rating: { verdict: 'pass', userWords: '合格' } },
    { label: 'Rejected copycat', body: 'The failed keyword was just the old label copied into a new category.',
      hypothesisIds: ['H-001'], rating: { verdict: 'fail', userWords: 'ボツ' } },
    { label: 'Rejected unverified', body: 'The second failed case did not show a concrete search result.',
      hypothesisIds: ['H-001'], rating: { verdict: 'fail', userWords: 'ボツ' } },
  ] });
  const state = await store.get({ id: 'test-base', view: 'state' });
  assert.equal(state.loop.learning.status, 'contrast_ready');
  assert.deepEqual(state.loop.learning.acceptedCases.map(x => x.id), ['T-001']);
  assert.equal(state.loop.learning.rejectedCases.length, 2);
  const { runId } = await store.startRun({
    baseId: 'test-base', objective: 'Improve a keyword using verified lessons, not superficial similarity',
    targets: [{ hypothesisId: 'H-001', prediction: 'The user will accept a genuinely different keyword' }],
  });
  const sample = { label: 'New keyword with observed comparison', body: 'A new candidate with observed readers and different actual competition.',
    hypothesisIds: ['H-001'], predictedPass: 0.48 };
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [sample] }), /Learning review required/);
  const learningAudit = {
    positiveCaseId: 'T-001', negativeCaseId: 'T-002',
    mechanism: 'Users had a real question and the competing results failed to answer it.',
    transferCondition: 'The new query has independently observed demand and weak answers.',
    failureContrast: 'We did not just rename the rejected keyword or invent demand.',
    fatalRisk: 'The existing SERP may already satisfy users better than our planned content.',
    riskResolution: 'We checked real results and confirmed what concrete answer is missing.',
    bodyAnchor: 'observed readers', decision: 'submit',
  };
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [
    { ...sample, learningAudit: { ...learningAudit, positiveCaseId: 'T-002' } },
  ] }), /actual human-accepted/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [
    { ...sample, learningAudit: { ...learningAudit, negativeCaseId: 'T-001' } },
  ] }), /actual human-rejected/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [
    { ...sample, learningAudit: { ...learningAudit, decision: 'reject' } },
  ] }), /may not be submitted/);
  const result = await store.recordTrials({ baseId: 'test-base', runId, trials: [
    { ...sample, learningAudit },
  ] });
  const full = await store.get({ id: 'test-base', view: 'full' });
  const saved = full.full.trials.find(t => t.id === result.created[0].id);
  assert.equal(saved.learningAudit.status, 'verified');
  assert.equal(saved.learningAudit.positiveCaseId, 'T-001');
  assert.equal(saved.learningAudit.negativeCaseId, 'T-002');
  assert.equal(full.loop.learning.auditCoverage.verified, 0, 'review coverage counts rated outcomes only');
  await store.rateTrials({ baseId: 'test-base', ratings: [{ id: saved.id, verdict: 'fail', userWords: 'ボツ' }] });
  const after = await store.get({ id: 'test-base', view: 'state' });
  assert.equal(after.loop.learning.auditCoverage.verified, 1);
  assert.equal(after.loop.learning.promisingHypotheses[0].id, 'H-001');
});

test('buzz dojo blocks low-confidence, one-shot, invented-reference or unscreened samples', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  const baseId = 'viral-post-method-discovery';
  await store.create({ id: baseId, title: 'Buzz Dojo', summary: 'Standalone quality gate', outcome, method, ...auth });
  await store.upsertItems({
    baseId, kind: 'source', items: [
      { title: 'Real world source', locator: 'https://example.com/source-a',
        coverage: 'Observed everyday event', stage: 'observed', addEvidence: [{ type: 'observation', ref: 'real confirmed case' }] },
      { title: 'Different source', locator: 'https://example.com/source-b',
        coverage: 'Observed forum anecdotes', stage: 'observed', addEvidence: [{ type: 'observation', ref: 'different observed source' }] },
    ],
  });
  await store.upsertItems({ baseId, kind: 'hypothesis', items: [hypothesis] });
  await store.recordTrials({
    baseId, backfill: true, trials: [
      { label: 'Human accepted', body: 'This genuinely different accepted standalone has a distinctive reader moment.',
        rating: { verdict: 'pass', userWords: '合格' } },
      { label: 'Human rejected A', body: 'This explanation did not work for the reader as an actual stand-alone post.',
        rating: { verdict: 'fail', userWords: 'ボツ' } },
      { label: 'Human rejected B', body: 'The second example was too dry and easy to predict for the audience.',
        rating: { verdict: 'fail', userWords: 'つまらない' } },
    ],
  });
  const { runId } = await store.startRun({
    baseId, objective: 'Compare multiple upstream sources before producing the next standalone post',
    targets: [{ hypothesisId: 'H-001', prediction: 'One evaluated post could be accepted' }],
  });
  const body = '当事者だけが気づく小さな面倒に、予想外の二段目が突然出てくる。だからそこが笑える。';
  const audit = {
    format: 'standalone',
    pool: [
      { title: 'Unexpected second step', sourceId: 'S-001', decision: 'selected', reason: '人物の操作と追加の帰結が本文に具体的にある' },
      { title: 'Obvious recap', sourceId: 'S-001', decision: 'rejected', reason: '元ニュースの要約を口語化しただけで独立した発見がない' },
      { title: 'Contrived quote', sourceId: 'S-002', decision: 'rejected', reason: '引用カードを読まなければ意味が通らず単独稿にならない' },
    ],
    positiveCaseId: 'T-001', negativeCaseIds: ['T-002', 'T-003'],
    readerQuote: '予想外の二段目が', distinctValue: '単なる出典紹介でなく、当事者の事情への新しい見え方がある',
    strongestObjection: '作者の説明を外すと読み手に二段目の具体像が伝わらないかもしれない',
    closingType: 'derived_consequence',
  };
  const trial = { label: 'Novel standalone', body, sourceIds: ['S-001'], hypothesisIds: ['H-001'],
    predictedPass: 0.64, predictionNote: 'Tentative, not an externally verified verdict.' };
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [trial] }), /screening packet is required/);
  const { closingType, ...noClosing } = audit;
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, editorialScreen: noClosing }] }), /closingType is required/);
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, editorialScreen: { ...audit, closingType: 'punchline' } }] }), /closingType must be one of/);
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, editorialScreen: { ...audit, format: 'quote' } }] }), /standalone/);
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, editorialScreen: { ...audit, positiveCaseId: 'T-003' } }] }), /real user-accepted previous text/);
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, editorialScreen: { ...audit, negativeCaseIds: ['T-002','T-999'] } }] }), /two real rejected texts/);
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, editorialScreen: { ...audit, pool: audit.pool.slice(0, 2) } }] }), /compare 3-12/);
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, editorialScreen: { ...audit, pool: audit.pool.map(x => ({ ...x, sourceId: 'S-001' })) } }] }), /two observed source lanes/);
  const envelope = 'screen:v1:' + JSON.stringify(audit);
  assert.ok(envelope.length <= 600, 'old MCP clients must have a usable envelope');
  const accepted = await store.recordTrials({ baseId, runId, trials: [{ ...trial, predictedPass: 0.35, predictionNote: envelope }] });
  assert.equal(accepted.created.length, 1);
  assert.equal(accepted.loop.screening.considered, 3);
  assert.equal(accepted.loop.screening.rejectedBeforeUser, 2);
  const full = await store.get({ id: baseId, view: 'full' });
  const t = full.full.trials.find(t => t.id === accepted.created[0].id);
  assert.equal(t.editorialScreen.format, 'standalone');
  assert.equal(t.editorialScreen.reviewer, 'agent_screen_only_unverified');
  assert.equal(t.editorialScreen.closingType, 'derived_consequence');
  assert.equal(t.predictedPass, 0.35, 'an honest low forecast is no longer refused');
  await store.rateTrials({ baseId, ratings: [{ id: t.id, verdict: 'fail', userWords: 'ボツ' }] });
  const after = await store.get({ id: baseId });
  assert.deepEqual(after.loop.screening, {
    submitted: 1, considered: 3, rejectedBeforeUser: 2,
    rated: 1, userPass: 0, passRate: 0,
    byClosingType: { derived_consequence: { submitted: 1, rated: 1, userPass: 0, passRate: 0 } },
  });
});

test('past samples are backfilled with the version and rating they had', async () => {
  const store = await setup();
  const done = await store.recordTrials({ baseId: 'test-base', backfill: true, trials: [
    { label: 'Old pass', ref: 'out-1', version: 44, methodVersion: 'old-v4', shownAt: '2026-11-14T06:00:00.000Z', rating: { verdict: 'pass', userWords: '初の合格', ratedAt: '2026-11-14T06:26:00.000Z' } },
    { label: 'Old fail', ref: 'out-2', version: 44, methodVersion: 'old-v4', rating: { verdict: 'fail', userWords: 'ボツ', ratedAt: '2026-11-14T07:00:00.000Z' } },
    { label: 'Newer fail', ref: 'out-3', version: 50, methodVersion: 'old-v6', rating: { verdict: 'fail', userWords: 'つまんない', ratedAt: '2026-11-15T01:00:00.000Z' } },
  ] });
  assert.equal(done.created.length, 3);
  const brief = await store.get({ id: 'test-base' });
  assert.deepEqual(brief.loop.byVersion.map((g) => [g.version, g.rated, g.passRate]), [['v50', 1, 0], ['v44', 2, 0.5]]);
  assert.equal(brief.loop.overall.passRate, round3(1 / 3));
  assert.equal(brief.loop.calibration, null, 'backfilled samples carry no prediction');
});
function round3(value) { return Math.round(value * 1000) / 1000; }

test('samples waiting for the user are listed across 道場, oldest first, and leave the list once rated', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [hypothesis] });
  const { runId } = await store.startRun({ baseId: 'test-base', objective: 'Two samples', targets: [{ hypothesisId: 'H-001', prediction: 'one passes' }] });
  await store.recordTrials({ baseId: 'test-base', runId, trials: [{ label: 'First', body: 'text one', hypothesisIds: ['H-001'], predictedPass: 0.5 }] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.recordTrials({ baseId: 'test-base', runId, trials: [{ label: 'Second', hypothesisIds: ['H-001'], predictedPass: 0.5 }] });
  let waiting = await store.awaitingTrials({});
  assert.deepEqual(waiting.items.map((t) => [t.baseTitle, t.id, t.body]), [['Test', 'T-001', 'text one'], ['Test', 'T-002', '']]);
  await store.rateTrials({ baseId: 'test-base', ratings: [{ id: 'T-001', verdict: 'pass', userWords: '合格（道場画面）' }] });
  waiting = await store.awaitingTrials({});
  assert.deepEqual(waiting.items.map((t) => t.id), ['T-002']);
});

test('common dojo stores a falsifiable, stage-isolated experiment without changing user-owned outcomes', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [
    { ...hypothesis, pipelineStage: 'source' },
    { ...hypothesis, title: 'Writing voice might be the cause', pipelineStage: 'voice' },
  ] });
  const design = {
    contrastedHypothesisIds: ['H-002'], changedStage: 'source',
    intervention: 'Collect firsthand remarks rather than completed editorials.',
    comparison: 'Use the same natural-language form with editorial sources.',
    controls: 'Same reader audience, sample length, user rating and time window.',
    expectedDifference: 'User pass rate should improve in the source-only arm.',
    refutingObservation: 'Source-only arm does no better than the matched comparison.',
  };
  await assert.rejects(store.startRun({
    baseId: 'test-base', objective: 'Bad duplicated alternatives',
    targets: [{ hypothesisId: 'H-001', prediction: 'pass' }],
    experimentDesign: { ...design, contrastedHypothesisIds: ['H-001'] },
  }), /distinct hypothesis/);
  const { runId } = await store.startRun({
    baseId: 'test-base', objective: 'Compare sourcing while holding voice stable',
    targets: [{ hypothesisId: 'H-001', prediction: 'more user approvals' }],
    experimentDesign: design,
  });
  const full = await store.get({ id: 'test-base', view: 'full' });
  const run = full.full.runs.find((r) => r.id === runId);
  assert.deepEqual(run.experimentDesign, design, 'the precommitted comparison is recoverable for later causal audit');
  assert.equal(full.outcome.statement, outcome.statement, 'user-owned outcome is not modified');
});

test('revisions retain the previous claim; adding new evidence is not a new hypothesis', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [{ ...hypothesis, pipelineStage: 'unknown' }] });
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [
    { id: 'H-001', statement: 'Natural observed exchanges might be stronger sources.', pipelineStage: 'source',
      reason: 'User rejected artificial source recaps' },
  ] });
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [
    { id: 'H-001', addEvidence: [{ type: 'observation', ref: 'Observed live customer exchange' }] },
  ] });
  const full = await store.get({ id: 'test-base', view: 'full' });
  const item = full.full.hypotheses.find((h) => h.id === 'H-001');
  assert.equal(item.revisionHistory.length, 1);
  assert.equal(item.revisionHistory[0].before.statement, hypothesis.statement);
  assert.equal(item.revisionHistory[0].after.pipelineStage, 'source');
  assert.equal(item.revisionHistory[0].reason, 'User rejected artificial source recaps');
});


test('compact dojo workflow avoids redundant target resolution and preserves authoritative loop', async () => {
  const db = new MemoryDb();
  let resolutions = 0;
  const store = createStore({ getDb: () => db, resolveTarget: async () => { resolutions += 1; return { title: 'Skill', latestVersion: 1, body: 'Long skill body '.repeat(1000) }; } });
  await store.create({ id: 'test-base', title: 'T', summary: 'S', outcome, method: { ...method, bodyRef: { kind: 'chat_skill', location: 'test-skill', versionNumber: 1 } }, ...auth });
  const before = await store.get({ id: 'test-base' });
  const count = resolutions;
  const run = await store.startRun({ baseId: 'test-base', objective: 'Observe', unknownTerritoryProbe: 'New material', responseMode: 'compact' });
  assert.equal(run.methodVersion, before.method.version);
  assert.equal(run.outcomeRevision, before.outcome.revision);
  assert.equal(run.brief, undefined);
  const state = await store.get({ id: 'test-base', view: 'state' });
  assert.equal(state.position.openRunId, run.runId);
  assert.equal(state.method.bodyRef.versionNumber, 1);
  assert.equal(state.method.body, undefined);
  assert.equal(state.protocol, undefined);
  const done = await store.finishRun({ baseId: 'test-base', runId: run.runId, summary: 'No new data', notMovedReason: 'No signal', responseMode: 'compact' });
  assert.equal(done.brief, undefined);
  assert.equal(resolutions, count, 'compact calls must not resolve the skill body again');
  const full = await store.get({ id: 'test-base' });
  assert.deepEqual(done.loop, full.loop);
  assert.equal(full.position.openRunId, null);
  assert.ok(JSON.stringify(state).length < JSON.stringify(before).length / 2, 'refresh payload must be materially smaller');
});

test('receiver experiment preserves verified cross-dojo human verdicts and rejects fake peer cases', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  await store.create({ id: 'receiver-dojo', title: 'Receiver', summary: 'Test receiver', outcome, method, ...auth });
  await store.create({ id: 'source-dojo', title: 'Source', summary: 'Test source', outcome, method, ...auth });
  await store.upsertItems({ baseId: 'receiver-dojo', kind: 'hypothesis', items: [
    { ...hypothesis, title: 'Source mechanism transfers' },
    { ...hypothesis, title: 'Context explains source result' },
  ] });
  const mkTrial = (id, verdict) => ({ id, baseId: 'source-dojo',
    status: 'rated', verdict, methodVersion: 'm-v1', label: 'Verified source '+id });
  db.records.set('explorationBaseTrials/source-dojo__T-001', mkTrial('T-001', 'pass'));
  db.records.set('explorationBaseTrials/source-dojo__T-002', mkTrial('T-002', 'fail'));
  const design = {
    contrastedHypothesisIds: ['H-002'], changedStage: 'selection',
    intervention: 'Select candidates by the verified transfer mechanism.',
    comparison: 'Keep original receiver selection as the comparison.',
    controls: 'Match task audience, budget and source type.',
    expectedDifference: 'Transferred selection produces a higher human acceptance rate.',
    refutingObservation: 'Receiver trials do not pass with the proposed selection.',
  };
  const evidence = [{
    sourceBaseId: 'source-dojo', positiveTrialId: 'T-001', negativeTrialId: 'T-002',
    hypothesizedMechanism: 'Actionable tension distinguishes successful source examples.',
    applicabilityConditions: 'Receiver must also offer this concrete tension.',
    falsification: 'Receiver user rejects otherwise equivalent transfer examples.',
  }];
  const input = {
    baseId: 'receiver-dojo', objective: 'Test a qualified cross-dojo transfer',
    targets: [{ hypothesisId: 'H-001', prediction: 'More human accepted receiver trials' }],
    experimentDesign: design, crossDojoEvidence: evidence, responseMode: 'compact',
  };
  await assert.rejects(
    store.startRun({ ...input, crossDojoEvidence: [{ ...evidence[0], positiveTrialId: 'T-003' }] }),
    /real user-rated pass/,
  );
  await assert.rejects(
    store.startRun({ ...input, experimentDesign: undefined }), /requires a controlled experimentDesign/,
  );
  const started = await store.startRun(input);
  assert.equal(started.crossDojoEvidenceCount, 1);
  const run = (await store.get({ id: 'receiver-dojo', view: 'full' }))
    .full.runs.find(x => x.id === started.runId);
  assert.deepEqual(run.crossDojoEvidence.map(x => [x.sourceBaseId, x.positiveTrialId,
    x.negativeTrialId, x.receiverValidation]), [['source-dojo', 'T-001', 'T-002', 'untested']]);
  assert.equal(run.experimentDesign.changedStage, 'selection');
  const receiver = await store.get({ id: 'receiver-dojo', view: 'brief' });
  assert.equal(receiver.loop.overall.rated, 0, 'source approvals do not count as receiver verdicts');
});

test('provisional images and transient video refs cannot earn a user verdict before durable media exists', async () => {
  const store=await setup();
  await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:[hypothesis]});
  const {runId}=await store.startRun({baseId:'test-base',objective:'Compare complete artifacts only',
    targets:[{hypothesisId:'H-001',prediction:'The user may accept the completed visual'}]});
  const refs=[
    'planned:character-creation-studio/R-011/traffic-gum-officer',
    'sandbox:///working_dir/c_temp/artifacts/file_generation/video.mp4',
  ];
  const recorded=await store.recordTrials({baseId:'test-base',runId,trials:refs.map((ref,index)=>({
    label:index?'Video without stable artifact':'Character concept without picture',
    body:'Design plan only, not the completed image or video.',
    hypothesisIds:['H-001'],predictedPass:0.4,ref,
  }))});
  assert.equal(recorded.created.length,2);
  const waiting=await store.awaitingTrials({});
  assert.deepEqual(waiting.items.map(x=>x.reviewStatus),['artifact_missing','artifact_temporary']);
  await assert.rejects(store.rateTrials({baseId:'test-base',ratings:[
    {id:'T-001',verdict:'pass',userWords:'合格'}]}),/not reviewable/);
  await assert.rejects(store.rateTrials({baseId:'test-base',ratings:[
    {id:'T-002',verdict:'pass',userWords:'合格'}]}),/not reviewable/);
  await assert.rejects(store.recordTrials({baseId:'test-base',runId,trials:[{
    label:'Video stable link',ref:refs[1],mediaUrl:'sandbox:///tmp/video.mp4',
  }]}),/public HTTPS URL/);
  await store.recordTrials({baseId:'test-base',runId,trials:[
    {label:'Picture uploaded',ref:refs[0],imageUrl:'https://cdn.example.com/character.png'},
    {label:'Video uploaded',ref:refs[1],mediaUrl:'https://cdn.example.com/film.mp4'},
  ]});
  const now=await store.awaitingTrials({});
  assert.ok(now.items.every(x=>x.reviewStatus==='ready'));
  assert.equal(now.items[1].mediaUrl,'https://cdn.example.com/film.mp4');
  const finished=await store.rateTrials({baseId:'test-base',ratings:[
    {id:'T-001',verdict:'pass',userWords:'画像を見て合格'}]});
  assert.equal(finished.loop.current.pass,1);
});
