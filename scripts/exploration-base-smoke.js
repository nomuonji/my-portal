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
  const store = createStore({ getDb: () => db, allowHistoricalBackfill: true });
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
  const { runId, purposeAnchor } = await store.startRun({ baseId: 'test-base', objective: 'try', unknownTerritoryProbe: 'new sources', responseMode: 'compact' });
  assert.equal(purposeAnchor.phase, 'start');
  assert.equal(purposeAnchor.purpose, outcome.statement);
  const done = await store.finishRun({ baseId: 'test-base', runId, summary: 'found one', achievements: [{ label: 'item', evidence: 'passed', sourceIds: ['S-001'] }] });
  assert.equal(done.purposeAnchor.phase, 'finish');
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
  assert.equal(recorded.purposeAnchor.phase, 'submission');
  assert.equal(rated.purposeAnchor.phase, 'feedback');
  const state = await store.get({ id: 'test-base', view: 'state' });
  assert.equal(state.purposeAnchor.purpose, outcome.statement);
  assert.equal(state.purposeAnchor.requiredQuality, outcome.acceptance);
  assert.deepEqual(state.purposeAnchor.notSuccess, ['search volume']);
  assert.equal(state.qualityAnchor, undefined, 'state refresh does not resend quality examples');

  const full = await store.get({ id: 'test-base', view: 'full' });
  assert.deepEqual(full.qualityAnchor.cases.map(t => [t.id, t.verdict]), [['T-001','pass'],['T-002','fail']]);
  assert.equal(full.qualityAnchor.cases[0].excerpt, 'text A');
  assert.equal(full.qualityAnchor.cases[1].imageUrl, sampleB.imageUrl);
  assert.equal(full.qualityAnchor.marketObservation, null, 'do not fabricate market evidence');
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
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: third.runId, trials: [trial('D')] }), /zero passes/,
    'a ceremony cannot rehabilitate a mechanism with three human failures');
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [{
    ...hypothesis, title: 'New mechanism after failed source selection',
    statement: 'An independently collected source leads to a different candidate.',
    mechanism: 'This is a new sourcing and selection hypothesis, not a reuse of the failed copy.',
  }] });
  await completePriorResearch(store, 'test-base', third.runId);
  const ok = await store.recordTrials({ baseId: 'test-base', runId: third.runId, trials: [{ ...trial('D'), hypothesisIds: ['H-002'] }] });
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
  await completePriorResearch(store, 'test-base', runId);
  const sample = { label: 'New keyword with observed comparison', body: 'A new candidate with observed readers and different actual competition.',
    hypothesisIds: ['H-001'], predictedPass: 0.48 };
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [sample] }), /Learning review required/);
  const learningAudit = {
    positiveCaseId: 'T-001', negativeCaseId: 'T-002',
    positiveAnchor: 'observable audience', negativeAnchor: 'old label copied',
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
    { ...sample, learningAudit: { ...learningAudit, positiveAnchor: 'fabricated accepted fact' } },
  ] }), /positiveAnchor must quote/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId, trials: [
    { ...sample, learningAudit: { ...learningAudit, negativeAnchor: 'fabricated rejection fact' } },
  ] }), /negativeAnchor must quote/);
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
  assert.equal(saved.learningAudit.positiveAnchor, 'observable audience');
  assert.equal(saved.learningAudit.negativeAnchor, 'old label copied');
  assert.equal(saved.learningAudit.verificationScope, 'case_identity_and_exact_quotes_only');
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
  // This fixture deliberately imports a known human-rated corpus before new trials.
  const trustedStore = createStore({ getDb: () => db, allowHistoricalBackfill: true });
  await store.create({ id: baseId, title: 'Buzz Dojo', summary: 'Standalone quality gate', outcome, method, ...auth });
  await store.upsertItems({
    baseId, kind: 'source', items: [
      { title: 'Real world source', locator: 'https://example.com/source-a',
        coverage: 'Observed everyday event', stage: 'observed', originalProof:{originalUrl:'https://example.com/source-a',excerpt:'Mocked primary source of sufficient length for provenance.',verification:'direct_original'}, addEvidence: [{ type: 'observation', ref: 'real confirmed case' }] },
      { title: 'Different source', locator: 'https://example.com/source-b',
        coverage: 'Observed forum anecdotes', stage: 'observed', originalProof:{originalUrl:'https://example.com/source-b',excerpt:'Mocked independent second primary source for the fixture.',verification:'direct_original'}, addEvidence: [{ type: 'observation', ref: 'different observed source' }] },
      { title:'Third source',locator:'https://example.com/source-c',coverage:'Third observed material',stage:'observed',originalProof:{originalUrl:'https://example.com/source-c',excerpt:'Mocked independent third primary source for the fixture.',verification:'direct_original'},addEvidence:[{type:'observation',ref:'third source'}] },
    ],
  });
  await store.upsertItems({ baseId, kind: 'hypothesis', items: [hypothesis] });
  await trustedStore.recordTrials({
    baseId, backfill: true, trials: [
      { label: 'Human accepted', body: 'This genuinely different accepted standalone has a distinctive reader moment.',
        rating: { verdict: 'pass', userWords: '合格' } },
      { label: 'Human rejected A', body: 'This explanation did not work for the reader as an actual stand-alone post.',
        rating: { verdict: 'fail', userWords: 'ボツ' } },
      { label: 'Human rejected B', body: 'The second example was too dry and easy to predict for the audience.',
        rating: { verdict: 'fail', userWords: 'つまらない' } },
    ],
  });
  const comparisonPlan=['causal_sequence','language','perspective'].map((operation,i)=>({hypothesisId:'H-001',operation,intervention:'Apply the specific operation '+operation+' on its own observed material.',control:'Use ordinary standalone copy preserving all the same facts.',expectedDifference:'The reader notices a different specific consequence in the treatment.',falsifier:'Reject if the reader gains no additional value compared with the control.',historicalContrast:{positiveCaseId:'T-001',negativeCaseId:i===1?'T-003':'T-002',positiveAnchor:'genuinely different accepted',negativeAnchor:i===1?'too dry and easy to predict':'explanation did not work',transfer:'Transfer the concrete feature of the accepted example, not its wording.',failureContrast:'Compare the actual failed example and avoid mere explanations.'}}));
  await assert.rejects(store.startRun({baseId,objective:'A nominally different plan',targets:[{hypothesisId:'H-001',prediction:'Compare drafts'}],comparisonPlan:comparisonPlan.map(r=>({...r,operation:'language'}))}),/three different operations/);
  const { runId } = await store.startRun({
    baseId, objective: 'Compare multiple upstream sources before producing the next standalone post',
    targets: [{ hypothesisId: 'H-001', prediction: 'One evaluated post could be accepted' }], comparisonPlan,
  });
  await completePriorResearch(store, baseId, runId);
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
  assert.ok(envelope.length <= 600, 'legacy screen still parses, but is not an independent audit');
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{ ...trial, predictionNote: envelope }] }),
    /not a verified transfer audit/, 'a Buzz screen must no longer impersonate a learning transfer audit');
  const transferAudit = {
    positiveCaseId: 'T-001', negativeCaseId: 'T-002',
    positiveAnchor: 'genuinely different accepted', negativeAnchor: 'explanation did not work',
    mechanism: 'The accepted text offers a distinctive observable moment.',
    transferCondition: 'The candidate needs its own specific interaction and consequence.',
    failureContrast: 'The rejected text only explained its premise without a second moment.',
    fatalRisk: 'This candidate might still explain an idea instead of showing the action.',
    riskResolution: 'Its wording depicts the action and unexpected additional consequence.',
    bodyAnchor: '予想外の二段目が', decision: 'submit',
  };
  // A real user hold overrides an otherwise valid candidate, including a
  // perfect self-forecast. It is not cleared by the agent's completed research.
  const hold = await store.upsertItems({ baseId, kind: 'constraint', ...auth, items: [{
    owner: 'user', statement: 'Hold new submissions until expressly released.',
    legacyIds: ['buzz-user-submission-hold'],
  }] });
  const holdId = hold.changed[0].id;
  await assert.rejects(store.recordTrials({ baseId, runId, trials: [{
    ...trial, predictedPass: 1, editorialScreen: audit, learningAudit: transferAudit,
  }] }), /User-owned submission HOLD/);
  await assert.rejects(store.upsertItems({ baseId, kind: 'constraint', items: [{
    id: holdId, status: 'relaxed',
  }] }), /owned by the user/);
  const held = await store.get({ id: baseId, view: 'full' });
  assert.equal(held.full.trials.length, 3, 'the refused candidate must not create a trial');
  // Explicit owner authorization releases the hold without altering prior
  // ratings or replacing the ordinary quality gates.
  await store.upsertItems({ baseId, kind: 'constraint', ...auth, items: [{
    id: holdId, status: 'relaxed',
  }] });
  await assert.rejects(store.recordTrials({baseId,runId,trials:[{...trial,editorialScreen:audit,learningAudit:transferAudit}]}),/Comparison work required/);
  const pairRows=[
    {branchId:'B1',sourceId:'S-001',controlBody:'当事者だけが気づく小さな面倒に、いつもの対処方法を順に説明するだけの原稿です。',treatmentBody:body,controlAnchor:'いつもの対処方法',treatmentAnchor:'予想外の二段目が',selection:'treatment'},
    {branchId:'B2',sourceId:'S-002',controlBody:'A quiet shop has a customer who checks the ordinary price list and goes home.',treatmentBody:'The shopkeeper memorized the customer’s hesitation but never learned the customer’s name.',controlAnchor:'ordinary price list',treatmentAnchor:'memorized the customer',selection:'neither'},
    {branchId:'B3',sourceId:'S-003',controlBody:'The bus driver had a long day and everyone left the bus without saying anything.',treatmentBody:'The passenger checks the last seat on the bus because a glove is still sitting there.',controlAnchor:'long day',treatmentAnchor:'a glove is still sitting there',selection:'neither'},
  ].map(row=>({...row,observedDifference:'The actual alternative text changes the reader’s observation of the concrete event.',reason:'Compare the visible consequences and keep weaker examples internal.'}));
  await assert.rejects(store.recordComparison({baseId,runId,rows:pairRows.slice(0,1)}),/cover every pinned branch/);
  await assert.rejects(store.recordComparison({baseId,runId,rows:pairRows.map(r=>({...r,sourceId:'S-001'}))}),/different original materials/);
  await assert.rejects(store.recordComparison({baseId,runId,rows:pairRows.map((r,i)=>i===1?{...r,treatmentBody:r.controlBody}:r)}),/duplicate or historical draft/);
  await assert.rejects(store.recordComparison({baseId,runId,rows:pairRows.map((r,i)=>i===0?{...r,treatmentAnchor:'not in the actual text'}:r)}),/anchors must quote/);
  const compared=await store.recordComparison({baseId,runId,rows:pairRows});
  assert.equal(compared.draftCount,6);
  await assert.rejects(store.recordComparison({baseId,runId,rows:pairRows}),/already recorded/);
  await assert.rejects(store.recordTrials({baseId,runId,trials:[{...trial,body:body+' Extra unsaved sentence.',editorialScreen:audit,learningAudit:transferAudit}]}),/exactly match/);
  const accepted = await store.recordTrials({ baseId, runId, trials: [{
    ...trial, predictedPass: 0.35, editorialScreen: audit, learningAudit: transferAudit,
  }] });
  assert.equal(accepted.created.length, 1);
  assert.equal(accepted.loop.screening.considered, 3);
  assert.equal(accepted.loop.screening.rejectedBeforeUser, 2);
  const full = await store.get({ id: baseId, view: 'full' });
  const t = full.full.trials.find(t => t.id === accepted.created[0].id);
  assert.equal(t.editorialScreen.format, 'standalone');
  assert.equal(t.editorialScreen.reviewer, 'agent_screen_only_unverified');
  assert.equal(t.editorialScreen.closingType, 'derived_consequence');
  assert.equal(t.predictedPass, 0.35, 'an honest low forecast is no longer refused');
  assert.equal(t.comparisonEvidence.branchId,'B1');
  assert.equal(t.comparisonEvidence.status,'agent_comparison_unverified');
  await assert.rejects(store.recordTrials({baseId,runId,trials:[{...trial,ref:'another-output',editorialScreen:audit,learningAudit:transferAudit}]}),/already been registered/);
  await store.rateTrials({ baseId, ratings: [{ id: t.id, verdict: 'fail', userWords: 'ボツ' }] });
  const finished=await store.finishRun({baseId,runId,summary:'One submitted comparison',verdicts:[{hypothesisId:'H-001',result:'contradicted',observed:'The user rejected the selected draft.'}]});
  assert.equal(finished.run.comparisonStatus,'compared_submitted');
  assert.equal(finished.run.comparisonDraftCount,6);
  const researchRun=await store.startRun({baseId,objective:'Research only, no artifact',unknownTerritoryProbe:'Read new primary material'});
  const researchOnly=await store.finishRun({baseId,runId:researchRun.runId,summary:'Research only',notMovedReason:'No fixed point changed'});
  assert.equal(researchOnly.run.comparisonStatus,'research_only');
  assert.equal(researchOnly.run.comparisonDraftCount,0);
  const after = await store.get({ id: baseId });
  assert.deepEqual(after.loop.screening, {
    submitted: 1, considered: 3, rejectedBeforeUser: 2,
    rated: 1, userPass: 0, passRate: 0,
    byClosingType: { derived_consequence: { submitted: 1, rated: 1, userPass: 0, passRate: 0 } },
  });
});

