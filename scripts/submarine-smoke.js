'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const dojoModule = require('../functions/explorationBaseStore');
const { createStore } = require('../functions/submarineStore');

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

// Skill versions: finder has v1..v2, helper v1 (no 道場).
const versions = { 'chat_skill:finder': 2, 'chat_skill:helper': 1 };
async function resolveTarget({ kind, id, versionNumber }) {
  const latest = versions[kind + ':' + id];
  if (!latest || versionNumber > latest) throw new Error('version not found: ' + id + ' v' + versionNumber);
  return { title: id, latestVersion: latest, body: id + ' body v' + versionNumber };
}
const auth = { userAuthorized: true, authorizationNote: 'User said: build the submarine' };
const outcome = { statement: 'Find things the user likes.', unit: 'one liked find', target: { min: 2 }, acceptance: 'Real and fun.' };

async function setup() {
  const db = new MemoryDb();
  const dojo = dojoModule.createStore({ getDb: () => db, resolveTarget });
  await dojo.create({ id: 'finder-dojo', title: 'Finder 道場', summary: 'Trains finder', outcome, ...auth,
    method: { title: 'Finder', version: 'f1', summary: 'v1', bodyRef: { kind: 'chat_skill', location: 'finder', versionNumber: 1 } } });
  await dojo.finishRun; // keep reference
  const runA = await dojo.startRun({ baseId: 'finder-dojo', objective: 'old run', unknownTerritoryProbe: 'old waters' });
  await dojo.finishRun({ baseId: 'finder-dojo', runId: runA.runId, summary: 'found one', achievements: [{ label: 'Old find', ref: 'feed:old', evidence: 'liked' }] });
  const subs = createStore({ getDb: () => db, dojo, resolveTarget });
  return { db, dojo, subs };
}
const loadout = [{ kind: 'chat_skill', id: 'finder', use: 'main method' }, { kind: 'chat_skill', id: 'helper', role: 'support', versionNumber: 1 }];

test('commissioning needs the user, migrates the 道場 goal and finds, and binds gear to the released version', async () => {
  const { subs } = await setup();
  await assert.rejects(subs.commission({ id: 'scout', name: 'Scout', summary: 'S', loadout, migrateFromDojo: 'finder-dojo' }), /owned by the user/);
  await assert.rejects(subs.commission({ id: 'scout', name: 'Scout', summary: 'S', loadout: [{ kind: 'chat_skill', id: 'helper' }], mission: outcome, ...auth }), /pin versionNumber/);
  const sub = await subs.commission({ id: 'scout', name: 'Scout', hull: 'SS-01', summary: 'S', loadout, migrateFromDojo: 'finder-dojo', ...auth });
  assert.equal(sub.mission.statement, outcome.statement);
  assert.equal(sub.haul.awaiting.length, 1, 'the 道場 candidate came aboard');
  const finder = sub.loadout.find((g) => g.id === 'finder');
  assert.equal(finder.version, 1, 'carries the version the 道場 released, not the latest');
  assert.equal(finder.versionFrom, 'dojo');
  assert.equal(finder.unreleasedNewer, true);
  assert.equal(finder.body, 'finder body v1');
  assert.ok(sub.warnings.some((w) => /not yet released/.test(w)));
  assert.equal(sub.loadout.find((g) => g.id === 'helper').versionFrom, 'pinned');
});

