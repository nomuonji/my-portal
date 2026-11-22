'use strict';

const { getDocumentDb, FieldValue } = require('./documentDb');
const DEFAULT_DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTIONS = Object.freeze({
  profiles: 'agentProfiles',
  profileVersions: 'agentProfileVersions',
  packs: 'intelligencePacks',
  packVersions: 'intelligencePackVersions',
});
const ID_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
const RESOURCE_TYPES = new Set([
  'chat_skill', 'hq_method', 'knowledge', 'intelligence_raw_document',
  'tool', 'policy', 'operator', 'context', 'external', 'exploration_base',
]);
const REQUIRED_CONTRIBUTION_FIELDS = [
  'findings', 'evidence', 'assumptions', 'counterevidence', 'uncertainty',
  'scope', 'dependencies', 'implications', 'nextValidation',
];

function database() {
  return getDocumentDb(DEFAULT_DATABASE_ID);
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object');
  }
  return value;
}
function text(value, max, label, required) {
  const result = value === undefined || value === null ? '' : String(value).trim().slice(0, max);
  if (required && !result) throw new Error(label + ' is required');
  return result;
}
function stringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength, 'array item', false)).filter(Boolean))].slice(0, maxItems);
}
function jsonSafe(value, depth) {
  const level = depth || 0;
  if (level > 9) throw new Error('Nested JSON exceeds maximum depth');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite');
    return value;
  }
  if (typeof value === 'string') return value.slice(0, 30000);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => jsonSafe(item, level + 1));
  if (typeof value === 'object') {
    const result = {};
    Object.entries(value).slice(0, 200).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
      const safeKey = text(key, 120, 'object key', true);
      result[safeKey] = jsonSafe(item, level + 1);
    });
    return result;
  }
  throw new Error('Only JSON-compatible values are allowed');
}
function requireId(value, label) {
  const id = text(value, 80, label, true);
  if (!ID_PATTERN.test(id)) throw new Error(label + ' must be lowercase kebab-case');
  return id;
}
function positiveVersion(value, label, optional) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new Error(label + ' must be a positive integer');
  return version;
}
function versionId(id, version) {
  return id + '__' + String(version).padStart(6, '0');
}
function snapshotValue(snapshot) {
  if (!snapshot || !snapshot.exists) return null;
  const value = snapshot.data();
  return { id: snapshot.id, ...value };
}
function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 100) throw new Error('At most 100 dependencies are allowed');
  return value.map((raw) => {
    const dep = object(raw, 'dependency');
    const resourceType = text(dep.resourceType, 60, 'dependency.resourceType', true);
    if (!RESOURCE_TYPES.has(resourceType)) throw new Error('Unsupported dependency resourceType: ' + resourceType);
    const canonicalRef = text(dep.canonicalRef, 500, 'dependency.canonicalRef', true);
    const requiredness = ['required', 'recommended', 'optional'].includes(dep.requiredness)
      ? dep.requiredness : 'recommended';
    return {
      resourceType,
      canonicalRef,
      // Shared Chat Skills are live references, not copied Pack snapshots.
      // Historical Pack versions retain their previous pins untouched.
      ...(resourceType === 'chat_skill'
        ? {} : { versionNumber: positiveVersion(dep.versionNumber, 'dependency.versionNumber', true) }),
      requiredness,
      when: text(dep.when, 800, 'dependency.when', false) || null,
      note: text(dep.note, 1000, 'dependency.note', false) || null,
    };
  });
}
function normalizePortfolio(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('intelligencePortfolio must contain at least one Intelligence Pack');
  if (value.length > 100) throw new Error('intelligencePortfolio supports at most 100 entries');
  const seen = new Set();
  return value.map((raw) => {
    const item = object(raw, 'intelligencePortfolio entry');
    const packId = requireId(item.packId, 'portfolio.packId');
    if (seen.has(packId)) throw new Error('Duplicate Intelligence Pack in portfolio: ' + packId);
    seen.add(packId);
    const availability = ['core', 'available'].includes(item.availability) ? item.availability : 'available';
    return {
      packId,
      versionNumber: positiveVersion(item.versionNumber, 'portfolio.versionNumber', true),
      availability,
      selectionHint: text(item.selectionHint, 800, 'portfolio.selectionHint', false) || null,
    };
  });
}
function cleanProfile(input) {
  const source = object(input, 'profile');
  const id = requireId(source.id, 'profile.id');
  const title = text(source.title || source.name, 220, 'profile.title', true);
  const identitySource = object(source.identity, 'profile.identity');
  const coreDefinition = text(identitySource.coreDefinition, 12000, 'identity.coreDefinition', true);
  if (coreDefinition.length < 20) throw new Error('identity.coreDefinition must contain at least 20 characters');
  const identity = jsonSafe(identitySource);
  identity.coreDefinition = coreDefinition;
  const composition = source.compositionPolicy && typeof source.compositionPolicy === 'object'
    ? jsonSafe(source.compositionPolicy) : {};
  const selectionPrinciples = stringArray(composition.selectionPrinciples, 40, 1000);
  if (!selectionPrinciples.length) {
    throw new Error('compositionPolicy.selectionPrinciples must contain at least one principle');
  }
  composition.minimumSufficientSet = composition.minimumSufficientSet !== false;
  composition.selectionPrinciples = selectionPrinciples;
  composition.iterationPolicy = text(composition.iterationPolicy, 2000, 'compositionPolicy.iterationPolicy', false) || 'Load the minimum sufficient set; add another Intelligence only when it can materially change the decision.';
  composition.conflictResolutionPrinciples = stringArray(composition.conflictResolutionPrinciples, 40, 1000);
  composition.synthesisPrinciples = stringArray(composition.synthesisPrinciples, 40, 1000);
  const resourceReferences = normalizeDependencies(source.resourceReferences);
  const status = ['active', 'paused', 'archived'].includes(source.status) ? source.status : 'active';
  return {
    schemaVersion: 1,
    id,
    title,
    summary: text(source.summary, 1400, 'profile.summary', false),
    purpose: text(source.purpose, 4000, 'profile.purpose', true),
    status,
    identity,
    intelligencePortfolio: normalizePortfolio(source.intelligencePortfolio),
    compositionPolicy: composition,
    resourceReferences,
  };
}
function cleanComponent(raw) {
  const component = object(raw, 'component');
  const id = requireId(component.id, 'component.id');
  return {
    id,
    title: text(component.title, 220, 'component.title', true),
    summary: text(component.summary, 1200, 'component.summary', false),
    purpose: text(component.purpose, 3000, 'component.purpose', false),
    loadWhen: stringArray(component.loadWhen, 30, 800),
    excludeWhen: stringArray(component.excludeWhen, 30, 800),
    worldModel: component.worldModel && typeof component.worldModel === 'object' ? jsonSafe(component.worldModel) : {},
    epistemology: component.epistemology && typeof component.epistemology === 'object' ? jsonSafe(component.epistemology) : {},
    reasoningProcedures: Array.isArray(component.reasoningProcedures) ? jsonSafe(component.reasoningProcedures) : [],
    evaluationCriteria: Array.isArray(component.evaluationCriteria) ? jsonSafe(component.evaluationCriteria) : [],
    contributionContract: component.contributionContract && typeof component.contributionContract === 'object'
      ? jsonSafe(component.contributionContract) : {},
    dependencies: normalizeDependencies(component.dependencies),
  };
}
function cleanPack(input) {
  const source = object(input, 'Intelligence Pack');
  const id = requireId(source.id, 'pack.id');
  const kind = ['atomic', 'composite'].includes(source.kind) ? source.kind : 'atomic';
  const components = Array.isArray(source.components) ? source.components.map(cleanComponent) : [];
  if (components.length > 30) throw new Error('At most 30 components are allowed per pack');
  if (kind === 'composite' && components.length === 0) throw new Error('Composite Packs require at least one component');
  const componentIds = new Set();
  components.forEach((item) => {
    if (componentIds.has(item.id)) throw new Error('Duplicate component id: ' + item.id);
    componentIds.add(item.id);
  });
  const inputContract = source.inputContract && typeof source.inputContract === 'object'
    ? jsonSafe(source.inputContract) : {};
  inputContract.requiredInputs = stringArray(inputContract.requiredInputs, 80, 300);
  inputContract.optionalInputs = stringArray(inputContract.optionalInputs, 80, 300);
  inputContract.validationRules = stringArray(inputContract.validationRules, 80, 1000);
  const contributionContract = source.contributionContract && typeof source.contributionContract === 'object'
    ? jsonSafe(source.contributionContract) : {};
  if (!Array.isArray(contributionContract.fields)) contributionContract.fields = REQUIRED_CONTRIBUTION_FIELDS.slice();
  return {
    schemaVersion: 1,
    id,
    title: text(source.title || source.name, 220, 'pack.title', true),
    summary: text(source.summary, 1400, 'pack.summary', false),
    purpose: text(source.purpose, 5000, 'pack.purpose', true),
    status: ['active', 'paused', 'archived'].includes(source.status) ? source.status : 'active',
    kind,
    scope: {
      includes: stringArray(source.scope?.includes, 80, 400),
      excludes: stringArray(source.scope?.excludes, 80, 400),
    },
    applicability: {
      taskSignals: stringArray(source.applicability?.taskSignals, 100, 240),
      evidenceNeeds: stringArray(source.applicability?.evidenceNeeds, 100, 240),
      constraints: stringArray(source.applicability?.constraints, 100, 400),
    },
    worldModel: source.worldModel && typeof source.worldModel === 'object' ? jsonSafe(source.worldModel) : {},
    epistemology: source.epistemology && typeof source.epistemology === 'object' ? jsonSafe(source.epistemology) : {},
    inputContract,
    reasoningProcedures: Array.isArray(source.reasoningProcedures) ? jsonSafe(source.reasoningProcedures) : [],
    evaluationCriteria: Array.isArray(source.evaluationCriteria) ? jsonSafe(source.evaluationCriteria) : [],
    contributionContract,
    knownLimits: stringArray(source.knownLimits, 100, 1000),
    failureModes: stringArray(source.failureModes, 100, 1000),
    dependencies: normalizeDependencies(source.dependencies),
    components,
  };
}