test('agent/runtime stores refuse forged historical ratings while trusted migrations retain backfill', async () => {
  const db = new MemoryDb();
  const runtime = createStore({ getDb: () => db });
  await runtime.create({ id: 'test-base', title: 'Test', summary: 'Smoke', outcome, method, ...auth });
  await assert.rejects(runtime.recordTrials({ baseId: 'test-base', backfill: true, trials: [{
    label: 'Fabricated win', version: 999, rating: { verdict: 'pass', userWords: '合格' },
  }] }), /backfill is disabled/, 'an agent cannot fabricate human PASS history via backfill');
  assert.equal((await runtime.get({ id: 'test-base', view: 'full' })).full.trials.length, 0);
  const store = createStore({ getDb: () => db, allowHistoricalBackfill: true });
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
  await store.recordTrials({baseId:'test-base',runId,trials:[{
    label:'Video thumbnail only',ref:refs[1],imageUrl:'https://cdn.example.com/thumbnail.jpg',
  }]});
  assert.equal((await store.awaitingTrials({})).items.find(x=>x.id==='T-002').reviewStatus,
    'artifact_temporary','video thumbnail cannot stand in for an inaccessible completed video');
  await assert.rejects(store.rateTrials({baseId:'test-base',ratings:[
    {id:'T-001',verdict:'pass',userWords:'合格'}]}),/not reviewable/);
  await assert.rejects(store.rateTrials({baseId:'test-base',ratings:[
    {id:'T-002',verdict:'pass',userWords:'合格'}]}),/not reviewable/);
  await assert.rejects(store.recordTrials({baseId:'test-base',runId,trials:[{
    label:'Video stable link',ref:refs[1],mediaUrl:'sandbox:///tmp/video.mp4',
  }]}),/public HTTPS URL/);
  await store.recordTrials({baseId:'test-base',runId,trials:[
    {label:'Picture uploaded through stale MCP client',ref:refs[0],
      predictionNote:'artifact:image:https://cdn.example.com/character.png'},
    {label:'Video uploaded through stale MCP client',ref:refs[1],
      predictionNote:'artifact:media:https://cdn.example.com/film.mp4'},
  ]});
  const now=await store.awaitingTrials({});
  assert.equal(now.items.length,2,'artifact attachment must preserve trial identity');
  assert.ok(now.items.every(x=>x.reviewStatus==='ready'));
  assert.equal(now.items[0].imageUrl,'https://cdn.example.com/character.png');
  assert.equal(now.items[1].mediaUrl,'https://cdn.example.com/film.mp4');
  const finished=await store.rateTrials({baseId:'test-base',ratings:[
    {id:'T-001',verdict:'pass',userWords:'画像を見て合格'}]});
  assert.equal(finished.loop.current.pass,1);
});

