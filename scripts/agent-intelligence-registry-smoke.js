'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const registryModule = require('../functions/agentIntelligenceRegistry');

class Snapshot {
  constructor(id, value) {
    this.id = id;
    this.value = value === undefined ? null : value;
    this.exists = this.value !== null;
  }
  data() { return this.exists ? JSON.parse(JSON.stringify(this.value)) : undefined; }
}
class DocumentRef {
  constructor(db, collection, id) { this.db = db; this.collectionPath = collection; this.id = id; }
  async get() { return new Snapshot(this.id, this.db.records.get(this.collectionPath + '/' + this.id)); }
}
class CollectionRef {
  constructor(db, path, limit) { this.db = db; this.path = path; this.max = limit || null; }
  doc(id) { return new DocumentRef(this.db, this.path, id); }
  limit(value) { return new CollectionRef(this.db, this.path, value); }
  async get() {
    const prefix = this.path + '/';
    const docs = [...this.db.records.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .slice(0, this.max || 1000)
      .map(([key, value]) => new Snapshot(key.slice(prefix.length), value));
    return { docs, size: docs.length };
  }
}
class MemoryDb {
  constructor() { this.records = new Map(); }
  collection(path) { return new CollectionRef(this, path); }
  async runTransaction(callback) {
    const writes = [];
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, value) => { writes.push({ op: 'set', ref, value }); },
      update: (ref, value) => { writes.push({ op: 'update', ref, value }); },
    };
    const result = await callback(tx);
    writes.forEach((write) => {
      const key = write.ref.collectionPath + '/' + write.ref.id;
      if (write.op === 'update' && !this.records.has(key)) throw new Error('missing document');
      this.records.set(key, write.op === 'update'
        ? { ...this.records.get(key), ...write.value }
        : write.value);
    });
    return result;
  }
}
const chatSkills = {
  async getSkill({ id }) {
    if (id !== 'example-skill') throw new Error('unknown skill');
    return { title: 'Example Skill', revision: 2, body: '# Skill v2' };
  },
  async skillVersions({ id }) {
    if (id !== 'example-skill') throw new Error('unknown skill');
    return { items: [{ versionNumber: 2, title: 'Example Skill', body: '# Skill v2' }] };
  },
};
const contextStore = {
  async methodGetContext({ id }) {
    if (id !== 'example-method') throw new Error('unknown method');
    const currentVersion = {
      versionNumber: 3, status: 'active', instructions: '# Method v3',
      protocol: { stages: ['inspect'] }, qualityGates: ['cite evidence'],
    };
    return { method: { id, title: 'Example Method' }, currentVersion, versions: [currentVersion] };
  },
};
const explorationBases = {
  async trainersOf() { return []; },
  async brief({ id }) {
    if (id !== 'example-base') throw new Error('Exploration Base not found: ' + id);
    return { base: { id, title: 'Example Base', revision: 7 }, outcome: { statement: 'Find two things.' } };
  },
};
const createRegistry = (database) => registryModule.createRegistry({
  getDb: () => database, chatSkills, contextStore, explorationBases,
});
const baseProfile = (portfolio) => ({
  id: 'test-agent',
  title: 'Test Agent',
  summary: 'A test profile.',
  purpose: 'A unified cognitive identity used to validate the Registry and Bundle Resolver.',
  identity: {
    coreDefinition: 'A coherent agent identity that reasons from explicit objectives and evidence.',
    operatingPrinciples: ['Preserve one integrated identity.', 'Keep evidence and assumptions distinct.'],
    expressionPrinciples: ['Explain uncertainty directly.'],
  },
  intelligencePortfolio: portfolio,
  compositionPolicy: {
    selectionPrinciples: ['Select by task relevance and evidence needs.', 'Load the minimum sufficient set.'],
    conflictResolutionPrinciples: ['Preserve unresolved conflicts.'],
    synthesisPrinciples: ['Synthesize against the stated objective.'],
  },
});
const basePack = () => ({
  id: 'test-cognition',
  title: 'Test Cognition',
  summary: 'A test composite pack.',
  purpose: 'A reusable cognitive model for testing component selection and dependency resolution.',
  kind: 'composite',
  scope: { includes: ['testing'], excludes: [] },
  applicability: { taskSignals: ['test'], evidenceNeeds: ['source evidence'], constraints: [] },
  worldModel: { entities: ['source'], variables: ['confidence'] },
  epistemology: { evidenceLabels: ['OBSERVED', 'UNKNOWN'] },
  inputContract: { requiredInputs: ['taskFrame.objective'] },
  reasoningProcedures: ['Inspect sources before synthesizing.'],
  evaluationCriteria: ['Evidence traceability.'],
  contributionContract: { fields: ['findings', 'evidence', 'uncertainty'] },
  components: [{
    id: 'evidence-review',
    title: 'Evidence Review',
    purpose: 'Check the source evidence and assumptions.',
    loadWhen: ['The task contains factual claims.'],
    dependencies: [
      { resourceType: 'hq_method', canonicalRef: 'example-method', versionNumber: 3, requiredness: 'required' },
      { resourceType: 'chat_skill', canonicalRef: 'example-skill', versionNumber: 2, requiredness: 'recommended' },
      { resourceType: 'tool', canonicalRef: 'external-search', requiredness: 'optional' },
    ],
  }],
});