test('a sortie opens and closes the 道場 run, brings haul aboard and a confirmed haul reaches the 道場', async () => {
  const { dojo, subs } = await setup();
  await subs.commission({ id: 'scout', name: 'Scout', summary: 'S', loadout, migrateFromDojo: 'finder-dojo', ...auth });
  const started = await subs.sortieStart({ submarineId: 'scout', objective: 'look in new waters' });
  assert.equal(started.dojoRuns.length, 1, 'only trained gear opens a 道場 run');
  let base = await dojo.get({ id: 'finder-dojo' });
  assert.equal(base.position.openRunId, started.dojoRuns[0].runId);
  await assert.rejects(subs.sortieStart({ submarineId: 'scout', objective: 'again' }), /at sea/);
  await assert.rejects(subs.update({ submarineId: 'scout', loadout, reason: 'swap' }), /at sea/);
  const back = await subs.sortieFinish({
    submarineId: 'scout', sortieId: started.sortieId, summary: 'two finds',
    haul: [{ label: 'Find A', ref: 'feed:a', evidence: 'fun' }, { label: 'Old find again', ref: 'feed:old', evidence: 'dup' }],
    chart: [{ statement: 'Domestic finds land better', basis: 'two likes' }],
  });
  assert.equal(back.sortie.haulCount, 1, 'a ref already aboard is not brought twice');
  assert.equal(back.sortie.duplicates, 1);
  assert.equal(back.brief.chart.length, 1);
  base = await dojo.get({ id: 'finder-dojo' });
  assert.equal(base.position.openRunId, null, 'the 道場 run closed with the sortie');
  assert.equal(base.position.lastRuns[0].moved, true, 'haul counts as movement for the 道場');
  const haulId = back.brief.haul.awaiting.find((h) => h.ref === 'feed:a').id;
  await assert.rejects(subs.haulDecide({ submarineId: 'scout', haulId, decision: 'confirmed' }), /owned by the user/);
  const after = await subs.haulDecide({ submarineId: 'scout', haulId, decision: 'confirmed', ...auth });
  assert.equal(after.mission.confirmedCount, 1);
  base = await dojo.get({ id: 'finder-dojo' });
  assert.ok(base.outcome.confirmed.some((a) => a.ref === 'feed:a'), 'the confirmed haul is mirrored to the 道場');
});

test('an app reaction decides haul by ref, and a stalled sortie needs a reason', async () => {
  const { dojo, subs } = await setup();
  await subs.commission({ id: 'scout', name: 'Scout', summary: 'S', loadout, migrateFromDojo: 'finder-dojo', ...auth });
  const liked = await subs.recordReaction({ submarineId: 'scout', ref: 'feed:old', label: 'Old find', liked: true });
  assert.equal(liked.status, 'confirmed');
  let base = await dojo.get({ id: 'finder-dojo' });
  assert.ok(base.outcome.confirmed.some((a) => a.ref === 'feed:old'));
  const unliked = await subs.recordReaction({ submarineId: 'scout', ref: 'feed:old', label: 'Old find', liked: false });
  assert.equal(unliked.status, 'candidate');
  base = await dojo.get({ id: 'finder-dojo' });
  assert.ok(!base.outcome.confirmed.some((a) => a.ref === 'feed:old'), 'withdrawing takes it back in the 道場');
  const fresh = await subs.recordReaction({ submarineId: 'scout', ref: 'feed:new', label: 'New', liked: true });
  assert.equal(fresh.status, 'confirmed', 'a like on something never logged comes aboard confirmed');
  assert.deepEqual(await subs.recordReaction({ submarineId: 'nope', ref: 'x', label: 'x', liked: true }), { submarineId: 'nope', changed: false });
  const s = await subs.sortieStart({ submarineId: 'scout', objective: 'empty sea' });
  await assert.rejects(subs.sortieFinish({ submarineId: 'scout', sortieId: s.sortieId, summary: 'nothing' }), /notMovedReason/);
  const empty = await subs.sortieFinish({ submarineId: 'scout', sortieId: s.sortieId, summary: 'nothing', notMovedReason: 'all sources dry' });
  assert.equal(empty.sortie.moved, false);
  assert.equal(empty.brief.position.stalledSorties, 1);
  const fleet = await subs.list({});
  assert.equal(fleet.items[0].loadout[0].version, 1);
  const all = await subs.haulList({ status: 'confirmed' });
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].submarine.name, 'Scout');
});