test('negative hypotheses run in parallel: unresolved candidates blocked, user misses separate from internal rejections', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [
    { ...hypothesis, title: 'Positive condition' },
    { ...hypothesis, title: 'Risk of generic endings', polarity: 'negative', statement: 'Generic endings may be rejected.', mechanism: 'A replaceable ending adds no discovery.' },
  ] });
  // Existing independently human-rated cases ground the review; an internal rejection is never a rating.
  const old = await store.recordTrials({ baseId: 'test-base', backfill: true, trials: [
    { label: 'Accepted example', body: 'Specific relationship, new consequence.', rating: { verdict: 'pass', userWords: '合格' } },
    { label: 'Rejected example', body: 'Generic line without consequence.', rating: { verdict: 'fail', userWords: 'ボツ' } },
  ] });
  assert.deepEqual(old.created.map(x => x.id), ['T-001', 'T-002']);
  const run = await store.startRun({ baseId: 'test-base', objective: 'Test success and failure mechanisms together',
    targets: [{ hypothesisId: 'H-001', prediction: 'User accepts the unusual consequence.' }],
    negativeTargets: [{ hypothesisId: 'H-002', prediction: 'Generic ending makes the copy boring.' }],
    responseMode: 'compact',
  });
  assert.equal(run.negativeTargetCount, 1);
  await completePriorResearch(store, 'test-base', run.runId);
  const candidate = {
    label: 'Concrete office failure', body: 'The office rule created a second problem for its author.',
    hypothesisIds: ['H-001'], predictedPass: 0.5,
  };
  const report = { checks: [{ hypothesisId: 'H-002', rejectedCaseId: 'T-002', acceptedCaseId: 'T-001',
    acceptedAnchor: 'Specific relationship', rejectedAnchor: 'Generic line',
    bodyAnchor: 'office rule created', observedRisk: 'The ending may merely restate a generic complaint.',
    counterEvidence: 'The particular office rule creates a different consequence.', decision: 'cleared' }] };
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: run.runId, trials: [candidate] }), /negativeReview is required/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: run.runId, trials: [
    { ...candidate, negativeReview: { checks: [{ ...report.checks[0], decision: 'unresolved' }] } },
  ] }), /Unresolved negative risk/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: run.runId, trials: [
    { ...candidate, negativeReview: { checks: [{ ...report.checks[0], acceptedCaseId: 'T-002' }] } },
  ] }), /human-accepted/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: run.runId, trials: [
    { ...candidate, negativeReview: { checks: [{ ...report.checks[0], acceptedAnchor: 'imaginary positive quote' }] } },
  ] }), /acceptedAnchor must quote/);
  await assert.rejects(store.recordTrials({ baseId: 'test-base', runId: run.runId, trials: [
    { ...candidate, negativeReview: { checks: [{ ...report.checks[0], rejectedAnchor: 'invented rejection quote' }] } },
  ] }), /rejectedAnchor must quote/);
  const made = await store.recordTrials({ baseId: 'test-base', runId: run.runId, trials: [{ ...candidate, negativeReview: report }] });
  assert.equal(made.created[0].id, 'T-003');
  await store.rateTrials({ baseId: 'test-base', ratings: [{ id: 'T-003', verdict: 'fail', userWords: 'ボツ' }] });
  const done = await store.finishRun({ baseId: 'test-base', runId: run.runId,
    summary: 'A cleared risk still led to a human rejection.',
    verdicts: [{ hypothesisId: 'H-001', result: 'contradicted', observed: 'User rejected the candidate.' }],
    negativeVerdicts: [{ hypothesisId: 'H-002', result: 'inconclusive', observed: 'One missed risk; causal mechanism is not confirmed.' }],
    screenedOut: [{ hypothesisId: 'H-002', candidate: 'Unshown generic draft',
      observedRisk: 'The entire premise was replaceable by generic nouns.',
      counterEvidence: 'The accepted case needed the particular office rule.' }],
    responseMode: 'compact',
  });
  assert.equal(done.run.screenedOutUnverifiedCount, 1);
  const brief = await store.get({ id: 'test-base' });
  assert.equal(brief.loop.negativeLearning.negativeHypotheses, 1);
  assert.equal(brief.loop.negativeLearning.clearedButRejected, 1);
  assert.equal(brief.loop.negativeLearning.screenedOutUnverified, 1);
  assert.equal(brief.loop.overall.pass, 1, 'screenedOut must not count as a human-rated fail or pass');
  assert.ok(!brief.loop.hypotheses.some(h => h.id === 'H-002'), 'negative hypotheses do not rank as positive win patterns');
  assert.ok(brief.hypotheses.conjectures.some(h => h.id === 'H-002' && h.polarity === 'negative'));
});

test('older MCP fields can classify and compare failure hypotheses without weakening human verdicts', async () => {
  const store = await setup();
  const result = await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [
    { ...hypothesis, title: 'Original success mechanism' },
    { ...hypothesis, title: 'Generic endings fail', reason: '[polarity:negative] The user asked to classify this untested failure mechanism separately.', statement: 'The ending may be a generic observation and get rejected.' },
  ] });
  assert.equal(result.changed[1].id, 'H-002');
  const initial = await store.get({ id: 'test-base' });
  const neg = initial.hypotheses.conjectures.find(h => h.id === 'H-002');
  assert.equal(neg.polarity, 'negative');
  const listed = await store.list({});
  assert.equal(listed.items.find(x => x.id === 'test-base').loop.negativeLearning.negativeHypotheses, 1,
    'shared dojo listing must refresh when a hypothesis is migrated to negative');

  await store.recordTrials({ baseId: 'test-base', backfill: true, trials: [
    { label: 'Earlier accepted original', body: 'A distinct causal consequence.', rating: { verdict: 'pass', userWords: '合格' } },
    { label: 'Earlier generic rejected', body: 'A forgettable generic ending.', rating: { verdict: 'fail', userWords: 'ボツ' } },
    { label: 'Another rejected case', body: 'Yet another generic ending.', rating: { verdict: 'fail', userWords: 'ボツ' } },
  ] });
  const run = await store.startRun({ baseId: 'test-base', objective: 'Controlled positive and negative comparison with old MCP parameters',
    targets: [{ hypothesisId: 'H-001', prediction: 'A distinct causal consequence is rated highly.' }],
    experimentDesign: {
      contrastedHypothesisIds: ['H-002'], changedStage: 'gate',
      intervention: 'Search for distinct consequences rather than generic endings.',
      comparison: 'Generic endings rejected in previous cases.',
      controls: 'Keep domain and reader expectations fixed.',
      expectedDifference: 'Human pass rate increases when the candidate is distinctive.',
      refutingObservation: 'Human rejects the new specific consequence.',
    }, responseMode: 'compact' });
  assert.equal(run.negativeTargetCount, 1);
  await completePriorResearch(store, 'test-base', run.runId);
  const body = 'A specific office rule unexpectedly changes who pays for the mistake.';
  const audit = { positiveCaseId: 'T-001', negativeCaseId: 'T-002',
    positiveAnchor: 'distinct causal consequence', negativeAnchor: 'forgettable generic ending',
    mechanism: 'The accepted example has a real cause and result.',
    transferCondition: 'The new item has an observable action and consequence.',
    failureContrast: 'The failure was a generic restatement without causal movement.',
    fatalRisk: 'The new ending might be a generic point that fits any office.',
    riskResolution: 'The office rule dictates who pays, an observable causal detail.',
    bodyAnchor: 'office rule unexpectedly', decision: 'submit' };
  assert.ok(('learning:v1:' + JSON.stringify(audit)).length <= 600,
    'older MCP clients can still supply a quote-checked audit alongside a native editorial screen');
  const made = await store.recordTrials({ baseId: 'test-base', runId: run.runId, trials: [{
    label: 'Office rule story', body, hypothesisIds: ['H-001'], predictedPass: 0.43,
    predictionNote: 'learning:v1:' + JSON.stringify(audit),
  }] });
  assert.equal(made.created[0].id, 'T-004');
  await store.rateTrials({ baseId: 'test-base', ratings: [{ id: 'T-004', verdict: 'fail', userWords: 'ボツ' }] });
  const ended = await store.finishRun({ baseId: 'test-base', runId: run.runId,
    summary: 'Review cleared but the human rejected the sample, so the failure gate missed a risk.',
    verdicts: [
      { hypothesisId: 'H-001', result: 'contradicted', observed: 'Rejected by the human.' },
      { hypothesisId: 'H-002', result: 'inconclusive', observed: 'One miss; the failure mechanism remains hypothetical.' },
    ], responseMode: 'compact' });
  assert.equal(ended.run.negativeVerdicts[0], 'H-002:inconclusive');
  const detail = await store.get({ id: 'test-base', view: 'full' });
  assert.equal(detail.loop.negativeLearning.clearedButRejected, 1);
  assert.equal(detail.loop.negativeLearning.legacyDerivedReviewed, 1);
  assert.equal(detail.loop.overall.pass, 1);
  assert.ok(!detail.loop.hypotheses.some(h => h.id === 'H-002'));
});

test('a dojo with no accepted cases can research a failure hypothesis without fabricating a pass', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [
    hypothesis,
    { ...hypothesis, title: 'Unobserved risk', statement: 'Weak upstream evidence produces unattractive outputs.', reason: '[polarity:negative] Cold-start hypothesis only.' },
  ] });
  const { runId } = await store.startRun({ baseId: 'test-base', objective: 'Cold-start learning',
    targets: [{ hypothesisId: 'H-001', prediction: 'The new candidate improves the evidence.' }],
    experimentDesign: { contrastedHypothesisIds: ['H-002'], changedStage: 'source', intervention: 'Change the source.',
      comparison: 'Old source.', controls: 'Same acceptance.', expectedDifference: 'Different evidence.',
      refutingObservation: 'No difference.' }, responseMode: 'compact' });
  const made = await store.recordTrials({ baseId: 'test-base', runId, trials: [
    { label: 'Early candidate', body: 'Early candidate with no human comparator yet.', hypothesisIds: ['H-001'], predictedPass: 0.3 },
  ] });
  assert.equal(made.created.length, 1);
  const d = await store.get({ id: 'test-base', view: 'full' });
  assert.equal(d.loop.negativeLearning.reviewed, 0, 'missing comparators must not be counted as a real review');
  assert.equal(d.loop.negativeLearning.insufficientHumanContrast, 1);
});