function createRegistry(options) {
  const opts = options || {};
  const getDb = opts.getDb || database;
  const chatSkills = opts.chatSkills || require('./chatContextRegistry');
  const contextStore = opts.contextStore || require('./contextStore');
  const explorationBases = opts.explorationBases || require('./explorationBaseStore');
  const submarines = opts.submarines || require('./submarineStore');
  const db = () => getDb();

  async function listProfiles(input) {
    const args = input || {};
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100);
    const scanLimit = Math.min(Math.max(Number(args.scanLimit) || 250, limit), 500);
    const query = text(args.query, 300, 'query', false).toLowerCase();
    const status = text(args.status, 20, 'status', false);
    const snap = await db().collection(COLLECTIONS.profiles).limit(scanLimit).get();
    const items = snap.docs.map((doc) => snapshotValue(doc))
      .filter((item) => (!status || item.status === status) && (!query
        || [item.title, item.summary, item.purpose, item.id].join('\n').toLowerCase().includes(query)))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
      .slice(0, limit);
    return { items, count: items.length, scanned: snap.size, collection: COLLECTIONS.profiles, databaseId: DEFAULT_DATABASE_ID };
  }

  async function getProfile(input) {
    const id = requireId(input?.id, 'profile.id');
    const root = snapshotValue(await db().collection(COLLECTIONS.profiles).doc(id).get());
    if (!root) throw new Error('Agent Profile not found: ' + id);
    const requestedVersion = positiveVersion(input?.versionNumber, 'versionNumber', true);
    const versionNumber = requestedVersion || Number(root.currentVersionNumber);
    if (!versionNumber) throw new Error('Agent Profile has no version');
    const version = snapshotValue(await db().collection(COLLECTIONS.profileVersions).doc(versionId(id, versionNumber)).get());
    if (!version || version.profileId !== id) throw new Error('Agent Profile version not found: ' + id + ' v' + versionNumber);
    return { profile: root, definition: version, databaseId: DEFAULT_DATABASE_ID };
  }

  async function createProfileVersion(input) {
    if (input?.confirm !== true) throw new Error('agent_profile_version_create requires confirm=true');
    const definition = cleanProfile(input.profile);
    const expected = Number(input.expectedCurrentVersion);
    if (!Number.isInteger(expected) || expected < 0) throw new Error('expectedCurrentVersion must be a nonnegative integer');
    const indexRef = db().collection(COLLECTIONS.profiles).doc(definition.id);
    const nextVersion = expected + 1;
    const versionRef = db().collection(COLLECTIONS.profileVersions).doc(versionId(definition.id, nextVersion));
    await db().runTransaction(async (tx) => {
      const rootSnapshot = await tx.get(indexRef);
      const versionSnapshot = await tx.get(versionRef);
      const current = rootSnapshot.exists ? rootSnapshot.data() : null;
      const currentVersion = Number(current?.currentVersionNumber) || 0;
      if (currentVersion !== expected) throw new Error('Agent Profile version conflict: expected ' + expected + ', current ' + currentVersion);
      if (current?.status === 'archived') throw new Error('Archived Agent Profiles cannot receive new versions');
      if (versionSnapshot.exists) throw new Error('Agent Profile version already exists; refusing to overwrite immutable version');
      const now = FieldValue.serverTimestamp();
      const record = {
        ...definition,
        profileId: definition.id,
        versionNumber: nextVersion,
        changeSummary: text(input.changeSummary, 2000, 'changeSummary', false) || (expected === 0 ? 'Initial version' : 'Profile revised'),
        createdAt: now,
      };
      tx.set(versionRef, record);
      const index = {
        id: definition.id,
        title: definition.title,
        summary: definition.summary,
        purpose: definition.purpose,
        status: definition.status,
        currentVersionNumber: nextVersion,
        versionCount: nextVersion,
        createdAt: current?.createdAt || now,
        updatedAt: now,
        schemaVersion: 1,
        kind: 'agent_profile',
      };
      if (rootSnapshot.exists) tx.update(indexRef, index);
      else tx.set(indexRef, index);
    });
    return getProfile({ id: definition.id });
  }

  async function listPacks(input) {
    const args = input || {};
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100);
    const scanLimit = Math.min(Math.max(Number(args.scanLimit) || 250, limit), 500);
    const query = text(args.query, 300, 'query', false).toLowerCase();
    const status = text(args.status, 20, 'status', false);
    const kind = text(args.kind, 20, 'kind', false);
    const snap = await db().collection(COLLECTIONS.packs).limit(scanLimit).get();
    const items = snap.docs.map((doc) => snapshotValue(doc))
      .filter((item) => (!status || item.status === status) && (!kind || item.kind === kind) && (!query
        || [item.title, item.summary, item.purpose, item.id, ...(item.taskSignals || [])].join('\n').toLowerCase().includes(query)))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
      .slice(0, limit);
    return { items, count: items.length, scanned: snap.size, collection: COLLECTIONS.packs, databaseId: DEFAULT_DATABASE_ID };
  }

  async function getPack(input) {
    const id = requireId(input?.id, 'pack.id');
    const root = snapshotValue(await db().collection(COLLECTIONS.packs).doc(id).get());
    if (!root) throw new Error('Intelligence Pack not found: ' + id);
    const requestedVersion = positiveVersion(input?.versionNumber, 'versionNumber', true);
    const versionNumber = requestedVersion || Number(root.currentVersionNumber);
    if (!versionNumber) throw new Error('Intelligence Pack has no version');
    const version = snapshotValue(await db().collection(COLLECTIONS.packVersions).doc(versionId(id, versionNumber)).get());
    if (!version || version.packId !== id) throw new Error('Intelligence Pack version not found: ' + id + ' v' + versionNumber);
    const result = {
      pack: root,
      definition: version,
      // Historical immutable Pack definitions remain unchanged; consumers
      // should read executionDependencies for the current effective version.
      executionDependencyPolicy: 'current_dojo_released_skill_else_registry_latest',
      databaseId: DEFAULT_DATABASE_ID,
    };
    if (input?.includeResolvedDependencies === true) {
      const refs = [
        ...(version.dependencies || []).map((dep) => ({ dep, componentId: null })),
        ...(version.components || []).flatMap((component) => (component.dependencies || [])
          .map((dep) => ({ dep, componentId: component.id }))),
      ];
      result.executionDependencies = await Promise.all(refs.map(async ({ dep, componentId }) => {
        if (dep.resourceType !== 'chat_skill')
          return { componentId, resourceType: dep.resourceType, canonicalRef: dep.canonicalRef,
            requiredness: dep.requiredness, declaredVersion: dep.versionNumber || null, versionPolicy: 'as_declared' };
        // This is a read-only dependency preview; it does not invoke tools.
        const current = await resolveDependency({ ...dep, requiredness: 'required' }, new Set());
        return { componentId, resourceType: dep.resourceType, canonicalRef: dep.canonicalRef,
          requiredness: dep.requiredness, declaredVersion: dep.versionNumber || null,
          resolvedVersion: current.resolvedVersion || null, versionPolicy: current.versionPolicy || null,
          loadState: current.loadState, ...(current.reason ? { reason: current.reason } : {}) };
      }));
    }
    return result;
  }

  async function createPackVersion(input) {
    if (input?.confirm !== true) throw new Error('intelligence_pack_version_create requires confirm=true');
    const definition = cleanPack(input.pack);
    const expected = Number(input.expectedCurrentVersion);
    if (!Number.isInteger(expected) || expected < 0) throw new Error('expectedCurrentVersion must be a nonnegative integer');
    const indexRef = db().collection(COLLECTIONS.packs).doc(definition.id);
    const nextVersion = expected + 1;
    const versionRef = db().collection(COLLECTIONS.packVersions).doc(versionId(definition.id, nextVersion));
    await db().runTransaction(async (tx) => {
      const rootSnapshot = await tx.get(indexRef);
      const versionSnapshot = await tx.get(versionRef);
      const current = rootSnapshot.exists ? rootSnapshot.data() : null;
      const currentVersion = Number(current?.currentVersionNumber) || 0;
      if (currentVersion !== expected) throw new Error('Intelligence Pack version conflict: expected ' + expected + ', current ' + currentVersion);
      if (current?.status === 'archived') throw new Error('Archived Intelligence Packs cannot receive new versions');
      if (versionSnapshot.exists) throw new Error('Intelligence Pack version already exists; refusing to overwrite immutable version');
      const now = FieldValue.serverTimestamp();
      const record = {
        ...definition,
        packId: definition.id,
        versionNumber: nextVersion,
        changeSummary: text(input.changeSummary, 2000, 'changeSummary', false) || (expected === 0 ? 'Initial version' : 'Pack revised'),
        createdAt: now,
      };
      tx.set(versionRef, record);
      const index = {
        id: definition.id,
        title: definition.title,
        summary: definition.summary,
        purpose: definition.purpose,
        status: definition.status,
        kind: definition.kind,
        taskSignals: definition.applicability.taskSignals.slice(0, 30),
        scopeLabels: definition.scope.includes.slice(0, 30),
        evidenceNeeds: definition.applicability.evidenceNeeds.slice(0, 30),
        currentVersionNumber: nextVersion,
        versionCount: nextVersion,
        createdAt: current?.createdAt || now,
        updatedAt: now,
        schemaVersion: 1,
        registryType: 'intelligence_pack',
      };
      if (rootSnapshot.exists) tx.update(indexRef, index);
      else tx.set(indexRef, index);
    });
    const result = await getPack({ id: definition.id });
    // A Pack trained in a 道場 is used at the version the 道場 released; say so to whoever just made a new one.
    try {
      const dojos = await explorationBases.trainersOf({ kind: 'intelligence_pack', id: definition.id });
      if (dojos.length) {
        result.dojos = dojos;
        result.dojoNotice = dojos.map((d) => 'このPackは道場「' + d.title + '」（' + d.baseId + '）で鍛えられている。実行で使うのは v' + d.releasedVersion
          + '。v' + nextVersion + ' は道場で合格させる（exploration_method_version_set, bodyRef.kind=intelligence_pack, versionNumber=' + nextVersion + '）まで実行には使われない。').join('\n');
      }
    } catch (error) { /* the notice is advisory */ }
    return result;
  }

  async function resolveDependency(dep, requested) {
    // A component explicitly selected by the agent is enough to activate its
    // recommended Chat Skills. Optional Skills, tools and external resources
    // remain opt-in, preserving the minimum-sufficient-load policy.
    const shouldLoad = dep.requiredness === 'required'
      || (dep.resourceType === 'chat_skill' && dep.requiredness === 'recommended')
      || requested.has(dep.resourceType + ':' + dep.canonicalRef);
    const base = {
      resourceType: dep.resourceType,
      canonicalRef: dep.canonicalRef,
      versionNumber: dep.versionNumber,
      requiredness: dep.requiredness,
      when: dep.when,
      note: dep.note,
      requested: shouldLoad,
    };
    if (!shouldLoad) return { ...base, loadState: 'not_requested' };
    try {
      if (dep.resourceType === 'chat_skill') {
        // Pack version pins describe the historical Pack definition, not the
        // execution dependency. Resolve shared Skills at execution time so
        // each consumer gets the current Skill without copying Pack versions.
        const trainers = await explorationBases.trainersOf({ kind: 'chat_skill', id: dep.canonicalRef });
        const released = [...new Set(trainers
          .map((dojo) => Number(dojo.releasedVersion))
          .filter((v) => Number.isInteger(v) && v > 0))];
        if (released.length > 1) throw new Error('Conflicting dojo Skill releases: ' + dep.canonicalRef);
        if (released.length) {
          // Exact document fetch works even after >30 revisions accumulate.
          const item = typeof chatSkills.skillVersionGet === 'function'
            ? await chatSkills.skillVersionGet({ id: dep.canonicalRef, versionNumber: released[0] })
            : (await chatSkills.skillVersions({ id: dep.canonicalRef })).items
              .find((entry) => Number(entry.versionNumber) === released[0]);
          if (!item) throw new Error('Dojo-released Chat Skill version unavailable: ' + dep.canonicalRef + ' v' + released[0]);
          return { ...base, resolvedVersion: item.versionNumber, versionPolicy: 'latest_dojo_release',
            title: item.title, loadState: 'loaded', content: item.body };
        }
        const item = await chatSkills.getSkill({ id: dep.canonicalRef });
        return { ...base, resolvedVersion: item.revision || null, versionPolicy: 'latest_registry_version',
          title: item.title, loadState: 'loaded', content: item.body };
      }
      if (dep.resourceType === 'hq_method') {
        const context = await contextStore.methodGetContext({ id: dep.canonicalRef, versionLimit: 50, runLimit: 1 });
        const available = context.versions || [];
        const selected = dep.versionNumber
          ? available.find((item) => Number(item.versionNumber) === dep.versionNumber)
          : context.currentVersion;
        if (!selected) throw new Error(dep.versionNumber ? 'Pinned HQ Method version not found' : 'HQ Method has no active version');
        if (selected.status && !['active', 'superseded'].includes(selected.status)) throw new Error('HQ Method version is not executable');
        return {
          ...base,
          resolvedVersion: selected.versionNumber,
          title: context.method?.title || dep.canonicalRef,
          loadState: 'loaded',
          content: {
            instructions: selected.instructions || '',
            protocol: selected.protocol || {},
            qualityGates: selected.qualityGates || [],
          },
        };
      }
      if (dep.resourceType === 'exploration_base') {
        const brief = await explorationBases.brief({ id: dep.canonicalRef });
        return { ...base, resolvedVersion: brief.base.revision, title: brief.base.title, loadState: 'loaded', content: brief };
      }
      return {
        ...base,
        loadState: 'reference_only',
        reason: 'This resource remains owned by its canonical external system; the resolver does not execute tools, grant permissions, or fetch arbitrary URLs.',
      };
    } catch (error) {
      return {
        ...base,
        loadState: 'unresolved',
        reason: String(error?.message || error).slice(0, 500),
      };
    }
  }

  // Derive a new immutable version from the current one by changing only dependencies or the portfolio.
  // The rest of the definition is copied server-side, so an agent never has to retype a long Pack or Profile.
  function sameDependency(dep, target) {
    return dep.resourceType === target.resourceType && dep.canonicalRef === target.canonicalRef
      && (target.versionNumber === undefined || target.versionNumber === null || dep.versionNumber === target.versionNumber);
  }
  async function derivePackVersion(input) {
    if (input?.confirm !== true) throw new Error('intelligence_pack_version_derive requires confirm=true');
    const current = await getPack({ id: input.id });
    const expected = Number(input.expectedCurrentVersion);
    if (current.pack.currentVersionNumber !== expected) throw new Error('Pack version conflict: current is ' + current.pack.currentVersionNumber);
    const rewrites = Array.isArray(input.dependencyRewrites) ? input.dependencyRewrites : [];
    if (!rewrites.length) throw new Error('dependencyRewrites must be a non-empty array');
    const used = rewrites.map(() => 0);
    const rewrite = (deps) => (deps || []).flatMap((dep) => {
      const index = rewrites.findIndex((entry) => sameDependency(dep, object(entry.from, 'dependencyRewrites.from')));
      if (index === -1) return [dep];
      used[index] += 1;
      if (rewrites[index].to === null || rewrites[index].to === undefined) return [];
      const to = object(rewrites[index].to, 'dependencyRewrites.to');
      return [{ requiredness: dep.requiredness, when: dep.when, note: dep.note, ...to }];
    });
    const definition = jsonSafe(current.definition);
    ['packId', 'versionNumber', 'changeSummary', 'createdAt'].forEach((key) => delete definition[key]);
    definition.dependencies = rewrite(definition.dependencies);
    definition.components = (definition.components || []).map((component) => ({ ...component, dependencies: rewrite(component.dependencies) }));
    const unused = rewrites.filter((_, index) => used[index] === 0).map((entry) => entry.from.resourceType + ':' + entry.from.canonicalRef);
    if (unused.length) throw new Error('No dependency matched: ' + unused.join(', '));
    const created = await createPackVersion({ pack: definition, expectedCurrentVersion: expected, changeSummary: input.changeSummary, confirm: true });
    return { pack: created.pack, versionNumber: created.definition.versionNumber, rewritten: used.reduce((sum, n) => sum + n, 0),
      dependencies: created.definition.dependencies,
      componentDependencies: (created.definition.components || []).map((c) => ({ id: c.id, dependencies: c.dependencies })) };
  }
  async function deriveProfileVersion(input) {
    if (input?.confirm !== true) throw new Error('agent_profile_version_derive requires confirm=true');
    const current = await getProfile({ id: input.id });
    const expected = Number(input.expectedCurrentVersion);
    if (current.profile.currentVersionNumber !== expected) throw new Error('Profile version conflict: current is ' + current.profile.currentVersionNumber);
    const updates = Array.isArray(input.portfolio) ? input.portfolio : [];
    if (!updates.length) throw new Error('portfolio must be a non-empty array');
    const definition = jsonSafe(current.definition);
    ['profileId', 'versionNumber', 'changeSummary', 'createdAt'].forEach((key) => delete definition[key]);
    let portfolio = definition.intelligencePortfolio || [];
    updates.forEach((raw) => {
      const update = object(raw, 'portfolio item');
      const existing = portfolio.find((entry) => entry.packId === update.packId);
      if (update.remove === true) {
        if (!existing) throw new Error('Portfolio has no Pack ' + update.packId);
        portfolio = portfolio.filter((entry) => entry.packId !== update.packId);
        return;
      }
      const next = { availability: 'available', ...(existing || {}), packId: update.packId };
      if ('versionNumber' in update) next.versionNumber = update.versionNumber;
      if (update.selectionHint !== undefined) next.selectionHint = update.selectionHint;
      if (!existing && !next.selectionHint) throw new Error('A new portfolio entry needs selectionHint: ' + update.packId);
      portfolio = existing ? portfolio.map((entry) => (entry.packId === update.packId ? next : entry)) : [...portfolio, next];
    });
    definition.intelligencePortfolio = portfolio;
    const created = await createProfileVersion({ profile: definition, expectedCurrentVersion: expected, changeSummary: input.changeSummary, confirm: true });
    return { profile: created.profile, versionNumber: created.definition.versionNumber, intelligencePortfolio: created.definition.intelligencePortfolio };
  }

  async function resolveBundle(input) {
    const args = input || {};
    const profileId = requireId(args.profileId, 'profileId');
    const profileResult = await getProfile({ id: profileId, versionNumber: args.profileVersionNumber });
    if (profileResult.profile.status !== 'active') throw new Error('Agent Profile is not active');
    const profileDefinition = profileResult.definition;
    const selections = Array.isArray(args.selectedIntelligences) ? args.selectedIntelligences : [];
    if (!selections.length || selections.length > 20) throw new Error('selectedIntelligences must contain 1 to 20 entries');
    const portfolio = new Map(profileDefinition.intelligencePortfolio.map((item) => [item.packId, item]));
    const chosenIds = new Set();
    const selectedPacks = [];
    for (const raw of selections) {
      const selection = object(raw, 'selectedIntelligence');
      const packId = requireId(selection.packId, 'selectedIntelligence.packId');
      if (chosenIds.has(packId)) throw new Error('Duplicate selected Intelligence Pack: ' + packId);
      chosenIds.add(packId);
      const portfolioEntry = portfolio.get(packId);
      if (!portfolioEntry) throw new Error('Selected Intelligence Pack is not in the Agent Profile portfolio: ' + packId);
      // A newer Registry revision may be a candidate awaiting approval from its
      // own dojo. The Bundle Resolver must not silently execute that draft.
      // Older explicit portfolio pins remain valid for regression comparisons.
      const trainers = await explorationBases.trainersOf({ kind: 'intelligence_pack', id: packId });
      const released = [...new Set(trainers.map((item) => Number(item.releasedVersion)).filter((n) => Number.isInteger(n) && n > 0))];
      if (released.length > 1) throw new Error('Conflicting dojo Pack releases for ' + packId);
      const approved = released[0] || null;
      const requestedVersion = selection.versionNumber || portfolioEntry.versionNumber || approved || undefined;
      if (approved && requestedVersion > approved) {
        throw new Error('Pack v' + requestedVersion + ' is not released by its dojo; use the released v' + approved + ': ' + packId);
      }
      const packResult = await getPack({ id: packId, versionNumber: requestedVersion });
      if (packResult.pack.status !== 'active') throw new Error('Intelligence Pack is not active: ' + packId);
      const definition = packResult.definition;
      if (portfolioEntry.versionNumber && Number(definition.versionNumber) !== portfolioEntry.versionNumber) {
        throw new Error('Selected Pack version violates the Agent Profile portfolio pin: ' + packId);
      }
      const componentIds = stringArray(selection.componentIds, 30, 80);
      let selectedDefinition = definition;
      if (definition.kind === 'composite') {
        if (!componentIds.length) throw new Error('Composite Intelligence Pack requires explicit componentIds: ' + packId);
        const componentMap = new Map(definition.components.map((item) => [item.id, item]));
        const selectedComponents = componentIds.map((id) => {
          const component = componentMap.get(id);
          if (!component) throw new Error('Unknown component ' + id + ' in Pack ' + packId);
          return component;
        });
        selectedDefinition = { ...definition, components: selectedComponents };
      } else if (componentIds.length) {
        throw new Error('Atomic Intelligence Pack does not accept componentIds: ' + packId);
      }
      const rationale = text(selection.selectionRationale, 1000, 'selectionRationale', true);
      if (rationale.length < 8) throw new Error('selectionRationale must contain at least 8 characters');
      selectedPacks.push({
        packId,
        versionNumber: definition.versionNumber,
        selectionRationale: rationale,
        loadLevel: ['summary', 'full'].includes(selection.loadLevel) ? selection.loadLevel : 'full',
        definition: selectedDefinition,
      });
    }

    const requested = new Set(stringArray(args.selectedDependencies, 100, 600));
    const dependencyGroups = new Map();
    const dependencySources = [
      ...(profileDefinition.resourceReferences || []),
      ...selectedPacks.flatMap((selected) => [
        ...(selected.definition.dependencies || []),
        ...(selected.definition.components || []).flatMap((component) => component.dependencies || []),
      ]),
    ];
    const requirednessRank = { optional: 1, recommended: 2, required: 3 };
    for (const declared of dependencySources) {
      // Old immutable Pack definitions may pin different revisions of the
      // same shared Skill. Those pins are advisory history in normal execution;
      // never treat them as a runtime conflict or a reason to load stale code.
      const dep = declared.resourceType === 'chat_skill'
        ? { ...declared, versionNumber: null } : declared;
      const key = dep.resourceType + ':' + dep.canonicalRef;
      const previous = dependencyGroups.get(key);
      if (!previous) {
        dependencyGroups.set(key, { ...dep, versionConflict: false });
        continue;
      }
      const versions = [previous.versionNumber, dep.versionNumber].filter((value) => value !== null && value !== undefined);
      const distinctVersions = [...new Set(versions.map(Number))];
      dependencyGroups.set(key, {
        ...previous,
        versionNumber: distinctVersions.length === 1 ? distinctVersions[0] : (distinctVersions.length > 1 ? null : null),
        versionConflict: previous.versionConflict || distinctVersions.length > 1,
        requiredness: requirednessRank[dep.requiredness] > requirednessRank[previous.requiredness] ? dep.requiredness : previous.requiredness,
        when: [...new Set([previous.when, dep.when].filter(Boolean))].join(' / ') || null,
        note: [...new Set([previous.note, dep.note].filter(Boolean))].join(' / ') || null,
      });
    }
    const resolvedDependencies = [];
    for (const dep of dependencyGroups.values()) {
      if (dep.versionConflict) {
        resolvedDependencies.push({
          resourceType: dep.resourceType,
          canonicalRef: dep.canonicalRef,
          requiredness: dep.requiredness,
          requested: dep.requiredness === 'required' || requested.has(dep.resourceType + ':' + dep.canonicalRef),
          loadState: 'unresolved',
          reason: 'Conflicting pinned versions were requested by the selected Profile/Pack dependencies.',
        });
      } else {
        resolvedDependencies.push(await resolveDependency(dep, requested));
      }
    }
    // reference_only means the resource is owned elsewhere and the agent reads it there; that is by design, not a gap.
    const unresolvedGaps = resolvedDependencies.filter((item) => item.requiredness === 'required' && item.loadState !== 'loaded' && item.loadState !== 'reference_only')
      .map((item) => ({ resourceType: item.resourceType, canonicalRef: item.canonicalRef, reason: item.reason || 'Required dependency is not loaded' }));
    const externalReferences = resolvedDependencies.filter((item) => item.loadState === 'reference_only')
      .map((item) => ({ resourceType: item.resourceType, canonicalRef: item.canonicalRef, requiredness: item.requiredness, when: item.when || '', note: item.note || '' }));
    const taskFrame = jsonSafe(object(args.taskFrame, 'taskFrame'));
    if (!taskFrame.objective && !taskFrame.userRequest) throw new Error('taskFrame.objective or taskFrame.userRequest is required');
    const plan = args.compositionPlan && typeof args.compositionPlan === 'object' ? jsonSafe(args.compositionPlan) : {};
    return {
      schemaVersion: 1,
      bundleType: 'resolved_cognitive_bundle',
      hostNeutral: true,
      ephemeral: true,
      taskFrame,
      agentProfile: {
        id: profileId,
        versionNumber: profileDefinition.versionNumber,
        title: profileDefinition.title,
        identity: profileDefinition.identity,
        compositionPolicy: profileDefinition.compositionPolicy,
      },
      selectedIntelligences: selectedPacks.map((item) => ({
        id: item.packId,
        versionNumber: item.versionNumber,
        selectionRationale: item.selectionRationale,
        loadLevel: item.loadLevel,
        definition: item.loadLevel === 'summary' ? {
          id: item.definition.id,
          title: item.definition.title,
          summary: item.definition.summary,
          purpose: item.definition.purpose,
          kind: item.definition.kind,
          scope: item.definition.scope,
          applicability: item.definition.applicability,
          components: (item.definition.components || []).map((component) => ({
            id: component.id, title: component.title, summary: component.summary, purpose: component.purpose,
            loadWhen: component.loadWhen, excludeWhen: component.excludeWhen,
          })),
        } : item.definition,
      })),
      resolvedDependencies,
      compositionPlan: plan,
      unresolvedGaps,
      externalReferences,
      knownConflicts: Array.isArray(args.knownConflicts) ? jsonSafe(args.knownConflicts) : [],
      provenance: {
        resolverContractVersion: '1.0.0',
        profileVersion: profileDefinition.versionNumber,
        packVersions: selectedPacks.map((item) => ({ id: item.packId, versionNumber: item.versionNumber })),
        createdAt: new Date().toISOString(),
      },
      executionBoundary: {
        resolverOwns: ['exact-version-validation', 'dependency-reference-resolution', 'bundle-assembly'],
        resolverDoesNotOwn: ['intelligence-selection', 'reasoning-execution', 'tool-execution', 'run-management', 'host-adaptation'],
      },
    };
  }

  // One read-only graph across the actual Registry and active dojos.
  // Text-only Skill references are intentionally not presented as executable
  // dependencies; they need separate structured declarations before use.
  async function dependencyAudit(input) {
    const args = input || {};
    const [packList, profileList, dojoList, skillList, fleetList] = await Promise.all([
      listPacks({ status: 'active', limit: 100, scanLimit: 500 }),
      listProfiles({ status: 'active', limit: 100, scanLimit: 500 }),
      explorationBases.list({ status: 'active' }),
      chatSkills.listSkills(),
      submarines.list({ status: 'active' }),
    ]);
    const dojos = dojoList.items || [];
    const skills = skillList.items || [];
    const skillIndex = new Map(skills.map((item) => [item.id, item]));
    const releaseByTarget = new Map();
    const nodes = [];
    const edges = [];
    const warnings = [];
    const profiles = await Promise.all((profileList.items || []).map((item) => getProfile({ id: item.id })));
    const offeredPacks = new Set();
    for (const profile of profiles) {
      nodes.push({ type: 'agent_profile', id: profile.profile.id, version: profile.definition.versionNumber });
      for (const entry of profile.definition.intelligencePortfolio || []) {
        offeredPacks.add(entry.packId);
        edges.push({ type: 'offers_pack', from: 'agent_profile:' + profile.profile.id,
          to: 'intelligence_pack:' + entry.packId, declaredVersion: entry.versionNumber || null });
      }
    }
    for (const base of dojos) {
      nodes.push({ type: 'dojo', id: base.id, title: base.title,
        rated: base.loop?.rated || 0, pass: base.loop?.pass || 0,
        passRate: base.loop?.passRate ?? null });
      if (base.target?.kind && base.target?.id) {
        const key = base.target.kind + ':' + base.target.id;
        const releases = releaseByTarget.get(key) || [];
        releases.push(Number(base.target.versionNumber) || null);
        releaseByTarget.set(key, releases);
        edges.push({ type: 'trains', from: 'dojo:' + base.id, to: key,
          releasedVersion: base.target.versionNumber || null });
      }
      for (const ref of base.packRefs || [])
        edges.push({ type: 'uses_pack', from: 'dojo:' + base.id,
          to: 'intelligence_pack:' + ref.packId, role: ref.role || '' });
    }
    const currentRelease = (kind, id) => {
      const values = releaseByTarget.get(kind + ':' + id) || [];
      const distinct = [...new Set(values.filter((v) => Number.isInteger(v) && v > 0))];
      if (distinct.length > 1 || (values.length && !distinct.length)) {
        warnings.push({ type: 'release_conflict_or_missing', resource: kind + ':' + id, values });
        return null;
      }
      return distinct[0] || null;
    };
    for (const skill of skills) {
      const approved = currentRelease('chat_skill', skill.id);
      nodes.push({ type: 'chat_skill', id: skill.id, registryVersion: skill.revision,
        executableVersion: approved || skill.revision,
        approval: approved ? 'dojo_released' : 'registry_latest' });
    }
    let historicalSkillPins = 0;
    const referenced = new Set();
    for (const item of packList.items || []) {
      const approved = currentRelease('intelligence_pack', item.id);
      const version = approved || item.currentVersionNumber;
      nodes.push({ type: 'intelligence_pack', id: item.id,
        registryVersion: item.currentVersionNumber, executableVersion: version,
        approval: approved ? 'dojo_released' : 'registry_latest',
        inAgentProfile: offeredPacks.has(item.id) });
      if (!offeredPacks.has(item.id))
        warnings.push({ type: 'pack_not_selectable', packId: item.id });
      if (approved && item.currentVersionNumber > approved)
        warnings.push({ type: 'unreleased_pack_candidate', packId: item.id,
          latest: item.currentVersionNumber, released: approved });
      const pack = await getPack({ id: item.id, versionNumber: version });
      const links = [
        ...(pack.definition.dependencies || []).map((dep) => ({ dep, componentId: null })),
        ...(pack.definition.components || []).flatMap((component) =>
          (component.dependencies || []).map((dep) => ({ dep, componentId: component.id }))),
      ];
      for (const { dep, componentId } of links) {
        if (dep.resourceType !== 'chat_skill') continue;
        referenced.add(dep.canonicalRef);
        const skill = skillIndex.get(dep.canonicalRef);
        const target = currentRelease('chat_skill', dep.canonicalRef);
        const old = dep.versionNumber || null;
        if (old && skill && old !== skill.revision) historicalSkillPins++;
        edges.push({ type: 'uses_skill', from: 'intelligence_pack:' + item.id,
          to: 'chat_skill:' + dep.canonicalRef,
          componentId, requiredness: dep.requiredness,
          autoLoad: dep.requiredness !== 'optional',
          declaredVersion: old, resolvedVersion: target || skill?.revision || null,
          versionPolicy: target ? 'dojo_released' : 'registry_latest' });
        if (!skill) warnings.push({ type: 'missing_skill', packId: item.id, skillId: dep.canonicalRef });
      }
    }
    const fleet = fleetList.items || [];
    for (const boat of fleet) {
      nodes.push({ type: 'submarine', id: boat.id, title: boat.title || boat.name || boat.id });
      for (const gear of boat.loadout || []) {
        const targetType = gear.kind;
        if (!['chat_skill', 'intelligence_pack'].includes(targetType)) continue;
        edges.push({ type: 'carries', from: 'submarine:' + boat.id,
          to: targetType + ':' + gear.id, role: gear.role || null,
          dojoId: gear.dojoId || null, resolvedVersion: gear.version || null });
        const approved = currentRelease(targetType, gear.id);
        if (approved && gear.dojoId && Number(gear.version) !== approved)
          warnings.push({ type: 'gear_version_mismatch', submarineId: boat.id,
            resource: targetType + ':' + gear.id,
            released: approved, loaded: gear.version || null });
      }
    }
    if (args.includeBodyReferences === true) {
      const skillIds = new Set(skillIndex.keys());
      const trained = skills.filter((item) => releaseByTarget.has('chat_skill:' + item.id));
      for (const item of trained) {
        // These are hints, not execution dependencies. Quoted names in prose
        // cannot be promoted to authoritative dependency declarations.
        const body = (await chatSkills.getSkill({ id: item.id })).body || '';
        const matches = [...body.matchAll(/`([a-z][a-z0-9-]{2,})`/g)]
          .map((match) => match[1]).filter((id) => id !== item.id && skillIds.has(id));
        for (const target of [...new Set(matches)].slice(0, 20))
          edges.push({ type: 'body_reference_unverified', from: 'chat_skill:' + item.id,
            to: 'chat_skill:' + target, autoLoad: false });
      }
    }
    return {
      asOf: new Date().toISOString(),
      nodes,
      edges,
      warnings,
      summary: {
        activeDojos: dojos.length, activePacks: (packList.items || []).length,
        activeSubmarines: fleet.length,
        availableSkills: skills.length, packsSelectable: offeredPacks.size,
        skillDependencies: edges.filter((item) => item.type === 'uses_skill').length,
        uniqueSkillsInPacks: referenced.size,
        skillsNotReferencedByPacks: skills.filter((item) => !referenced.has(item.id)).map((item) => item.id),
        historicalSkillPins, warningCount: warnings.length,
      },
      boundaries: ['Body references are observations, not enforced dependencies.',
        'A registered Skill may legitimately run standalone without a Pack.',
        'Human acceptance and observed commercial outcomes are not inferred from graph connectivity.'],
    };
  }

  // Cross-dojo retrieval on *the next actual training run*, not a scheduled job.
  // Findings are evidence for a receiver-side hypothesis; never auto-credit
  // another dojo's pass as a receiver's pass, or overwrite its Skill/Pack.
  async function crossDojoLearning(input) {
    const targetId = requireId(input?.targetBaseId, 'targetBaseId');
    const limit = Math.min(Math.max(Number(input?.limit) || 5, 1), 10);
    const active = (await explorationBases.list({ status: 'active' })).items || [];
    const target = active.find((base) => base.id === targetId);
    if (!target) throw new Error('Active receiver dojo not found: ' + targetId);
    const targetRef = target.target || {};
    const targetSkills = new Set();
    const targetBodyLinks = new Set();
    if (targetRef.kind === 'chat_skill') {
      targetSkills.add(targetRef.id);
      const skill = typeof chatSkills.getExecutableSkill === 'function'
        ? await chatSkills.getExecutableSkill({ id: targetRef.id })
        : await chatSkills.getSkill({ id: targetRef.id });
      const body = skill.body || '';
      const refs = [...body.matchAll(/`([a-z][a-z0-9-]{2,})`/g)].map((match) => match[1]);
      for (const ref of refs) targetBodyLinks.add(ref);
    } else if (targetRef.kind === 'intelligence_pack') {
      const pack = await getPack({ id: targetRef.id, versionNumber: targetRef.versionNumber });
      for (const dep of [
        ...(pack.definition.dependencies || []),
        ...(pack.definition.components || []).flatMap((component) => component.dependencies || []),
      ]) if (dep.resourceType === 'chat_skill') targetSkills.add(dep.canonicalRef);
    }
    const targetPacks = new Set((target.packRefs || []).map((ref) => ref.packId)
      .filter((id) => id !== 'exploration-operations'));
    const candidates = [];
    for (const base of active) {
      if (base.id === targetId || !base.target?.id) continue;
      const reasons = [];
      if (targetBodyLinks.has(base.target.id))
        reasons.push('receiver_skill_explicit_body_reference');
      if (targetSkills.has(base.target.id))
        reasons.push('receiver_pack_skill_dependency');
      for (const item of base.packRefs || [])
        if (targetPacks.has(item.packId))
          reasons.push('shared_specialist_pack:' + item.packId);
      if (!reasons.length) continue;
      candidates.push({ base, reasons, score:
        reasons.reduce((n, reason) => n + (reason === 'receiver_skill_explicit_body_reference' ? 5
          : reason === 'receiver_pack_skill_dependency' ? 4 : 2), 0) });
    }
    candidates.sort((a, b) => b.score - a.score || a.base.id.localeCompare(b.base.id));
    const sources = await Promise.all(candidates.slice(0, limit).map(async ({ base, reasons, score }) => {
      const view = await explorationBases.brief({ id: base.id });
      const learning = view.loop?.learning || {};
      const samples = (arr) => (arr || []).slice(0, 3).map((item) => ({
        trialId: item.id, label: item.label || '', version: item.version || null,
        hypothesisIds: item.hypothesisIds || [],
        textExcerpt: String(item.body || '').slice(0, 700),
      }));
      return {
        sourceBaseId: base.id, sourceTitle: base.title, sourceTarget: base.target,
        connectionReasons: reasons, relevanceScore: score,
        sourceStatus: learning.status || 'unknown',
        acceptedCount: learning.acceptedCount || 0,
        rejectedCount: learning.rejectedCount || 0,
        accepted: samples(learning.acceptedCases),
        rejected: samples(learning.rejectedCases),
        contrastPairs: (learning.contrastPairs || []).slice(0, 4).map((pair) => ({
          positiveId: pair.positiveId, negativeId: pair.negativeId,
          commonHypothesisIds: pair.commonHypothesisIds || [],
        })),
        evidenceStatus: 'source_user_feedback_only_not_receiver_validated',
      };
    }));
    return {
      receiver: { id: target.id, title: target.title, target: target.target,
        awaitings: target.awaitingCount || 0,
        currentVersionRated: target.loop?.currentRated || 0,
        currentPassRate: target.loop?.currentPassRate ?? null },
      sources,
      count: sources.length,
      transferContract: {
        stage: 'hypothesis_only',
        beforeUse: ['Read source accepted and rejected original cases, not just their labels',
          'Extract the mechanism, applicability conditions and counterexamples',
          'Design one controlled receiver-side trial with a competing hypothesis',
          'Keep actual user verdict and predicted pass in the receiver dojo ledger'],
        prohibited: ['Treat source dojo approval as receiver approval',
          'Change an unapproved Skill or Pack version without the receiver dojo release gate',
          'Schedule a synchronization or training job'],
      },
      missingLinksNotice: !sources.length
        ? 'No structurally supported neighbor found; do not invent a transfer connection.' : null,
    };
  }

  async function bootstrapInitialPack(input) {
    if (input?.confirm !== true) throw new Error('agent_intelligence_bootstrap requires confirm=true');
    const current = await db().collection(COLLECTIONS.packs).doc(INITIAL_PACK.id).get();
    if (current.exists) return { created: false, reason: 'Initial Intelligence Pack already exists', result: await getPack({ id: INITIAL_PACK.id }) };
    const result = await createPackVersion({
      pack: INITIAL_PACK,
      expectedCurrentVersion: 0,
      changeSummary: 'Initial Marketing & Creative Cognition Composite Pack derived from the approved specification',
      confirm: true,
    });
    return { created: true, result };
  }

  return {
    listProfiles,
    getProfile,
    createProfileVersion,
    listPacks,
    getPack,
    createPackVersion,
    derivePackVersion,
    deriveProfileVersion,
    resolveBundle,
    dependencyAudit,
    crossDojoLearning,
    bootstrapInitialPack,
  };
}