test('profile and composite Pack validators enforce stable structure', () => {
  assert.throws(() => registryModule.cleanProfile({ id: 'INVALID', title: 'x' }), /kebab-case/);
  assert.throws(() => registryModule.cleanPack({ id: 'empty-pack', title: 'Empty', purpose: 'Test', kind: 'composite' }), /require at least one component/);
  const profile = registryModule.cleanProfile(baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]));
  assert.equal(profile.intelligencePortfolio[0].versionNumber, 1);
  const pack = registryModule.cleanPack(basePack());
  assert.equal(pack.kind, 'composite');
  assert.equal(pack.components[0].dependencies.length, 3);
});

test('Profile and Pack versions are immutable and revision checked', async () => {
  const db = new MemoryDb();
  const registry = createRegistry(db);
  const profileV1 = await registry.createProfileVersion({
    profile: baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]),
    expectedCurrentVersion: 0, confirm: true,
  });
  assert.equal(profileV1.definition.versionNumber, 1);
  await registry.createProfileVersion({
    profile: { ...baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]), summary: 'Updated summary' },
    expectedCurrentVersion: 1, changeSummary: 'Clarify profile summary', confirm: true,
  });
  const historical = await registry.getProfile({ id: 'test-agent', versionNumber: 1 });
  const current = await registry.getProfile({ id: 'test-agent' });
  assert.equal(historical.definition.summary, 'A test profile.');
  assert.equal(current.definition.summary, 'Updated summary');
  await assert.rejects(
    registry.createProfileVersion({
      profile: baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]),
      expectedCurrentVersion: 1, confirm: true,
    }),
    /version conflict/,
  );
  await assert.rejects(
    registry.createProfileVersion({
      profile: baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]),
      expectedCurrentVersion: 2, confirm: false,
    }),
    /confirm=true/,
  );
  const packV1 = await registry.createPackVersion({
    pack: basePack(), expectedCurrentVersion: 0, confirm: true,
  });
  assert.equal(packV1.definition.versionNumber, 1);
  await assert.rejects(
    registry.createPackVersion({ pack: basePack(), expectedCurrentVersion: 0, confirm: true }),
    /version conflict/,
  );
});

