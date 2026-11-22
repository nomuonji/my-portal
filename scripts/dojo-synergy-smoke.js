'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { planPackRewrites, planProfileUpdates, reconcileDojoRelease } = require('../functions/dojoSynergy');

test('shared Skill upgrade updates every old pinned component exactly once per old version', () => {
  const definition = {
    dependencies: [{ resourceType: 'chat_skill', canonicalRef: 'buzz-content-ideation', versionNumber: 63 }],
    components: [
      { dependencies: [{ resourceType: 'chat_skill', canonicalRef: 'buzz-content-ideation', versionNumber: 63 }] },
      { dependencies: [{ resourceType: 'chat_skill', canonicalRef: 'buzz-content-ideation', versionNumber: 64 }] },
      { dependencies: [{ resourceType: 'chat_skill', canonicalRef: 'other-skill', versionNumber: 2 }] },
      { dependencies: [{ resourceType: 'chat_skill', canonicalRef: 'buzz-content-ideation', versionNumber: null }] },
    ],
  };
  const rewrites = planPackRewrites(definition, { kind: 'chat_skill', id: 'buzz-content-ideation', versionNumber: 64 });
  assert.deepEqual(rewrites, [{
    from: { resourceType: 'chat_skill', canonicalRef: 'buzz-content-ideation', versionNumber: 63 },
    to: { resourceType: 'chat_skill', canonicalRef: 'buzz-content-ideation', versionNumber: 64 },
  }]);
  assert.deepEqual(definition.dependencies[0].versionNumber, 63);
});

test('only pinned older profile Pack versions change; latest-following null pins remain', () => {
  const definition = { intelligencePortfolio: [
    { packId: 'sample-pack', versionNumber: 3 },
    { packId: 'latest-following', versionNumber: null },
    { packId: 'newer-pack', versionNumber: 9 },
  ] };
  assert.deepEqual(planProfileUpdates(definition, { kind: 'intelligence_pack', id: 'sample-pack', versionNumber: 4 }),
    [{ packId: 'sample-pack', versionNumber: 4 }]);
  assert.deepEqual(planProfileUpdates(definition, { kind: 'intelligence_pack', id: 'latest-following', versionNumber: 4 }), []);
});

test('unreleased version cannot propagate or update Pack versions', async () => {
  let wrote = 0;
  const services = {
    dojos: { trainersOf: async () => [{ releasedVersion: 63 }] },
    registry: { derivePackVersion: async () => { wrote += 1; } },
  };
  await assert.rejects(() => reconcileDojoRelease(
    { kind: 'chat_skill', id: 'buzz-content-ideation', versionNumber: 64 }, services),
  /not currently released/);
  assert.equal(wrote, 0);
});

test('one released Skill updates all dependent Packs but reports one failed compare-and-swap', async () => {
  const versions = { a: 4, b: 5 };
  const calls = [];
  const registry = {
    listPacks: async () => ({ items: [{ id: 'a' }, { id: 'b' }, { id: 'unrelated' }] }),
    getPack: async ({ id }) => ({
      pack: { status: 'active', currentVersionNumber: versions[id] || 1 },
      definition: { dependencies: id === 'unrelated' ? [] : [
        { resourceType: 'chat_skill', canonicalRef: 'shared-skill', versionNumber: 1, requiredness: 'required' },
      ] },
    }),
    derivePackVersion: async (input) => {
      calls.push(input);
      if (input.id === 'b') throw new Error('version conflict');
      return { versionNumber: 5, rewritten: 1 };
    },
  };
  const result = await reconcileDojoRelease(
    { kind: 'chat_skill', id: 'shared-skill', versionNumber: 2 },
    { registry, dojos: { trainersOf: async () => [{ releasedVersion: 2 }] } },
  );
  assert.deepEqual(result.updated.map(x => x.id), ['a']);
  assert.deepEqual(result.failures.map(x => x.id), ['b']);
  assert.equal(result.skipped, 1);
  assert.equal(calls[0].expectedCurrentVersion, 4);
  assert.equal(calls[0].confirm, true);
});

test('released Pack synchronizes only explicitly pinned Agent Profiles', async () => {
  const calls = [];
  const registry = {
    listProfiles: async () => ({ items: [{ id: 'agent-1' }, { id: 'agent-2' }] }),
    getProfile: async ({ id }) => ({
      profile: { currentVersionNumber: 3 },
      definition: { intelligencePortfolio: [{ packId: 'video-pack', versionNumber: id === 'agent-1' ? 1 : null }] },
    }),
    deriveProfileVersion: async (input) => { calls.push(input); return { versionNumber: 4 }; },
  };
  const result = await reconcileDojoRelease(
    { kind: 'intelligence_pack', id: 'video-pack', versionNumber: 2 },
    { registry, dojos: { trainersOf: async () => [{ releasedVersion: 2 }] } },
  );
  assert.equal(result.updated.length, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(calls[0].portfolio, [{ packId: 'video-pack', versionNumber: 2 }]);
});
