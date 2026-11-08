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
const createRegistry = (database) => registryModule.createRegistry({
  getDb: () => database, chatSkills, contextStore,
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