test('Bundle Resolver loads pinned internal dependencies and leaves optional external tools unloaded', async () => {
  const db = new MemoryDb();
  const registry = createRegistry(db);
  await registry.createPackVersion({ pack: basePack(), expectedCurrentVersion: 0, confirm: true });
  await registry.createProfileVersion({
    profile: baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]),
    expectedCurrentVersion: 0, confirm: true,
  });
  const bundle = await registry.resolveBundle({
    profileId: 'test-agent',
    taskFrame: { objective: 'Verify one sourced claim.', deliverable: 'evidence memo' },
    selectedIntelligences: [{
      packId: 'test-cognition',
      versionNumber: 1,
      componentIds: ['evidence-review'],
      selectionRationale: 'The request requires verification of factual evidence.',
    }],
  });
  assert.equal(bundle.hostNeutral, true);
  assert.equal(bundle.ephemeral, true);
  assert.equal(bundle.selectedIntelligences[0].definition.components.length, 1);
  const method = bundle.resolvedDependencies.find((item) => item.resourceType === 'hq_method');
  const skill = bundle.resolvedDependencies.find((item) => item.resourceType === 'chat_skill');
  const tool = bundle.resolvedDependencies.find((item) => item.resourceType === 'tool');
  assert.equal(method.loadState, 'loaded');
  assert.equal(method.resolvedVersion, 3);
  assert.equal(method.content.instructions, '# Method v3');
  assert.equal(skill.loadState, 'not_requested');
  assert.equal(tool.loadState, 'not_requested');
  const expanded = await registry.resolveBundle({
    profileId: 'test-agent',
    taskFrame: { objective: 'Verify one sourced claim.' },
    selectedIntelligences: [{
      packId: 'test-cognition',
      componentIds: ['evidence-review'],
      selectionRationale: 'Load the optional writing skill for this task.',
    }],
    selectedDependencies: ['chat_skill:example-skill'],
  });
  assert.equal(expanded.resolvedDependencies.find((item) => item.resourceType === 'chat_skill').content, '# Skill v2');
  assert.deepEqual(expanded.unresolvedGaps, []);
});

test('Bundle Resolver refuses Packs outside the Agent Profile portfolio', async () => {
  const db = new MemoryDb();
  const registry = createRegistry(db);
  await registry.createPackVersion({ pack: basePack(), expectedCurrentVersion: 0, confirm: true });
  await registry.createProfileVersion({
    profile: baseProfile([{ packId: 'different-pack' }]),
    expectedCurrentVersion: 0, confirm: true,
  });
  await assert.rejects(registry.resolveBundle({
    profileId: 'test-agent',
    taskFrame: { objective: 'No bypass.' },
    selectedIntelligences: [{ packId: 'test-cognition', selectionRationale: 'Not in the portfolio.' }],
  }), /not in the Agent Profile portfolio/);
});

test('Initial MCC bootstrap is idempotent and does not create a Profile', async () => {
  const db = new MemoryDb();
  const registry = createRegistry(db);
  await assert.rejects(registry.bootstrapInitialPack({ confirm: false }), /confirm=true/);
  const first = await registry.bootstrapInitialPack({ confirm: true });
  const second = await registry.bootstrapInitialPack({ confirm: true });
  assert.equal(first.created, true);
  assert.equal(first.result.definition.components.length, 5);
  assert.equal(second.created, false);
  const profileList = await registry.listProfiles({});
  assert.equal(profileList.count, 0);
  const packList = await registry.listPacks({});
  assert.equal(packList.items[0].id, 'marketing-creative-cognition');
});

test('Bundle Resolver loads an Exploration Base brief when the caller selects it', async () => {
  const db = new MemoryDb();
  const registry = createRegistry(db);
  const pack = basePack();
  pack.components[0].dependencies.push(
    { resourceType: 'exploration_base', canonicalRef: 'example-base', requiredness: 'recommended' },
    { resourceType: 'exploration_base', canonicalRef: 'missing-base', requiredness: 'optional' },
  );
  await registry.createPackVersion({ pack, expectedCurrentVersion: 0, confirm: true });
  await registry.createProfileVersion({ profile: baseProfile([{ packId: 'test-cognition' }]), expectedCurrentVersion: 0, confirm: true });
  const resolve = (selectedDependencies) => registry.resolveBundle({
    profileId: 'test-agent', taskFrame: { objective: 'Run one exploration cycle.' },
    selectedIntelligences: [{ packId: 'test-cognition', componentIds: ['evidence-review'], selectionRationale: 'Exploration run needs the base.' }],
    selectedDependencies,
  });
  const idle = await resolve([]);
  assert.equal(idle.resolvedDependencies.find((item) => item.canonicalRef === 'example-base').loadState, 'not_requested');
  const loaded = await resolve(['exploration_base:example-base', 'exploration_base:missing-base']);
  const base = loaded.resolvedDependencies.find((item) => item.canonicalRef === 'example-base');
  assert.equal(base.loadState, 'loaded');
  assert.equal(base.resolvedVersion, 7);
  assert.equal(base.content.outcome.statement, 'Find two things.');
  assert.equal(loaded.resolvedDependencies.find((item) => item.canonicalRef === 'missing-base').loadState, 'unresolved');
});