test('all dojos automatically precommit one failure hypothesis even when an old agent omits the new fields', async () => {
  const store = await setup();
  await store.upsertItems({ baseId: 'test-base', kind: 'hypothesis', items: [
    { ...hypothesis, title: 'Positive candidate mechanism' },
    { ...hypothesis, title: 'Generic result failure', statement: 'Generic results fail to be useful.', reason: '[polarity:negative] A real but untested failure condition.', pipelineStage: 'selection' },
    { ...hypothesis, title: 'Weak presentation failure', statement: 'Weak presentation cannot show a distinctive example.', reason: '[polarity:negative] Independent failure condition.', pipelineStage: 'gate' },
  ] });
  const first = await store.startRun({ baseId: 'test-base', objective: 'Automatic paired learning on a new candidate',
    targets: [{ hypothesisId: 'H-001', prediction: 'A specific candidate gets accepted.' }], responseMode: 'compact' });
  assert.equal(first.negativeTargetCount, 1);
  assert.equal(first.negativeTargetOrigin, 'automatic');
  const made = await store.recordTrials({ baseId: 'test-base', runId: first.runId, trials: [{
    label: 'Unverified early sample', body: 'Concrete artifact for a domain that has no human comparator yet.',
    hypothesisIds: ['H-001'], predictedPass: 0.45,
  }] });
  assert.equal(made.created.length, 1, 'auto-enrollment must not freeze a cold-start dojo');
  const closed = await store.finishRun({ baseId: 'test-base', runId: first.runId,
    summary: 'Research without sufficient human samples; no user rating is invented.',
    verdicts: [{ hypothesisId: 'H-001', result: 'inconclusive', observed: 'The human has not rated this trial.' }],
    responseMode: 'compact' });
  assert.deepEqual(closed.run.negativeVerdicts, ['H-002:inconclusive'], 'an automatic target cannot silently become supported');
  const next = await store.startRun({ baseId: 'test-base', objective: 'A separate next trial rotates the failure arm',
    targets: [{ hypothesisId: 'H-001', prediction: 'Another candidate may succeed.' }], responseMode: 'compact' });
  assert.equal(next.negativeTargetOrigin, 'automatic');
  await store.finishRun({ baseId: 'test-base', runId: next.runId,
    summary: 'No further data yet, second negative arm stays inconclusive.',
    verdicts: [{ hypothesisId: 'H-001', result: 'inconclusive', observed: 'No new user observation.' }],
    notMovedReason: 'The next source has not been checked; no new trial or evidence to claim yet.',
    responseMode: 'compact' });
  const finished = await store.get({ id: 'test-base', view: 'full' });
  assert.equal(finished.loop.negativeLearning.negativeHypotheses, 2);
  assert.equal(finished.loop.negativeLearning.insufficientHumanContrast, 1);
  assert.equal(finished.loop.negativeLearning.reviewed, 0);
  assert.equal(finished.loop.overall.rated, 0);
});



async function completePriorResearch(store, baseId, runId) {
  const first = await store.researchRead({baseId,runId,page:0});
  const rows = [first];
  for (let page=1;page<first.pages;page++) rows.push(await store.researchRead({baseId,runId,page}));
  const hypotheses = rows.flatMap(x=>x.hypotheses);
  const feedback = rows.flatMap(x=>x.feedback);
  const thesis=hypotheses[0];
  const antithesis=hypotheses[1]||null;
  assert.ok(thesis,'research requires a preexisting hypothesis');
  const graph=await store.graphGet({baseId,view:'full'});
  const pending=graph.stewardship.feedbackReview;
  const treeReview=pending.pendingTrialIds.length ? {
    reviewedTrialIds:pending.pendingTrialIds,
    crossBranchSummary:'Recent user evaluations must be contrasted across the affected Skill branches; the agent can propose narrowed conditions but not infer motives from an unexplained rejection.',
    branchDecisions:pending.touchedHypothesisIds.map(id=>({
      hypothesisId:id,action:'retain',
      rationale:'Keep the hypothesis provisional until a separate new comparison can distinguish mechanisms from incidental conditions.',
      nextFalsification:'Create a source-matched independent control and treatment pair whose user verdict can contradict the current explanation.',
    })),
  }:undefined;
  return store.researchSynthesize({baseId,runId,...(treeReview?{treeReview}:{}),synthesis:{
    thesisId:thesis.id,antithesisId:antithesis?.id,
    thesisAnchor:thesis.statement.slice(0,Math.min(40,thesis.statement.length)),
    antithesisAnchor:antithesis?.statement.slice(0,Math.min(40,antithesis.statement.length)),
    passFeedbackId:feedback.find(x=>x.verdict==='pass')?.id,
    passFeedbackAnchor:feedback.find(x=>x.verdict==='pass')?.userWords?.slice(0,80),
    failFeedbackId:feedback.find(x=>['fail','partial'].includes(x.verdict))?.id,
    failFeedbackAnchor:feedback.find(x=>['fail','partial'].includes(x.verdict))?.userWords?.slice(0,80),
    action:'retain',tension:'The earlier mechanism may work for some tasks, while the rejected cases imply it is not sufficient.',
    proposedClaim:'A narrower transfer condition should allow the mechanism to work only when the individual has a concrete motive.',
    comparison:'Keep the topic fixed while testing a concrete motive against the original generic statement with matched context.',
    falsification:'If the newer user-rated example fails despite meeting the proposed motive condition, the proposal is refuted.',
  }});
}

test('recall gate retrieves historical hypothesis claims, refutations and user-verified outcomes before a trial', async () => {
  const store = await setup();
  await store.upsertItems({ baseId:'test-base', kind:'hypothesis', items:[hypothesis] });
  await store.upsertItems({ baseId:'test-base', kind:'hypothesis', items:[{
    id:'H-001',limits:'The mechanism may fail when the ending is a generic restatement of the premise.',
    reason:'Add a falsifiable countercondition observed in the early examples.',
  }] });
  const history = [
    ['fail','The same ordinary words describe the customer but add no surprise.'],
    ['pass','The customer rejects a discount, then misses the only buyer who cared.'],
    ['fail','A generic last sentence repeats exactly what the first sentence said.'],
    ['pass','The stylist gets the blame because I asked them to choose my haircut.'],
    ['fail','A flat summary tells the reader only what the news already said.'],
    ['pass','The person admits an embarrassing motive they cannot say aloud.'],
    ['fail','The ending replaces one label with another without a concrete act.'],
    ['pass','A mundane social rule makes its author accidentally trapped by it.'],
  ];
  await store.recordTrials({ baseId:'test-base', backfill:true, trials:history.map(([verdict,body],i) => ({
    label:'Historical example '+i, body, hypothesisIds:['H-001'],
    rating:{verdict,userWords:verdict==='pass'?'合格':'ボツ'},
  }))});
  const {runId} = await store.startRun({baseId:'test-base',objective:'Understand historical accepted vs rejected texts',
    targets:[{hypothesisId:'H-001',prediction:'Specific motives will produce another user pass'}], responseMode:'compact'});
  await completePriorResearch(store,'test-base',runId);
  const candidate = {label:'New relationship-specific motive',
    body:'When the buyer stops responding, I realize I wanted the message more than the sale itself.',
    hypothesisIds:['H-001'],predictedPass:0.45};
  await assert.rejects(store.recordTrials({baseId:'test-base',runId,trials:[candidate]}),/Historical recall check required/);
  const p = await store.prepareRecall({baseId:'test-base',runId,topic:'Emotional reversal in ordinary customer interactions',hypothesisIds:['H-001']});
  assert.equal(p.required,true);
  assert.equal(p.studyCases.length,4);
  assert.equal(p.challengeCases.length,4);
  assert.equal(p.studyCases.filter(c=>c.verdict==='pass').length,2);
  assert.equal(p.studyCases.filter(c=>c.verdict==='fail').length,2);
  assert.ok(p.challengeCases.every(c=>c.verdict===undefined),'challenge labels are not returned');
  assert.equal(p.historicalHypotheses.length,1);
  const historical=p.historicalHypotheses[0];
  assert.equal(historical.id,'H-001');
  assert.equal(historical.testCounts.pass,4);
  assert.equal(historical.testCounts.fail,4);
  assert.match(historical.claim,/Emotional queries/);
  assert.match(historical.mechanism,/Professionals/);
  assert.match(historical.limits,/generic restatement/);
  assert.ok(historical.revisionHistory.length>0,'the earlier hypothesis revision must be shown');
  assert.ok(historical.passCaseIds.includes('T-002'));
  assert.ok(historical.failCaseIds.includes('T-001'));
  await assert.rejects(store.recordTrials({baseId:'test-base',runId,trials:[candidate]}),/Historical recall check required/);
  await assert.rejects(store.prepareRecall({baseId:'test-base',runId,topic:'Retry with a new topic'}),
    /already prepared/);
  const predictions=p.challengeCases.map(c=>({
    caseId:c.id,predictedVerdict:'pass',quote:c.body.slice(0,12),
    reason:'The text contains a specific observable situation and a candidate consequence.',
  }));
  const review={hypothesisId:'H-001',claimAnchor:'Emotional queries have',
    limitAnchor:'mechanism may fail when',passCaseId:'T-002',failCaseId:'T-001',
    transferCondition:'The new scenario may involve an actual motivation rather than a bare label.',
    refutingCondition:'If the new copy repeats the premise without a changed action, this hypothesis fails.',
  };
  await assert.rejects(store.checkRecall({baseId:'test-base',runId,predictions}),/requires an explicit review/);
  await assert.rejects(store.checkRecall({baseId:'test-base',runId,predictions,
    hypothesisReviews:[{...review,claimAnchor:'invented historical claim'}]}),/claimAnchor/);
  await assert.rejects(store.checkRecall({baseId:'test-base',runId,predictions,
    hypothesisReviews:[{...review,failCaseId:'T-002'}]}),/actual pass and fail/);
  const fail = await store.checkRecall({baseId:'test-base',runId,predictions,hypothesisReviews:[review]});
  assert.equal(fail.status,'failed');
  assert.equal(fail.correct,2);
  await assert.rejects(store.recordTrials({baseId:'test-base',runId,trials:[candidate]}),/Historical recall check required/);
  await assert.rejects(store.checkRecall({baseId:'test-base',runId,predictions:[]}),/not pending/);
});