test('the mission belongs to the user; chart entries retire with a reason', async () => {
  const { subs } = await setup();
  await subs.commission({ id: 'scout', name: 'Scout', summary: 'S', loadout, mission: outcome, ...auth });
  await assert.rejects(subs.update({ submarineId: 'scout', mission: { ...outcome, target: { min: 5 } } }), /owned by the user/);
  let sub = await subs.update({ submarineId: 'scout', mission: { ...outcome, target: { min: 5 } }, ...auth });
  assert.equal(sub.mission.target.min, 5);
  assert.equal(sub.mission.revision, 2);
  sub = await subs.update({ submarineId: 'scout', chartEdits: [{ statement: 'Memes need context', basis: '0 likes', legacyRef: 'dojo:H-001' }] });
  assert.equal(sub.chart[0].id, 'F-001');
  await assert.rejects(subs.update({ submarineId: 'scout', chartEdits: [{ id: 'F-001', status: 'retired' }] }), /reason/);
  sub = await subs.update({ submarineId: 'scout', chartEdits: [{ id: 'F-001', status: 'retired', reason: 'a meme got a like' }] });
  assert.equal(sub.chart.length, 0);
  await assert.rejects(subs.update({ submarineId: 'scout', loadout }), /reason/);
});

test('the fleet manifest commissions missing submarines once, with their 道場 and chart', async () => {
  const fleetModule = require('../functions/submarineFleet');
  const calls = [];
  const have = new Set(['job-db']);
  const stub = {
    list: async () => ({ items: [...have].map((id) => ({ id })) }),
    commission: async (input) => { calls.push(['commission', input]); if (input.id === 'unknown') throw new Error('gear missing'); have.add(input.id); },
    update: async (input) => { calls.push(['update', input]); },
  };
  const first = await fleetModule.ensureFleet(stub, { force: true });
  const commissioned = calls.filter(([kind]) => kind === 'commission').map(([, input]) => input);
  assert.ok(!commissioned.some((c) => c.id === 'job-db'), 'an existing submarine is never touched');
  assert.ok(commissioned.every((c) => c.userAuthorized === true && /うまく道場と整合性/.test(c.authorizationNote) && c.migrateFromDojo));
  assert.equal(first.results.find((r) => r.id === 'unknown').commissioned, false);
  assert.equal(first.settled, false, 'a failed submarine is retried next time');
  const chart = calls.find(([kind, input]) => kind === 'update' && input.submarineId === 'discover');
  assert.equal(chart[1].chartEdits.length, 2);
  have.add('unknown');
  const second = await fleetModule.ensureFleet(stub, { force: true });
  assert.equal(second.results.length, 0);
  assert.equal(second.settled, true);
  assert.equal((await fleetModule.ensureFleet(stub)).settled, true);
  assert.deepEqual(fleetModule.FLEET.map((s) => s.hull), ['SS-01', 'SS-02', 'SS-03', 'SS-04', 'SS-05']);
});

function fakeFeed() {
  const items = new Map([
    ['a', { id: 'a', title: 'Foot bath', url: 'https://x/a', reason: 'local find', feedback: 'loved', revision: 2 }],
    ['b', { id: 'b', title: 'Meme history', url: 'https://x/b', reason: 'meme', feedback: 'new', revision: 1 }],
  ]);
  const calls = [];
  return {
    calls, items,
    adapter: {
      where: 'personal_feed', authoritative: true,
      actions: [{ key: 'loved', label: '好き', decision: 'confirmed' }, { key: 'saved', label: 'あとで', decision: 'candidate' }, { key: 'skipped', label: '興味なし', decision: 'declined' }],
      async list() {
        const st = { loved: 'confirmed', skipped: 'declined' };
        return [...items.values()].map((i) => ({ id: i.id, ref: 'personal_feed:' + i.id, record: { title: i.title, url: i.url, reason: i.reason, state: i.feedback }, status: st[i.feedback] || 'candidate', evidence: i.reason }));
      },
      async apply(id, action, note) { calls.push([id, action, note]); items.get(id).feedback = action; },
    },
  };
}