test('derive creates a new version by changing only dependencies or the portfolio', async () => {
  const db = new MemoryDb();
  const registry = createRegistry(db);
  await registry.createPackVersion({ pack: basePack(), expectedCurrentVersion: 0, confirm: true });
  await registry.createProfileVersion({ profile: baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]), expectedCurrentVersion: 0, confirm: true });
  const before = await registry.getPack({ id: 'test-cognition' });
  const allDeps = (definition) => [...definition.dependencies, ...definition.components.flatMap((c) => c.dependencies)];
  const target = allDeps(before.definition)[0];
  await assert.rejects(registry.derivePackVersion({ id: 'test-cognition', expectedCurrentVersion: 1, confirm: true,
    dependencyRewrites: [{ from: { resourceType: 'chat_skill', canonicalRef: 'does-not-exist' }, to: null }] }), /No dependency matched/);
  const derived = await registry.derivePackVersion({ id: 'test-cognition', expectedCurrentVersion: 1, confirm: true, changeSummary: 'Repoint',
    dependencyRewrites: [{ from: { resourceType: target.resourceType, canonicalRef: target.canonicalRef }, to: { resourceType: 'external', canonicalRef: 'https://example.com/replacement' } }] });
  assert.equal(derived.versionNumber, 2);
  const after = await registry.getPack({ id: 'test-cognition' });
  assert.equal(after.definition.purpose, before.definition.purpose);
  assert.deepEqual(after.definition.reasoningProcedures, before.definition.reasoningProcedures);
  assert.equal(allDeps(after.definition).length, allDeps(before.definition).length);
  const replaced = allDeps(after.definition).find((dep) => dep.canonicalRef === 'https://example.com/replacement');
  assert.equal(replaced.requiredness, target.requiredness, 'requiredness carries over');
  assert.ok(!allDeps(after.definition).some((dep) => dep.canonicalRef === target.canonicalRef && dep.resourceType === target.resourceType));
  assert.equal((await registry.getPack({ id: 'test-cognition', versionNumber: 1 })).definition.versionNumber, 1, 'the earlier version is untouched');

  const profile = await registry.deriveProfileVersion({ id: 'test-agent', expectedCurrentVersion: 1, confirm: true, changeSummary: 'Unpin',
    portfolio: [{ packId: 'test-cognition', versionNumber: null }] });
  assert.equal(profile.versionNumber, 2);
  assert.equal(profile.intelligencePortfolio[0].versionNumber, null);
  await assert.rejects(registry.deriveProfileVersion({ id: 'test-agent', expectedCurrentVersion: 1, confirm: true, portfolio: [{ packId: 'test-cognition', versionNumber: null }] }), /version conflict/);
  const identityBefore = (await registry.getProfile({ id: 'test-agent', versionNumber: 1 })).definition.identity;
  assert.deepEqual((await registry.getProfile({ id: 'test-agent' })).definition.identity, identityBefore);
});

test('trained Pack defaults to dojo-released version, even if Registry has an untested draft', async () => {
  const db = new MemoryDb();
  const trainedBases = { ...explorationBases, trainersOf: async ({ kind, id }) =>
    kind === 'intelligence_pack' && id === 'test-cognition'
      ? [{ baseId: 'test-dojo', releasedVersion: 1 }] : [] };
  const registry = registryModule.createRegistry({
    getDb: () => db, chatSkills, contextStore, explorationBases: trainedBases,
  });
  await registry.createProfileVersion({
    profile: baseProfile([{ packId: 'test-cognition', versionNumber: null }]),
    expectedCurrentVersion: 0, confirm: true,
  });
  await registry.createPackVersion({ pack: basePack(), expectedCurrentVersion: 0, confirm: true });
  await registry.createPackVersion({
    pack: { ...basePack(), summary: 'Draft dependency update, not dojo released' },
    expectedCurrentVersion: 1, confirm: true,
  });
  assert.equal((await registry.getPack({ id: 'test-cognition' })).definition.versionNumber, 2);
  const request = {
    profileId: 'test-agent', taskFrame: { objective: 'Verify dojo release isolation' },
    selectedIntelligences: [{
      packId: 'test-cognition', componentIds: ['evidence-review'],
      selectionRationale: 'Only the dojo released version is executable.',
    }],
  };
  const bundle = await registry.resolveBundle(request);
  assert.equal(bundle.selectedIntelligences[0].versionNumber, 1);
  await assert.rejects(
    registry.resolveBundle({
      ...request,
      selectedIntelligences: [{ ...request.selectedIntelligences[0], versionNumber: 2 }],
    }),
    /not released by its dojo/,
  );
});