test('passing an exact historical-label recall check permits the existing candidate learning audit', async () => {
  const store = await setup();
  await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:[hypothesis]});
  const examples = [
    ['fail','The same ordinary words describe the customer but add no surprise.'],
    ['pass','The customer rejects a discount, then misses the only buyer who cared.'],
    ['fail','A generic last sentence repeats exactly what the first sentence said.'],
    ['pass','The stylist gets the blame because I asked them to choose my haircut.'],
    ['fail','A flat summary tells the reader only what the news already said.'],
    ['pass','The person admits an embarrassing motive they cannot say aloud.'],
    ['fail','The ending replaces one label with another without a concrete act.'],
    ['pass','A mundane social rule makes its author accidentally trapped by it.'],
  ];
  await store.recordTrials({baseId:'test-base',backfill:true,trials:examples.map(([verdict,body],i)=>({
    label:'Case '+i,body,rating:{verdict,userWords:verdict==='pass'?'合格':'ボツ'},
  }))});
  const {runId}=await store.startRun({baseId:'test-base',objective:'Check remembered success mechanisms',
    targets:[{hypothesisId:'H-001',prediction:'Specific motive is an observable transfer condition'}],responseMode:'compact'});
  await completePriorResearch(store,'test-base',runId);
  const p=await store.prepareRecall({baseId:'test-base',runId,topic:'Reversal and motive in ordinary interactions'});
  const truth=new Map(examples.map(([verdict],i)=>['T-'+String(i+1).padStart(3,'0'),verdict]));
  const checked=await store.checkRecall({baseId:'test-base',runId,predictions:p.challengeCases.map((c,i)=>({
    caseId:c.id,predictedVerdict:i===0?(truth.get(c.id)==='pass'?'fail':'pass'):truth.get(c.id),
    quote:c.body.slice(0,12),reason:'This case has an observable action and a specific unexpected consequence.',
  }))});
  assert.equal(checked.status,'passed');
  assert.equal(checked.correct,3);
  const candidate={label:'A buyer I had turned down',
    body:'The only person who asked about my old bag walked away, and now I miss that buyer more than the sale.',
    hypothesisIds:['H-001'],predictedPass:0.46,
    learningAudit:{
      positiveCaseId:'T-002',negativeCaseId:'T-001',
      positiveAnchor:'The customer rejects',negativeAnchor:'The same ordinary',
      mechanism:'A character exposes an embarrassing personal motive rather than reporting a fact.',
      transferCondition:'The seller misses the attention from the buyer more than receiving the money.',
      failureContrast:'The candidate adds a motive beyond the rejected example rather than paraphrasing it.',
      fatalRisk:'The buyer story might still sound like an obvious generic relationship metaphor.',
      riskResolution:'The body ties the reversal to the original buyer and an actual declined sale.',
      bodyAnchor:'now I miss that buyer',decision:'submit',
    },
  };
  const created=await store.recordTrials({baseId:'test-base',runId,trials:[candidate]});
  assert.equal(created.created.length,1);
  const full=await store.get({id:'test-base',view:'full'});
  const trial=full.full.trials.find(t=>t.id===created.created[0].id);
  assert.equal(trial.recallEvidence.correct,3);
  assert.equal(trial.recallEvidence.challengeCaseIds.length,4);
  assert.equal(trial.learningAudit.status,'verified');
  assert.equal(trial.status,'awaiting','historical recall must not count as a user rating');
});



test('all historical hypotheses and user feedback must be read; dialectical synthesis binds genuine opposing claims and ratings', async () => {
  const store=await setup();
  const hypotheses=Array.from({length:26},(_,i)=>({
    title:'Historical theory '+i,
    statement:'The mechanism '+i+' predicts a concrete new consequence for ordinary actions.',
    mechanism:'A specific motive changes what the speaker does in this situation.',
    limits:'Without a plausible character motive the statement is only an abstract label.',
    polarity:i%5===0?'negative':'positive',
  }));
  await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:hypotheses});
  const sampleRows=Array.from({length:30},(_,i)=>({
    label:'Historical sample '+i,
    body:'A customer has a particular concern in case number '+i+' and responds unusually.',
    hypothesisIds:['H-001'],
    rating:{verdict:i%2===0?'pass':'fail',userWords:i%2===0?'合格、具体的な行動がある':'ボツ。変化が弱い'},
  }));
  await store.recordTrials({baseId:'test-base',backfill:true,trials:sampleRows});
  const {runId}=await store.startRun({baseId:'test-base',objective:'Read all prior ideas and direct feedback',
    targets:[{hypothesisId:'H-002',prediction:'Test a concrete consequence against earlier failures.'}],responseMode:'compact'});
  const candidate={label:'A new consequence',body:'The waiting customer finally changes their mind after a strange answer.',
    hypothesisIds:['H-002'],predictedPass:0.4};
  await assert.rejects(store.prepareRecall({baseId:'test-base',runId,topic:'An unresolved change in customer motivation'}),
    /Full hypothesis and user-feedback research review must be synthesized/);
  await assert.rejects(store.recordTrials({baseId:'test-base',runId,trials:[candidate]}),
    /Historical recall check required|Full historical research review required/);
  const first=await store.researchRead({baseId:'test-base',runId,page:0});
  assert.equal(first.totalHypotheses,26);
  assert.equal(first.totalFeedback,30);
  assert.equal(first.pages,3);
  assert.equal(first.hypotheses.length,12);
  assert.equal(first.feedback.length,10);
  assert.equal(first.feedback[0].originalArtifact.body,sampleRows[0].body,'research must expose full original evaluated artifact');
  assert.ok(first.feedback[0].userWords,'the original user evaluation must be exposed');
  await assert.rejects(store.researchRead({baseId:'test-base',runId,page:2}),/without skipped or repeated pages/);
  await assert.rejects(store.researchSynthesize({baseId:'test-base',runId,synthesis:{}}),/Read all prior/);
  const second=await store.researchRead({baseId:'test-base',runId,page:1});
  const third=await store.researchRead({baseId:'test-base',runId,page:2});
  assert.equal(third.status,'ready_to_synthesize');
  assert.equal([first,second,third].flatMap(x=>x.hypotheses).length,26);
  assert.equal([first,second,third].flatMap(x=>x.feedback).length,30);
  const allH=[first,second,third].flatMap(x=>x.hypotheses);
  const allF=[first,second,third].flatMap(x=>x.feedback);
  const h1=allH[1],h2=allH[2];
  const synthesis={thesisId:h1.id,antithesisId:h2.id,thesisAnchor:h1.statement.slice(0,32),
    antithesisAnchor:h2.statement.slice(0,32),
    passFeedbackId:allF.find(x=>x.verdict==='pass').id,
    passFeedbackAnchor:allF.find(x=>x.verdict==='pass').userWords,
    failFeedbackId:allF.find(x=>x.verdict==='fail').id,
    failFeedbackAnchor:allF.find(x=>x.verdict==='fail').userWords,action:'synthesize',
    tension:'The hypothesis with broad explanatory scope contradicts the narrower evidence of recent failed samples.',
    proposedClaim:'The motive must change the downstream action rather than just introduce another descriptive label.',
    comparison:'Compare versions with an actual changed motive versus a generic paraphrase under matched source conditions.',
    falsification:'The user rejects the specific motive version or accepts a generic equivalent under matched conditions.'};
  await assert.rejects(store.researchSynthesize({baseId:'test-base',runId,synthesis:{
    ...synthesis,antithesisId:'H-999'}}),/distinct existing hypothesis/);
  await assert.rejects(store.researchSynthesize({baseId:'test-base',runId,synthesis:{
    ...synthesis,passFeedbackId:'T-888'}}),/real historical accepted feedback/);
  await assert.rejects(store.researchSynthesize({baseId:'test-base',runId,synthesis:{
    ...synthesis,passFeedbackAnchor:'invented feedback'}}),/must quote the actual human feedback/);
  const pass=allF.find(x=>x.verdict==='pass'),fail=allF.find(x=>x.verdict==='fail');
  const textureReview={cases:[
    {caseId:pass.id,anchor:pass.originalArtifact.body,observation:'The customer response is stated as an unusual action in the scene.',context:'A customer reacts to a specific concern rather than to an abstract topic.'},
    {caseId:fail.id,anchor:fail.originalArtifact.body,observation:'The case uses similar phrasing, with no identifiable change in actual action.',context:'The case is a near neighbor but the user rejected it for a weak change.'}
  ],distinction:'The examples are almost identical; the labels alone do not explain the different outcomes.',
    transfer:'Test a concrete changed action using the same setting and preserve the original tone.',
    boundary:'Changing only the case number does not establish a transferable mechanism.',
    uncertainty:'The user verdict is observed but the causal difference is not established.'};
  await assert.rejects(store.researchSynthesize({baseId:'test-base',runId,synthesis,textureReview:{
    ...textureReview,cases:[{...textureReview.cases[0],anchor:'invented original'},textureReview.cases[1]]}}),/anchor must quote exact/);
  const done=await store.researchSynthesize({baseId:'test-base',runId,synthesis,textureReview});
  assert.equal(done.totalHypotheses,26);
  assert.equal(done.totalFeedback,30);
  assert.equal(done.status,'synthesized');
  await assert.rejects(store.researchRead({baseId:'test-base',runId,page:0}),/already complete/);
});