const INITIAL_PACK = {
  id: 'marketing-creative-cognition',
  title: 'Marketing & Creative Cognition',
  summary: 'Composite Intelligence for evidence-led market understanding, audience behavior, creative and intellectual transformation, distribution/commercial fit, and experimentation.',
  purpose: '市場の実態、受け手の具体的な状況、文化・コンテンツ、流通・取引の証拠を往復し、目的に合う企画や知的コンテンツへの変換を行い、必要なときは小規模な実験で検証する。ReachとRevenueを分離し、ユーザー個人の好みを市場需要の証拠にしない。',
  status: 'active',
  kind: 'composite',
  scope: {
    includes: ['market-research', 'business-ideas', 'audience-behavior', 'creative-ideation', 'intellectual-translation', 'content-strategy', 'distribution', 'commercial-fit', 'experimentation'],
    excludes: ['pure execution procedures', 'tool execution authorization', 'unrequested market research for personal creative tasks'],
  },
  applicability: {
    taskSignals: ['market research', 'business opportunity discovery', 'content ideation', 'creative concept', 'intellectual translation', 'audience fit', 'distribution strategy', 'commercial validation', 'experiment design'],
    evidenceNeeds: ['source-backed market observations', 'audience behavior evidence', 'primary-source fidelity', 'distribution and conversion evidence', 'measured outcomes'],
    constraints: ['host independent', 'do not force all components to load', 'do not conflate reach with revenue', 'do not use personal taste as market evidence'],
  },
  worldModel: {
    entities: ['market', 'offer', 'audience situation', 'content artifact', 'platform', 'distribution surface', 'transaction', 'experiment'],
    variables: ['demand', 'supply', 'attention', 'comprehension', 'retention', 'sharing', 'utility', 'friction', 'price', 'conversion', 'revenue', 'rights', 'evidence quality'],
    relationships: [
      'distribution creates opportunities for exposure but does not prove demand or revenue',
      'audience response depends on situation, motivation, attention and cognitive cost, not demographics alone',
      'creative novelty must remain connected to a comprehensible audience foothold',
      'conversion depends on a traceable path from traffic source through content and landing page to an actual action',
      'measured outcomes update hypotheses but do not automatically rewrite the Intelligence definition',
    ],
  },
  epistemology: {
    evidenceLabels: ['OBSERVED', 'REPORTED', 'INFERRED', 'HYPOTHESIS', 'COUNTEREVIDENCE', 'UNKNOWN'],
    rules: [
      'Label seller claims and third-party observations separately.',
      'A listing proves that an offer was listed, not that it sold or generated profit.',
      'Keep source dates, sample definitions and metrics with each evidence item.',
      'Do not generalize search or platform metrics to the entire market.',
      'Keep forecasts and AI evaluation scores separate from measured outcomes.',
      'Preserve unresolved disagreement instead of forcing consensus.',
    ],
    hierarchy: ['primary transaction or platform records', 'official provider terms and pricing', 'independent observed evidence', 'reported claims', 'inference', 'hypothesis'],
  },
  inputContract: {
    requiredInputs: ['taskFrame.objective or taskFrame.userRequest'],
    optionalInputs: ['audience context', 'source material', 'target channel', 'offer/product', 'success criteria', 'constraints'],
    validationRules: ['Distinguish explicit requirements from inferred assumptions.', 'Do not load unrelated components.', 'Keep private user taste separate from public-market evidence.'],
  },
  reasoningProcedures: [
    'Fix objective, deliverable, constraints and success criteria before choosing components.',
    'For market-dependent tasks, observe independent real examples, ordinary examples and failure cases before ideating.',
    'Model the audience through concrete situations and behavior, and label unknown variables.',
    'Generate multiple independent creative mechanisms from source material; preserve original propositions and nuance when translating intellectual content.',
    'Recheck concepts against market reality, platform rules, rights and commercial constraints when relevant.',
    'Design small tests with defined metrics, denominators, baselines, comparison groups, windows and stopping rules when measurement is an objective.',
  ],
  evaluationCriteria: [
    'evidence quality and independence',
    'fit to the stated objective and constraints',
    'audience comprehension and relevance',
    'originality without surface copying',
    'separation of reach, retention, sharing, utility, conversion and revenue',
    'traceability of distribution and commercial claims',
    'factual, legal, privacy and platform integrity',
  ],
  contributionContract: {
    fields: REQUIRED_CONTRIBUTION_FIELDS,
    evidenceFields: ['source', 'date', 'sample', 'metric', 'evidenceLabel'],
    never: ['fabricated citations', 'fake quotations', 'forced consensus', 'unmeasured performance claims'],
  },
  knownLimits: [
    'Public post counts, search indices and reviews do not represent all market behavior.',
    'Platform metric definitions and ranking systems can change.',
    'Samples may be biased and paid reach may differ from organic distribution.',
    'Sales may be unobservable from public information.',
    'Rights and reuse permissions depend on the specific asset and terms.',
    'Small experiments may be underpowered or confounded.',
  ],
  failureModes: [
    'Generating generic ideas from model priors instead of real source material.',
    'Treating listings, impressions or search demand as proof of sales.',
    'Using demographics as fixed personality types.',
    'Forcing market research into a pure creative task.',
    'Changing the meaning of a source idea to improve virality.',
    'Using AI scores as a proxy for real business outcomes.',
  ],
  dependencies: [],
  components: [
    {
      id: 'market-reality-evidence',
      title: 'Market Reality & Evidence',
      summary: 'Observe actual market conditions, concrete targets, supply, demand signals, offers, competitors, transactions and counterevidence.',
      purpose: '市場依存の課題では、既存案や個人の嗜好より先に実在する対象と証拠を観測する。対象、母集団、期間、観測値、独立ソース、反証、UNKNOWNを区別する。',
      loadWhen: ['market research', 'business opportunity', 'competitor or offer research', 'current platform or pricing claims'],
      excludeWhen: ['pure creative transformation with supplied source material', 'tasks that do not depend on external market facts'],
      worldModel: { entities: ['target', 'market cluster', 'supplier', 'buyer', 'offer', 'competitor', 'transaction'], variables: ['demand', 'supply', 'price', 'purchase trigger', 'competition', 'evidence quality'] },
      epistemology: { evidenceLabels: ['OBSERVED', 'REPORTED', 'INFERRED', 'HYPOTHESIS', 'COUNTEREVIDENCE', 'UNKNOWN'], rule: 'A listing is not evidence of a sale; independent corroboration must be distinguished from seller claims.' },
      reasoningProcedures: ['Observe concrete examples and ordinary/failure cases.', 'Capture target, sample, time window, source and metric.', 'Trace claims to primary and independent evidence.', 'Keep gaps and contrary evidence visible.'],
      evaluationCriteria: ['source independence', 'recency', 'sample comparability', 'transaction evidence', 'counterevidence coverage'],
      dependencies: [
        { resourceType: 'hq_method', canonicalRef: '9vuhwfnjJZROreCVHXTb', versionNumber: 6, requiredness: 'required', when: 'Market discovery and market-dependent opportunity exploration' },
        { resourceType: 'chat_skill', canonicalRef: 'market-research-orchestrator', versionNumber: 21, requiredness: 'recommended', when: 'Only when research spans multiple specialist Operators' },
      ],
    },
    {
      id: 'audience-situation-behavior',
      title: 'Audience Situation & Behavior',
      summary: 'Model concrete audience situations, motivations, attention, comprehension, social use, choice cues, friction and alternatives.',
      purpose: '属性ステレオタイプではなく、状況・課題・知識・動機・注意・感情報酬・認知コスト・社会的利用・選択手掛かり・購買摩擦・代替行動から受け手の行動をモデル化する。',
      loadWhen: ['audience response matters', 'content reach or retention', 'sharing, saving, utility or purchase behavior'],
      excludeWhen: ['private creative task with no audience-fit objective', 'mechanical transformation with no audience assumption'],
      worldModel: { entities: ['person in a situation', 'task', 'social context', 'choice', 'alternative'], variables: ['knowledge', 'motivation', 'attention', 'cognitive cost', 'emotional reward', 'friction'] },
      epistemology: { rule: 'Unobserved audience variables remain UNKNOWN; never turn broad demographic labels into fixed personality claims.' },
      reasoningProcedures: ['Describe the concrete situation and trigger.', 'Identify desired progress, friction and alternatives.', 'Model attention and comprehension costs.', 'Keep behavior claims distinct from inferred motivations.'],
      evaluationCriteria: ['situational specificity', 'evidence for motivations', 'audience comprehension', 'alternative behavior coverage'],
      dependencies: [
        { resourceType: 'chat_skill', canonicalRef: 'baka-culture-content-engine', versionNumber: 6, requiredness: 'recommended', when: 'When mass-consumer behavior and reach/conversion distinctions are relevant' },
      ],
    },
    {
      id: 'creative-intellectual-transformation',
      title: 'Creative & Intellectual Transformation',
      summary: 'Extract creative mechanisms from real material and translate intellectual content while preserving its central proposition, reasoning, conditions and nuance.',
      purpose: '実在素材・通常の見方・具体的観察から発想操作を抽出して遠距離転用する。知的内容は中心命題・論理・条件・反論・壊してはいけないニュアンスを保ちながら生活経験・文化・ネット・物語・映像へ変換する。',
      loadWhen: ['ideation', 'creative concept development', 'intellectual explanation or translation', 'story/video adaptation'],
      excludeWhen: ['pure factual retrieval with no transformation', 'simple data lookup'],
      worldModel: { entities: ['source material', 'central proposition', 'reasoning chain', 'audience foothold', 'new expression'], variables: ['novelty', 'comprehensibility', 'semantic fidelity', 'distance from source', 'assumptions added'] },
      epistemology: { rule: 'Do not fabricate quotations or change the source meaning; distinguish simplification from distortion.' },
      reasoningProcedures: ['Extract the source thesis, logic, conditions, objections and nuance.', 'Abstract the generative mechanism rather than copy surface features.', 'Generate multiple independent transfer paths.', 'Audit semantic loss and added assumptions.'],
      evaluationCriteria: ['source fidelity', 'non-obvious transfer', 'audience foothold', 'novelty without imitation'],
      dependencies: [
        { resourceType: 'hq_method', canonicalRef: 'dG3Ww6TungxgULbru7is', versionNumber: 3, requiredness: 'required', when: 'Creative mechanism abstraction and long-distance transfer' },
        { resourceType: 'hq_method', canonicalRef: 'Ztp6HGMO0WGHcZ2sk0JO', versionNumber: 1, requiredness: 'recommended', when: 'When choosing concepts for resonance, originality and audience fit' },
        { resourceType: 'chat_skill', canonicalRef: 'primary-source-writing-gate', versionNumber: 2, requiredness: 'recommended', when: 'When factual claims or source-based explanatory writing are part of the deliverable' },
        { resourceType: 'chat_skill', canonicalRef: 'quantitative-content-transposition', versionNumber: 2, requiredness: 'optional', when: 'When meaningful quantitative data is transformed into substantial content' },
      ],
    },
    {
      id: 'distribution-commercial-fit',
      title: 'Distribution & Commercial Fit',
      summary: 'Validate real distribution surfaces and the chain from traffic source through content and landing page to application or purchase.',
      purpose: '媒体・配信面・コミュニティ・検索・紹介経路・販路を実例と規約で検証し、流入元→コンテンツ→クリック→LP→申込/購入の連鎖を追う。ReachをRevenueの代理にしない。',
      loadWhen: ['distribution strategy', 'acquisition channel research', 'offer, affiliate or sales validation'],
      excludeWhen: ['pure creative transformation or translation with no distribution/revenue objective'],
      worldModel: { entities: ['traffic source', 'content', 'click', 'landing page', 'offer', 'application', 'purchase'], variables: ['reach', 'click-through', 'eligibility', 'friction', 'conversion', 'revenue'] },
      epistemology: { rule: 'A channel existing does not prove it can deliver qualified traffic; a click does not prove a purchase.' },
      reasoningProcedures: ['Identify real traffic sources and posting/link policies.', 'Trace each step to the desired action.', 'Verify offer terms, eligibility, pricing and friction.', 'Separate reach metrics from transaction outcomes.'],
      evaluationCriteria: ['source verification', 'policy compatibility', 'traceable funnel', 'evidence of actual purchase or application'],
      dependencies: [
        { resourceType: 'chat_skill', canonicalRef: 'traffic-distribution-discovery', versionNumber: 8, requiredness: 'recommended', when: 'When discovering communities, traffic sources or external-link routes' },
        { resourceType: 'chat_skill', canonicalRef: 'product-affiliate-discovery', versionNumber: 7, requiredness: 'optional', when: 'When product, affiliate eligibility, ASP terms or purchase validation are in scope' },
        { resourceType: 'chat_skill', canonicalRef: 'short-form-video-direction', versionNumber: 6, requiredness: 'optional', when: 'Downstream production skill when the requested deliverable is a short-form video' },
      ],
    },
    {
      id: 'experiment-measurement',
      title: 'Experiment, Measurement & Integrity',
      summary: 'Design and interpret experiments with explicit metrics, denominators, baselines, comparison groups, windows, stopping rules and integrity gates.',
      purpose: '目的別KPI、分母、比較群、基準値、期間、停止条件を事前に定め、試作・小規模テスト・実測後の改訂を行う。事実性・出典・権利・プライバシー・広告表示・媒体規約を横断的に確認する。',
      loadWhen: ['experiment design', 'performance evaluation', 'iteration and measurement', 'outcome or causal claims'],
      excludeWhen: ['tasks with no measurement objective; lightweight integrity checks still apply globally'],
      worldModel: { entities: ['hypothesis', 'intervention', 'sample', 'metric', 'baseline', 'comparison group', 'observation'], variables: ['denominator', 'window', 'effect', 'uncertainty', 'stopping rule'] },
      epistemology: { rule: 'Keep predictions, proxy scores and observed business outcomes separate; report sample limitations.' },
      reasoningProcedures: ['Choose purpose-specific metrics.', 'Define denominator, baseline, comparison and time window.', 'Set sample and stopping criteria before a test.', 'Record results and counterevidence before changing hypotheses.'],
      evaluationCriteria: ['metric validity', 'measurement completeness', 'comparability', 'uncertainty reporting', 'integrity and rights compliance'],
      dependencies: [],
    },
  ],
};

const registry = createRegistry();
module.exports = {
  COLLECTIONS,
  REQUIRED_CONTRIBUTION_FIELDS,
  INITIAL_PACK,
  cleanProfile,
  cleanPack,
  normalizeDependencies,
  createRegistry,
  ...registry,
};