test('runtime uses current shared Skill despite stale and conflicting Pack pins', async () => {
  const db = new MemoryDb();
  const registry = createRegistry(db);
  const pack = basePack();
  pack.components[0].dependencies = [
    { resourceType: 'chat_skill', canonicalRef: 'example-skill', versionNumber: 1, requiredness: 'required' },
    { resourceType: 'chat_skill', canonicalRef: 'example-skill', versionNumber: 2, requiredness: 'recommended' },
  ];
  await registry.createPackVersion({ pack, expectedCurrentVersion: 0, confirm: true });
  await registry.createProfileVersion({ profile: baseProfile([{ packId: 'test-cognition', versionNumber: 1 }]), expectedCurrentVersion: 0, confirm: true });
  const bundle = await registry.resolveBundle({
    profileId: 'test-agent', taskFrame: { objective: 'Load shared Skill at execution time' },
    selectedIntelligences: [{ packId: 'test-cognition', componentIds: ['evidence-review'],
      selectionRationale: 'Shared Skill revisions should follow latest at each execution.' }],
  });
  const skills = bundle.resolvedDependencies.filter((item) => item.resourceType === 'chat_skill');
  assert.equal(skills.length, 1);
  assert.equal(skills[0].loadState, 'loaded');
  assert.equal(skills[0].resolvedVersion, 2);
  assert.equal(skills[0].content, '# Skill v2');
  assert.equal(skills[0].versionPolicy, 'latest_registry_version');
  assert.deepEqual(bundle.unresolvedGaps, []);
  assert.equal((await registry.getPack({ id: 'test-cognition', versionNumber: 1 }))
    .definition.components[0].dependencies[0].versionNumber, 1);
});

test('dojo-approved shared Skill update takes effect next resolution without Pack rewrite', async () => {
  const db = new MemoryDb();
  let release = 1;
  const skills = {
    ...chatSkills,
    async skillVersions() {
      return { items: [
        { versionNumber: 3, title: 'Example Skill', body: '# Unapproved v3' },
        { versionNumber: 2, title: 'Example Skill', body: '# Approved v2' },
        { versionNumber: 1, title: 'Example Skill', body: '# Approved v1' },
      ] };
    },
    async getSkill() { throw new Error('must not load draft of a dojo-owned Skill'); },
  };
  const dojos = {
    ...explorationBases,
    async trainersOf({ kind, id }) {
      if (kind === 'chat_skill' && id === 'example-skill')
        return [{ baseId: 'example-dojo', releasedVersion: release }];
      return [];
    },
  };
  const registry = registryModule.createRegistry({ getDb: () => db, chatSkills: skills, contextStore, explorationBases: dojos });
  const pack = basePack();
  pack.components[0].dependencies = [{ resourceType: 'chat_skill', canonicalRef: 'example-skill',
    versionNumber: 1, requiredness: 'required' }];
  await registry.createPackVersion({ pack, expectedCurrentVersion: 0, confirm: true });
  await registry.createProfileVersion({ profile: baseProfile([{ packId: 'test-cognition' }]), expectedCurrentVersion: 0, confirm: true });
  const args = {
    profileId: 'test-agent', taskFrame: { objective: 'Use approved Skill' },
    selectedIntelligences: [{ packId: 'test-cognition', componentIds: ['evidence-review'],
      selectionRationale: 'Load the currently dojo-released version.' }],
  };
  const before = await registry.resolveBundle(args);
  assert.equal(before.resolvedDependencies[0].resolvedVersion, 1);
  assert.equal(before.resolvedDependencies[0].content, '# Approved v1');
  release = 2;
  const after = await registry.resolveBundle(args);
  assert.equal(after.resolvedDependencies[0].resolvedVersion, 2);
  assert.equal(after.resolvedDependencies[0].content, '# Approved v2');
  assert.equal(after.resolvedDependencies[0].versionPolicy, 'latest_dojo_release');
  assert.equal((await registry.getPack({ id: 'test-cognition' })).pack.currentVersionNumber, 1);
});