test('a dialectical synthesis only counts as progress once linked to a real derived hypothesis in the ledger', async () => {
  const store=await setup();
  await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:[
    {...hypothesis,title:'Meaningful reversal in a situation'},
    {...hypothesis,title:'Specific motive matters more than reversal',
      statement:'The user accepts a specific embarrassing motive even without a formal reversal.',
      mechanism:'A real motivation and consequence feel more human than abstract surprise.'},
  ]});
  await store.recordTrials({baseId:'test-base',backfill:true,trials:[
    {label:'Earlier accepted example',body:'Specific human motive and a changed action.',
      hypothesisIds:['H-001'],rating:{verdict:'pass',userWords:'合格'}},
    {label:'Earlier rejected example',body:'An unexpected label with no specific stakes.',
      hypothesisIds:['H-002'],rating:{verdict:'fail',userWords:'ボツ'}},
  ]});
  const {runId}=await store.startRun({baseId:'test-base',objective:'Integrate competing prior theories',
    targets:[{hypothesisId:'H-001',prediction:'The joined mechanism changes user acceptance.'}],responseMode:'compact'});
  const all=await store.researchRead({baseId:'test-base',runId,page:0});
  assert.equal(all.pages,1);
  const a=all.hypotheses.find(x=>x.id==='H-001');
  const b=all.hypotheses.find(x=>x.id==='H-002');
  await store.researchSynthesize({baseId:'test-base',runId,synthesis:{
    thesisId:'H-001',antithesisId:'H-002',relationship:'competing',
    thesisAnchor:a.statement.slice(0,35),antithesisAnchor:b.statement.slice(0,35),
    passFeedbackId:'T-001',passFeedbackAnchor:'合格',
    failFeedbackId:'T-002',failFeedbackAnchor:'ボツ',action:'synthesize',
    tension:'Surprise and human motives may be competing explanations for why a concrete situation seems funny.',
    proposedClaim:'The strongest example combines a meaningful reversal with a visible personal motive and consequent behavior.',
    comparison:'Compare matched samples with the same context, varying only motive and action.',
    falsification:'User rejects the motive-and-reversal example but accepts the original generic reversal.',
  }});
  const candidate={label:'Example grounded in a motive',
    body:'The seller feels bad about rejecting the one person who wanted the item.',
    hypothesisIds:['H-001'],predictedPass:0.42};
  await assert.rejects(store.recordTrials({baseId:'test-base',runId,trials:[candidate]}),
    /must be applied to the hypothesis ledger/);
  const mutation=await store.upsertItems({baseId:'test-base',runId,kind:'hypothesis',items:[{
    title:'Motive-driven reversal as a combined mechanism',
    statement:'When ordinary social rules reverse, a recognizably selfish motivation shapes what the speaker does next.',
    mechanism:'The distinctive payoff is the believable changed action, not merely a clever renaming of the situation.',
    limits:'Generic metaphors with no changed behavior should not be treated as evidence of the new mechanism.',
    reason:'Integrate H-001 and H-002 as an unverified synthesis to test separately.',
  }]});
  assert.deepEqual(mutation.changed.map(x=>x.id),['H-003']);
  const made=await store.recordTrials({baseId:'test-base',runId,trials:[{...candidate,hypothesisIds:['H-003']}]});
  assert.equal(made.created.length,1);
  const state=await store.get({id:'test-base',view:'full'});
  const h=state.full.hypotheses.find(x=>x.id==='H-003');
  assert.equal(h.researchLineage[0].action,'synthesize');
  assert.deepEqual(h.researchLineage[0].priorHypothesisIds,['H-001','H-002']);
  assert.deepEqual(h.researchLineage[0].comparedFeedbackIds,['T-001','T-002']);
  const trial=state.full.trials.find(x=>x.id===made.created[0].id);
  assert.equal(trial.researchEvidence.action,'synthesize');
  const finished=await store.finishRun({baseId:'test-base',runId,summary:'Derived an unverified combined claim from contrasting evidence',
    verdicts:[{hypothesisId:'H-001',result:'inconclusive',
      observed:'The new combined hypothesis awaits independent user evaluation.'}],
    responseMode:'compact'});
  assert.equal(finished.run.researchSynthesis.action,'synthesize');
  assert.deepEqual(finished.run.researchSynthesis.appliedHypothesisIds,['H-003']);
  assert.equal(finished.run.researchSynthesis.pendingApplication,false);
});


test('legacy dojo graph API projects H/T/feedback without rewriting originals and stores proposed edges only',async()=>{
  const store=await setup();
  const created=await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:[
    {...hypothesis,pipelineStage:'voice',targetModuleIds:['voice']},
    {...hypothesis,title:'Alternative source',pipelineStage:'source'},
  ]});
  assert.deepEqual(created.changed.map(x=>x.id),['H-001','H-002']);
  await store.recordTrials({baseId:'test-base',backfill:true,trials:[{
    label:'User approved historical text',body:'A recognizably selfish speaker reveals the actual motive.',
    hypothesisIds:['H-001'],rating:{verdict:'pass',userWords:'合格。いいね',ratedAt:'2026-10-21T00:00:00.000Z'},
  },{
    label:'Rejected original text',body:'An abstract restatement with no particular consequence.',
    hypothesisIds:['H-001','H-002'],
    rating:{verdict:'fail',userWords:'ボツ。つまらない',ratedAt:'2026-10-22T00:00:00.000Z'},
  }]});
  const before=(await store.get({id:'test-base',view:'full'})).full.trials;
  const projected=await store.graphGet({baseId:'test-base',view:'full'});
  assert.equal(projected.migration.mode,'virtual_non_destructive');
  assert.equal(projected.hypotheses.length,2);
  assert.equal(projected.trials.length,2);
  const originals=new Map(before.map(t=>[t.id,t]));
  for(const t of projected.trials){
    assert.equal(t.body,originals.get(t.id).body);
    assert.equal(t.userWords,originals.get(t.id).userWords);
  }
  assert.equal(projected.promotions.find(x=>x.hypothesisId==='H-001').eligibleForMerge,false);
  assert.deepEqual((await store.get({id:'test-base',view:'full'})).full.trials,before);
  await assert.rejects(store.graphRelationUpsert({baseId:'test-base',relations:[{
    sourceId:'H-001',targetId:'H-002',relation:'derives_from',
    rationale:'Hypothesis H-002 narrows the source compared to H-001.',evidenceIds:['T-999'],
  }]}),/existing T-nnn/);
  const payload={baseId:'test-base',relations:[{
    sourceId:'H-001',targetId:'H-002',relation:'narrows',
    rationale:'Hypothesis H-002 seems to narrow the premise from H-001, to be tested.',evidenceIds:['T-001','T-002'],
  }]};
  const change=await store.graphRelationUpsert(payload);
  assert.equal(change.created.length,1);
  assert.equal((await store.graphRelationUpsert(payload)).existing,1,'relation upserts are idempotent');
  const after=await store.graphGet({baseId:'test-base'});
  assert.equal(after.hypothesisEdges.length,1);
  assert.equal(after.hypothesisEdges[0].status,'proposed');
  assert.equal(after.hypothesisEdges[0].sourceId,'H-001');
  await assert.rejects(store.graphRelationUpsert({baseId:'test-base',relations:[{
    sourceId:'H-002',targetId:'H-001',relation:'derives_from',
    rationale:'This reverse ancestry conflicts with the existing proposed edge.',
  }]}),/cycle/);
  assert.deepEqual((await store.get({id:'test-base',view:'full'})).full.trials,before,
    'relations must never mutate the actual rated historical sample');
});