test('a canonical store is indexed as haul, its state decides status, and feedback writes back and is kept', async () => {
  const db = new MemoryDb();
  const dojo = dojoModule.createStore({ getDb: () => db, resolveTarget });
  await dojo.create({ id: 'finder-dojo', title: 'Finder 道場', summary: 'Trains finder', outcome, ...auth,
    method: { title: 'Finder', version: 'f1', summary: 'v1', bodyRef: { kind: 'chat_skill', location: 'finder', versionNumber: 1 } } });
  const feed = fakeFeed();
  const { createCanonical } = require('../functions/submarineCanonical');
  const subs = createStore({ getDb: () => db, dojo, resolveTarget, canonical: createCanonical({ personal_feed: feed.adapter }) });
  await subs.commission({ id: 'disc', name: 'D', summary: 'S', loadout: [{ kind: 'chat_skill', id: 'finder' }], mission: outcome, haulCanonical: { where: 'personal_feed' }, ...auth });
  let sub = await subs.get({ id: 'disc' });
  assert.equal(sub.haul.confirmed.length, 1, 'a loved recommendation came aboard confirmed');
  assert.equal(sub.haul.awaiting.length, 1);
  assert.equal(sub.haul.awaiting[0].record.reason, 'meme', 'haul shows the canonical record');
  assert.equal(sub.actions[0].key, 'loved');
  let base = await dojo.get({ id: 'finder-dojo' });
  assert.ok(base.outcome.confirmed.some((a) => a.ref === 'personal_feed:a'), 'mirrored to the 道場');
  sub = await subs.get({ id: 'disc' });
  assert.equal(sub.haul.awaiting.length + sub.haul.confirmed.length, 2, 'a second read does not index twice');

  const b = sub.haul.awaiting[0];
  await assert.rejects(subs.haulFeedback({ submarineId: 'disc', haulId: b.id, action: 'loved' }), /owned by the user/);
  await assert.rejects(subs.haulFeedback({ submarineId: 'disc', haulId: b.id, action: 'nope', ...auth }), /action must be one of/);
  sub = await subs.haulFeedback({ submarineId: 'disc', haulId: b.id, action: 'skipped', comment: '前提知識が要る', ...auth });
  assert.deepEqual(feed.calls[0], ['b', 'skipped', '前提知識が要る'], 'written back to the feed');
  assert.equal(sub.haul.declinedCount, 1);
  assert.equal(sub.recentFeedback[0].comment, '前提知識が要る');
  assert.equal(sub.recentFeedback[0].actionLabel, '興味なし');
  sub = await subs.haulFeedback({ submarineId: 'disc', haulId: b.id, comment: 'やっぱり惜しい', ...auth });
  assert.equal(sub.recentFeedback.length, 2, 'a comment alone is kept too');

  // The feed changed elsewhere (e.g. the old Discover page): the next read follows it.
  feed.items.get('a').feedback = 'skipped';
  sub = await subs.get({ id: 'disc' });
  assert.equal(sub.haul.confirmed.length, 0);
  base = await dojo.get({ id: 'finder-dojo' });
  assert.ok(!base.outcome.confirmed.some((x) => x.ref === 'personal_feed:a'), 'the 道場 follows the withdrawal');

  // A new record added during a sortie is linked to it rather than counted as a duplicate.
  const s = await subs.sortieStart({ submarineId: 'disc', objective: 'find' });
  feed.items.set('c', { id: 'c', title: 'New find', url: 'https://x/c', reason: 'r', feedback: 'new', revision: 1 });
  await subs.get({ id: 'disc' });
  const back = await subs.sortieFinish({ submarineId: 'disc', sortieId: s.sortieId, summary: 'one', haul: [{ label: 'New find', ref: 'personal_feed:c', evidence: 'passes' }] });
  assert.equal(back.sortie.haulCount, 1);
  assert.equal(back.sortie.duplicates, 0);
  assert.equal(back.brief.haul.awaiting.find((h) => h.ref === 'personal_feed:c').sortieId, s.sortieId);
  const all = await subs.haulList({});
  assert.ok(all.items.every((h) => h.record), 'the fleet view renders canonical records');
  assert.equal(all.actions.personal_feed[0].key, 'loved');
});