test('new human feedback creates cross-branch maintenance debt that cannot be skipped in next run',async()=>{
 const store=await setup();
 await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:[{
   ...hypothesis,pipelineStage:'voice'
 },{
   ...hypothesis,title:'Information source effect',pipelineStage:'source',
   statement:'A verified source changes user reaction to the generated material.',
 }]});
 const opened=await store.startRun({baseId:'test-base',
   objective:'Measure the difference between a concrete and generic premise.',
   targets:[{hypothesisId:'H-001',prediction:'The concrete material will have a larger acceptance rate'}],
   responseMode:'compact'});
 const made=await store.recordTrials({baseId:'test-base',runId:opened.runId,trials:[{
    label:'New candidate 1',body:'A person explicitly reveals the selfish reason for an ordinary decision.',
    hypothesisIds:['H-001','H-002'],predictedPass:0.5,
  }]});
 await store.rateTrials({baseId:'test-base',ratings:[{id:made.created[0].id,verdict:'pass',userWords:'合格。動機がある'}]});
 let graph=await store.graphGet({baseId:'test-base',view:'full'});
 assert.equal(graph.stewardship.feedbackReview.status,'needs_hypothesis_tree_review');
 assert.deepEqual(graph.stewardship.feedbackReview.pendingTrialIds,[made.created[0].id]);
 assert.deepEqual(graph.stewardship.feedbackReview.touchedHypothesisIds,['H-001','H-002']);
 await store.finishRun({baseId:'test-base',runId:opened.runId,
   summary:'Received a real user verdict; comparing both branches is needed before the next generation.',
   verdicts:[{hypothesisId:'H-001',result:'supported',
    observed:'The submitted user-rated artifact passed; because it tests multiple hypotheses, causal attribution remains unproven.'}],
   notMovedReason:'The observed acceptance is in the ratings ledger, not a separately validated hypothesis revision.',
   responseMode:'compact'});
 const next=await store.startRun({baseId:'test-base',
   objective:'Compare the two previously combined mechanisms without making up a cause.',
   targets:[{hypothesisId:'H-002',prediction:'Source verification may matter in the next independent sample.'}],
   responseMode:'compact'});
 const page=await store.researchRead({baseId:'test-base',runId:next.runId,page:0});
 const root=page.hypotheses.find(x=>x.id==='H-001');
 const synthesis={thesisId:'H-001',thesisAnchor:root.statement.slice(0,36),action:'retain',
   tension:'Multiple hypotheses explained the same accepted sample; no unique cause follows from that observation.',
   proposedClaim:'Concrete motivations could help, but source verification may still be confounded with the wording.',
   comparison:'Create separate matched comparisons under one stable source while only the wording changes.',
   falsification:'The human prefers the generic version under a matched source or rejects both tested variants.',
   passFeedbackId:made.created[0].id,passFeedbackAnchor:'合格',
 };
 await assert.rejects(store.researchSynthesize({baseId:'test-base',runId:next.runId,synthesis}),/treeReview/);
 const review={reviewedTrialIds:[made.created[0].id],
   crossBranchSummary:'The accepted sample relates to both writing style and source quality. No unique explanation has emerged, and the next experiment should separate these factors.',
   branchDecisions:['H-001','H-002'].map(hypothesisId=>({hypothesisId,action:'retain',
     rationale:'This user-accepted example is consistent with this hypothesis, but simultaneous changes make attribution uncertain.',
     nextFalsification:'Use separate matched pairs to vary one feature and check whether the human still accepts the result.'}))};
 const accepted=await store.researchSynthesize({baseId:'test-base',runId:next.runId,synthesis,treeReview:review});
 assert.equal(accepted.status,'synthesized');
 graph=await store.graphGet({baseId:'test-base'});
 assert.equal(graph.stewardship.feedbackReview.status,'up_to_date');
 assert.equal(graph.stewardship.feedbackReview.lastReviewedRunId,next.runId);
});

test('Skill rule proposals bind exact evidence without rewriting the old Skill, and verified diffs are recorded on explicit releases',async()=>{
 const store=await setup();
 await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:[{
   ...hypothesis,pipelineStage:'voice',targetModuleIds:['voice'],
 }]});
 await store.recordTrials({baseId:'test-base',backfill:true,trials:[{
   label:'Human pass example',body:'A specific observable motive reverses the role of the speaker.',
   hypothesisIds:['H-001'],rating:{verdict:'pass',userWords:'合格。動機に納得'}
 },{
   label:'Human reject example',body:'The same idea is repeated in a generic way.',
   hypothesisIds:['H-001'],rating:{verdict:'fail',userWords:'ボツ。抽象的'}
 }]});
 const before=(await store.get({id:'test-base',view:'full'})).full.trials;
 const proposal={sourceMethodVersion:'m-v1',action:'add',moduleId:'voice',
   replacementText:'Describe a concrete person and motive before allowing the final role reversal.',
   hypothesisIds:['H-001'],supportingTrialIds:['T-001'],counterexampleTrialIds:['T-002'],
   rationale:'The accepted sample has a concrete motive, while the rejected one only rephrases the premise.',
   refutingObservation:'If another controlled generic premise beats a concrete motive under matched conditions, the rule needs reversal.',
 };
 await assert.rejects(store.ruleProposalUpsert({baseId:'test-base',proposal:{
   ...proposal,supportingTrialIds:['T-002']}}),/real human pass/);
 const saved=await store.ruleProposalUpsert({baseId:'test-base',proposal});
 assert.match(saved.proposalId,/^MR-/);
 assert.equal(saved.eligibility.evidenceEligible,false);
 assert.equal(saved.status,'proposal_only_never_auto_released');
 const existing=await store.ruleProposalUpsert({baseId:'test-base',proposal});
 assert.equal(existing.duplicate,true);
 const graph=await store.graphGet({baseId:'test-base',view:'full'});
 assert.equal(graph.skillRules.rules.length,1);
 assert.equal(graph.skillRules.rules[0].eligibility.automaticRelease,false);
 assert.equal(graph.skillRules.rules[0].hypothesisIds[0],'H-001');
 assert.deepEqual((await store.get({id:'test-base',view:'full'})).full.trials,before);
 const next={title:'Method',version:'m-v2',summary:'Explicitly requested test of the new rule',
   bodyRef:{kind:'inline'},body:'# Method\n\n'+proposal.replacementText};
 const bad={...next,body:'# Method\n\nThe linked rule is absent'};
 await assert.rejects(store.setMethodVersion({baseId:'test-base',method:bad,
   ruleProposalIds:[saved.proposalId],userAuthorized:true,
   authorizationNote:'User explicitly approved method rule change',noBenchmarkReason:'User asked for this change.'}),
 /does not contain the exact proposed replacement rule/);
 const update=await store.setMethodVersion({baseId:'test-base',method:next,
   ruleProposalIds:[saved.proposalId],userAuthorized:true,
   authorizationNote:'User explicitly approved method rule change',noBenchmarkReason:'User requested the change, future testing required.'});
 assert.equal(update.method.version,'m-v2');
 const history=(await store.get({id:'test-base',view:'full'})).full.methodHistory;
 const last=history.at(-1);
 assert.equal(last.ruleMergeReview[0].proposalId,saved.proposalId);
 assert.equal(last.ruleMergeReview[0].evidenceEligible,false);
 assert.equal(last.ruleMergeReview[0].overrideByDirectUserInstruction,true);
 const stale=(await store.graphGet({baseId:'test-base'})).skillRules.rules[0].eligibility;
 assert.ok(stale.blockingReasons.includes('base_method_version_changed'));
});

test('feedback from submarine hauls also creates a durable tree maintenance obligation',async()=>{
 const store=await setup();
 await store.upsertItems({baseId:'test-base',kind:'hypothesis',items:[hypothesis]});
 await store.recordFeedback({baseId:'test-base',ref:'haul:verified-human-1',decision:'confirmed',
   label:'A user approved output',comment:'本人が良いと明言した'});
 let graph=await store.graphGet({baseId:'test-base'});
 assert.deepEqual(graph.stewardship.feedbackReview.pendingExternalRefs,['haul:verified-human-1']);
 assert.equal(graph.stewardship.feedbackReview.pendingCount,1);
 const run=await store.startRun({baseId:'test-base',
   objective:'Review external user feedback without inventing a linked hypothesis.',
   targets:[{hypothesisId:'H-001',prediction:'A future controlled example may be accepted.'}],responseMode:'compact'});
 const page=await store.researchRead({baseId:'test-base',runId:run.runId,page:0});
 const yes=page.feedback.find(x=>x.verdict==='pass');
 assert.ok(yes);
 const h=page.hypotheses.find(x=>x.id==='H-001');
 const synth={thesisId:'H-001',thesisAnchor:h.statement.slice(0,36),action:'retain',
   passFeedbackId:yes.id,passFeedbackAnchor:yes.userWords.slice(0,16),
   tension:'The outside haul acceptance has no recorded causal link to the existing text-mechanism hypothesis.',
   proposedClaim:'External acceptance should not be treated as proof until an independently controlled sample is judged.',
   comparison:'Keep the source unchanged, submit a contrasted message, and record human responses on both.',
   falsification:'A follow-up independent, source-matched case is rejected by the human despite meeting the proposed rule.'};
 await assert.rejects(store.researchSynthesize({baseId:'test-base',runId:run.runId,synthesis:synth}),/treeReview/);
 const ok=await store.researchSynthesize({baseId:'test-base',runId:run.runId,synthesis:synth,treeReview:{
    reviewedTrialIds:[],reviewedExternalRefs:['haul:verified-human-1'],branchDecisions:[],
    crossBranchSummary:'The external user acceptance is important, but has no causal H linkage. Hold the earlier theory as conjecture and design a genuine comparison.'
 }});
 assert.equal(ok.status,'synthesized');
 graph=await store.graphGet({baseId:'test-base'});
 assert.equal(graph.stewardship.feedbackReview.pendingCount,0);
});

test('Buzz hypothesis creation requires a concrete six-stage research protocol and preserves historical records', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db });
  const id = 'viral-post-method-discovery';
  await store.create({ id, title: 'Buzz', summary: 'Hypothesis protocol', outcome: {
    statement: 'User evaluates each individual standalone post', unit: 'one human-rated draft',
    acceptance: 'Only direct user feedback counts as pass', confirmedBy: 'user',
  }, method: { ...method, version: 'bci-v7.7' }, ...auth });
  const draft = { title: 'Source selection test', statement: 'A source selection hypothesis with a measurable condition.',
    mechanism: 'Observable source details may enable different transformations than summaries.',
    pipelineStage: 'selection', targetModuleIds: ['selection'] };
  await assert.rejects(store.upsertItems({ baseId: id, kind: 'hypothesis', items: [draft] }), /requires researchProtocol/);
  await assert.rejects(store.upsertItems({ baseId: id, kind: 'hypothesis', items: [{
    ...draft, researchProtocol: { acquisition: 'a vague source' },
  }] }), /hypothesis.researchProtocol/);
  const researchProtocol = {
    acquisition: 'Query original one-person field reports for actual actions and record the exact source URL and retrieval date.',
    selection: 'Only retain a case with an observed costly choice and a concrete consequence; reject hypothetical social commentary.',
    transformation: 'Keep the actors and observed acts fixed; move the reader viewpoint to the person carrying the immediate cost.',
    control: 'Compare an equal-length ordinary summary of the same material while preserving the original actors and basic facts.',
    prediction: 'Precommit a difference in user pass versus fail on the same source family, never count an AI quality screen as acceptance.',
    falsification: 'If repeated human-rated comparisons favor the ordinary summary or both arms fail, stop using this source selection.',
  };
  const created = await store.upsertItems({ baseId: id, kind: 'hypothesis', items: [{...draft, researchProtocol}] });
  assert.equal(created.changed.length, 1);
  const hid = created.changed[0].id;
  let read = await store.get({ id, view: 'full' });
  const saved = read.full.hypotheses.find(h => h.id === hid);
  assert.deepEqual(saved.researchProtocol, researchProtocol);
  assert.equal(saved.pipelineStage, 'selection');
  // A normal historical update is not required to rewrite untouched fields.
  await store.upsertItems({ baseId: id, kind: 'hypothesis', items: [{ id: hid, limits: 'Unknown effectiveness until human comparison.' }] });
  read = await store.get({ id, view: 'full' });
  assert.deepEqual(read.full.hypotheses.find(h => h.id === hid).researchProtocol, researchProtocol);
});

test('Skill/Pack dojos reject one-off examples as new H without real formation evidence', async () => {
  const db = new MemoryDb();
  const store = createStore({ getDb: () => db, resolveTarget: async () => ({ title: 'fixture skill', body: 'fixture' }) });
  const id = 'formation-gate-smoke';
  await store.create({
    id, title: 'Formation smoke', summary: 'Avoid topic-as-hypothesis',
    outcome: { ...outcome, confirmedBy: 'user' },
    method: { ...method, bodyRef: { kind: 'chat_skill', location: 'fixture-skill', versionNumber: 1 } },
    ...auth,
  });
  const material = (label, sourceRole) => ({
    title: 'Source ' + label, locator: 'https://example.org/' + label.toLowerCase(),
    coverage: 'A mocked, quoted primary case, used only to validate evidence-linking behavior in a local test.',
    sourceRole,
    originalProof: {
      originalUrl: 'https://example.org/' + label.toLowerCase(),
      excerpt: 'A mocked original excerpt of sufficient length for source metadata validation.',
      verification: 'direct_original',
    },
  });
  const sources = await store.upsertItems({ baseId: id, kind: 'source', items: [
    material('Alpha', 'observation'), material('Beta', 'observation'), material('Idea', 'idea'),
  ] });
  const [a, b, idea] = sources.changed.map(entry => entry.id);
  const plan = {
    acquisition: 'Collect independent firsthand reports from the same period and record direct original URLs.',
    selection: 'Keep only verified action-and-consequence reports and exclude third-party conclusions.',
    transformation: 'Switch one creative operation from naming an observed fact to deriving a documented next consequence.',
    control: 'Keep language, target audience and original facts matched, while varying only the transformation.',
    prediction: 'Compare later genuine user acceptance rates between the two operations, not internal self-ratings.',
    falsification: 'If a matched control repeatedly outperforms the treatment, narrow or reject this method claim.',
  };
  const formationReview = {
    caseRefs: [a, b],
    changedOperation: 'Change the selection operation before drafting: require a documented secondary consequence.',
    rivalExplanation: 'The source audience or topic could explain the result instead of the selection operation.',
    transferTest: 'Try two unrelated documented subject areas, keep the word budget fixed and compare human verdicts.',
    priorArtDecision: 'Unlike existing one-case observations, this identifies an intervention to compare across topics.',
  };
  const hypothesis = {
    title: 'Documented consequences beat labels on distinct topics',
    statement: 'Changing this specific sourcing gate may improve human acceptance versus ordinary summaries.',
    mechanism: 'The reader encounters an independently new and documented consequence rather than a renamed fact.',
    pipelineStage: 'selection', targetModuleIds: ['selection'], researchProtocol: plan,
  };
  await assert.rejects(store.upsertItems({
    baseId: id, kind: 'hypothesis', items: [hypothesis],
  }), /formationReview/);
  await assert.rejects(store.upsertItems({
    baseId: id, kind: 'hypothesis', items: [{ ...hypothesis, formationReview: { ...formationReview, caseRefs: [a, 'S-999'] } }],
  }), /verified observed source/);
  await assert.rejects(store.upsertItems({
    baseId: id, kind: 'hypothesis', items: [{ ...hypothesis, formationReview: { ...formationReview, caseRefs: [a, idea] } }],
  }), /ideas are not evidence|verified observed source/);
  const created = await store.upsertItems({
    baseId: id, kind: 'hypothesis', items: [{ ...hypothesis, formationReview }],
  });
  const hId = created.changed[0].id;
  const result = await store.get({ id, view: 'full' });
  assert.deepEqual(result.full.hypotheses.find(h => h.id === hId).formationReview.caseRefs, [a, b]);
  const graph = await store.graphGet({ baseId: id });
  assert.equal(graph.hypotheses.find(h => h.id === hId).formationReview.changedOperation, formationReview.changedOperation);
  // Legacy H edits need not invent a formation history they never had.
  await store.upsertItems({ baseId: id, kind: 'hypothesis', items: [{ id: hId, limits: 'Unproven before matched human comparison.' }] });
});
