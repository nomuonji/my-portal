const { createHash } = require('node:crypto');
const { getDocumentDb, FieldValue } = require('./documentDb');
const agentStore = require('./agentIdeasStore');
const linearBridge = require('./linearMcpBridge');
const {
  isMaterialReceipt, hasLiveEvidence, hasCommitEvidence, MATERIAL_ACTION_TYPES, trustedTargetProgress,
} = require('./managerOutcome');
const { validateSeoManagerWorkItem } = require('./managerWorkItemPolicy');
const organizationRegistry = require('./organizationRegistry');
const organizationLifecycle = require('./organizationLifecycle');

const DATABASE_ID = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const COLLECTIONS = Object.freeze({
  spaces: 'spaces',
  profileFacts: 'profileFacts',
  decisions: 'decisions',
  opportunities: 'opportunities',
  methods: 'methods',
  methodVersions: 'methodVersions',
  workItems: 'memos/agent-control/workItems',
  managerJobs: 'memos/agent-control/managerJobs',
  managerRuns: 'memos/agent-control/managerRuns',
  organizations: organizationRegistry.ORGANIZATIONS,
  operatingModels: 'memos/agent-control/operatingModels',
  operatingModelVersions: 'memos/agent-control/operatingModelVersions',
  systemChangeSets: 'memos/agent-control/systemChangeSets',
});

const THINKING_COLLECTIONS = Object.freeze({
  ideas: 'ideas',
  relations: 'relations',
  runs: 'runs',
  sources: 'sources',
  evaluations: 'evaluations',
  artifacts: 'artifacts',
});

const SPACE_STATUSES = ['active', 'paused', 'completed', 'archived'];
const SPACE_THEME_OWNERS = ['user', 'assistant'];
const IDEA_STATUSES = ['active', 'paused', 'archived', 'promoted'];
const IDEA_MATURITY = ['seed', 'exploring', 'developed', 'validated', 'execution_ready'];
const RUN_STATUSES = ['active', 'completed', 'paused', 'failed'];
const PROFILE_EVIDENCE_TYPES = ['explicit', 'inferred', 'confirmed_inference'];
const PROFILE_STABILITY = ['temporary', 'contextual', 'stable'];
const PROFILE_STATUSES = ['active', 'superseded', 'archived'];
const DECISION_TYPES = ['adopt', 'reject', 'hold', 'defer', 'supersede'];
const DECISION_STATUSES = ['active', 'superseded', 'reversed'];
const OPPORTUNITY_STATUSES = ['active', 'watching', 'paused', 'closed', 'rejected', 'completed'];
const METHOD_STATUSES = ['active', 'paused', 'archived'];
const METHOD_VERSION_STATUSES = ['draft', 'active', 'superseded', 'archived'];
const WORK_ITEM_STATUSES = ['backlog', 'ready', 'in_progress', 'running', 'blocked', 'review', 'archived'];
const WORK_ITEM_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const WORK_ITEM_EXECUTION_MODES = ['agent', 'human'];
const MANAGER_JOB_STATUSES = ['active', 'paused', 'archived'];
const MANAGER_JOB_CONCURRENCY_POLICIES = ['skip_if_open', 'allow_overlap'];
const EXECUTION_DELIVERY_STATUSES = ['local_ready', 'committed', 'live_verified'];
const MANAGER_RUN_STATUSES = ['ready', 'running', 'completed', 'failed'];
const LINEAR_SETUP_WORK_ITEM_ID = 'system-linear-integration-setup';
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ESCALATION_CATEGORIES = ['capability', 'safety', 'external_dependency', 'state', 'validation', 'tool_error', 'unknown'];
const OPERATING_MODEL_VERSION_STATUSES = ['draft', 'active', 'superseded', 'archived'];
const SYSTEM_CHANGE_STATUSES = ['planned', 'applied', 'failed', 'rolled_back', 'superseded'];
const SYSTEM_CHANGE_TRIGGER_TYPES = ['human_decision', 'incident', 'health_audit', 'manual', 'system', 'migration'];
const AGENT_HQ_OPERATING_MODEL_ID = 'agent-hq';
const AGENT_HQ_GOVERNANCE_CHANGESET_ID = 'agent-hq-governance-structured-data-2026-09-27';
const AGENT_HQ_LEGACY_VERSION_ID = 'agent-hq-v1-legacy';
const AGENT_HQ_STRUCTURED_VERSION_ID = 'agent-hq-v2-structured-governance';

const AGENT_HQ_OPERATING_MODEL = Object.freeze({
  version: 1,
  updatedAt: '2026-09-27',
  docs: {
    operatingModel: 'docs/AGENT_HQ_OPERATING_MODEL.md',
    decisionLog: 'docs/AGENT_HQ_DECISION_LOG.md',
    uiViewer: 'Agent HQ > 運用モデル',
    sourcePolicy: 'The authenticated UI reads the repository-owned Markdown through the My Portal backend; it does not keep a second hand-written copy.',
  },
  organization: ['human', 'manager', 'work_bundle', 'worker', 'manager'],
  roles: {
    human: 'Sets mission, boundaries, major policy, and genuinely human-only decisions.',
    manager: 'Owns mission outcomes, reconciles queue state, delegates executable bundles, receives Worker escalations, and creates structural Incidents.',
    worker: 'Claims executable work, delivers and validates it, and reports execution problems to its Manager before any Incident escalation.',
  },
  methods: {
    managerMethod: 'How a Manager observes, reconciles, decides, delegates, reviews outcomes, and handles incidents.',
    workerMethod: 'How a Worker executes, validates, delivers, and reports problems.',
    runtimeRequirements: 'Method protocol.runtimeRequirements declares required/optional capabilities and tool families.',
    managerVersionPin: 'Manager Method version is pinned when manager_job_start materializes a Manager Run.',
    workerVersionPin: 'Worker Method version is pinned on the first successful Work Item claim.',
  },
  schedulerBoundary: {
    owns: ['when', 'runner_bootstrap'],
    doesNotOwn: ['manager_manual', 'worker_manual', 'tool_list', 'validation_policy', 'state_semantics', 'incident_policy'],
    bootstrapFailure: 'If My Portal itself is unavailable, stop instead of improvising and report directly to the Human.',
  },
  stateSemantics: {
    backlog: 'Deliberately deferred from near-term execution.',
    ready: 'Unclaimed and executable by the intended current Worker.',
    running: 'Actively claimed and being executed now.',
    in_progress: 'Unfinished and idle, with a known compatible route to resume.',
    blocked: 'Unfinished and currently not executable because of capability, safety, permission, external dependency, or another concrete blocker.',
    review: 'Implementation and validation are complete; only Manager/Human judgment remains.',
    archived: 'Closed terminal history: completed, withdrawn, merged, or resolved.',
  },
  invariants: [
    'Never put unfinished capability or write failures into review.',
    'Do not count a Work Item as ready when the intended Worker cannot complete it end-to-end.',
    'Review is a judgment-only state, not a generic handoff bucket.',
    'Do not move ongoing work to backlog merely because an execution session ended.',
    'Do not blindly retry the same Worker with the same capability or safety failure.',
    'Do not bundle work across incompatible safety, lock, release, approval, or validation boundaries.',
    'System Incidents are not ordinary Worker queue inventory.',
  ],
  escalation: {
    workerToManagerFirst: true,
    localProblem: 'Manager fixes or reroutes the Work Item; no Incident.',
    incidentThreshold: [
      'same class of problem recurs',
      'fixing one Work Item would not prevent recurrence elsewhere',
      'Operating Model, Method, code, schema, connector, or scheduler must change',
      'Manager cannot resolve it through normal reconciliation',
      'data loss, authentication, permissions, or safety boundary is involved',
    ],
    humanThreshold: 'Mission, policy, important architecture, quality/safety boundary, credential/permission, or genuinely human-only decision.',
  },
});

function db() {
  return getDocumentDb(DATABASE_ID);
}

function clampString(value, max = 12000) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().slice(0, max);
}

function stringArray(value, maxItems = 50, maxLen = 240) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clampString(item, maxLen)).filter(Boolean))].slice(0, maxItems);
}

function normalizeRuntimeRequirements(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    requiredCapabilities: stringArray(source.requiredCapabilities, 100, 160),
    requiredTools: stringArray(source.requiredTools, 100, 160),
    optionalCapabilities: stringArray(source.optionalCapabilities, 100, 160),
    optionalTools: stringArray(source.optionalTools, 100, 160),
  };
}

function mergeRuntimeRequirements(...values) {
  const merged = values.map(normalizeRuntimeRequirements);
  return {
    requiredCapabilities: [...new Set(merged.flatMap((item) => item.requiredCapabilities))],
    requiredTools: [...new Set(merged.flatMap((item) => item.requiredTools))],
    optionalCapabilities: [...new Set(merged.flatMap((item) => item.optionalCapabilities))],
    optionalTools: [...new Set(merged.flatMap((item) => item.optionalTools))],
  };
}

function runtimeRequirementsFromMethodExecution(executionContract) {
  return normalizeRuntimeRequirements(executionContract?.protocol?.runtimeRequirements || {});
}

function runtimeAvailability(input = {}) {
  return {
    runnerId: clampString(input.runnerId, 160) || null,
    capabilities: stringArray(input.availableCapabilities, 200, 160),
    tools: stringArray(input.availableTools, 200, 160),
  };
}

function compareRuntimeRequirements(requirements, availability) {
  const required = normalizeRuntimeRequirements(requirements);
  const available = availability || { capabilities: [], tools: [] };
  const capabilitySet = new Set(available.capabilities || []);
  const toolSet = new Set(available.tools || []);
  const missingCapabilities = required.requiredCapabilities.filter((item) => !capabilitySet.has(item));
  const missingTools = required.requiredTools.filter((item) => !toolSet.has(item));
  return {
    ok: missingCapabilities.length === 0 && missingTools.length === 0,
    missingCapabilities,
    missingTools,
  };
}

function jsonSafe(value, depth = 0) {
  if (depth > 6) return '[max-depth]';
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 30000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => jsonSafe(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
      out[String(key).slice(0, 120)] = jsonSafe(item, depth + 1);
    });
    return out;
  }
  return String(value).slice(0, 30000);
}

function serialize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = serialize(item);
    return out;
  }
  return value;
}

function documentToObject(snapshot) {
  return snapshot.exists ? serialize({ id: snapshot.id, ...snapshot.data() }) : null;
}

function assertString(value, name, { min = 1, max = 12000 } = {}) {
  const normalized = clampString(value, max);
  if (!normalized || normalized.length < min) throw new Error(`${name} is required`);
  return normalized;
}

function assertEnum(value, allowed, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function createdBy(input = {}, actor = {}) {
  return {
    type: clampString(input.type || actor.type, 30) || 'agent',
    agent: clampString(input.agent || actor.agent, 120) || 'chatgpt',
    model: clampString(input.model || actor.model, 120) || null,
  };
}

function thinkingRelationId(fromIdeaId, type, toIdeaId) {
  return createHash('sha256').update(fromIdeaId + '\n' + type + '\n' + toIdeaId).digest('hex').slice(0, 40);
}

function sortRecent(items) {
  return [...items].sort((a, b) => {
    const left = Date.parse(a.updatedAt || a.createdAt || a.startedAt || '') || 0;
    const right = Date.parse(b.updatedAt || b.createdAt || b.startedAt || '') || 0;
    return right - left;
  });
}


function structuredAgentHqOperatingModel() {
  return {
    ...AGENT_HQ_OPERATING_MODEL,
    version: 2,
    updatedAt: '2026-09-27',
    docs: {
      operatingModel: 'docs/AGENT_HQ_OPERATING_MODEL.md',
      decisionLog: 'docs/AGENT_HQ_DECISION_LOG.md',
      uiViewer: 'Agent HQ > 運用モデル',
      sourcePolicy: 'Versioned Firestore Operating Model data is canonical. Agent HQ renders human-readable Markdown from the active structured version; repository Markdown remains fallback/history.',
      canonicalStore: 'memos/agent-control/operatingModels + operatingModelVersions',
      changeHistoryStore: 'memos/agent-control/systemChangeSets',
    },
    runtimeRequirementPolicy: {
      methodBaseline: 'A Method baseline contains only capabilities/tools required for every Work Item using that Method.',
      workItemRequirementsAreAdditive: true,
      optionalDoesNotBecomeRequired: true,
      rule: 'Task-specific mutation, deployment, verification, approval, or provider requirements belong on the Work Item and are merged additively at preflight.',
    },
    governance: {
      canonicalEntity: 'OperatingModelVersion',
      versioning: 'immutable versions + active pointer',
      changeTracking: 'SystemChangeSet',
      incidentTracking: 'System Incident Work Items',
      layerOwnership: {
        operatingModel: 'stable cross-system principles and governance',
        method: 'role/domain execution procedure',
        managerJob: 'job/domain configuration and mission scope',
        workItem: 'concrete executable work and task-specific runtime requirements',
        incident: 'failure evidence, diagnosis, fix, prevention, recurrence',
        systemChangeSet: 'why a system repair/change happened across entities and how to rollback it',
      },
      autonomousRepair: {
        allowed: true,
        scope: 'low-risk repairs inside existing mission, quality, permission, and safety boundaries',
        requiresVersionHistory: true,
        requiresChangeSet: true,
        requiresRegressionCheck: true,
        requiresRollbackTarget: true,
        humanApprovalRequiredFor: [
          'mission change',
          'major architecture change',
          'quality boundary change',
          'safety boundary change',
          'credential or permission change',
          'genuinely human-only policy decision',
        ],
      },
    },
    healthAudit: {
      purpose: 'Detect when Agent HQ is running but not producing valid work, or when contracts and runtime behavior diverge.',
      checks: [
        'scheduled Manager/Worker executions occurred as expected',
        'Manager -> executable ready inventory -> Worker claim -> finish flow is progressing',
        'ready starvation is not persisting while canonical backlog contains executable work',
        'failed, blocked, stale lease, and repeated incident fingerprints are not accumulating',
        'Method/runtime requirements match the actual runner and Work Item-specific needs',
        'Manager and Worker schedules do not create avoidable races',
        'recent Method or Operating Model changes improved rather than degraded the target behavior',
      ],
      repairPolicy: 'Use the governance.autonomousRepair rules. Diagnose the owning layer first; do not rewrite unrelated layers.',
    },
  };
}

async function ensureAgentHqGovernanceBootstrap() {
  const database = db();
  const modelRef = database.collection(COLLECTIONS.operatingModels).doc(AGENT_HQ_OPERATING_MODEL_ID);
  const existing = await modelRef.get();
  if (existing.exists) return false;

  const legacyVersionRef = database.collection(COLLECTIONS.operatingModelVersions).doc(AGENT_HQ_LEGACY_VERSION_ID);
  const structuredVersionRef = database.collection(COLLECTIONS.operatingModelVersions).doc(AGENT_HQ_STRUCTURED_VERSION_ID);
  const changeRef = database.collection(COLLECTIONS.systemChangeSets).doc(AGENT_HQ_GOVERNANCE_CHANGESET_ID);
  const currentModel = structuredAgentHqOperatingModel();

  await database.runTransaction(async (tx) => {
    const modelSnapshot = await tx.get(modelRef);
    if (modelSnapshot.exists) return;
    const now = FieldValue.serverTimestamp();

    tx.set(legacyVersionRef, {
      operatingModelId: AGENT_HQ_OPERATING_MODEL_ID,
      versionNumber: 1,
      label: 'v1 repository/code canonical',
      changeSummary: 'Historical pre-migration Agent HQ Operating Model. Repository Markdown and code constant were treated as canonical.',
      model: jsonSafe(AGENT_HQ_OPERATING_MODEL),
      status: 'superseded',
      changeSetId: AGENT_HQ_GOVERNANCE_CHANGESET_ID,
      createdBy: { type: 'system', agent: 'governance-migration', model: null },
      createdAt: now,
      updatedAt: now,
    });
    tx.set(structuredVersionRef, {
      operatingModelId: AGENT_HQ_OPERATING_MODEL_ID,
      versionNumber: 2,
      label: 'v2 versioned structured governance',
      changeSummary: 'Moves the live Operating Model to versioned structured Firestore data, adds System ChangeSet history and explicit autonomous-repair governance.',
      model: jsonSafe(currentModel),
      status: 'active',
      changeSetId: AGENT_HQ_GOVERNANCE_CHANGESET_ID,
      createdBy: { type: 'system', agent: 'governance-migration', model: null },
      createdAt: now,
      updatedAt: now,
    });
    tx.set(changeRef, {
      title: 'Operating Modelをversioned structured dataへ移行',
      summary: 'Agent HQの現行運用モデルをDB正本へ移し、旧モデルをv1として保存したうえでv2をactive化。System ChangeSetで今後の横断修正を追跡可能にした。',
      reason: 'Health Auditorや自律修復が、会話やMarkdownの解釈ではなく、機械可読なcurrent version・変更理由・rollback先を参照できるようにするため。',
      status: 'applied',
      triggerType: 'human_decision',
      triggerIds: ['human-request-2026-09-27-governance-db'],
      changes: [
        {
          entityType: 'operating_model',
          entityId: AGENT_HQ_OPERATING_MODEL_ID,
          beforeVersionId: AGENT_HQ_LEGACY_VERSION_ID,
          afterVersionId: AGENT_HQ_STRUCTURED_VERSION_ID,
          summary: 'Repository/code canonicalからversioned Firestore canonicalへ移行。',
          metadata: {},
        },
        {
          entityType: 'governance_ui',
          entityId: 'agent-hq-governance',
          beforeVersionId: 'repository-markdown',
          afterVersionId: 'db-generated-markdown',
          summary: 'UIをDB正本から生成する人間向けMarkdown投影へ変更。',
          metadata: {},
        },
      ],
      evidence: ['Migration bootstrapped by My Portal runtime after deployment.'],
      regressionCheck: 'agent_hq_operating_model must report canonicalSource=firestore and versionNumber=2; v1 must remain queryable for rollback.',
      rollback: {
        type: 'activate_operating_model_version',
        operatingModelId: AGENT_HQ_OPERATING_MODEL_ID,
        versionId: AGENT_HQ_LEGACY_VERSION_ID,
        codeRollbackRequired: false,
      },
      metadata: { migration: true },
      createdBy: { type: 'system', agent: 'governance-migration', model: null },
      appliedAt: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(modelRef, {
      title: 'Agent HQ Operating Model',
      status: 'active',
      latestVersionNumber: 2,
      currentVersionId: AGENT_HQ_STRUCTURED_VERSION_ID,
      currentVersionNumber: 2,
      docs: currentModel.docs,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  });
  return true;
}

function normalizeSystemChangeEntry(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    entityType: clampString(source.entityType, 80) || 'unknown',
    entityId: clampString(source.entityId, 240) || null,
    beforeVersionId: clampString(source.beforeVersionId, 240) || null,
    afterVersionId: clampString(source.afterVersionId, 240) || null,
    summary: clampString(source.summary, 4000) || '',
    metadata: jsonSafe(source.metadata || {}),
  };
}

async function operatingModelVersionGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.operatingModelVersions).doc(id).get();
  if (!snapshot.exists) throw new Error('Operating Model version not found: ' + id);
  return documentToObject(snapshot);
}

async function operatingModelGetContext(input = {}) {
  const id = clampString(input.id, 160) || AGENT_HQ_OPERATING_MODEL_ID;
  if (id === AGENT_HQ_OPERATING_MODEL_ID) await ensureAgentHqGovernanceBootstrap();

  const database = db();
  const modelSnapshot = await database.collection(COLLECTIONS.operatingModels).doc(id).get();
  if (!modelSnapshot.exists) throw new Error('Operating Model not found: ' + id);
  const operatingModel = documentToObject(modelSnapshot);
  const limit = Math.min(Math.max(Number(input.versionLimit) || 20, 1), 100);
  const versionSnapshot = await database.collection(COLLECTIONS.operatingModelVersions)
    .where('operatingModelId', '==', id)
    .limit(100)
    .get();
  const versions = versionSnapshot.docs.map(documentToObject)
    .sort((a, b) => Number(b.versionNumber || 0) - Number(a.versionNumber || 0))
    .slice(0, limit);
  const currentVersion = operatingModel.currentVersionId
    ? versions.find((item) => item.id === operatingModel.currentVersionId)
      || await operatingModelVersionGet({ id: operatingModel.currentVersionId })
    : null;
  return { operatingModel, currentVersion, versions, source: 'firestore', databaseId: DATABASE_ID };
}

async function operatingModelVersionCreate(input, actor = {}) {
  const operatingModelId = clampString(input.operatingModelId, 160) || AGENT_HQ_OPERATING_MODEL_ID;
  if (operatingModelId === AGENT_HQ_OPERATING_MODEL_ID) await ensureAgentHqGovernanceBootstrap();
  const database = db();
  const modelRef = database.collection(COLLECTIONS.operatingModels).doc(operatingModelId);
  const versionRef = database.collection(COLLECTIONS.operatingModelVersions).doc();
  const activate = input.activate === true;
  const rawModel = input.model && typeof input.model === 'object' && !Array.isArray(input.model) ? input.model : null;
  if (!rawModel) throw new Error('model must be a structured object');

  await database.runTransaction(async (tx) => {
    const modelSnapshot = await tx.get(modelRef);
    if (!modelSnapshot.exists) throw new Error('Operating Model not found: ' + operatingModelId);
    const current = modelSnapshot.data();
    const previousRef = activate && current.currentVersionId
      ? database.collection(COLLECTIONS.operatingModelVersions).doc(current.currentVersionId)
      : null;
    const previousSnapshot = previousRef ? await tx.get(previousRef) : null;
    const versionNumber = Number(current.latestVersionNumber || 0) + 1;
    const now = FieldValue.serverTimestamp();
    const safeModel = jsonSafe(rawModel);
    const model = { ...safeModel, version: versionNumber, updatedAt: new Date().toISOString() };

    tx.set(versionRef, {
      operatingModelId,
      versionNumber,
      label: clampString(input.label, 120) || ('v' + versionNumber),
      changeSummary: clampString(input.changeSummary, 5000) || '',
      model,
      status: activate ? 'active' : 'draft',
      changeSetId: clampString(input.changeSetId, 160) || null,
      createdBy: createdBy(input.createdBy, actor),
      createdAt: now,
      updatedAt: now,
    });
    if (activate && previousSnapshot?.exists && previousSnapshot.id !== versionRef.id) {
      tx.update(previousSnapshot.ref, { status: 'superseded', updatedAt: now });
    }
    tx.update(modelRef, {
      latestVersionNumber: versionNumber,
      ...(activate ? { currentVersionId: versionRef.id, currentVersionNumber: versionNumber } : {}),
      revision: Number(current.revision || 1) + 1,
      updatedAt: now,
    });
  });
  return operatingModelGetContext({ id: operatingModelId, versionLimit: 100 });
}

async function operatingModelVersionActivate(input) {
  const operatingModelId = clampString(input.operatingModelId, 160) || AGENT_HQ_OPERATING_MODEL_ID;
  if (operatingModelId === AGENT_HQ_OPERATING_MODEL_ID) await ensureAgentHqGovernanceBootstrap();
  const versionId = assertString(input.versionId, 'versionId', { max: 160 });
  const database = db();
  const modelRef = database.collection(COLLECTIONS.operatingModels).doc(operatingModelId);
  const versionRef = database.collection(COLLECTIONS.operatingModelVersions).doc(versionId);

  await database.runTransaction(async (tx) => {
    const modelSnapshot = await tx.get(modelRef);
    const versionSnapshot = await tx.get(versionRef);
    if (!modelSnapshot.exists) throw new Error('Operating Model not found: ' + operatingModelId);
    if (!versionSnapshot.exists) throw new Error('Operating Model version not found: ' + versionId);
    const current = modelSnapshot.data();
    const version = versionSnapshot.data();
    if (version.operatingModelId !== operatingModelId) throw new Error('Operating Model version does not belong to: ' + operatingModelId);
    const previousRef = current.currentVersionId && current.currentVersionId !== versionId
      ? database.collection(COLLECTIONS.operatingModelVersions).doc(current.currentVersionId)
      : null;
    const previousSnapshot = previousRef ? await tx.get(previousRef) : null;
    const now = FieldValue.serverTimestamp();
    if (previousSnapshot?.exists) tx.update(previousSnapshot.ref, { status: 'superseded', updatedAt: now });
    tx.update(versionRef, { status: 'active', updatedAt: now });
    tx.update(modelRef, {
      currentVersionId: versionId,
      currentVersionNumber: Number(version.versionNumber || 0) || null,
      revision: Number(current.revision || 1) + 1,
      updatedAt: now,
    });
  });
  return operatingModelGetContext({ id: operatingModelId, versionLimit: 100 });
}

async function systemChangeCreate(input, actor = {}) {
  const ref = db().collection(COLLECTIONS.systemChangeSets).doc();
  const now = FieldValue.serverTimestamp();
  const changes = (Array.isArray(input.changes) ? input.changes : []).slice(0, 100).map(normalizeSystemChangeEntry);
  await ref.set({
    title: assertString(input.title, 'title', { max: 500 }),
    summary: clampString(input.summary, 12000) || '',
    reason: assertString(input.reason, 'reason', { max: 12000 }),
    status: assertEnum(input.status, SYSTEM_CHANGE_STATUSES, 'status', 'applied'),
    triggerType: assertEnum(input.triggerType, SYSTEM_CHANGE_TRIGGER_TYPES, 'triggerType', 'manual'),
    triggerIds: stringArray(input.triggerIds, 100, 240),
    changes,
    evidence: stringArray(input.evidence, 100, 3000),
    regressionCheck: clampString(input.regressionCheck, 6000) || '',
    rollback: jsonSafe(input.rollback || {}),
    metadata: jsonSafe(input.metadata || {}),
    createdBy: createdBy(input.createdBy, actor),
    appliedAt: (input.status || 'applied') === 'applied' ? now : null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  return documentToObject(await ref.get());
}

async function systemChangeGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.systemChangeSets).doc(id).get();
  if (!snapshot.exists) throw new Error('System ChangeSet not found: ' + id);
  return documentToObject(snapshot);
}

async function systemChangeSearch(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 4, 100), limit), 1000);
  const snapshot = await db().collection(COLLECTIONS.systemChangeSets).limit(scanLimit).get();
  const q = clampString(input.query, 400)?.toLowerCase();
  const status = clampString(input.status, 40);
  const triggerType = clampString(input.triggerType, 40);
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((item) => !status || item.status === status)
    .filter((item) => !triggerType || item.triggerType === triggerType)
    .filter((item) => !q || [item.title, item.summary, item.reason, ...(item.triggerIds || [])].join('\n').toLowerCase().includes(q))
    .slice(0, limit);
  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

async function systemChangeUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.systemChangeSets).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('System ChangeSet not found: ' + id);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error('Revision conflict: expected ' + input.expectedRevision + ', actual ' + (current.revision || 1));
    }
    const update = { revision: Number(current.revision || 1) + 1, updatedAt: FieldValue.serverTimestamp() };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 500 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 12000) || '';
    if (patch.reason !== undefined) update.reason = assertString(patch.reason, 'patch.reason', { max: 12000 });
    if (patch.status !== undefined) update.status = assertEnum(patch.status, SYSTEM_CHANGE_STATUSES, 'patch.status', current.status || 'applied');
    if (patch.triggerType !== undefined) update.triggerType = assertEnum(patch.triggerType, SYSTEM_CHANGE_TRIGGER_TYPES, 'patch.triggerType', current.triggerType || 'manual');
    if (patch.triggerIds !== undefined) update.triggerIds = stringArray(patch.triggerIds, 100, 240);
    if (patch.changes !== undefined) update.changes = (Array.isArray(patch.changes) ? patch.changes : []).slice(0, 100).map(normalizeSystemChangeEntry);
    if (patch.evidence !== undefined) update.evidence = stringArray(patch.evidence, 100, 3000);
    if (patch.regressionCheck !== undefined) update.regressionCheck = clampString(patch.regressionCheck, 6000) || '';
    if (patch.rollback !== undefined) update.rollback = jsonSafe(patch.rollback || {});
    if (patch.metadata !== undefined) update.metadata = jsonSafe(patch.metadata || {});
    if (patch.metadataPatch !== undefined) update.metadata = { ...(current.metadata || {}), ...jsonSafe(patch.metadataPatch || {}) };
    if (patch.status === 'applied' && !current.appliedAt) update.appliedAt = FieldValue.serverTimestamp();
    if (patch.status === 'rolled_back') update.rolledBackAt = FieldValue.serverTimestamp();
    tx.update(ref, update);
  });
  return systemChangeGet({ id });
}

function markdownLabel(key) {
  return String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (value) => value.toUpperCase());
}
function markdownScalar(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
function renderStructuredObject(value, headingLevel = 2) {
  const lines = [];
  Object.entries(value || {}).forEach(([key, item]) => {
    const heading = '#'.repeat(Math.min(Math.max(headingLevel, 2), 5));
    lines.push('', heading + ' ' + markdownLabel(key));
    if (Array.isArray(item)) {
      if (!item.length) lines.push('- none');
      else if (item.every((entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry))) {
        item.forEach((entry) => lines.push('- ' + markdownScalar(entry)));
      } else {
        lines.push('~~~json', JSON.stringify(item, null, 2), '~~~');
      }
    } else if (item && typeof item === 'object') {
      const entries = Object.entries(item);
      if (entries.every(([, nested]) => nested === null || ['string', 'number', 'boolean'].includes(typeof nested))) {
        entries.forEach(([nestedKey, nested]) => lines.push('- **' + markdownLabel(nestedKey) + ':** ' + markdownScalar(nested)));
      } else {
        lines.push('~~~json', JSON.stringify(item, null, 2), '~~~');
      }
    } else {
      lines.push('', markdownScalar(item));
    }
  });
  return lines.join('\n');
}

function renderOperatingModelMarkdown(model) {
  const meta = model?._meta || {};
  const cleanModel = { ...(model || {}) };
  delete cleanModel._meta;
  const lines = [
    '# Agent HQ Operating Model', '',
    '> Generated from the active versioned structured Operating Model in My Portal.',
    '> Repository Markdown remains fallback/history, not the live canonical state.', '',
    '- **Current version:** v' + markdownScalar(meta.versionNumber || cleanModel.version),
    '- **Version ID:** ' + markdownScalar(meta.versionId),
    '- **Canonical source:** ' + markdownScalar(meta.canonicalSource),
    '- **Updated:** ' + markdownScalar(cleanModel.updatedAt),
  ];
  const body = { ...cleanModel };
  delete body.version;
  delete body.updatedAt;
  lines.push(renderStructuredObject(body, 2));
  return lines.join('\n');
}

function renderSystemChangeLogMarkdown(items = []) {
  const lines = [
    '# Agent HQ System Change Log', '',
    '> Generated from My Portal System ChangeSets. Each record captures what changed, why, regression evidence, and rollback.', '',
  ];
  if (!items.length) return lines.concat(['No structured ChangeSets have been recorded yet.']).join('\n');
  items.forEach((item) => {
    lines.push('## ' + (item.createdAt ? String(item.createdAt).slice(0, 10) + ' — ' : '') + item.title, '');
    lines.push('- **Status:** ' + markdownScalar(item.status));
    lines.push('- **Trigger:** ' + markdownScalar(item.triggerType) + (item.triggerIds?.length ? ' · ' + item.triggerIds.join(', ') : ''));
    if (item.summary) lines.push('', item.summary);
    if (item.reason) lines.push('', '**Reason**', '', item.reason);
    if (item.changes?.length) {
      lines.push('', '**Changes**');
      item.changes.forEach((change) => {
        const versions = [change.beforeVersionId, change.afterVersionId].filter(Boolean).join(' → ');
        lines.push('- ' + markdownScalar(change.entityType) + (change.entityId ? ' [' + change.entityId + ']' : '') + (versions ? ' · ' + versions : '') + (change.summary ? ' — ' + change.summary : ''));
      });
    }
    if (item.regressionCheck) lines.push('', '**Regression check**', '', item.regressionCheck);
    if (item.evidence?.length) {
      lines.push('', '**Evidence**');
      item.evidence.forEach((entry) => lines.push('- ' + entry));
    }
    if (item.rollback && Object.keys(item.rollback).length) lines.push('', '**Rollback**', '', '~~~json', JSON.stringify(item.rollback, null, 2), '~~~');
    lines.push('');
  });
  return lines.join('\n');
}

async function agentHqGovernanceView() {
  const [operatingContext, changes] = await Promise.all([
    operatingModelGetContext({ id: AGENT_HQ_OPERATING_MODEL_ID, versionLimit: 50 }),
    systemChangeSearch({ limit: 100, scanLimit: 500 }),
  ]);
  const operatingModel = await agentHqOperatingModel();
  return {
    operatingModel,
    operatingModelContext: operatingContext,
    systemChanges: changes.items,
    docs: {
      operatingModel: {
        title: 'Agent HQ Operating Model',
        path: 'db://operatingModels/' + AGENT_HQ_OPERATING_MODEL_ID,
        source: operatingContext.source,
        versionNumber: operatingContext.currentVersion?.versionNumber || null,
        versionId: operatingContext.currentVersion?.id || null,
        legacyPath: 'docs/AGENT_HQ_OPERATING_MODEL.md',
        markdown: renderOperatingModelMarkdown(operatingModel),
      },
      decisionLog: {
        title: 'Agent HQ System Change Log',
        path: 'db://systemChangeSets',
        source: 'firestore',
        legacyPath: 'docs/AGENT_HQ_DECISION_LOG.md',
        markdown: renderSystemChangeLogMarkdown(changes.items),
      },
    },
  };
}

function inferSpaceThemeOwner(input = {}) {
  const explicit = clampString(input.themeOwner, 30);
  if (explicit) return assertEnum(explicit, SPACE_THEME_OWNERS, 'themeOwner', 'user');

  const tags = (Array.isArray(input.tags) ? input.tags : []).map((item) => String(item || '').trim().toLowerCase());
  const domains = (Array.isArray(input.domains) ? input.domains : []).map((item) => String(item || '').trim().toLowerCase());

  if (
    /^ai側[:：]/i.test(String(input.title || '').trim())
    || tags.some((item) => ['ai側の課題', 'assistant-quality', 'ai-side'].includes(item))
    || domains.includes('assistant-quality')
  ) {
    return 'assistant';
  }

  // Legacy Spaces were overwhelmingly user-owned themes. Keep that as the
  // compatibility default instead of guessing from who created the record.
  return 'user';
}

async function bootstrapSpaceThemeOwnerMigration() {
  const database = db();
  const snapshot = await database.collection(COLLECTIONS.spaces).limit(500).get();
  const missing = snapshot.docs.filter((doc) => !SPACE_THEME_OWNERS.includes(doc.data()?.themeOwner));
  if (!missing.length) return 0;

  const batch = database.batch();
  missing.forEach((doc) => {
    batch.update(doc.ref, { themeOwner: inferSpaceThemeOwner(doc.data() || {}) });
  });
  await batch.commit();
  return missing.length;
}

function normalizeSpaceObject(space) {
  if (!space) return space;
  return {
    ...space,
    themeOwner: SPACE_THEME_OWNERS.includes(space.themeOwner)
      ? space.themeOwner
      : inferSpaceThemeOwner(space),
  };
}

function spacePayload(input) {
  return {
    title: assertString(input.title, 'title', { max: 300 }),
    summary: clampString(input.summary, 5000) || '',
    goal: clampString(input.goal, 8000) || '',
    status: assertEnum(input.status, SPACE_STATUSES, 'status', 'active'),
    themeOwner: inferSpaceThemeOwner(input),
    currentBrief: clampString(input.currentBrief, 16000) || '',
    nextActions: stringArray(input.nextActions, 100, 3000),
    tags: stringArray(input.tags, 50, 100),
    domains: stringArray(input.domains, 30, 100),
    revision: 1,
  };
}

async function spaceCreate(input) {
  const ref = db().collection(COLLECTIONS.spaces).doc();
  await ref.set({
    ...spacePayload(input),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function spaceGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.spaces).doc(id).get();
  if (!snapshot.exists) throw new Error(`Space not found: ${id}`);
  return normalizeSpaceObject(documentToObject(snapshot));
}

async function spaceUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.spaces).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error(`Space not found: ${id}`);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, actual ${current.revision || 1}`);
    }
    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 300 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 5000) || '';
    if (patch.goal !== undefined) update.goal = clampString(patch.goal, 8000) || '';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, SPACE_STATUSES, 'patch.status', current.status || 'active');
    if (patch.themeOwner !== undefined) update.themeOwner = assertEnum(patch.themeOwner, SPACE_THEME_OWNERS, 'patch.themeOwner', inferSpaceThemeOwner(current));
    if (patch.currentBrief !== undefined) update.currentBrief = clampString(patch.currentBrief, 16000) || '';
    if (patch.nextActions !== undefined) update.nextActions = stringArray(patch.nextActions, 100, 3000);
    if (patch.tags !== undefined) update.tags = stringArray(patch.tags, 50, 100);
    if (patch.domains !== undefined) update.domains = stringArray(patch.domains, 30, 100);
    tx.update(ref, update);
  });
  return spaceGet({ id });
}

async function spaceSearch(input = {}) {
  await bootstrapSpaceThemeOwnerMigration();
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 5, 100), limit), 500);
  const snapshot = await db().collection(COLLECTIONS.spaces).limit(scanLimit).get();
  const q = clampString(input.query, 300)?.toLowerCase();
  const status = input.status;
  const themeOwner = input.themeOwner ? assertEnum(input.themeOwner, SPACE_THEME_OWNERS, 'themeOwner') : null;
  const tag = clampString(input.tag, 100)?.toLowerCase();
  const domain = clampString(input.domain, 100)?.toLowerCase();
  const items = sortRecent(snapshot.docs.map(documentToObject).map(normalizeSpaceObject))
    .filter((space) => {
      if (status && space.status !== status) return false;
      if (themeOwner && space.themeOwner !== themeOwner) return false;
      if (tag && !(space.tags || []).some((item) => String(item).toLowerCase() === tag)) return false;
      if (domain && !(space.domains || []).some((item) => String(item).toLowerCase() === domain)) return false;
      if (q) {
        const haystack = [space.title, space.summary, space.goal, space.currentBrief, ...(space.tags || []), ...(space.domains || [])]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .slice(0, limit);
  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

function profileFactId(input) {
  const material = [
    clampString(input.scope, 240) || 'global',
    clampString(input.category, 120) || 'general',
    clampString(input.statement, 4000) || '',
  ].join('\n').toLowerCase();
  return createHash('sha256').update(material).digest('hex').slice(0, 40);
}

async function profileFactUpsert(input) {
  const statement = assertString(input.statement, 'statement', { max: 4000 });
  const scope = clampString(input.scope, 240) || 'global';
  const category = clampString(input.category, 120) || 'general';
  const evidenceType = assertEnum(input.evidenceType, PROFILE_EVIDENCE_TYPES, 'evidenceType', 'explicit');
  const stability = assertEnum(input.stability, PROFILE_STABILITY, 'stability', 'contextual');
  const status = assertEnum(input.status, PROFILE_STATUSES, 'status', 'active');
  const confidenceValue = Number(input.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.min(Math.max(confidenceValue, 0), 1)
    : evidenceType === 'explicit' ? 1 : 0.6;
  const id = profileFactId({ statement, scope, category });
  const ref = db().collection(COLLECTIONS.profileFacts).doc(id);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    statement,
    scope,
    category,
    evidenceType,
    confidence,
    stability,
    status,
    source: jsonSafe(input.source ?? null),
    sourceRunId: clampString(input.sourceRunId, 160) || null,
    lastConfirmedAt: evidenceType === 'inferred'
      ? (existing.exists ? existing.data().lastConfirmedAt || null : null)
      : now,
    createdAt: existing.exists ? existing.data().createdAt : now,
    updatedAt: now,
  }, { merge: true });
  return documentToObject(await ref.get());
}

async function profileFactUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.profileFacts).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error(`Profile fact not found: ${id}`);
  const update = { updatedAt: FieldValue.serverTimestamp() };
  if (patch.statement !== undefined) update.statement = assertString(patch.statement, 'patch.statement', { max: 4000 });
  if (patch.scope !== undefined) update.scope = clampString(patch.scope, 240) || 'global';
  if (patch.category !== undefined) update.category = clampString(patch.category, 120) || 'general';
  if (patch.evidenceType !== undefined) update.evidenceType = assertEnum(patch.evidenceType, PROFILE_EVIDENCE_TYPES, 'patch.evidenceType', snapshot.data().evidenceType);
  if (patch.stability !== undefined) update.stability = assertEnum(patch.stability, PROFILE_STABILITY, 'patch.stability', snapshot.data().stability);
  if (patch.status !== undefined) update.status = assertEnum(patch.status, PROFILE_STATUSES, 'patch.status', snapshot.data().status);
  if (patch.confidence !== undefined) {
    const value = Number(patch.confidence);
    if (!Number.isFinite(value)) throw new Error('patch.confidence must be a number');
    update.confidence = Math.min(Math.max(value, 0), 1);
  }
  if (patch.source !== undefined) update.source = jsonSafe(patch.source);
  if (patch.sourceRunId !== undefined) update.sourceRunId = clampString(patch.sourceRunId, 160) || null;
  if (patch.confirm === true) update.lastConfirmedAt = FieldValue.serverTimestamp();
  await ref.update(update);
  return documentToObject(await ref.get());
}

async function profileGetContext(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 80, 1), 200);
  const snapshot = await db().collection(COLLECTIONS.profileFacts).limit(400).get();
  const scopes = new Set(stringArray(input.scopes, 50, 240).map((item) => item.toLowerCase()));
  const categories = new Set(stringArray(input.categories, 50, 120).map((item) => item.toLowerCase()));
  let space = null;
  if (input.spaceId) {
    space = await spaceGet({ id: input.spaceId });
    scopes.add('global');
    scopes.add(`space:${space.id}`.toLowerCase());
    (space.domains || []).forEach((domain) => scopes.add(String(domain).toLowerCase()));
  }
  const useScopeFilter = scopes.size > 0;
  const useCategoryFilter = categories.size > 0;
  const includeInferred = input.includeInferred !== false;
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((fact) => {
      if (fact.status && fact.status !== 'active') return false;
      if (!includeInferred && fact.evidenceType === 'inferred') return false;
      if (useScopeFilter && !scopes.has(String(fact.scope || 'global').toLowerCase())) return false;
      if (useCategoryFilter && !categories.has(String(fact.category || 'general').toLowerCase())) return false;
      return true;
    })
    .slice(0, limit);
  return {
    items,
    count: items.length,
    filters: {
      spaceId: space?.id || null,
      scopes: [...scopes],
      categories: [...categories],
      includeInferred,
    },
  };
}

async function decisionCreate(input) {
  const spaceId = assertString(input.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });
  const ref = db().collection(COLLECTIONS.decisions).doc();
  await ref.set({
    spaceId,
    subjectType: clampString(input.subjectType, 80) || 'idea',
    subjectId: clampString(input.subjectId, 160) || null,
    decision: assertEnum(input.decision, DECISION_TYPES, 'decision', 'hold'),
    reason: assertString(input.reason, 'reason', { max: 12000 }),
    status: assertEnum(input.status, DECISION_STATUSES, 'status', 'active'),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    metadata: jsonSafe(input.metadata || {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function opportunityCreate(input) {
  const spaceId = assertString(input.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });
  const ref = db().collection(COLLECTIONS.opportunities).doc();
  await ref.set({
    spaceId,
    title: assertString(input.title, 'title', { max: 500 }),
    summary: clampString(input.summary, 8000) || '',
    type: clampString(input.type, 120) || 'opportunity',
    status: assertEnum(input.status, OPPORTUNITY_STATUSES, 'status', 'active'),
    sourceUrl: clampString(input.sourceUrl, 3000) || '',
    originIdeaId: clampString(input.originIdeaId, 160) || null,
    reward: clampString(input.reward, 500) || '',
    deadline: clampString(input.deadline, 120) || '',
    attributes: jsonSafe(input.attributes || {}),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    revision: 1,
  });
  return documentToObject(await ref.get());
}

async function opportunityUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const ref = db().collection(COLLECTIONS.opportunities).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error(`Opportunity not found: ${id}`);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error(`Revision conflict: expected ${input.expectedRevision}, actual ${current.revision || 1}`);
    }
    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 500 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 8000) || '';
    if (patch.type !== undefined) update.type = clampString(patch.type, 120) || 'opportunity';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, OPPORTUNITY_STATUSES, 'patch.status', current.status || 'active');
    if (patch.sourceUrl !== undefined) update.sourceUrl = clampString(patch.sourceUrl, 3000) || '';
    if (patch.reward !== undefined) update.reward = clampString(patch.reward, 500) || '';
    if (patch.deadline !== undefined) update.deadline = clampString(patch.deadline, 120) || '';
    if (patch.attributes !== undefined) update.attributes = jsonSafe(patch.attributes || {});
    if (patch.attributesPatch !== undefined) update.attributes = { ...(current.attributes || {}), ...jsonSafe(patch.attributesPatch || {}) };
    tx.update(ref, update);
  });
  return documentToObject(await ref.get());
}


async function methodCreate(input, actor = {}) {
  const spaceId = clampString(input.spaceId, 160) || null;
  if (spaceId) await spaceGet({ id: spaceId });
  const ref = db().collection(COLLECTIONS.methods).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    title: assertString(input.title, 'title', { max: 300 }),
    summary: clampString(input.summary, 5000) || '',
    purpose: clampString(input.purpose, 12000) || '',
    status: assertEnum(input.status, METHOD_STATUSES, 'status', 'active'),
    spaceId,
    tags: stringArray(input.tags, 50, 100),
    domains: stringArray(input.domains, 30, 100),
    currentVersionId: null,
    currentVersionNumber: null,
    latestVersionNumber: 0,
    revision: 1,
    createdBy: createdBy(input.createdBy, actor),
    createdAt: now,
    updatedAt: now,
  });
  return documentToObject(await ref.get());
}

async function methodGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.methods).doc(id).get();
  if (!snapshot.exists) throw new Error('Method not found: ' + id);
  return documentToObject(snapshot);
}

async function methodSearch(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 5, 100), limit), 500);
  const snapshot = await db().collection(COLLECTIONS.methods).limit(scanLimit).get();
  const q = clampString(input.query, 300)?.toLowerCase();
  const status = input.status;
  const spaceId = clampString(input.spaceId, 160);
  const tag = clampString(input.tag, 100)?.toLowerCase();
  const domain = clampString(input.domain, 100)?.toLowerCase();
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((method) => {
      if (status && method.status !== status) return false;
      if (spaceId && method.spaceId !== spaceId) return false;
      if (tag && !(method.tags || []).some((item) => String(item).toLowerCase() === tag)) return false;
      if (domain && !(method.domains || []).some((item) => String(item).toLowerCase() === domain)) return false;
      if (q) {
        const haystack = [method.title, method.summary, method.purpose, ...(method.tags || []), ...(method.domains || [])]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .slice(0, limit);
  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

async function methodUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const nextSpaceId = patch.spaceId !== undefined ? (clampString(patch.spaceId, 160) || null) : undefined;
  if (nextSpaceId) await spaceGet({ id: nextSpaceId });
  const ref = db().collection(COLLECTIONS.methods).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Method not found: ' + id);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error('Revision conflict: expected ' + input.expectedRevision + ', actual ' + (current.revision || 1));
    }
    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 300 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 5000) || '';
    if (patch.purpose !== undefined) update.purpose = clampString(patch.purpose, 12000) || '';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, METHOD_STATUSES, 'patch.status', current.status || 'active');
    if (patch.spaceId !== undefined) update.spaceId = nextSpaceId;
    if (patch.tags !== undefined) update.tags = stringArray(patch.tags, 50, 100);
    if (patch.domains !== undefined) update.domains = stringArray(patch.domains, 30, 100);
    tx.update(ref, update);
  });
  return methodGet({ id });
}

async function methodVersionGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.methodVersions).doc(id).get();
  if (!snapshot.exists) throw new Error('Method version not found: ' + id);
  return documentToObject(snapshot);
}

async function methodVersionCreate(input, actor = {}) {
  const methodId = assertString(input.methodId, 'methodId', { max: 160 });
  const database = db();
  const methodRef = database.collection(COLLECTIONS.methods).doc(methodId);
  const versionRef = database.collection(COLLECTIONS.methodVersions).doc();
  const activate = input.activate === true;

  await database.runTransaction(async (tx) => {
    const methodSnapshot = await tx.get(methodRef);
    if (!methodSnapshot.exists) throw new Error('Method not found: ' + methodId);
    const current = methodSnapshot.data();
    const previousRef = activate && current.currentVersionId
      ? database.collection(COLLECTIONS.methodVersions).doc(current.currentVersionId)
      : null;
    const previousSnapshot = previousRef ? await tx.get(previousRef) : null;
    const versionNumber = Number(current.latestVersionNumber || 0) + 1;
    const now = FieldValue.serverTimestamp();

    tx.set(versionRef, {
      methodId,
      versionNumber,
      label: clampString(input.label, 120) || ('v' + versionNumber),
      changeSummary: clampString(input.changeSummary, 5000) || '',
      instructions: clampString(input.instructions, 30000) || '',
      protocol: jsonSafe(input.protocol || {}),
      qualityGates: stringArray(input.qualityGates, 100, 1000),
      changeSetId: clampString(input.changeSetId, 160) || null,
      status: activate ? 'active' : 'draft',
      createdBy: createdBy(input.createdBy, actor),
      createdAt: now,
      updatedAt: now,
    });

    if (activate && previousSnapshot?.exists && previousSnapshot.id !== versionRef.id) {
      tx.update(previousSnapshot.ref, { status: 'superseded', updatedAt: now });
    }

    tx.update(methodRef, {
      latestVersionNumber: versionNumber,
      ...(activate ? {
        currentVersionId: versionRef.id,
        currentVersionNumber: versionNumber,
      } : {}),
      revision: Number(current.revision || 1) + 1,
      updatedAt: now,
    });
  });

  return {
    method: await methodGet({ id: methodId }),
    version: await methodVersionGet({ id: versionRef.id }),
  };
}

async function methodVersionActivate(input) {
  const methodId = assertString(input.methodId, 'methodId', { max: 160 });
  const versionId = assertString(input.versionId, 'versionId', { max: 160 });
  const database = db();
  const methodRef = database.collection(COLLECTIONS.methods).doc(methodId);
  const versionRef = database.collection(COLLECTIONS.methodVersions).doc(versionId);

  await database.runTransaction(async (tx) => {
    const methodSnapshot = await tx.get(methodRef);
    const versionSnapshot = await tx.get(versionRef);
    if (!methodSnapshot.exists) throw new Error('Method not found: ' + methodId);
    if (!versionSnapshot.exists) throw new Error('Method version not found: ' + versionId);
    const method = methodSnapshot.data();
    const version = versionSnapshot.data();
    if (version.methodId !== methodId) throw new Error('Method version does not belong to method: ' + methodId);
    const previousRef = method.currentVersionId && method.currentVersionId !== versionId
      ? database.collection(COLLECTIONS.methodVersions).doc(method.currentVersionId)
      : null;
    const previousSnapshot = previousRef ? await tx.get(previousRef) : null;
    const now = FieldValue.serverTimestamp();

    if (previousSnapshot?.exists) tx.update(previousSnapshot.ref, { status: 'superseded', updatedAt: now });
    tx.update(versionRef, { status: 'active', updatedAt: now });
    tx.update(methodRef, {
      currentVersionId: versionId,
      currentVersionNumber: Number(version.versionNumber || 0) || null,
      revision: Number(method.revision || 1) + 1,
      updatedAt: now,
    });
  });

  return methodGetContext({ id: methodId });
}

async function methodGetContext(input) {
  const method = await methodGet({ id: input.id });
  const database = db();
  const versionLimit = Math.min(Math.max(Number(input.versionLimit) || 20, 1), 50);
  const versionSnapshot = await database.collection(COLLECTIONS.methodVersions)
    .where('methodId', '==', method.id)
    .limit(50)
    .get();
  const versions = [...versionSnapshot.docs.map(documentToObject)]
    .sort((a, b) => Number(b.versionNumber || 0) - Number(a.versionNumber || 0))
    .slice(0, versionLimit);
  const currentVersion = method.currentVersionId
    ? versions.find((item) => item.id === method.currentVersionId) || await methodVersionGet({ id: method.currentVersionId })
    : null;
  const runs = (await getRecentCollection(THINKING_COLLECTIONS.runs, 300))
    .filter((run) => run.methodId === method.id)
    .slice(0, Math.min(Math.max(Number(input.runLimit) || 30, 1), 100));
  return {
    method,
    currentVersion,
    versions,
    recentRuns: runs,
    executionContract: currentVersion ? {
      methodId: method.id,
      methodVersionId: currentVersion.id,
      methodVersionNumber: currentVersion.versionNumber,
      instructions: currentVersion.instructions || '',
      protocol: currentVersion.protocol || {},
      qualityGates: currentVersion.qualityGates || [],
    } : null,
  };
}

async function getRecentCollection(name, limit = 300) {
  const snapshot = await db().collection(name).limit(limit).get();
  return sortRecent(snapshot.docs.map(documentToObject));
}

function activeOpportunity(item) {
  return ['active', 'watching'].includes(item.status || 'active');
}

async function spaceGetContext(input) {
  const space = await spaceGet({ id: input.id });
  const database = db();
  const ideaLimit = Math.min(Math.max(Number(input.ideaLimit) || 80, 1), 200);
  const opportunityLimit = Math.min(Math.max(Number(input.opportunityLimit) || 80, 1), 200);
  const recentLimit = Math.min(Math.max(Number(input.recentLimit) || 30, 1), 100);

  const [ideaSnapshot, decisionSnapshot, opportunitySnapshot, methodSnapshot, profileContext] = await Promise.all([
    database.collection('ideas').where('spaceId', '==', space.id).limit(ideaLimit).get(),
    database.collection(COLLECTIONS.decisions).where('spaceId', '==', space.id).limit(100).get(),
    database.collection(COLLECTIONS.opportunities).where('spaceId', '==', space.id).limit(opportunityLimit).get(),
    database.collection(COLLECTIONS.methods).where('spaceId', '==', space.id).limit(50).get(),
    profileGetContext({ spaceId: space.id, includeInferred: input.includeInferred !== false, limit: 120 }),
  ]);

  const ideas = sortRecent(ideaSnapshot.docs.map(documentToObject));
  const ideaIds = new Set(ideas.map((item) => item.id));
  const runIds = new Set(ideas.map((item) => item.createdInRunId).filter(Boolean));
  const decisions = sortRecent(decisionSnapshot.docs.map(documentToObject));
  decisions.forEach((item) => { if (item.createdInRunId) runIds.add(item.createdInRunId); });
  const opportunities = sortRecent(opportunitySnapshot.docs.map(documentToObject));
  opportunities.forEach((item) => { if (item.createdInRunId) runIds.add(item.createdInRunId); });
  const methods = sortRecent(methodSnapshot.docs.map(documentToObject));

  const [sourcesAll, runsAll, agentRunsAll, artifactsAll, projectsAll] = await Promise.all([
    getRecentCollection(THINKING_COLLECTIONS.sources, 300),
    getRecentCollection(THINKING_COLLECTIONS.runs, 220),
    getRecentCollection('agent_idea_runs', 220).catch(() => []),
    input.includeArtifacts === false ? Promise.resolve([]) : getRecentCollection(THINKING_COLLECTIONS.artifacts, 220),
    getRecentCollection('projects', 150).catch(() => []),
  ]);

  const sources = sourcesAll
    .filter((item) => item.spaceId === space.id || ideaIds.has(item.ideaId))
    .slice(0, recentLimit);
  sources.forEach((item) => { if (item.createdInRunId) runIds.add(item.createdInRunId); });

  const runs = sortRecent([...runsAll, ...agentRunsAll])
    .filter((item) => item.spaceId === space.id
      || runIds.has(item.id)
      || (item.seedIdeaIds || []).some((id) => ideaIds.has(id)))
    .slice(0, recentLimit);

  const artifacts = artifactsAll
    .filter((item) => item.spaceId === space.id || ideaIds.has(item.ideaId) || runIds.has(item.createdInRunId))
    .slice(0, recentLimit);

  const projects = sortRecent(projectsAll.filter((project) =>
    project.spaceId === space.id ||
    (Array.isArray(project.spaceIds) && project.spaceIds.includes(space.id))
  )).slice(0, 50);
  const themeLocalConstraints = profileContext.items.filter((fact) => String(fact.scope || '') === `space:${space.id}`);
  const relevantProfileFacts = profileContext.items.filter((fact) => String(fact.scope || '') !== `space:${space.id}`);
  const activeIdeas = ideas.filter((item) => item.status === 'active' && !['wild_gig', 'opportunity_source'].includes(item.type));

  // Keep concrete Opportunities self-contained in the Context Pack. Legacy
  // opportunity records may not have sourceUrl populated because their source
  // evidence lived on the originating Idea; prefer the strongest source type
  // without mutating the stored migration data.
  const sourcePriority = {
    source_of_truth: 0,
    bounty_listing: 1,
    contest_page: 1,
    program_rules: 1,
    job_listing: 1,
    program_history: 2,
    platform_documentation: 2,
    market_evidence: 3,
    risk_note: 4,
  };
  const sourceByIdea = new Map();
  sources.forEach((source) => {
    if (!source.ideaId || !source.url) return;
    const existing = sourceByIdea.get(source.ideaId);
    const rank = sourcePriority[source.type] ?? 10;
    const existingRank = existing ? (sourcePriority[existing.type] ?? 10) : Number.POSITIVE_INFINITY;
    if (!existing || rank < existingRank) sourceByIdea.set(source.ideaId, source);
  });
  const activeOpportunities = opportunities.filter(activeOpportunity).map((item) => {
    const primarySource = item.originIdeaId ? sourceByIdea.get(item.originIdeaId) : null;
    if (!primarySource) return item;
    return {
      ...item,
      sourceUrl: item.sourceUrl || primarySource.url || '',
      primarySource: {
        id: primarySource.id,
        title: primarySource.title || '',
        type: primarySource.type || '',
        url: primarySource.url || '',
      },
    };
  });
  const importantDecisions = decisions.filter((item) => !item.status || item.status === 'active');

  return {
    contextVersion: 2,
    space,
    goal: space.goal || '',
    currentBrief: space.currentBrief || '',
    themeLocalConstraints,
    relevantProfileFacts,
    importantDecisions,
    activeIdeas,
    activeOpportunities,
    activeMethods: methods.filter((item) => item.status === 'active'),
    recentSources: sources,
    recentRuns: runs,
    artifacts,
    projects,
    nextActions: space.nextActions || [],
    resumeBrief: [
      space.title,
      space.goal ? `Goal: ${space.goal}` : '',
      space.currentBrief ? `Current: ${space.currentBrief}` : '',
      (space.nextActions || []).length ? `Next: ${space.nextActions.join(' / ')}` : '',
    ].filter(Boolean).join('\n'),
  };
}


async function spaceIdeaExists(id) {
  const normalized = assertString(id, 'id', { max: 160 });
  const snapshot = await db().collection(THINKING_COLLECTIONS.ideas).doc(normalized).get();
  return snapshot.exists && Boolean(snapshot.data().spaceId);
}

async function spaceIdeaGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(THINKING_COLLECTIONS.ideas).doc(id).get();
  if (!snapshot.exists || !snapshot.data().spaceId) throw new Error('Thinking Space idea not found: ' + id);
  return documentToObject(snapshot);
}

async function spaceIdeaSearch(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 500);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 5, 100), limit), 2000);
  const snapshot = await db().collection(THINKING_COLLECTIONS.ideas).limit(scanLimit).get();
  const q = clampString(input.query, 300)?.toLowerCase();
  const spaceId = clampString(input.spaceId, 160);
  const status = input.status;
  const maturity = input.maturity;
  const tag = clampString(input.tag, 80)?.toLowerCase();
  const domain = clampString(input.domain, 80)?.toLowerCase();
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((idea) => {
      if (spaceId && idea.spaceId !== spaceId) return false;
      if (status && idea.status !== status) return false;
      if (maturity && idea.maturity !== maturity) return false;
      if (tag && !(idea.tags || []).some((item) => String(item).toLowerCase() === tag)) return false;
      if (domain && !(idea.domains || []).some((item) => String(item).toLowerCase() === domain)) return false;
      if (q) {
        const haystack = [idea.title, idea.summary, idea.content, ...(idea.tags || []), ...(idea.domains || [])]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .slice(0, limit);
  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID, layer: 'thinking-space' };
}

async function spaceIdeaUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const nextSpaceId = patch.spaceId !== undefined
    ? assertString(patch.spaceId, 'patch.spaceId', { max: 160 })
    : null;
  if (nextSpaceId) await spaceGet({ id: nextSpaceId });
  const ref = db().collection(THINKING_COLLECTIONS.ideas).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Idea not found: ' + id);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error('Revision conflict: expected ' + input.expectedRevision + ', actual ' + (current.revision || 1));
    }
    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 300 });
    if (patch.summary !== undefined) update.summary = clampString(patch.summary, 3000) || '';
    if (patch.content !== undefined) update.content = clampString(patch.content, 30000) || '';
    if (patch.type !== undefined) update.type = clampString(patch.type, 80) || 'idea';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, IDEA_STATUSES, 'patch.status', current.status || 'active');
    if (patch.maturity !== undefined) update.maturity = assertEnum(patch.maturity, IDEA_MATURITY, 'patch.maturity', current.maturity || 'seed');
    if (patch.tags !== undefined) update.tags = stringArray(patch.tags, 50, 80);
    if (patch.domains !== undefined) update.domains = stringArray(patch.domains, 30, 80);
    if (patch.attributes !== undefined) update.attributes = jsonSafe(patch.attributes || {});
    if (patch.attributesPatch !== undefined) update.attributes = { ...(current.attributes || {}), ...jsonSafe(patch.attributesPatch || {}) };
    if (nextSpaceId) update.spaceId = nextSpaceId;
    tx.update(ref, update);
  });

  return spaceIdeaGet({ id });
}

async function spaceIdeaLink(input, actor = {}) {
  const fromIdeaId = assertString(input.fromIdeaId, 'fromIdeaId', { max: 160 });
  const toIdeaId = assertString(input.toIdeaId, 'toIdeaId', { max: 160 });
  if (fromIdeaId === toIdeaId) throw new Error('Cannot link an idea to itself');
  const type = assertString(input.type, 'type', { max: 80 });
  const database = db();
  const [fromSnapshot, toSnapshot] = await database.getAll(
    database.collection(THINKING_COLLECTIONS.ideas).doc(fromIdeaId),
    database.collection(THINKING_COLLECTIONS.ideas).doc(toIdeaId),
  );
  if (!fromSnapshot.exists) throw new Error('Idea not found: ' + fromIdeaId);
  if (!toSnapshot.exists) throw new Error('Idea not found: ' + toIdeaId);

  const id = thinkingRelationId(fromIdeaId, type, toIdeaId);
  const ref = database.collection(THINKING_COLLECTIONS.relations).doc(id);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();
  const fromSpaceId = fromSnapshot.data().spaceId || null;
  const toSpaceId = toSnapshot.data().spaceId || null;
  await ref.set({
    fromIdeaId,
    toIdeaId,
    type,
    description: clampString(input.description, 3000) || '',
    spaceId: fromSpaceId && fromSpaceId === toSpaceId ? fromSpaceId : null,
    createdBy: createdBy(input.createdBy, actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: existing.exists ? existing.data().createdAt : now,
    updatedAt: now,
  }, { merge: true });
  return documentToObject(await ref.get());
}

async function loadThinkingRelationsForIdea(ideaId) {
  const database = db();
  const [outgoing, incoming] = await Promise.all([
    database.collection(THINKING_COLLECTIONS.relations).where('fromIdeaId', '==', ideaId).limit(100).get(),
    database.collection(THINKING_COLLECTIONS.relations).where('toIdeaId', '==', ideaId).limit(100).get(),
  ]);
  const map = new Map();
  [...outgoing.docs, ...incoming.docs].forEach((snapshot) => map.set(snapshot.id, documentToObject(snapshot)));
  return [...map.values()];
}

async function spaceIdeaGetContext(input) {
  const rootId = assertString(input.id, 'id', { max: 160 });
  const depth = Math.min(Math.max(Number(input.depth) || 1, 0), 2);
  const maxNeighbors = Math.min(Math.max(Number(input.maxNeighbors) || 40, 1), 80);
  const database = db();
  const rootSnapshot = await database.collection(THINKING_COLLECTIONS.ideas).doc(rootId).get();
  if (!rootSnapshot.exists) throw new Error('Idea not found: ' + rootId);

  const ideas = new Map([[rootId, documentToObject(rootSnapshot)]]);
  const relations = new Map();
  let frontier = [rootId];
  for (let level = 0; level < depth && frontier.length && ideas.size <= maxNeighbors; level += 1) {
    const nextIds = new Set();
    for (const ideaId of frontier) {
      const linked = await loadThinkingRelationsForIdea(ideaId);
      linked.forEach((relation) => {
        relations.set(relation.id, relation);
        const otherId = relation.fromIdeaId === ideaId ? relation.toIdeaId : relation.fromIdeaId;
        if (!ideas.has(otherId)) nextIds.add(otherId);
      });
      if (ideas.size + nextIds.size >= maxNeighbors) break;
    }
    const ids = [...nextIds].slice(0, Math.max(0, maxNeighbors - ideas.size));
    if (!ids.length) break;
    const snapshots = await database.getAll(...ids.map((id) => database.collection(THINKING_COLLECTIONS.ideas).doc(id)));
    snapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => ideas.set(snapshot.id, documentToObject(snapshot)));
    frontier = snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id);
  }

  async function listByIdea(collectionName, enabled) {
    if (!enabled) return [];
    const snapshot = await database.collection(collectionName).where('ideaId', '==', rootId).limit(100).get();
    return snapshot.docs.map(documentToObject);
  }

  const [sources, evaluations, artifacts] = await Promise.all([
    listByIdea(THINKING_COLLECTIONS.sources, input.includeSources !== false),
    listByIdea(THINKING_COLLECTIONS.evaluations, input.includeEvaluations !== false),
    listByIdea(THINKING_COLLECTIONS.artifacts, Boolean(input.includeArtifacts)),
  ]);

  const runIds = new Set();
  if (input.includeRuns !== false) {
    ideas.forEach((idea) => { if (idea.createdInRunId) runIds.add(idea.createdInRunId); });
    relations.forEach((relation) => { if (relation.createdInRunId) runIds.add(relation.createdInRunId); });
  }
  const runIdList = [...runIds].slice(0, 30);
  const [thinkingRuns, agentRuns] = runIdList.length ? await Promise.all([
    database.getAll(...runIdList.map((id) => database.collection(THINKING_COLLECTIONS.runs).doc(id))),
    database.getAll(...runIdList.map((id) => database.collection('agent_idea_runs').doc(id))),
  ]) : [[], []];
  const runs = new Map();
  [...thinkingRuns, ...agentRuns].filter((snapshot) => snapshot.exists).forEach((snapshot) => {
    runs.set(snapshot.id, documentToObject(snapshot));
  });

  return {
    root: ideas.get(rootId),
    ideas: [...ideas.values()],
    relations: [...relations.values()],
    sources,
    evaluations,
    artifacts,
    runs: [...runs.values()],
    depth,
    layer: 'thinking-space',
  };
}

async function spaceRunExists(id) {
  const normalized = assertString(id, 'id', { max: 160 });
  return (await db().collection(THINKING_COLLECTIONS.runs).doc(normalized).get()).exists;
}

async function spaceRunStart(input, actor = {}) {
  const requestedMethodId = clampString(input.methodId, 160) || null;
  const requestedVersionId = clampString(input.methodVersionId, 160) || null;
  let method = null;
  let methodVersion = null;

  if (requestedVersionId) {
    methodVersion = await methodVersionGet({ id: requestedVersionId });
    if (requestedMethodId && requestedMethodId !== methodVersion.methodId) throw new Error('methodVersionId does not belong to methodId');
    method = await methodGet({ id: methodVersion.methodId });
  } else if (requestedMethodId) {
    method = await methodGet({ id: requestedMethodId });
    if (!method.currentVersionId) throw new Error('Method has no active version: ' + method.id);
    methodVersion = await methodVersionGet({ id: method.currentVersionId });
  }

  const spaceId = assertString(input.spaceId || method?.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });
  const ref = db().collection(THINKING_COLLECTIONS.runs).doc();
  await ref.set({
    agent: clampString(input.agent, 120) || actor.agent || 'chatgpt',
    model: clampString(input.model, 120) || actor.model || null,
    objective: assertString(input.objective, 'objective', { max: 6000 }),
    instructions: clampString(input.instructions, 12000) || '',
    trigger: clampString(input.trigger, 80) || 'chat',
    status: 'active',
    seedIdeaIds: stringArray(input.seedIdeaIds, 50, 160),
    spaceId,
    methodId: method?.id || null,
    methodVersionId: methodVersion?.id || null,
    methodVersionNumber: methodVersion?.versionNumber || null,
    createdIdeaIds: [],
    updatedIdeaIds: [],
    findings: [],
    nextActions: [],
    metadata: jsonSafe(input.metadata || {}),
    revision: 1,
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function spaceRunFinish(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const status = assertEnum(input.status, RUN_STATUSES, 'status', 'completed');
  const ref = db().collection(THINKING_COLLECTIONS.runs).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Run not found: ' + id);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error('Revision conflict: expected ' + input.expectedRevision + ', actual ' + (current.revision || 1));
    }
    tx.update(ref, {
      status,
      createdIdeaIds: [...new Set([...(current.createdIdeaIds || []), ...stringArray(input.createdIdeaIds, 200, 160)])],
      updatedIdeaIds: [...new Set([...(current.updatedIdeaIds || []), ...stringArray(input.updatedIdeaIds, 200, 160)])],
      findings: [...(current.findings || []), ...stringArray(input.findings, 100, 3000)].slice(-200),
      nextActions: [...(current.nextActions || []), ...stringArray(input.nextActions, 100, 3000)].slice(-200),
      metadata: { ...(current.metadata || {}), ...jsonSafe(input.metadataPatch || {}) },
      revision: Number(current.revision || 1) + 1,
      finishedAt: ['completed', 'failed'].includes(status) ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const snapshot = await ref.get();
  return documentToObject(snapshot);
}

async function spaceSourceAdd(input, actor = {}) {
  const ideaId = assertString(input.ideaId, 'ideaId', { max: 160 });
  const idea = await spaceIdeaGet({ id: ideaId });
  const ref = db().collection(THINKING_COLLECTIONS.sources).doc();
  await ref.set({
    ideaId,
    spaceId: clampString(input.spaceId, 160) || idea.spaceId || null,
    type: clampString(input.type, 80) || 'web',
    url: clampString(input.url, 3000) || '',
    title: clampString(input.title, 1000) || '',
    quote: clampString(input.quote, 5000) || '',
    summary: clampString(input.summary, 12000) || '',
    metadata: jsonSafe(input.metadata || {}),
    addedBy: createdBy(input.addedBy, actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function spaceEvaluationAdd(input, actor = {}) {
  const ideaId = assertString(input.ideaId, 'ideaId', { max: 160 });
  const idea = await spaceIdeaGet({ id: ideaId });
  const ref = db().collection(THINKING_COLLECTIONS.evaluations).doc();
  await ref.set({
    ideaId,
    spaceId: clampString(input.spaceId, 160) || idea.spaceId || null,
    evaluator: clampString(input.evaluator, 120) || actor.agent || 'chatgpt',
    criteria: jsonSafe(input.criteria || {}),
    comment: clampString(input.comment, 12000) || '',
    metadata: jsonSafe(input.metadata || {}),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function spaceArtifactAdd(input, actor = {}) {
  const ideaId = clampString(input.ideaId, 160) || null;
  const idea = ideaId ? await spaceIdeaGet({ id: ideaId }) : null;
  const spaceId = clampString(input.spaceId, 160) || idea?.spaceId || null;
  if (spaceId) await spaceGet({ id: spaceId });
  const ref = db().collection(THINKING_COLLECTIONS.artifacts).doc();
  await ref.set({
    ideaId,
    spaceId,
    type: clampString(input.type, 80) || 'document',
    title: assertString(input.title, 'title', { max: 1000 }),
    content: clampString(input.content, 50000) || '',
    url: clampString(input.url, 3000) || '',
    metadata: jsonSafe(input.metadata || {}),
    createdBy: createdBy(input.createdBy, actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return documentToObject(await ref.get());
}

async function spaceIdeaExpand(input, actor = {}) {
  const parentIdeaId = assertString(input.parentIdeaId, 'parentIdeaId', { max: 160 });
  const parent = await spaceIdeaGet({ id: parentIdeaId });
  if (!parent.spaceId) throw new Error('Parent idea has no Space: ' + parentIdeaId);
  const candidates = Array.isArray(input.ideas) ? input.ideas.slice(0, 20) : [];
  if (!candidates.length) throw new Error('ideas must contain at least one idea');
  const relationType = clampString(input.relationType, 80) || 'derived_from';
  const items = [];
  for (const candidate of candidates) {
    const child = await spaceIdeaCreate({
      ...candidate,
      spaceId: parent.spaceId,
      createdInRunId: candidate.createdInRunId || input.createdInRunId,
    }, actor);
    await spaceIdeaLink({
      fromIdeaId: child.id,
      toIdeaId: parentIdeaId,
      type: relationType,
      description: candidate.relationDescription || input.relationDescription,
      createdInRunId: input.createdInRunId,
    }, actor);
    items.push(child);
  }
  return { parentIdeaId, items, count: items.length, layer: 'thinking-space' };
}

async function spaceIdeaMerge(input, actor = {}) {
  const sourceIdeaIds = stringArray(input.sourceIdeaIds, 20, 160);
  if (sourceIdeaIds.length < 2) throw new Error('sourceIdeaIds must contain at least two idea IDs');
  const sourceIdeas = [];
  for (const id of sourceIdeaIds) sourceIdeas.push(await spaceIdeaGet({ id }));
  const spaces = [...new Set(sourceIdeas.map((idea) => idea.spaceId).filter(Boolean))];
  if (spaces.length !== 1) throw new Error('Thinking Space idea merge requires all source ideas to belong to the same Space');
  const merged = await spaceIdeaCreate({
    ...(input.idea || {}),
    spaceId: spaces[0],
    createdInRunId: input.createdInRunId || input.idea?.createdInRunId,
  }, actor);
  const relationType = clampString(input.relationType, 80) || 'combined_from';
  for (const sourceId of sourceIdeaIds) {
    await spaceIdeaLink({
      fromIdeaId: merged.id,
      toIdeaId: sourceId,
      type: relationType,
      description: input.relationDescription,
      createdInRunId: input.createdInRunId,
    }, actor);
  }
  return { idea: merged, sourceIdeaIds, layer: 'thinking-space' };
}

async function spaceIdeaArchive(input) {
  const reason = clampString(input.reason, 2000);
  return spaceIdeaUpdate({
    id: input.id,
    expectedRevision: input.expectedRevision,
    patch: {
      status: 'archived',
      attributesPatch: reason ? { archiveReason: reason } : {},
    },
  });
}

async function spaceIdeaCreate(input, actor = {}) {
  const spaceId = assertString(input.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });
  const database = db();
  const ref = database.collection(THINKING_COLLECTIONS.ideas).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    title: assertString(input.title, 'title', { max: 300 }),
    summary: clampString(input.summary, 3000) || '',
    content: clampString(input.content, 30000) || '',
    type: clampString(input.type, 80) || 'idea',
    status: IDEA_STATUSES.includes(input.status) ? input.status : 'active',
    maturity: IDEA_MATURITY.includes(input.maturity) ? input.maturity : 'seed',
    tags: stringArray(input.tags, 50, 80),
    domains: stringArray(input.domains, 30, 80),
    attributes: jsonSafe(input.attributes || {}),
    spaceId,
    createdBy: createdBy(input.createdBy, actor),
    createdInRunId: clampString(input.createdInRunId, 160) || null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  return documentToObject(await ref.get());
}

async function spaceDistillRun(input) {
  const spaceId = assertString(input.spaceId, 'spaceId', { max: 160 });
  await spaceGet({ id: spaceId });

  const spacePatch = {};
  ['summary', 'goal', 'currentBrief', 'status'].forEach((key) => {
    if (input[key] !== undefined) spacePatch[key] = input[key];
  });
  if (input.nextActions !== undefined) spacePatch.nextActions = input.nextActions;
  if (input.tags !== undefined) spacePatch.tags = input.tags;
  if (input.domains !== undefined) spacePatch.domains = input.domains;
  if (Object.keys(spacePatch).length) await spaceUpdate({ id: spaceId, patch: spacePatch });

  const database = db();
  const attachedIdeaIds = stringArray(input.attachIdeaIds, 200, 160);
  if (attachedIdeaIds.length) {
    const refs = await database.getAll(...attachedIdeaIds.map((id) => database.collection('ideas').doc(id)));
    const batch = database.batch();
    refs.filter((snapshot) => snapshot.exists).forEach((snapshot) => {
      batch.update(snapshot.ref, { spaceId, updatedAt: FieldValue.serverTimestamp() });
    });
    await batch.commit();
  }

  const runId = clampString(input.runId, 160);
  if (runId) {
    const runRefs = [
      database.collection(THINKING_COLLECTIONS.runs).doc(runId),
      database.collection('agent_idea_runs').doc(runId),
    ];
    const runSnapshots = await database.getAll(...runRefs);
    const runSnapshot = runSnapshots.find((snapshot) => snapshot.exists);
    if (runSnapshot) {
      await runSnapshot.ref.update({
        spaceId,
        metadata: { ...(runSnapshot.data().metadata || {}), distilledToSpaceId: spaceId },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  const createdProfileFacts = [];
  for (const fact of Array.isArray(input.profileFacts) ? input.profileFacts.slice(0, 50) : []) {
    createdProfileFacts.push(await profileFactUpsert({ ...fact, sourceRunId: fact.sourceRunId || runId || null }));
  }

  const createdDecisions = [];
  for (const decision of Array.isArray(input.decisions) ? input.decisions.slice(0, 50) : []) {
    createdDecisions.push(await decisionCreate({ ...decision, spaceId, createdInRunId: decision.createdInRunId || runId || null }));
  }

  const createdOpportunities = [];
  for (const opportunity of Array.isArray(input.opportunities) ? input.opportunities.slice(0, 50) : []) {
    createdOpportunities.push(await opportunityCreate({ ...opportunity, spaceId, createdInRunId: opportunity.createdInRunId || runId || null }));
  }

  const createdIdeas = [];
  for (const idea of Array.isArray(input.ideas) ? input.ideas.slice(0, 50) : []) {
    createdIdeas.push(await spaceIdeaCreate({ ...idea, spaceId, createdInRunId: idea.createdInRunId || runId || null }));
  }

  return {
    ok: true,
    spaceId,
    attachedIdeaIds,
    created: {
      profileFacts: createdProfileFacts.map((item) => item.id),
      decisions: createdDecisions.map((item) => item.id),
      opportunities: createdOpportunities.map((item) => item.id),
      ideas: createdIdeas.map((item) => item.id),
    },
    context: await spaceGetContext({ id: spaceId, includeArtifacts: true }),
  };
}

async function bootstrapIncomeSearchMigration() {
  const rootIdeaId = 'wCaYjTvbYlO55KM3kNO5';
  const spaceId = 'income-search';
  const database = db();
  const rootSnapshot = await database.collection('ideas').doc(rootIdeaId).get();
  if (!rootSnapshot.exists) {
    return { migrated: false, reason: 'legacy-root-not-found', rootIdeaId };
  }

  const spaceRef = database.collection(COLLECTIONS.spaces).doc(spaceId);
  const existingSpace = await spaceRef.get();
  if (existingSpace.exists && existingSpace.data().migrationState === 'complete') {
    return { migrated: false, reason: 'already-migrated', spaceId, rootIdeaId };
  }

  const root = documentToObject(rootSnapshot);
  const now = FieldValue.serverTimestamp();
  if (!existingSpace.exists) {
    await spaceRef.set({
      title: 'お金を稼ぐ方法を探す',
      summary: '在宅・ネット完結・非同期を前提に、営業や重い選考を避けながら、需要が先に存在する収益機会を継続探索する長期テーマ。',
      goal: 'まず1万円程度の初回収益を現実的に作る。正社員就職を主目的にせず、ネット上に既に存在する需要へ成果物を提出する形を優先する。',
      status: 'active',
      currentBrief: 'AI評価プラットフォームや自前マーケティング中心の案から、OSS bounty・microgrant・公開懸賞・research bountyなど「インターネット上にすでに金が置かれている未解決問題をAIで採掘する」方向へ転換。野良案件レーダーを軸に、source-of-truth、競合、支払可能性、日本からの参加可否、AIでの圧縮余地を検証して候補化する。',
      nextActions: [
        'OSS bounty / microgrant / research bounty の新規候補を追加探索する',
        '候補ごとに未アサイン・競合PR・支払実績・日本からの受領可否を検証する',
        '作業量に対する期待報酬が低い案件は早めに除外する',
      ],
      tags: ['収益化', '野良案件', 'bounty', '非同期'],
      domains: ['work', 'business', 'income'],
      legacyRootIdeaId: rootIdeaId,
      migrationState: 'running',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await spaceRef.set({ migrationState: 'running', updatedAt: now }, { merge: true });
  }

  const ideaIds = new Set([rootIdeaId]);
  let frontier = [rootIdeaId];
  for (let depth = 0; depth < 2 && frontier.length; depth += 1) {
    const next = new Set();
    for (const ideaId of frontier) {
      const [outgoing, incoming] = await Promise.all([
        database.collection('relations').where('fromIdeaId', '==', ideaId).limit(100).get(),
        database.collection('relations').where('toIdeaId', '==', ideaId).limit(100).get(),
      ]);
      [...outgoing.docs, ...incoming.docs].forEach((snapshot) => {
        const relation = snapshot.data();
        const otherId = relation.fromIdeaId === ideaId ? relation.toIdeaId : relation.fromIdeaId;
        if (otherId && !ideaIds.has(otherId)) next.add(otherId);
      });
    }
    [...next].forEach((id) => ideaIds.add(id));
    frontier = [...next];
  }

  const ideaSnapshots = await database.getAll(...[...ideaIds].map((id) => database.collection('ideas').doc(id)));
  const ideas = ideaSnapshots.filter((snapshot) => snapshot.exists).map(documentToObject);
  const attachBatch = database.batch();
  ideaSnapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => {
    attachBatch.update(snapshot.ref, { spaceId, updatedAt: FieldValue.serverTimestamp() });
  });
  await attachBatch.commit();

  const runIds = new Set(ideas.map((idea) => idea.createdInRunId).filter(Boolean));
  if (runIds.size) {
    const runSnapshots = await database.getAll(...[...runIds].map((id) => database.collection('runs').doc(id)));
    const runBatch = database.batch();
    runSnapshots.filter((snapshot) => snapshot.exists).forEach((snapshot) => {
      runBatch.update(snapshot.ref, {
        spaceId,
        metadata: { ...(snapshot.data().metadata || {}), migratedToSpaceId: spaceId },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await runBatch.commit();
  }

  const sourceRunId = root.createdInRunId || null;
  const profileFacts = [
    { statement: '仕事では対人コミュニケーションがかなり少ない働き方を好む', scope: 'work', category: 'work_preferences', stability: 'stable' },
    { statement: '仕事では非同期で進められる作業を好む', scope: 'work', category: 'work_preferences', stability: 'stable' },
    { statement: '営業・マーケティング負荷の低い収益方法を好む', scope: 'work', category: 'work_preferences', stability: 'stable' },
    { statement: '登録・試験・選考負荷の大きいプラットフォームを好まない', scope: 'work', category: 'work_preferences', stability: 'contextual' },
    { statement: 'AIで手作業を大きく圧縮できる仕事を好む', scope: 'work', category: 'technical_preferences', stability: 'stable' },
    { statement: '当面の初回収益目標は1万円程度', scope: `space:${spaceId}`, category: 'temporary_context', stability: 'temporary' },
    { statement: '現在は正社員就職を優先していない', scope: `space:${spaceId}`, category: 'temporary_context', stability: 'temporary' },
  ];
  for (const fact of profileFacts) {
    await profileFactUpsert({
      ...fact,
      evidenceType: 'explicit',
      confidence: 1,
      source: { type: 'legacy_space_migration', rootIdeaId },
      sourceRunId,
    });
  }

  const byTitle = new Map(ideas.map((idea) => [idea.title, idea]));
  const existingDecisions = await database.collection(COLLECTIONS.decisions).where('spaceId', '==', spaceId).limit(100).get();
  if (existingDecisions.empty) {
    const outlier = byTitle.get('AIトレーニング：Outlier 日本語×Coding');
    const mercor = byTitle.get('AI評価：Mercor 日本語バイリンガル AI Safety');
    const radar = byTitle.get('野良案件レーダー：需要先行・成果物提出型');
    await decisionCreate({
      spaceId,
      subjectType: 'idea',
      subjectId: outlier?.id || null,
      decision: 'reject',
      reason: '登録・試験・選考負荷が高く、案件発生も不定期で継続監視が必要なため、AI評価プラットフォーム系を主軸から外す。',
      createdInRunId: sourceRunId,
    });
    await decisionCreate({
      spaceId,
      subjectType: 'idea',
      subjectId: mercor?.id || null,
      decision: 'reject',
      reason: '高単価でもオンボーディング負荷と案件供給の不透明さが現在の希望条件に合わないため、主軸から外す。',
      createdInRunId: sourceRunId,
    });
    await decisionCreate({
      spaceId,
      subjectType: 'idea',
      subjectId: radar?.id || null,
      decision: 'adopt',
      reason: '自分で需要を作るより、すでに金が置かれている未解決問題を探し、非同期で成果物を提出する需要先行型を優先する。',
      createdInRunId: sourceRunId,
    });
  }

  const existingOpportunities = await database.collection(COLLECTIONS.opportunities).where('spaceId', '==', spaceId).limit(100).get();
  const migratedOriginIds = new Set(existingOpportunities.docs.map((snapshot) => snapshot.data().originIdeaId).filter(Boolean));
  const opportunityIdeas = ideas.filter((idea) => ['wild_gig', 'opportunity_source'].includes(idea.type));
  for (const idea of opportunityIdeas) {
    if (migratedOriginIds.has(idea.id)) continue;
    const attrs = idea.attributes || {};
    await opportunityCreate({
      spaceId,
      title: idea.title,
      summary: idea.summary || idea.content || '',
      type: idea.type === 'wild_gig' ? 'concrete_gig' : 'opportunity_source',
      status: idea.status === 'paused' ? 'paused' : 'active',
      originIdeaId: idea.id,
      reward: attrs.reward || attrs.historicalReward || attrs.rewardModel || '',
      deadline: attrs.deadline || '',
      attributes: attrs,
      createdInRunId: idea.createdInRunId || sourceRunId,
    });
  }

  await spaceRef.set({
    migrationState: 'complete',
    migratedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    migrated: true,
    spaceId,
    rootIdeaId,
    attachedIdeaCount: ideas.length,
    runCount: runIds.size,
    profileFactCount: profileFacts.length,
    opportunityCount: opportunityIdeas.length,
  };
}


async function bootstrapYoutubeEssayMethod() {
  const database = db();
  const spaceId = 'youtube-content-methodology';
  const methodId = 'tweet-intellectual-youtube-essay';
  const versionId = 'tweet-intellectual-youtube-essay-v1';
  const version2Id = 'tweet-intellectual-youtube-essay-v2';
  const now = FieldValue.serverTimestamp();
  const spaceRef = database.collection(COLLECTIONS.spaces).doc(spaceId);
  const methodRef = database.collection(COLLECTIONS.methods).doc(methodId);
  const versionRef = database.collection(COLLECTIONS.methodVersions).doc(versionId);
  const version2Ref = database.collection(COLLECTIONS.methodVersions).doc(version2Id);
  const [spaceSnapshot, methodSnapshot, versionSnapshot, version2Snapshot] = await database.getAll(
    spaceRef,
    methodRef,
    versionRef,
    version2Ref,
  );

  if (!spaceSnapshot.exists) {
    await spaceRef.set({
      title: 'YouTubeコンテンツ制作方法論',
      summary: '自分のX投稿を種に、外部知見・反論・独自統合・演出を経て、重厚だが説教臭くないYouTubeコンテンツへ発展させる方法論を継続改善するSpace。',
      goal: 'tweet固有の妙味を失わず、哲学・思想・批評・文学・社会科学などの知見との衝突から独自命題を作り、動画として面白い脚本と演出へ変換する再利用可能な制作プロトコルを育てる。',
      status: 'active',
      currentBrief: '初期Method v0.1を導入。Seed Extraction → Question Expansion → Intellectual Research → Collision → Original Synthesis → Narrative → Script → Direction → Production → Review/Method Update の10段階で運用する。引用の寄せ集めではなく、元tweetと外部知見の衝突から新しい命題を作ることを中核とする。',
      nextActions: [
        '実際のtweetを1本選び、Method v0.1でResearchからScriptまで通す',
        '完成物を評価し、退屈・説教臭さ・引用過多・元tweetの妙味喪失をMethod Feedbackとして記録する',
        '評価を踏まえてv0.2を作り、旧versionを残したままactive versionを切り替える',
      ],
      tags: ['YouTube', 'content-method', 'research', 'script', 'X過去投稿'],
      domains: ['creative', 'video', 'research', 'personal-archive'],
      revision: 1,
      bootstrapKey: 'youtube-content-methodology-v1',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!methodSnapshot.exists) {
    await methodRef.set({
      title: 'Tweet → Intellectual YouTube Essay',
      summary: '短いX投稿を、知的リサーチ・反論・独自統合・物語化を通してYouTube脚本へ発展させる再利用可能Method。',
      purpose: 'tweetを単なる引用動画や思想家紹介へ薄めず、tweetの矛盾・違和感・笑いを核に、複数の知的レンズを衝突させて独自命題を作り、最終的に映像として面白い構造へ変換する。',
      status: 'active',
      spaceId,
      tags: ['tweet', 'youtube', 'essay', 'research', 'script'],
      domains: ['creative', 'video', 'research'],
      currentVersionId: version2Id,
      currentVersionNumber: 2,
      latestVersionNumber: 2,
      revision: 1,
      createdBy: { type: 'system', agent: 'bootstrap', model: null },
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!versionSnapshot.exists) {
    await versionRef.set({
      methodId,
      versionNumber: 1,
      label: 'v0.1',
      changeSummary: 'Initial workflow: tweet seed → intellectual collision → original synthesis → narrative/script/direction → review-driven method improvement.',
      instructions: [
        '# Tweet → Intellectual YouTube Essay v0.1',
        '',
        '元tweetを主張の要約に縮めない。語感、矛盾、飛躍、笑い、気味悪さ、個人的な切実さをSeedとして保持する。',
        '',
        '外部知見は権威付けのために引用しない。tweetを支持・破壊・別方向へ曲げるための道具として使う。',
        '',
        'Researchの最終成果は思想家の紹介ではなく、元tweetと複数の知見を衝突させた結果として生まれるOriginal Thesisである。',
        '',
        '構成は論文順を避け、Hook → tweet → 一見くだらない展開 → 深掘り → 反論 → 予想外の統合 → 元tweetへの帰還を基本形とする。',
        '',
        '深くなった後でも、必要なら最後にくだらなさで全体を破壊してよい。真面目さとユーモアを二者択一にしない。',
      ].join('\n'),
      protocol: {
        input: ['source_post'],
        stages: [
          { id: 'seed_extraction', output: 'seed_brief', goal: 'tweet固有の違和感・矛盾・笑い・暗黙の前提・個人的含意を抽出する' },
          { id: 'question_expansion', output: 'question_map', goal: '元tweetから5〜15個の問いを展開し、射程を広げる' },
          { id: 'intellectual_research', output: 'research_dossier', goal: '哲学・思想・批評・文学・社会科学・歴史等から有効なレンズと一次/信頼できる二次資料を集める' },
          { id: 'collision', output: 'collision_map', goal: '支持・反論・別解・経験的批判・馬鹿馬鹿しい読みを衝突させる' },
          { id: 'original_synthesis', output: 'thesis', goal: '引用元の誰も直接言っていない独自命題を作る' },
          { id: 'narrative_design', output: 'narrative_outline', goal: '論文ではなく動画として観続けたくなる情報開示順へ変換する' },
          { id: 'script', output: 'script', goal: 'ナレーション、会話、間、フック、回収を含む脚本を作る' },
          { id: 'direction', output: 'direction_sheet', goal: 'シーン、画、テキスト、音、テンポ、演出上の反復と破壊を設計する' },
          { id: 'production', output: 'production_artifacts', goal: 'animation-factory等の実制作系へ受け渡せる形にする' },
          { id: 'review_method_update', output: 'method_feedback', goal: '完成物を評価し、次versionへ残す改善点をMethod Feedbackとして記録する' },
        ],
        researchLenses: ['philosophy', 'critical_theory', 'literature', 'sociology', 'psychology', 'history', 'empirical_counterevidence', 'humor'],
        collisionRoles: ['supporter', 'destroyer', 'sideways_reader', 'empirical_skeptic', 'comic_reducer'],
        outputs: ['seed_brief', 'question_map', 'research_dossier', 'collision_map', 'thesis', 'narrative_outline', 'script', 'direction_sheet', 'production_artifacts', 'method_feedback'],
        improvementLoop: 'run → evaluate finished content → record findings → create new method version → activate only after review',
      },
      qualityGates: [
        '元tweet固有の妙味・矛盾・語感が残っている',
        '思想家や批評家の名前を並べるだけの権威付けになっていない',
        '支持だけでなく有力な反論または別解が入っている',
        'Researchから独自命題が生成されている',
        '内容が正しくても動画として退屈なら不合格',
        '説明が説教臭くなりすぎていない',
        '最後まで真面目さを維持する必要はなく、適切ならユーモアで破壊してよい',
        '引用・出典は検証可能で、引用とAIの解釈が区別されている',
      ],
      status: 'active',
      createdBy: { type: 'system', agent: 'bootstrap', model: null },
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!version2Snapshot.exists) {
    await version2Ref.set({
      methodId,
      versionNumber: 2,
      label: 'v0.2',
      changeSummary: 'Production feedback update: standard long-form duration, free local Japanese TTS, separate spoken script, explicit attention timeline, reading-budget validation, and a 30–60s quality probe before full render.',
      instructions: [
        '# Tweet → Intellectual YouTube Essay v0.2',
        '',
        'v0.1の知的リサーチ・Collision・Original Thesisを維持しつつ、完成動画の視聴体験を制作工程の中心に置く。',
        '',
        '動画尺は目的別に分ける。short = 60–150秒、standard = 5–8分、deep = 10–20分。思想・批評系の通常制作はstandardを既定とし、短尺pilotを本編扱いしない。',
        '',
        'Script、Spoken Script、On-screen Textを別成果物として扱う。文章として良い文を、そのままTTS原稿や画面字幕へ流用しない。',
        '',
        'Spoken Scriptでは読み・句読点・間・固有語の発音を音声用に調整する。AI→エーアイ、LLM→エルエルエム等、必要なら表示文と読みを分ける。',
        '',
        'Attention Timelineを先に設計し、各beatで視聴者が何を見るかを一つに絞る。原則として同時に複数の長文を読ませない。',
        '',
        'カードや重要テキストを読ませる場面では通常字幕を抑制し、読む時間を確保する。内容理解のための静止や無音を失敗とみなさない。',
        '',
        '本番TTSは無料・ローカル実行を前提とし、有料APIや従量課金を必須にしない。現在のanimation-factory標準はVOICEVOX Nemo。必要なクレジットを成果物に保持する。',
        '',
        'ピクセルアートは背景・キャラクターの表現に使い、字幕・見出し・論点カードはフル解像度の通常フォントで描画する。',
        '',
        '長尺本番の前に30〜60秒のQuality Probeをレンダーし、音声、発音、テンポ、視線誘導、文字量、BGM、余白を確認する。probeが不合格なら本編レンダーへ進まない。',
      ].join('\n'),
      protocol: {
        input: ['source_post'],
        defaultMode: 'standard',
        durationModes: {
          short: '60–150 sec',
          standard: '5–8 min',
          deep: '10–20 min',
        },
        stages: [
          { id: 'seed_extraction', output: 'seed_brief', goal: 'tweet固有の違和感・矛盾・笑い・暗黙の前提・個人的含意を抽出する' },
          { id: 'question_expansion', output: 'question_map', goal: '元tweetから複数の問いを展開し、射程を広げる' },
          { id: 'intellectual_research', output: 'research_dossier', goal: '哲学・思想・批評・文学・社会科学・歴史等から有効なレンズと検証可能な資料を集める' },
          { id: 'collision', output: 'collision_map', goal: '支持・反論・別解・経験的批判・馬鹿馬鹿しい読みを衝突させる' },
          { id: 'original_synthesis', output: 'thesis', goal: '引用元の誰も直接言っていない独自命題を作る' },
          { id: 'narrative_design', output: 'narrative_outline', goal: '論文順ではなく動画として観続けたくなる情報開示順へ変換する' },
          { id: 'script', output: 'script', goal: '意味内容、会話、フック、回収を含む脚本を作る' },
          { id: 'spoken_script', output: 'spoken_script', goal: 'TTSまたはナレーター用に発音、句読点、間、速度を最適化した音声原稿を別に作る' },
          { id: 'attention_design', output: 'attention_timeline', goal: '各beatのvisual focus、on-screen text、reading budget、breathing roomを設計する' },
          { id: 'quality_probe', output: 'quality_probe', goal: '30〜60秒を実レンダーし、音声・発音・テンポ・視線誘導・文字可読性・BGMを検証する' },
          { id: 'production', output: 'production_artifacts', goal: 'probe承認後にanimation-factory等で長尺本編を制作する' },
          { id: 'review_method_update', output: 'method_feedback', goal: '完成物とprobeの差分を評価し、次versionへ残す改善点を記録する' },
        ],
        researchLenses: ['philosophy', 'critical_theory', 'literature', 'sociology', 'psychology', 'history', 'empirical_counterevidence', 'humor'],
        collisionRoles: ['supporter', 'destroyer', 'sideways_reader', 'empirical_skeptic', 'comic_reducer'],
        productionDefaults: {
          paidCloudTtsRequired: false,
          japaneseTts: 'VOICEVOX Nemo local',
          typography: 'full-resolution DOM/sans-serif',
          readingBudget: 'about 8 Japanese chars/sec plus buffer',
          maxPrimaryReadingTargets: 1,
          qualityProbeSeconds: '30–60',
        },
        outputs: ['seed_brief', 'question_map', 'research_dossier', 'collision_map', 'thesis', 'narrative_outline', 'script', 'spoken_script', 'attention_timeline', 'quality_probe', 'production_artifacts', 'method_feedback'],
        improvementLoop: 'run → quality probe → full production → evaluate → record findings → create next method version → activate after review',
      },
      qualityGates: [
        '元tweet固有の妙味・矛盾・語感が残っている',
        '思想家や批評家の名前を並べるだけの権威付けになっていない',
        '支持だけでなく有力な反論または別解が入っている',
        'Researchから独自命題が生成されている',
        'standard本編は原則5〜8分の内容密度を持ち、短いpilotを本編として扱わない',
        'ScriptとSpoken ScriptとOn-screen Textが意図的に分離されている',
        '一画面の主たる読解対象は原則1つである',
        '表示文字に十分なreading budgetがあり、長文カードと通常字幕を同時に読ませない',
        '30〜60秒Quality Probeで音声・発音・テンポ・視線誘導・文字可読性・BGMを確認している',
        '日本語TTSの既定経路が無料・ローカルで、有料APIを必須にしていない',
        '背景・キャラクターのpixel artと、通常フォントの情報テキストが役割分離されている',
        '内容が正しくても動画として退屈なら不合格',
        '説明が説教臭くなりすぎていない',
        '適切なら最後にユーモアで真面目さを破壊してよい',
        '引用・出典は検証可能で、引用とAIの解釈が区別されている',
      ],
      status: Number(methodSnapshot.data()?.currentVersionNumber || 0) > 2 ? 'superseded' : 'active',
      createdBy: { type: 'system', agent: 'bootstrap', model: null },
      createdAt: now,
      updatedAt: now,
    });
  }

  const currentMethodVersion = Number(methodSnapshot.data()?.currentVersionNumber || 0);
  if (!methodSnapshot.exists || currentMethodVersion < 2) {
    await methodRef.set({
      currentVersionId: version2Id,
      currentVersionNumber: 2,
      latestVersionNumber: Math.max(2, Number(methodSnapshot.data()?.latestVersionNumber || 0)),
      revision: Math.max(2, Number(methodSnapshot.data()?.revision || 0) + 1),
      updatedAt: now,
    }, { merge: true });
    await versionRef.set({
      status: 'superseded',
      updatedAt: now,
    }, { merge: true });
  }

  if (
    spaceSnapshot.exists &&
    spaceSnapshot.data()?.bootstrapKey === 'youtube-content-methodology-v1'
  ) {
    await spaceRef.set({
      currentBrief: 'Method v0.2へ更新。知的リサーチと独自命題の生成に加え、Script → Spoken Script → Attention Timeline → 30〜60秒Quality Probe → Full Production を標準工程とする。通常の思想系本編は5〜8分を既定とし、日本語TTSは有料APIに依存せずローカル無料経路を使う。',
      nextActions: [
        'VOICEVOX Nemo + attention timelineのQuality Probeを確認する',
        'probeの音声・テンポ・視線誘導を評価して本編productionへ反映する',
        '5〜8分standard版を制作し、完成後にMethod v0.3候補の改善点を記録する',
      ],
      bootstrapKey: 'youtube-content-methodology-v2',
      revision: FieldValue.increment(1),
      updatedAt: now,
    }, { merge: true });
  }

  return {
    ok: true,
    spaceId,
    methodId,
    versionId: version2Id,
    version1Id: versionId,
    version2Id,
    created: {
      space: !spaceSnapshot.exists,
      method: !methodSnapshot.exists,
      version: !versionSnapshot.exists,
    },
  };
}


function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return Date.parse(value) || 0;
}

function linearPriorityToWorkItem(value) {
  const priority = Number(value?.value ?? value);
  if (priority === 1) return 'critical';
  if (priority === 2) return 'high';
  if (priority === 4) return 'low';
  return 'medium';
}

function workItemPriorityToLinear(value) {
  if (value === 'critical') return 1;
  if (value === 'high') return 2;
  if (value === 'medium') return 3;
  if (value === 'low') return 4;
  return 0;
}

function linearStatusToWorkItem(statusType) {
  const type = String(statusType || '').toLowerCase();
  if (type === 'completed' || type === 'canceled' || type === 'cancelled') return 'archived';
  if (type === 'backlog' || type === 'triage') return 'backlog';
  if (type === 'started') return 'in_progress';
  return 'ready';
}

function workItemStatusToLinear(status) {
  if (status === 'backlog') return 'backlog';
  if (status === 'archived' || status === 'done') return 'completed';
  if (status === 'cancelled') return 'canceled';
  if (['in_progress', 'running', 'blocked', 'review'].includes(status)) return 'started';
  return 'unstarted';
}

function linearLabelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter(Boolean)
    .map((label) => String(label).slice(0, 100));
}

function linearIssueMetadata(issue) {
  return {
    issueId: clampString(issue?.id, 200) || null,
    identifier: clampString(issue?.identifier, 200) || clampString(issue?.id, 200) || null,
    url: clampString(issue?.url, 3000) || '',
    status: clampString(typeof issue?.status === 'string' ? issue.status : issue?.status?.name, 160) || '',
    statusType: clampString(issue?.statusType || issue?.status?.type, 80) || '',
    priority: Number(issue?.priority?.value ?? issue?.priority ?? 0) || 0,
    project: clampString(typeof issue?.project === 'string' ? issue.project : issue?.project?.name, 500) || '',
    team: clampString(typeof issue?.team === 'string' ? issue.team : issue?.team?.name, 300) || '',
    assignee: clampString(typeof issue?.assignee === 'string' ? issue.assignee : issue?.assignee?.name, 300) || '',
    delegate: clampString(typeof issue?.delegate === 'string' ? issue.delegate : issue?.delegate?.name, 300) || '',
    dueDate: clampString(issue?.dueDate, 120) || null,
    updatedAt: clampString(issue?.updatedAt, 120) || null,
    syncedAt: new Date().toISOString(),
  };
}

async function ensureLinearSetupTask() {
  const ref = db().collection(COLLECTIONS.workItems).doc(LINEAR_SETUP_WORK_ITEM_ID);
  const configured = linearBridge.isConfigured();

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? snapshot.data() : null;

    if (configured) {
      if (
        current &&
        current.sourceType === 'system_integration' &&
        current.sourceId === 'linear' &&
        !['archived', 'done', 'cancelled'].includes(current.status)
      ) {
        tx.update(ref, {
          status: 'archived',
          completedBy: 'system',
          resultSummary: 'LINEAR_API_KEYを検出しました。My Portal MCPからLinear公式Remote MCPを利用できます。',
          finishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          revision: Number(current.revision || 1) + 1,
        });
      }
      return;
    }

    if (
      current &&
      current.sourceType === 'system_integration' &&
      current.sourceId === 'linear' &&
      current.executionMode === 'human' &&
      current.status === 'ready'
    ) {
      return;
    }

    const now = FieldValue.serverTimestamp();
    const payload = {
      title: 'Linear連携: APIキーをNetlifyへ設定',
      objective: 'My Portal MCPからLinearのIssue・Project・Comment等を読み書きできるようにする。',
      instructions: 'Linearの Settings > Account > Security & Access でPersonal API keyを作成し、Netlify site my-portal-agent の秘密環境変数 LINEAR_API_KEY に直接保存する。キーはチャットやWork Item本文に貼らない。必要なら LINEAR_TEAM_KEY=MY も設定する。',
      status: 'ready',
      priority: 'high',
      executionMode: 'human',
      humanReason: 'Linearの個人APIキー発行とNetlifyへの秘密情報登録は本人操作が必要です。',
      spaceId: null,
      projectId: null,
      sourceType: 'system_integration',
      sourceId: 'linear',
      dependencies: [],
      tags: ['integration', 'linear'],
      dueAt: null,
      metadata: {
        integration: 'linear',
        envVar: 'LINEAR_API_KEY',
        optionalTeamEnvVar: 'LINEAR_TEAM_KEY',
        defaultTeamKey: linearBridge.teamKey(),
        secretHandling: 'Store directly in Netlify. Never paste the API key into chat or Firestore.',
      },
      claimedBy: null,
      claimedModel: null,
      runId: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      blockedReason: '',
      resultSummary: '',
      nextActions: [
        'LinearでPersonal API keyを発行する',
        'NetlifyのLINEAR_API_KEYへ保存する',
        'My Portal MCPを再接続してlinear_statusを確認する',
      ],
      requestedBy: 'system',
      updatedAt: now,
      revision: Number(current?.revision || 0) + 1,
    };

    if (snapshot.exists) {
      tx.set(ref, payload, { merge: true });
    } else {
      tx.set(ref, {
        ...payload,
        createdBy: { type: 'system', agent: 'my-portal', model: null },
        createdAt: now,
      });
    }
  });

  return documentToObject(await ref.get());
}


function managerJobPayload(input) {
  return {
    title: assertString(input.title, 'title', { max: 500 }),
    objective: clampString(input.objective, 12000) || '',
    instructions: clampString(input.instructions, 20000) || '',
    status: assertEnum(input.status, MANAGER_JOB_STATUSES, 'status', 'active'),
    priority: assertEnum(input.priority, WORK_ITEM_PRIORITIES, 'priority', 'medium'),
    spaceId: clampString(input.spaceId, 160) || null,
    projectId: clampString(input.projectId, 160) || null,
    organizationId: clampString(input.organizationId, 160) || null,
    methodId: clampString(input.methodId, 160) || null,
    defaultWorkerMethodId: clampString(input.defaultWorkerMethodId || input.metadata?.defaultWorkerMethodId, 160) || null,
    concurrencyPolicy: assertEnum(
      input.concurrencyPolicy,
      MANAGER_JOB_CONCURRENCY_POLICIES,
      'concurrencyPolicy',
      'skip_if_open'
    ),
    rotationTargets: stringArray(input.rotationTargets, 100, 160),
    requireExecutionReceipt: input.requireExecutionReceipt === true,
    allowedActionTypes: stringArray(input.allowedActionTypes, 30, 80),
    targetProgress: {},
    tags: stringArray(input.tags, 50, 100),
    metadata: jsonSafe(input.metadata || {}),
    revision: 1,
  };
}

async function managerJobCreate(input, actor = {}) {
  const payload = managerJobPayload(input);
  if (payload.spaceId) await spaceGet({ id: payload.spaceId });
  if (payload.methodId) await methodGet({ id: payload.methodId });
  if (payload.defaultWorkerMethodId) await methodGet({ id: payload.defaultWorkerMethodId });

  const requestedId = clampString(input.id, 160);
  const ref = requestedId
    ? db().collection(COLLECTIONS.managerJobs).doc(requestedId)
    : db().collection(COLLECTIONS.managerJobs).doc();

  if (requestedId) {
    const existing = await ref.get();
    if (existing.exists) throw new Error('Manager job already exists: ' + requestedId);
  }

  const now = FieldValue.serverTimestamp();
  const jobData = {
    ...payload,
    startCount: 0,
    finishCount: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastManagerRunId: null,
    lastExecutionStatus: null,
    lastResultSummary: '',
    createdBy: createdBy(input.createdBy, actor),
    createdAt: now,
    updatedAt: now,
  };
  if (payload.organizationId) {
    await db().runTransaction(async (tx) => {
      const org = await tx.get(db().collection(COLLECTIONS.organizations).doc(payload.organizationId));
      organizationLifecycle.assertCanManage(org.exists ? org.data() : null);
      const old = await tx.get(ref);
      if (old.exists) throw new Error('Manager job already exists: ' + ref.id);
      tx.set(ref, jobData);
    });
  } else {
    await ref.set(jobData);
  }
  return documentToObject(await ref.get());
}

async function managerJobGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.managerJobs).doc(id).get();
  if (!snapshot.exists) throw new Error('Manager job not found: ' + id);
  return documentToObject(snapshot);
}

async function managerJobSearch(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 5, 100), limit), 1000);
  const [snapshot, workSnapshot] = await Promise.all([
    db().collection(COLLECTIONS.managerJobs).limit(scanLimit).get(),
    db().collection(COLLECTIONS.workItems).limit(1000).get(),
  ]);
  const q = clampString(input.query, 400)?.toLowerCase();
  const status = clampString(input.status, 40);
  const projectId = clampString(input.projectId, 160);
  const spaceId = clampString(input.spaceId, 160);
  const methodId = clampString(input.methodId, 160);
  const organizationId = clampString(input.organizationId, 160);
  const managedWork = workSnapshot.docs.map(documentToObject)
    .filter((item) => item.sourceType === 'manager_job' && item.sourceId);

  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((item) => {
      if (status && item.status !== status) return false;
      if (projectId && item.projectId !== projectId) return false;
      if (spaceId && item.spaceId !== spaceId) return false;
      if (methodId && item.methodId !== methodId) return false;
      if (organizationId && item.organizationId !== organizationId) return false;
      if (q) {
        const haystack = [
          item.title,
          item.objective,
          item.instructions,
          ...(item.tags || []),
        ].filter(Boolean).join('\n').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .slice(0, limit)
    .map((item) => {
      const workerItems = managedWork.filter((work) => work.sourceId === item.id);
      const open = workerItems.filter((work) => !['archived', 'done', 'cancelled'].includes(work.status));
      const count = (targetStatus) => open.filter((work) => work.status === targetStatus).length;
      return {
        ...item,
        targetProgress: trustedTargetProgress(item, workerItems),
        managedWorkSummary: {
          open: open.length,
          running: count('running'),
          blocked: count('blocked'),
          review: count('review'),
          ready: count('ready'),
          inProgress: count('in_progress'),
          backlog: count('backlog'),
        },
      };
    });

  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

async function managerJobUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const nextSpaceId = patch.spaceId !== undefined ? (clampString(patch.spaceId, 160) || null) : undefined;
  const nextMethodId = patch.methodId !== undefined ? (clampString(patch.methodId, 160) || null) : undefined;
  const nextDefaultWorkerMethodId = patch.defaultWorkerMethodId !== undefined
    ? (clampString(patch.defaultWorkerMethodId, 160) || null)
    : undefined;
  if (nextSpaceId) await spaceGet({ id: nextSpaceId });
  if (nextMethodId) await methodGet({ id: nextMethodId });
  if (nextDefaultWorkerMethodId) await methodGet({ id: nextDefaultWorkerMethodId });

  const ref = db().collection(COLLECTIONS.managerJobs).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Manager job not found: ' + id);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error('Revision conflict: expected ' + input.expectedRevision + ', actual ' + (current.revision || 1));
    }
    if (current.organizationId && patch.status === 'active') {
      const owner = await tx.get(db().collection(COLLECTIONS.organizations).doc(current.organizationId));
      organizationLifecycle.assertCanManage(owner.exists ? owner.data() : null);
    }

    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 500 });
    if (patch.objective !== undefined) update.objective = clampString(patch.objective, 12000) || '';
    if (patch.instructions !== undefined) update.instructions = clampString(patch.instructions, 20000) || '';
    if (patch.status !== undefined) update.status = assertEnum(patch.status, MANAGER_JOB_STATUSES, 'patch.status', current.status || 'active');
    if (patch.priority !== undefined) update.priority = assertEnum(patch.priority, WORK_ITEM_PRIORITIES, 'patch.priority', current.priority || 'medium');
    if (patch.spaceId !== undefined) update.spaceId = nextSpaceId;
    if (patch.projectId !== undefined) update.projectId = clampString(patch.projectId, 160) || null;
    if (patch.organizationId !== undefined) {
      const nextOrgId = clampString(patch.organizationId, 160) || null;
      if (current.organizationId && current.organizationId !== nextOrgId) {
        throw new Error('Organization reassignment requires a separate migration; do not detach a Manager Job in place');
      }
      if (nextOrgId) {
        const orgSnapshot = await tx.get(db().collection(COLLECTIONS.organizations).doc(nextOrgId));
        organizationLifecycle.assertCanManage(orgSnapshot.exists ? orgSnapshot.data() : null);
      }
      update.organizationId = nextOrgId;
    }
    if (patch.methodId !== undefined) update.methodId = nextMethodId;
    if (patch.defaultWorkerMethodId !== undefined) update.defaultWorkerMethodId = nextDefaultWorkerMethodId;
    if (patch.concurrencyPolicy !== undefined) {
      update.concurrencyPolicy = assertEnum(
        patch.concurrencyPolicy,
        MANAGER_JOB_CONCURRENCY_POLICIES,
        'patch.concurrencyPolicy',
        current.concurrencyPolicy || 'skip_if_open'
      );
    }
    if (patch.tags !== undefined) update.tags = stringArray(patch.tags, 50, 100);
    if (patch.rotationTargets !== undefined) update.rotationTargets = stringArray(patch.rotationTargets, 100, 160);
    if (patch.requireExecutionReceipt !== undefined) update.requireExecutionReceipt = patch.requireExecutionReceipt === true;
    if (patch.allowedActionTypes !== undefined) update.allowedActionTypes = stringArray(patch.allowedActionTypes, 30, 80);
    if (patch.metadata !== undefined) update.metadata = jsonSafe(patch.metadata || {});
    if (patch.metadataPatch !== undefined) {
      update.metadata = { ...(current.metadata || {}), ...jsonSafe(patch.metadataPatch || {}) };
    }
    tx.update(ref, update);
  });
  return managerJobGet({ id });
}

function jobRotationTargets(job) {
  return stringArray(Array.isArray(job.rotationTargets) ? job.rotationTargets : job.metadata?.rotationTargets, 100, 160);
}

function jobRequiresReceipt(job) {
  return job.requireExecutionReceipt === undefined
    ? job.metadata?.requireExecutionReceipt === true
    : job.requireExecutionReceipt === true;
}

async function managerRunGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.managerRuns).doc(id).get();
  if (!snapshot.exists) throw new Error('Manager run not found: ' + id);
  return documentToObject(snapshot);
}

async function managerJobHistory(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  await managerJobGet({ id });
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 200);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || 300, limit), 1000);
  const snapshot = await db().collection(COLLECTIONS.managerRuns).limit(scanLimit).get();
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((item) => item.managerJobId === id)
    .slice(0, limit);
  return { id, items, count: items.length, scanned: snapshot.size };
}

async function managerJobGetContext(input) {
  const job = await managerJobGet({ id: input.id });
  const [methodContext, workerMethodContext, managerHistory, space, projectSnapshot, workSnapshot, jobWorkSnapshot, operatingModel] = await Promise.all([
    job.methodId
      ? methodGetContext({
        id: job.methodId,
        versionLimit: Math.min(Math.max(Number(input.versionLimit) || 3, 1), 50),
        runLimit: Math.min(Math.max(Number(input.runLimit) || 5, 1), 100),
      })
      : Promise.resolve(null),
    (job.defaultWorkerMethodId || job.metadata?.defaultWorkerMethodId)
      ? methodGetContext({
        id: job.defaultWorkerMethodId || job.metadata?.defaultWorkerMethodId,
        versionLimit: Math.min(Math.max(Number(input.versionLimit) || 3, 1), 50),
        runLimit: Math.min(Math.max(Number(input.runLimit) || 5, 1), 100),
      })
      : Promise.resolve(null),
    managerJobHistory({ id: job.id, limit: Math.min(Math.max(Number(input.historyLimit) || 10, 1), 100) }),
    job.spaceId ? spaceGet({ id: job.spaceId }).catch(() => null) : Promise.resolve(null),
    job.projectId ? db().collection('projects').doc(job.projectId).get() : Promise.resolve(null),
    db().collection(COLLECTIONS.workItems).limit(1000).get(),
    db().collection(COLLECTIONS.workItems).where('sourceId', '==', job.id).limit(1000).get(),
    agentHqOperatingModel(),
  ]);

  const allWork = sortRecent(workSnapshot.docs.map(documentToObject));
  const outcomeProgress = trustedTargetProgress(job, jobWorkSnapshot.docs.map(documentToObject));
  const queue = allWork
    .filter((item) => item.sourceType !== 'system_incident')
    .filter((item) => !['archived', 'done', 'cancelled'].includes(item.status))
    .filter((item) => !job.projectId || item.projectId === job.projectId)
    .slice(0, 120)
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      executionMode: item.executionMode || 'agent',
      projectId: item.projectId || null,
      sourceType: item.sourceType || null,
      sourceId: item.sourceId || null,
      claimedBy: item.claimedBy || null,
      blockedReason: clampString(item.blockedReason, 500) || '',
      resultSummary: clampString(item.resultSummary, 800) || '',
      escalation: item.metadata?.escalation || null,
      managerRunId: item.metadata?.managerJob?.managerRunId || null,
      managerReason: clampString(item.metadata?.managerJob?.reason, 1000) || '',
      updatedAt: item.updatedAt,
    }));

  const workerEscalations = allWork
    .filter((item) => item.metadata?.escalation?.status === 'reported')
    .filter((item) => item.sourceType === 'manager_job' && item.sourceId === job.id)
    .slice(0, 50)
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      escalation: item.metadata?.escalation,
      blockedReason: clampString(item.blockedReason, 1000) || '',
      updatedAt: item.updatedAt,
    }));

  const relatedIncidents = allWork
    .filter((item) => item.sourceType === 'system_incident')
    .filter((item) =>
      item.sourceId === job.id
      || (item.metadata?.incident?.affectedManagerJobIds || []).includes(job.id)
    );
  const activeIncidents = relatedIncidents.filter((item) => !['archived', 'done', 'cancelled'].includes(item.status)).slice(0, 50);
  const recentResolvedIncidents = relatedIncidents.filter((item) => ['archived', 'done', 'cancelled'].includes(item.status)).slice(0, 20);

  return {
    job: { ...job, targetProgress: outcomeProgress },
    managementContract: {
      managerJobId: job.id,
      objective: job.objective,
      instructions: job.instructions,
      projectId: job.projectId,
      priority: job.priority,
      concurrencyPolicy: job.concurrencyPolicy || 'skip_if_open',
      observationTargets: jobRotationTargets(job),
      targetProgress: outcomeProgress,
      generatedWorkPolicy: {
        requireExecutionReceipt: jobRequiresReceipt(job),
        allowedActionTypes: job.allowedActionTypes || job.metadata?.allowedActionTypes || [],
        readyRequiresCapabilityMatch: job.metadata?.readyRequiresCapabilityMatch === true,
        workerCapabilityProfile: job.metadata?.workerCapabilityProfile || null,
        defaultWorkerMethodId: job.defaultWorkerMethodId || job.metadata?.defaultWorkerMethodId || null,
        defaultWorkerMethod: workerMethodContext?.executionContract || null,
      },
      managerRuntimeRequirements: runtimeRequirementsFromMethodExecution(methodContext?.executionContract),
      operatingModel,
      escalationPolicy: {
        workerReportsToManagerFirst: true,
        incidentSourceType: 'system_incident',
        incidentThreshold: operatingModel.escalation.incidentThreshold,
      },
      method: methodContext?.executionContract || null,
      loop: ['observe', 'reconcile', 'decide', 'delegate'],
      principle: 'A Manager Run may create zero, one, or many Work Items. The Manager should manage the queue rather than perform the underlying worker task itself.',
    },
    method: methodContext,
    workerMethod: workerMethodContext,
    space,
    project: projectSnapshot && projectSnapshot.exists ? documentToObject(projectSnapshot) : null,
    currentQueue: queue,
    workerEscalations,
    systemIncidents: {
      active: activeIncidents,
      recentResolved: recentResolvedIncidents,
    },
    operatingModel,
    organization: job.organizationId ? await organizationRegistry.organizationGet({ id: job.organizationId }) : null,
    recentManagerRuns: managerHistory.items,
  };
}

async function managerJobStart(input, actor = {}) {
  const jobId = assertString(input.id, 'id', { max: 160 });
  const initialJob = await managerJobGet({ id: jobId });
  if (initialJob.status !== 'active') throw new Error('Manager job is not active: ' + initialJob.status);
  const invocationId = clampString(input.invocationId, 300) || null;
  const requestedBy = clampString(input.requestedBy || actor.agent, 120) || 'external-trigger';
  const methodContext = initialJob.methodId
    ? await methodGetContext({ id: initialJob.methodId, versionLimit: 3, runLimit: 3 })
    : null;
  const methodExecution = methodContext?.executionContract || null;

  const jobRef = db().collection(COLLECTIONS.managerJobs).doc(jobId);
  const runs = db().collection(COLLECTIONS.managerRuns);
  const runRef = runs.doc();
  let outcome;

  await db().runTransaction(async (tx) => {
    const jobSnapshot = await tx.get(jobRef);
    if (!jobSnapshot.exists) throw new Error('Manager job not found: ' + jobId);
    const job = documentToObject(jobSnapshot);
    if (job.status !== 'active') throw new Error('Manager job is not active: ' + job.status);
    let organizationContext = null;
    if (job.organizationId) {
      const org = await tx.get(db().collection(COLLECTIONS.organizations).doc(job.organizationId));
      organizationLifecycle.assertCanManage(org.exists ? org.data() : null);
      const owner = org.data();
      organizationContext = {
        id: job.organizationId, status: owner.status, mission: owner.mission,
        systemOfRecord: owner.systemOfRecord || null,
        outcomeContract: owner.outcomeContract || {},
        operatingPolicy: owner.operatingPolicy || {},
        policyRevision: owner.revision || 1,
      };
    }
    if (job.methodId !== initialJob.methodId) throw new Error('Manager job Method changed during start; retry');

    const existingSnapshot = await tx.get(runs.where('managerJobId', '==', jobId).limit(200));
    const existingRuns = sortRecent(existingSnapshot.docs.map(documentToObject));
    const duplicate = invocationId && existingRuns.find((run) => run.invocationId === invocationId);
    if (duplicate) {
      outcome = { created: false, duplicate: true, skipped: false, reason: 'invocation_already_materialized', managerRun: duplicate };
      return;
    }
    const open = (job.concurrencyPolicy || 'skip_if_open') === 'skip_if_open'
      && existingRuns.find((run) => ['ready', 'running'].includes(run.status));
    if (open) {
      outcome = { created: false, duplicate: false, skipped: true, resumable: true, reason: 'open_manager_run_exists', managerRun: open };
      return;
    }

    const now = FieldValue.serverTimestamp();
    tx.set(runRef, {
      managerJobId: jobId,
      title: job.title,
      objective: job.objective || '',
      instructions: job.instructions || '',
      projectId: job.projectId || null,
      organizationId: job.organizationId || null,
      organizationContext,
      spaceId: job.spaceId || null,
      priority: job.priority || 'medium',
      methodId: methodExecution?.methodId || job.methodId || null,
      methodVersionId: methodExecution?.methodVersionId || null,
      methodVersionNumber: methodExecution?.methodVersionNumber || null,
      runtimeRequirements: runtimeRequirementsFromMethodExecution(methodExecution),
      runtimeAvailability: null,
      runtimeGap: null,
      observationTargets: jobRotationTargets(job),
      invocationId,
      requestedBy,
      status: 'ready',
      claimedBy: null,
      claimedModel: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      createdWorkItemIds: [],
      updatedWorkItemIds: [],
      archivedWorkItemIds: [],
      observations: [],
      decisions: [],
      summary: '',
      createdBy: createdBy({}, actor),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    });
    tx.update(jobRef, {
      lastStartedAt: now,
      lastManagerRunId: runRef.id,
      lastExecutionStatus: 'manager_ready',
      startCount: FieldValue.increment(1),
      updatedAt: now,
    });
    outcome = { created: true, duplicate: false, skipped: false };
  });

  const job = await managerJobGet({ id: jobId });
  if (!outcome.created) return { ...outcome, job, method: methodExecution };
  return { ...outcome, job, managerRun: await managerRunGet({ id: runRef.id }), method: methodExecution };
}

async function managerRunClaim(input, actor = {}) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent || actor.agent, 'agent', { max: 120 });
  const model = clampString(input.model || actor.model, 120) || null;
  const leaseMinutes = Math.min(Math.max(Number(input.leaseMinutes) || 60, 10), 1440);
  const availability = runtimeAvailability(input);
  const ref = db().collection(COLLECTIONS.managerRuns).doc(id);
  const nowMs = Date.now();

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Manager run not found: ' + id);
    const current = snapshot.data();
    if (!['ready', 'running'].includes(current.status)) throw new Error('Manager run is not claimable: ' + current.status);
    const leaseMs = timestampMillis(current.leaseExpiresAt);
    if (current.claimedBy && current.claimedBy !== agent && leaseMs > nowMs) {
      throw new Error('Manager run is claimed by ' + current.claimedBy);
    }
    const runtimeGap = compareRuntimeRequirements(current.runtimeRequirements || {}, availability);
    if (!runtimeGap.ok) {
      throw new Error('MANAGER_RUNTIME_REQUIREMENTS_UNMET ' + JSON.stringify({
        managerJobId: current.managerJobId,
        methodId: current.methodId || null,
        methodVersionId: current.methodVersionId || null,
        runtimeRequirements: normalizeRuntimeRequirements(current.runtimeRequirements || {}),
        runtimeAvailability: availability,
        runtimeGap,
      }));
    }
    tx.update(ref, {
      status: 'running',
      claimedBy: agent,
      claimedModel: model,
      runtimeAvailability: availability,
      runtimeGap,
      leaseExpiresAt: new Date(nowMs + leaseMinutes * 60 * 1000),
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      startedAt: current.startedAt || FieldValue.serverTimestamp(),
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return managerRunGet({ id });
}

async function managerRunHeartbeat(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent, 'agent', { max: 120 });
  const leaseMinutes = Math.min(Math.max(Number(input.leaseMinutes) || 60, 10), 1440);
  const ref = db().collection(COLLECTIONS.managerRuns).doc(id);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Manager run not found: ' + id);
    const current = snapshot.data();
    if (current.status !== 'running' || current.claimedBy !== agent) {
      throw new Error('Manager run is not claimed by ' + agent);
    }
    tx.update(ref, {
      leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60 * 1000),
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return managerRunGet({ id });
}

async function managerRunCreateWorkItem(input, actor = {}) {
  const runId = assertString(input.runId, 'runId', { max: 160 });
  const agent = assertString(input.agent || actor.agent, 'agent', { max: 120 });
  const runRef = db().collection(COLLECTIONS.managerRuns).doc(runId);
  const itemRef = db().collection(COLLECTIONS.workItems).doc();
  let existing = null;

  await db().runTransaction(async (tx) => {
    const runSnapshot = await tx.get(runRef);
    if (!runSnapshot.exists) throw new Error('Manager run not found: ' + runId);
    const run = runSnapshot.data();
    if (run.status !== 'running' || run.claimedBy !== agent) throw new Error('Manager run is not claimed by ' + agent);
    const jobRef = db().collection(COLLECTIONS.managerJobs).doc(run.managerJobId);
    const jobSnapshot = await tx.get(jobRef);
    if (!jobSnapshot.exists) throw new Error('Manager job not found: ' + run.managerJobId);
    const job = jobSnapshot.data();
    if (job.organizationId) {
      const org = await tx.get(db().collection(COLLECTIONS.organizations).doc(job.organizationId));
      organizationLifecycle.assertCanManage(org.exists ? org.data() : null);
    }

    const dedupeKey = clampString(input.dedupeKey, 300) || null;
    if (dedupeKey) {
      const candidateSnapshot = await tx.get(db().collection(COLLECTIONS.workItems).where('sourceId', '==', run.managerJobId).limit(1000));
      existing = candidateSnapshot.docs
        .map(documentToObject)
        .find((item) =>
          item.sourceType === 'manager_job'
          && !['archived', 'done', 'cancelled'].includes(item.status)
          && item.metadata?.managerJob?.dedupeKey === dedupeKey
        ) || null;
      if (existing) return;
    }

    validateSeoManagerWorkItem(input, job);

    const workerMethodId = clampString(input.workerMethodId, 160)
      || job.defaultWorkerMethodId
      || job.metadata?.defaultWorkerMethodId
      || null;
    let workerMethodRequirements = normalizeRuntimeRequirements({});
    if (workerMethodId) {
      const workerMethodSnapshot = await tx.get(db().collection(COLLECTIONS.methods).doc(workerMethodId));
      if (!workerMethodSnapshot.exists) throw new Error('Worker Method not found: ' + workerMethodId);
      const workerMethod = workerMethodSnapshot.data();
      if (!workerMethod.currentVersionId) throw new Error('Worker Method has no active version: ' + workerMethodId);
      const workerVersionSnapshot = await tx.get(db().collection(COLLECTIONS.methodVersions).doc(workerMethod.currentVersionId));
      if (!workerVersionSnapshot.exists) throw new Error('Worker Method active version not found: ' + workerMethod.currentVersionId);
      workerMethodRequirements = normalizeRuntimeRequirements(workerVersionSnapshot.data().protocol?.runtimeRequirements || {});
    }

    const targetId = clampString(input.targetId, 160) || null;
    const configuredTargets = jobRotationTargets(job);
    if (targetId && configuredTargets.length && !configuredTargets.includes(targetId)) {
      throw new Error('targetId must be one of the Manager Job observation targets');
    }

    const payload = workItemPayload({
      title: input.title,
      objective: input.objective,
      instructions: input.instructions,
      status: input.status || 'ready',
      priority: input.priority || job.priority || 'medium',
      executionMode: input.executionMode || 'agent',
      humanReason: input.humanReason,
      spaceId: input.spaceId !== undefined ? input.spaceId : (job.spaceId || null),
      projectId: input.projectId !== undefined ? input.projectId : (job.projectId || null),
      sourceType: 'manager_job',
      sourceId: run.managerJobId,
      workerMethodId,
      dependencies: input.dependencies || [],
      tags: [...(input.tags || []), 'manager-job'],
      dueAt: input.dueAt,
      metadata: {
        ...(jsonSafe(input.metadata || {})),
        organizationId: job.organizationId || null,
        organizationPolicyRevision: run.organizationContext?.policyRevision || null,
        managerJob: {
          id: run.managerJobId,
          managerRunId: runId,
          dedupeKey,
          reason: clampString(input.reason, 4000) || '',
          targetId,
          managerMethodId: run.methodId || null,
          managerMethodVersionId: run.methodVersionId || null,
          managerMethodVersionNumber: run.methodVersionNumber || null,
        },
        workerPolicy: {
          requireExecutionReceipt: jobRequiresReceipt(job),
          allowedActionTypes: job.allowedActionTypes || job.metadata?.allowedActionTypes || [],
        },
      },
    });
    if (payload.status === 'running') throw new Error('Manager-created Work Items cannot start as running; create ready or in_progress');

    if (['ready', 'in_progress'].includes(payload.status) && (job.organizationId || job.metadata?.readyRequiresCapabilityMatch === true)) {
      const execution = payload.metadata?.execution || {};
      const itemRequirements = {
        requiredCapabilities: stringArray(execution.requiredCapabilities, 50, 160),
        requiredTools: stringArray(execution.requiredTools, 50, 160),
      };
      const combinedRequirements = mergeRuntimeRequirements(workerMethodRequirements, itemRequirements);
      const expectedAvailability = {
        capabilities: stringArray(job.metadata?.workerCapabilityProfile?.capabilities, 100, 160),
        tools: stringArray(job.metadata?.workerCapabilityProfile?.tools, 100, 160),
      };
      if (!workerMethodId) {
        throw new Error('Agent-executable Work Items for this Manager Job require a Worker Method');
      }
      if (!execution.validationStrategy || (typeof execution.validationStrategy !== 'string'
        && (typeof execution.validationStrategy !== 'object' || Array.isArray(execution.validationStrategy)))) {
        throw new Error('Agent-executable Work Items for this Manager Job require metadata.execution.validationStrategy');
      }
      const expectedGap = compareRuntimeRequirements(combinedRequirements, expectedAvailability);
      if (!expectedGap.ok) {
        throw new Error('Agent-executable Work Item requires capabilities/tools outside the configured Worker profile: ' + JSON.stringify(expectedGap));
      }
    }

    const now = FieldValue.serverTimestamp();
    tx.set(itemRef, {
      ...payload,
      claimedBy: null,
      claimedModel: null,
      runId: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      blockedReason: '',
      resultSummary: '',
      nextActions: [],
      createdBy: createdBy({}, actor),
      createdAt: now,
      updatedAt: now,
    });
    tx.update(runRef, {
      createdWorkItemIds: FieldValue.arrayUnion(itemRef.id),
      revision: Number(run.revision || 1) + 1,
      updatedAt: now,
    });
    if (targetId) {
      const targetProgress = { ...(job.targetProgress || {}) };
      targetProgress[targetId] = {
        ...(targetProgress[targetId] || {}),
        lastAssignedAt: new Date().toISOString(),
      };
      tx.update(jobRef, { targetProgress, updatedAt: now });
    }
  });

  if (existing) return { created: false, duplicate: true, workItem: existing, managerRun: await managerRunGet({ id: runId }) };
  return { created: true, duplicate: false, workItem: await workItemGet({ id: itemRef.id }), managerRun: await managerRunGet({ id: runId }) };
}

async function managerRunReconcileWorkItem(input) {
  const runId = assertString(input.runId, 'runId', { max: 160 });
  const workItemId = assertString(input.workItemId, 'workItemId', { max: 160 });
  const agent = assertString(input.agent, 'agent', { max: 120 });
  const run = await managerRunGet({ id: runId });
  if (run.status !== 'running' || run.claimedBy !== agent) throw new Error('Manager run is not claimed by ' + agent);
  const item = await workItemGet({ id: workItemId });
  if (item.status === 'running' && item.claimedBy && item.claimedBy !== agent) {
    throw new Error('Cannot reconcile a Work Item actively claimed by ' + item.claimedBy);
  }
  const patch = input.patch && typeof input.patch === 'object' ? { ...input.patch } : {};
  const existingEscalation = item.metadata?.escalation;
  patch.metadataPatch = {
    ...(patch.metadataPatch || {}),
    ...(existingEscalation?.status === 'reported'
      ? {
        escalation: {
          ...existingEscalation,
          status: 'handled',
          handledByManagerRunId: runId,
          handledAt: new Date().toISOString(),
        },
      }
      : {}),
    lastManagerTouch: {
      managerJobId: run.managerJobId,
      managerRunId: runId,
      reason: clampString(input.reason, 4000) || '',
      at: new Date().toISOString(),
    },
  };
  const updated = await workItemUpdate({ id: workItemId, patch });
  const runRef = db().collection(COLLECTIONS.managerRuns).doc(runId);
  await runRef.update({
    ...(updated.status === 'archived'
      ? { archivedWorkItemIds: FieldValue.arrayUnion(workItemId) }
      : { updatedWorkItemIds: FieldValue.arrayUnion(workItemId) }),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { workItem: updated, managerRun: await managerRunGet({ id: runId }) };
}

async function managerRunFinish(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent, 'agent', { max: 120 });
  const status = assertEnum(input.status, ['completed', 'failed'], 'status', 'completed');
  const ref = db().collection(COLLECTIONS.managerRuns).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Manager run not found: ' + id);
    const current = snapshot.data();
    if (['completed', 'failed'].includes(current.status)) throw new Error('Manager run is already closed: ' + current.status);
    if (current.claimedBy && current.claimedBy !== agent) throw new Error('Manager run is claimed by ' + current.claimedBy);
    const jobRef = db().collection(COLLECTIONS.managerJobs).doc(current.managerJobId);
    const jobSnapshot = await tx.get(jobRef);
    if (!jobSnapshot.exists) throw new Error('Manager job not found: ' + current.managerJobId);
    const now = FieldValue.serverTimestamp();
    const summary = clampString(input.summary, 12000) || '';
    tx.update(ref, {
      status,
      summary,
      observations: stringArray(input.observations, 100, 3000),
      decisions: stringArray(input.decisions, 100, 3000),
      claimedBy: null,
      claimedModel: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: now,
      finishedAt: now,
      revision: Number(current.revision || 1) + 1,
      updatedAt: now,
    });
    tx.update(jobRef, {
      lastFinishedAt: now,
      lastManagerRunId: id,
      lastExecutionStatus: status === 'completed' ? 'manager_completed' : 'manager_failed',
      lastResultSummary: summary,
      finishCount: FieldValue.increment(1),
      updatedAt: now,
    });
  });
  return managerRunGet({ id });
}

function workItemPayload(input) {
  return {
    title: assertString(input.title, 'title', { max: 500 }),
    objective: clampString(input.objective, 12000) || '',
    instructions: clampString(input.instructions, 16000) || '',
    status: assertEnum(input.status, WORK_ITEM_STATUSES, 'status', 'ready'),
    priority: assertEnum(input.priority, WORK_ITEM_PRIORITIES, 'priority', 'medium'),
    executionMode: assertEnum(input.executionMode, WORK_ITEM_EXECUTION_MODES, 'executionMode', 'agent'),
    humanReason: clampString(input.humanReason, 6000) || '',
    spaceId: clampString(input.spaceId, 160) || null,
    projectId: clampString(input.projectId, 160) || null,
    sourceType: clampString(input.sourceType, 80) || 'manual',
    sourceId: clampString(input.sourceId, 500) || null,
    workerMethodId: clampString(input.workerMethodId || input.metadata?.workerMethodId, 160) || null,
    workerMethodVersionId: null,
    workerMethodVersionNumber: null,
    runtimeRequirements: null,
    runtimeAvailability: null,
    runtimeGap: null,
    dependencies: stringArray(input.dependencies, 50, 160),
    tags: stringArray(input.tags, 50, 100),
    dueAt: clampString(input.dueAt, 120) || null,
    metadata: jsonSafe(input.metadata || {}),
    revision: 1,
  };
}

async function workItemCreate(input, actor = {}) {
  const payload = workItemPayload(input);
  if (payload.status === 'running') throw new Error('running is claim-only; create as ready or in_progress, then call work_item_claim');
  if (payload.spaceId) await spaceGet({ id: payload.spaceId });
  if (payload.workerMethodId) await methodGet({ id: payload.workerMethodId });
  const ref = db().collection(COLLECTIONS.workItems).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    ...payload,
    claimedBy: null,
    claimedModel: null,
    runId: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    blockedReason: '',
    resultSummary: '',
    nextActions: [],
    createdBy: createdBy(input.createdBy, actor),
    createdAt: now,
    updatedAt: now,
  });
  return documentToObject(await ref.get());
}

async function workItemGet(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const snapshot = await db().collection(COLLECTIONS.workItems).doc(id).get();
  if (!snapshot.exists) throw new Error('Work item not found: ' + id);
  return documentToObject(snapshot);
}

async function workItemSearch(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || Math.max(limit * 5, 100), limit), 1000);
  const snapshot = await db().collection(COLLECTIONS.workItems).limit(scanLimit).get();
  const q = clampString(input.query, 400)?.toLowerCase();
  const status = clampString(input.status, 40);
  const priority = clampString(input.priority, 40);
  const spaceId = clampString(input.spaceId, 160);
  const projectId = clampString(input.projectId, 160);
  const executionMode = clampString(input.executionMode, 20);
  const sourceType = clampString(input.sourceType, 80);
  const sourceId = clampString(input.sourceId, 500);
  const agent = clampString(input.agent, 120)?.toLowerCase();
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((item) => {
      if (status && item.status !== status) return false;
      if (priority && item.priority !== priority) return false;
      if (spaceId && item.spaceId !== spaceId) return false;
      if (projectId && item.projectId !== projectId) return false;
      if (executionMode && (item.executionMode || 'agent') !== executionMode) return false;
      if (sourceType && item.sourceType !== sourceType) return false;
      if (sourceId && item.sourceId !== sourceId) return false;
      if (agent && String(item.claimedBy || '').toLowerCase() !== agent) return false;
      if (q) {
        const haystack = [
          item.title,
          item.objective,
          item.instructions,
          item.blockedReason,
          item.resultSummary,
          ...(item.tags || []),
          ...(item.nextActions || []),
        ].filter(Boolean).join('\n').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .slice(0, limit);
  return { items, count: items.length, scanned: snapshot.size, databaseId: DATABASE_ID };
}

async function workItemUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : {};
  const nextSpaceId = patch.spaceId !== undefined ? (clampString(patch.spaceId, 160) || null) : undefined;
  const nextWorkerMethodId = patch.workerMethodId !== undefined ? (clampString(patch.workerMethodId, 160) || null) : undefined;
  if (nextSpaceId) await spaceGet({ id: nextSpaceId });
  if (nextWorkerMethodId) await methodGet({ id: nextWorkerMethodId });
  const ref = db().collection(COLLECTIONS.workItems).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Work item not found: ' + id);
    const current = snapshot.data();
    if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current.revision || 1)) {
      throw new Error('Revision conflict: expected ' + input.expectedRevision + ', actual ' + (current.revision || 1));
    }
    const update = {
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.title !== undefined) update.title = assertString(patch.title, 'patch.title', { max: 500 });
    if (patch.objective !== undefined) update.objective = clampString(patch.objective, 12000) || '';
    if (patch.instructions !== undefined) update.instructions = clampString(patch.instructions, 16000) || '';
    if (patch.status !== undefined) {
      const nextStatus = assertEnum(patch.status, WORK_ITEM_STATUSES, 'patch.status', current.status || 'ready');
      if (nextStatus === 'running') throw new Error('running is claim-only; call work_item_claim instead');
      if (current.status === 'running' && nextStatus !== 'running') {
        throw new Error('Use work_item_finish, work_item_release, or work_item_delegate_to_human to leave running state');
      }
      update.status = nextStatus;
    }
    if (patch.priority !== undefined) update.priority = assertEnum(patch.priority, WORK_ITEM_PRIORITIES, 'patch.priority', current.priority || 'medium');
    if (patch.executionMode !== undefined) update.executionMode = assertEnum(patch.executionMode, WORK_ITEM_EXECUTION_MODES, 'patch.executionMode', current.executionMode || 'agent');
    if (patch.humanReason !== undefined) update.humanReason = clampString(patch.humanReason, 6000) || '';
    if (patch.spaceId !== undefined) update.spaceId = nextSpaceId;
    if (patch.projectId !== undefined) update.projectId = clampString(patch.projectId, 160) || null;
    if (patch.sourceType !== undefined) update.sourceType = clampString(patch.sourceType, 80) || 'manual';
    if (patch.sourceId !== undefined) update.sourceId = clampString(patch.sourceId, 500) || null;
    if (patch.workerMethodId !== undefined) {
      if (current.status === 'running') throw new Error('Cannot change Worker Method while Work Item is running');
      update.workerMethodId = nextWorkerMethodId;
      update.workerMethodVersionId = null;
      update.workerMethodVersionNumber = null;
      update.runtimeRequirements = null;
      update.runtimeAvailability = null;
      update.runtimeGap = null;
    }
    if (patch.dependencies !== undefined) update.dependencies = stringArray(patch.dependencies, 50, 160);
    if (patch.tags !== undefined) update.tags = stringArray(patch.tags, 50, 100);
    if (patch.dueAt !== undefined) update.dueAt = clampString(patch.dueAt, 120) || null;
    if (patch.blockedReason !== undefined) update.blockedReason = clampString(patch.blockedReason, 6000) || '';
    if (patch.resultSummary !== undefined) update.resultSummary = clampString(patch.resultSummary, 12000) || '';
    if (patch.nextActions !== undefined) update.nextActions = stringArray(patch.nextActions, 100, 3000);
    if (patch.metadata !== undefined) update.metadata = jsonSafe(patch.metadata || {});
    if (patch.metadataPatch !== undefined) update.metadata = { ...(current.metadata || {}), ...jsonSafe(patch.metadataPatch || {}) };
    tx.update(ref, update);
  });
  return workItemGet({ id });
}

async function resolveWorkerMethodExecution(item) {
  const workerMethodId = item?.workerMethodId || item?.metadata?.workerMethodId || null;
  if (!workerMethodId) return null;
  if (item.workerMethodVersionId) {
    const version = await methodVersionGet({ id: item.workerMethodVersionId });
    if (version.methodId !== workerMethodId) throw new Error('Pinned Worker Method version does not belong to Worker Method');
    return {
      methodId: workerMethodId,
      methodVersionId: version.id,
      methodVersionNumber: version.versionNumber,
      instructions: version.instructions || '',
      protocol: version.protocol || {},
      qualityGates: version.qualityGates || [],
    };
  }
  const context = await methodGetContext({ id: workerMethodId, versionLimit: 3, runLimit: 3 });
  if (!context.executionContract) throw new Error('Worker Method has no active version: ' + workerMethodId);
  return context.executionContract;
}

async function workItemGetExecutionContext(input) {
  const item = await workItemGet({ id: input.id });
  const workerMethod = await resolveWorkerMethodExecution(item);
  const taskRequirements = {
    requiredCapabilities: item.metadata?.execution?.requiredCapabilities || [],
    requiredTools: item.metadata?.execution?.requiredTools || [],
  };
  const runtimeRequirements = mergeRuntimeRequirements(
    runtimeRequirementsFromMethodExecution(workerMethod),
    taskRequirements
  );
  return {
    workItem: item,
    workerMethod,
    runtimeRequirements,
    operatingModel: await agentHqOperatingModel(),
  };
}

async function workItemClaim(input, actor = {}) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent || actor.agent, 'agent', { max: 120 });
  const model = clampString(input.model || actor.model, 120) || null;
  const leaseMinutes = Math.min(Math.max(Number(input.leaseMinutes) || 60, 10), 1440);
  const initialItem = await workItemGet({ id });
  const initialWorkerMethodId = initialItem.workerMethodId || initialItem.metadata?.workerMethodId || null;
  const workerMethod = await resolveWorkerMethodExecution(initialItem);
  const taskRequirements = {
    requiredCapabilities: initialItem.metadata?.execution?.requiredCapabilities || [],
    requiredTools: initialItem.metadata?.execution?.requiredTools || [],
  };
  const runtimeRequirements = mergeRuntimeRequirements(
    runtimeRequirementsFromMethodExecution(workerMethod),
    taskRequirements
  );
  const availability = runtimeAvailability(input);
  const runtimeGap = compareRuntimeRequirements(runtimeRequirements, availability);
  if (!runtimeGap.ok) {
    throw new Error('WORKER_RUNTIME_REQUIREMENTS_UNMET ' + JSON.stringify({
      workItemId: id,
      workerMethodId: workerMethod?.methodId || initialItem.workerMethodId || null,
      workerMethodVersionId: workerMethod?.methodVersionId || initialItem.workerMethodVersionId || null,
      runtimeRequirements,
      runtimeAvailability: availability,
      runtimeGap,
    }));
  }

  const ref = db().collection(COLLECTIONS.workItems).doc(id);
  const nowMs = Date.now();

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Work item not found: ' + id);
    const current = snapshot.data();
    const currentWorkerMethodId = current.workerMethodId || current.metadata?.workerMethodId || null;
    if (currentWorkerMethodId !== initialWorkerMethodId || current.workerMethodVersionId !== initialItem.workerMethodVersionId) {
      throw new Error('Worker Method changed during claim; retry');
    }
    if (['archived', 'done', 'cancelled'].includes(current.status)) throw new Error('Work item is already closed: ' + current.status);
    if ((current.executionMode || 'agent') === 'human') throw new Error('Human task cannot be claimed by an agent; complete it in Human Tasks or delegate it back to agent mode');
    const currentLeaseMs = timestampMillis(current.leaseExpiresAt);
    const leaseActive = current.claimedBy && currentLeaseMs > nowMs;
    if (leaseActive && current.claimedBy !== agent) {
      throw new Error('Work item is claimed by ' + current.claimedBy + ' until ' + new Date(currentLeaseMs).toISOString());
    }
    tx.update(ref, {
      status: 'running',
      claimedBy: agent,
      claimedModel: model,
      workerMethodId: initialWorkerMethodId,
      workerMethodVersionId: workerMethod?.methodVersionId || current.workerMethodVersionId || null,
      workerMethodVersionNumber: workerMethod?.methodVersionNumber || current.workerMethodVersionNumber || null,
      runtimeRequirements,
      runtimeAvailability: availability,
      runtimeGap,
      runId: clampString(input.runId, 160) || current.runId || null,
      leaseExpiresAt: new Date(nowMs + leaseMinutes * 60 * 1000),
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return workItemGet({ id });
}

async function workItemHeartbeat(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent, 'agent', { max: 120 });
  const leaseMinutes = Math.min(Math.max(Number(input.leaseMinutes) || 60, 10), 1440);
  const ref = db().collection(COLLECTIONS.workItems).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Work item not found: ' + id);
    const current = snapshot.data();
    if (current.claimedBy !== agent) throw new Error('Work item is not claimed by ' + agent);
    if (current.status !== 'running') throw new Error('Work item is not currently running');
    tx.update(ref, {
      leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60 * 1000),
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      runId: clampString(input.runId, 160) || current.runId || null,
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return workItemGet({ id });
}

function normalizeExecutionReceipt(value, job) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const targetId = assertString(value.targetId, 'executionReceipt.targetId', { max: 160 });
  const rotationTargets = job ? jobRotationTargets(job) : [];
  if (rotationTargets.length && !rotationTargets.includes(targetId)) {
    throw new Error('executionReceipt.targetId must be a configured rotation target');
  }
  const artifacts = stringArray(value.artifacts, 30, 1000);
  if (!artifacts.length) throw new Error('executionReceipt.artifacts must include a verifiable file, commit, or URL');
  const actionType = assertString(value.actionType, 'executionReceipt.actionType', { max: 80 });
  const allowedActionTypes = stringArray(
    Array.isArray(job?.allowedActionTypes) ? job.allowedActionTypes : job?.metadata?.allowedActionTypes,
    30,
    80
  );
  if (allowedActionTypes.length && !allowedActionTypes.includes(actionType)) {
    throw new Error('executionReceipt.actionType must be one of: ' + allowedActionTypes.join(', '));
  }
  return {
    targetId,
    actionType,
    deliveryStatus: assertEnum(
      assertString(value.deliveryStatus, 'executionReceipt.deliveryStatus', { max: 40 }),
      EXECUTION_DELIVERY_STATUSES,
      'executionReceipt.deliveryStatus'
    ),
    artifacts,
    validation: assertString(value.validation, 'executionReceipt.validation', { max: 3000 }),
    measurementDueAt: clampString(value.measurementDueAt, 120) || null,
    attemptedTargets: stringArray(value.attemptedTargets, 100, 160),
  };
}

async function workItemFinish(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent, 'agent', { max: 120 });
  const requestedStatus = assertEnum(input.status, ['archived', 'blocked', 'review', 'done'], 'status', 'archived');
  const outcomeStatus = requestedStatus === 'done' ? 'archived' : requestedStatus;
  const ref = db().collection(COLLECTIONS.workItems).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Work item not found: ' + id);
    const current = snapshot.data();
    if (['archived', 'done', 'cancelled'].includes(current.status)) throw new Error('Work item is already closed: ' + current.status);
    if (current.claimedBy && current.claimedBy !== agent) throw new Error('Work item is claimed by ' + current.claimedBy);
    const jobRef = current.sourceType === 'manager_job' && current.sourceId
      ? db().collection(COLLECTIONS.managerJobs).doc(current.sourceId)
      : null;
    const jobSnapshot = jobRef ? await tx.get(jobRef) : null;
    const job = jobSnapshot?.exists ? jobSnapshot.data() : null;
    const receipt = normalizeExecutionReceipt(input.executionReceipt || input.metadataPatch?.executionReceipt, job)
      || current.executionReceipt
      || null;
    if (job?.metadata?.stabilization?.mode === 'action-first' && receipt
      && ['archived', 'review'].includes(outcomeStatus) && MATERIAL_ACTION_TYPES.has(receipt.actionType)) {
      if (current.metadata?.execution?.mutationAllowed === false) {
        throw new Error('Read-only work cannot be completed as a material action');
      }
      if (receipt.deliveryStatus === 'local_ready' || !hasCommitEvidence(receipt)) {
        throw new Error('Material action completion requires a commit receipt');
      }
      if (receipt.deliveryStatus === 'live_verified' && !hasLiveEvidence(receipt)) {
        throw new Error('live_verified material action requires a production URL artifact');
      }
    }
    const materialReceipt = isMaterialReceipt({
      ...current,
      metadata: { ...(current.metadata || {}), ...(input.metadataPatch || {}) },
      executionReceipt: receipt,
    });
    if (job && jobRequiresReceipt(job) && ['archived', 'review'].includes(outcomeStatus) && !receipt) {
      throw new Error('This Manager Job requires an executionReceipt with an action and validation for generated worker work');
    }
    if (job && jobRequiresReceipt(job) && outcomeStatus === 'blocked' && !clampString(input.blockedReason || current.blockedReason, 6000)) {
      throw new Error('A blocked Manager Job worker execution requires a concrete blockedReason');
    }
    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      status: outcomeStatus,
      completedBy: agent,
      resultSummary: clampString(input.resultSummary, 12000) || current.resultSummary || '',
      blockedReason: outcomeStatus === 'blocked'
        ? (clampString(input.blockedReason, 6000) || current.blockedReason || '')
        : '',
      nextActions: input.nextActions !== undefined
        ? stringArray(input.nextActions, 100, 3000)
        : (current.nextActions || []),
      metadata: { ...(current.metadata || {}), ...jsonSafe(input.metadataPatch || {}) },
      executionReceipt: receipt || current.executionReceipt || null,
      materialOutcomeCounted: Boolean(current.materialOutcomeCounted || (materialReceipt && ['archived', 'review'].includes(outcomeStatus))),
      finishRecorded: true,
      claimedBy: null,
      claimedModel: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: now,
      finishedAt: outcomeStatus === 'archived' ? now : null,
      revision: Number(current.revision || 1) + 1,
      updatedAt: now,
    });
    if (jobRef && job) {
      const targetProgress = { ...(job.targetProgress || {}) };
      const assignedTarget = current.metadata?.managerJob?.targetId;
      if (outcomeStatus === 'blocked') {
        for (const attemptedTarget of stringArray(input.metadataPatch?.attemptedTargets, 100, 160)) {
          if (attemptedTarget === assignedTarget || !jobRotationTargets(job).includes(attemptedTarget)) continue;
          targetProgress[attemptedTarget] = {
            ...(targetProgress[attemptedTarget] || {}),
            lastConsideredAt: new Date().toISOString(),
          };
        }
      }
      if (outcomeStatus === 'blocked' && assignedTarget && jobRotationTargets(job).includes(assignedTarget)) {
        targetProgress[assignedTarget] = {
          ...(targetProgress[assignedTarget] || {}),
          lastBlockedAt: new Date().toISOString(),
          lastBlockedReason: clampString(input.blockedReason || current.blockedReason, 500) || '',
        };
      }
      if (materialReceipt && ['archived', 'review'].includes(outcomeStatus)) {
        for (const attemptedTarget of receipt.attemptedTargets) {
          if (attemptedTarget === receipt.targetId || !jobRotationTargets(job).includes(attemptedTarget)) continue;
          targetProgress[attemptedTarget] = {
            ...(targetProgress[attemptedTarget] || {}),
            lastConsideredAt: new Date().toISOString(),
          };
        }
        const previous = targetProgress[receipt.targetId] || {};
        targetProgress[receipt.targetId] = {
          ...previous,
          lastActionAt: new Date().toISOString(),
          lastDeliveryStatus: hasLiveEvidence(receipt) ? 'live_verified' : 'committed',
          actionCount: Number(previous.actionCount || 0) + (current.materialOutcomeCounted ? 0 : 1),
          ...(hasLiveEvidence(receipt) ? { lastLiveAt: new Date().toISOString() } : {}),
        };
      }
      tx.update(jobRef, {
        lastWorkerActionAt: now,
        lastWorkerWorkItemId: id,
        lastWorkerStatus: outcomeStatus,
        lastWorkerResultSummary: clampString(input.resultSummary, 12000) || current.resultSummary || '',
        targetProgress,
        updatedAt: now,
      });
    }
  });
  return workItemGet({ id });
}


async function workItemDelegateToHuman(input, actor = {}) {
  const id = assertString(input.id, 'id', { max: 160 });
  const ref = db().collection(COLLECTIONS.workItems).doc(id);
  const requester = clampString(input.requestedBy || actor.agent, 120) || 'agent';

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Work item not found: ' + id);
    const current = snapshot.data();
    if (['archived', 'done', 'cancelled'].includes(current.status)) {
      throw new Error('Work item is already closed: ' + current.status);
    }
    tx.update(ref, {
      executionMode: 'human',
      status: 'ready',
      humanReason: assertString(input.reason, 'reason', { max: 6000 }),
      requestedBy: requester,
      resultSummary: clampString(input.resultSummary, 12000) || current.resultSummary || '',
      nextActions: input.nextActions !== undefined
        ? stringArray(input.nextActions, 100, 3000)
        : (current.nextActions || []),
      claimedBy: null,
      claimedModel: null,
      runId: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return workItemGet({ id });
}

async function workItemRelease(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent, 'agent', { max: 120 });
  const targetStatus = assertEnum(input.status, ['ready', 'in_progress', 'backlog'], 'status', 'ready');
  const ref = db().collection(COLLECTIONS.workItems).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Work item not found: ' + id);
    const current = snapshot.data();
    if (current.claimedBy && current.claimedBy !== agent) throw new Error('Work item is claimed by ' + current.claimedBy);
    const jobRef = current.sourceType === 'manager_job' && current.sourceId
      ? db().collection(COLLECTIONS.managerJobs).doc(current.sourceId)
      : null;
    const jobSnapshot = jobRef ? await tx.get(jobRef) : null;
    const job = jobSnapshot?.exists ? jobSnapshot.data() : null;
    const receipt = input.executionReceipt
      ? normalizeExecutionReceipt(input.executionReceipt, job)
      : null;
    if (receipt) {
      if (current.status !== 'running' || current.claimedBy !== agent || targetStatus !== 'in_progress') {
        throw new Error('A commit handoff requires an owned running item released to in_progress');
      }
      if (receipt.deliveryStatus !== 'committed' || !isMaterialReceipt({ ...current, executionReceipt: receipt })) {
        throw new Error('Commit handoff requires a material action receipt with commit evidence');
      }
    }
    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      status: targetStatus,
      claimedBy: null,
      claimedModel: null,
      runId: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: now,
      blockedReason: receipt ? '' : (current.blockedReason || ''),
      resultSummary: clampString(input.resultSummary, 12000) || current.resultSummary || '',
      nextActions: input.nextActions !== undefined
        ? stringArray(input.nextActions, 100, 3000)
        : (current.nextActions || []),
      metadata: { ...(current.metadata || {}), ...jsonSafe(input.metadataPatch || {}) },
      executionReceipt: receipt || current.executionReceipt || null,
      revision: Number(current.revision || 1) + 1,
      updatedAt: now,
    });
    if (jobRef && job && receipt) {
      tx.update(jobRef, {
        lastWorkerActionAt: now,
        lastWorkerWorkItemId: id,
        lastWorkerStatus: targetStatus,
        lastWorkerResultSummary: clampString(input.resultSummary, 12000) || current.resultSummary || '',
        updatedAt: now,
      });
    }
  });
  return workItemGet({ id });
}

async function agentHqOperatingModel() {
  const context = await operatingModelGetContext({ id: AGENT_HQ_OPERATING_MODEL_ID, versionLimit: 20 });
  const version = context.currentVersion;
  const model = version?.model || AGENT_HQ_OPERATING_MODEL;
  return {
    ...model,
    _meta: {
      canonicalSource: context.source,
      operatingModelId: AGENT_HQ_OPERATING_MODEL_ID,
      versionId: version?.id || null,
      versionNumber: version?.versionNumber || Number(model.version || 1),
      changeSetId: version?.changeSetId || null,
    },
  };
}

async function workItemReportProblem(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const agent = assertString(input.agent, 'agent', { max: 120 });
  const status = assertEnum(input.status, ['in_progress', 'blocked'], 'status', 'blocked');
  const category = assertEnum(input.category, ESCALATION_CATEGORIES, 'category', 'unknown');
  const symptom = assertString(input.symptom, 'symptom', { max: 6000 });
  const ref = db().collection(COLLECTIONS.workItems).doc(id);

  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('Work item not found: ' + id);
    const current = snapshot.data();
    if (current.status === 'running') {
      if (current.claimedBy !== agent) throw new Error('Work item is not claimed by ' + agent);
    } else if (!['ready', 'in_progress'].includes(current.status) || current.claimedBy) {
      throw new Error('Worker problem report requires an owned running item or an unclaimed ready/in_progress item');
    }
    const escalation = {
      status: 'reported',
      reportedTo: 'manager',
      reportedBy: agent,
      reportedAt: new Date().toISOString(),
      category,
      symptom,
      attempted: stringArray(input.attempted, 50, 2000),
      evidence: stringArray(input.evidence, 50, 3000),
      affectedWork: clampString(input.affectedWork, 6000) || '',
      requiredCapability: clampString(input.requiredCapability, 240) || null,
      nextPossibleStep: clampString(input.nextPossibleStep, 6000) || '',
    };
    tx.update(ref, {
      status,
      blockedReason: status === 'blocked' ? symptom : '',
      resultSummary: clampString(input.resultSummary, 12000) || current.resultSummary || '',
      nextActions: input.nextActions !== undefined
        ? stringArray(input.nextActions, 100, 3000)
        : (current.nextActions || []),
      metadata: {
        ...(current.metadata || {}),
        escalation,
      },
      claimedBy: null,
      claimedModel: null,
      runId: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      revision: Number(current.revision || 1) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return workItemGet({ id });
}

const INCIDENT_DIAGNOSIS_CONFIDENCE = ['unknown', 'low', 'medium', 'high', 'confirmed'];

function normalizeIncidentDiagnosis(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('diagnosis is required');
  }

  const observedFacts = stringArray(input.observedFacts, 50, 3000);
  if (!observedFacts.length) throw new Error('diagnosis.observedFacts must contain at least one item');

  return {
    failureLayer: assertString(input.failureLayer, 'diagnosis.failureLayer', { max: 160 }),
    errorClass: assertString(input.errorClass, 'diagnosis.errorClass', { max: 160 }),
    currentHypothesis: assertString(input.currentHypothesis, 'diagnosis.currentHypothesis', { max: 12000 }),
    confidence: assertEnum(input.confidence, INCIDENT_DIAGNOSIS_CONFIDENCE, 'diagnosis.confidence'),
    observedFacts,
    exactOperation: clampString(input.exactOperation, 1000) || '',
    runnerProfile: clampString(input.runnerProfile, 300) || '',
    toolFamily: clampString(input.toolFamily, 300) || '',
    fingerprint: clampString(input.fingerprint, 1000) || '',
    competingHypotheses: stringArray(input.competingHypotheses, 30, 3000),
    ruledOut: stringArray(input.ruledOut, 30, 3000),
    unknowns: stringArray(input.unknowns, 30, 3000),
    isolationEvidence: stringArray(input.isolationEvidence, 30, 3000),
    updatedAt: new Date().toISOString(),
  };
}

async function systemIncidentCreate(input, actor = {}) {
  const severity = assertEnum(input.severity, INCIDENT_SEVERITIES, 'severity', 'medium');
  const detectedBy = assertEnum(input.detectedBy, ['worker', 'manager', 'human'], 'detectedBy', 'manager');
  const symptom = assertString(input.symptom, 'symptom', { max: 6000 });
  const diagnosis = normalizeIncidentDiagnosis(input.diagnosis);
  const affectedManagerJobIds = stringArray(input.affectedManagerJobIds, 50, 160);
  const sourceManagerJobId = clampString(input.managerJobId, 160) || affectedManagerJobIds[0] || null;
  const dedupeKey = clampString(input.dedupeKey, 300) || null;

  if (dedupeKey) {
    const snapshot = await db().collection(COLLECTIONS.workItems).limit(1000).get();
    const existing = sortRecent(snapshot.docs.map(documentToObject)).find((item) =>
      item.sourceType === 'system_incident'
      && !['archived', 'done', 'cancelled'].includes(item.status)
      && item.metadata?.incident?.dedupeKey === dedupeKey
      && (!sourceManagerJobId || item.sourceId === sourceManagerJobId)
    );
    if (existing) return existing;
  }

  return workItemCreate({
    title: input.title,
    objective: clampString(input.objective, 12000) || 'Diagnose, repair, regression-check, and prevent recurrence of this Agent HQ system incident.',
    instructions: clampString(input.instructions, 16000) || 'Treat this as a structural operating-system record, not ordinary Worker queue inventory.',
    status: 'in_progress',
    priority: severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : 'medium',
    executionMode: input.executionMode || 'agent',
    humanReason: input.humanReason,
    projectId: clampString(input.projectId, 160) || null,
    sourceType: 'system_incident',
    sourceId: sourceManagerJobId,
    tags: [...stringArray(input.tags, 40, 100), 'system-incident'],
    metadata: {
      incident: {
        status: 'investigating',
        severity,
        detectedBy,
        symptom,
        diagnosis,
        rootCause: clampString(input.rootCause, 12000) || '',
        affectedManagerJobIds,
        relatedWorkItemIds: stringArray(input.relatedWorkItemIds, 100, 160),
        fix: clampString(input.fix, 12000) || '',
        prevention: clampString(input.prevention, 12000) || '',
        operatingModelChanged: input.operatingModelChanged === true,
        evidence: stringArray(input.evidence, 100, 3000),
        dedupeKey,
        openedAt: new Date().toISOString(),
      },
    },
  }, actor);
}

async function systemIncidentSearch(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const snapshot = await db().collection(COLLECTIONS.workItems).limit(1000).get();
  const severity = clampString(input.severity, 20);
  const incidentStatus = clampString(input.incidentStatus, 40);
  const managerJobId = clampString(input.managerJobId, 160);
  const includeResolved = input.includeResolved !== false;
  const items = sortRecent(snapshot.docs.map(documentToObject))
    .filter((item) => item.sourceType === 'system_incident')
    .filter((item) => includeResolved || item.status !== 'archived')
    .filter((item) => !severity || item.metadata?.incident?.severity === severity)
    .filter((item) => !incidentStatus || item.metadata?.incident?.status === incidentStatus)
    .filter((item) => !managerJobId || item.sourceId === managerJobId || (item.metadata?.incident?.affectedManagerJobIds || []).includes(managerJobId))
    .slice(0, limit);
  return {
    items,
    count: items.length,
    openCount: items.filter((item) => item.status !== 'archived').length,
    databaseId: DATABASE_ID,
  };
}

async function systemIncidentUpdate(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const incident = await workItemGet({ id });
  if (incident.sourceType !== 'system_incident') throw new Error('Work item is not a system incident: ' + id);

  const currentIncident = incident.metadata?.incident || {};
  const diagnosis = normalizeIncidentDiagnosis(input.diagnosis);
  const nextStatus = assertEnum(input.incidentStatus, ['open', 'investigating'], 'incidentStatus', currentIncident.status || 'investigating');

  const nextIncident = {
    ...currentIncident,
    status: nextStatus,
    diagnosis,
    rootCause: input.rootCause === undefined ? (currentIncident.rootCause || '') : clampString(input.rootCause, 12000),
    fix: input.fix === undefined ? (currentIncident.fix || '') : clampString(input.fix, 12000),
    prevention: input.prevention === undefined ? (currentIncident.prevention || '') : clampString(input.prevention, 12000),
    operatingModelChanged: input.operatingModelChanged === true || currentIncident.operatingModelChanged === true,
    evidence: [
      ...stringArray(currentIncident.evidence, 100, 3000),
      ...stringArray(input.evidence, 100, 3000),
    ].slice(-100),
  };

  return workItemUpdate({
    id,
    expectedRevision: input.expectedRevision,
    patch: {
      resultSummary: input.summary === undefined ? incident.resultSummary : clampString(input.summary, 12000),
      nextActions: input.nextActions === undefined ? (incident.nextActions || []) : stringArray(input.nextActions, 100, 3000),
      metadataPatch: { incident: nextIncident },
    },
  });
}

async function systemIncidentResolve(input) {
  const id = assertString(input.id, 'id', { max: 160 });
  const incident = await workItemGet({ id });
  if (incident.sourceType !== 'system_incident') throw new Error('Work item is not a system incident: ' + id);
  const diagnosis = normalizeIncidentDiagnosis(input.diagnosis);
  const rootCause = assertString(input.rootCause, 'rootCause', { max: 12000 });
  const fix = assertString(input.fix, 'fix', { max: 12000 });
  const prevention = assertString(input.prevention, 'prevention', { max: 12000 });
  const regressionCheck = assertString(input.regressionCheck, 'regressionCheck', { max: 6000 });
  const currentIncident = incident.metadata?.incident || {};
  return workItemFinish({
    id,
    agent: assertString(input.agent, 'agent', { max: 120 }),
    status: 'archived',
    resultSummary: clampString(input.summary, 12000) || fix,
    nextActions: stringArray(input.nextActions, 100, 3000),
    metadataPatch: {
      incident: {
        ...currentIncident,
        status: 'resolved',
        diagnosis,
        rootCause,
        fix,
        prevention,
        operatingModelChanged: input.operatingModelChanged === true || currentIncident.operatingModelChanged === true,
        evidence: [
          ...stringArray(currentIncident.evidence, 100, 3000),
          ...stringArray(input.evidence, 100, 3000),
        ].slice(0, 100),
        regressionCheck,
        resolvedAt: new Date().toISOString(),
        resolvedBy: assertString(input.agent, 'agent', { max: 120 }),
      },
    },
  });
}

async function linearStatus() {
  return linearBridge.status();
}

async function linearToolCatalog(input = {}) {
  return linearBridge.toolCatalog(input);
}

async function linearToolCall(input = {}) {
  return linearBridge.callTool(input);
}

async function findLinearLinkedWorkItem(issue) {
  const issueId = clampString(issue?.id, 200);
  const identifier = clampString(issue?.identifier, 200);
  const snapshot = await db().collection(COLLECTIONS.workItems).limit(1000).get();
  const items = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));

  return items.find((item) => {
    const linear = item.metadata?.linear || {};
    return (
      (issueId && [item.sourceId, linear.issueId, linear.identifier].includes(issueId)) ||
      (identifier && [item.sourceId, linear.issueId, linear.identifier].includes(identifier))
    );
  }) || null;
}

async function linearIssueImportToWorkItem(input = {}, actor = {}) {
  const issueRef = assertString(input.issue, 'issue', { max: 300 });
  const remote = await linearBridge.callTool({
    name: 'get_issue',
    arguments: {
      id: issueRef,
      includeRelations: true,
    },
  });
  const issue = remote.data;
  if (!issue || typeof issue !== 'object') throw new Error('Linear issue could not be read: ' + issueRef);

  let existing = null;
  if (input.workItemId) existing = await workItemGet({ id: input.workItemId });
  if (!existing) existing = await findLinearLinkedWorkItem(issue);

  const linearMeta = linearIssueMetadata(issue);
  const title = clampString(issue.title, 500) || issueRef;
  const objective = clampString(issue.description, 12000) || '';
  const nextStatus = linearStatusToWorkItem(issue.statusType || issue.status?.type);
  const nextPriority = linearPriorityToWorkItem(issue.priority);
  const labels = linearLabelNames(issue.labels);
  const dueAt = clampString(issue.dueDate, 120) || null;

  if (!existing) {
    const item = await workItemCreate({
      title,
      objective,
      instructions: '',
      status: nextStatus,
      priority: nextPriority,
      executionMode: input.executionMode || 'agent',
      humanReason: input.executionMode === 'human'
        ? (clampString(input.humanReason, 6000) || 'Linear Issueを人間担当として取り込みました。')
        : '',
      spaceId: input.spaceId || null,
      projectId: input.projectId || null,
      sourceType: 'linear_issue',
      sourceId: linearMeta.identifier || linearMeta.issueId || issueRef,
      dependencies: [],
      tags: labels,
      dueAt,
      metadata: {
        linear: linearMeta,
      },
      createdBy: input.createdBy,
    }, actor);
    return { created: true, synced: true, workItem: item, linearIssue: issue };
  }

  const preserveExecutionState = existing.status === 'running' && existing.claimedBy;
  const patch = {
    title,
    objective,
    priority: nextPriority,
    dueAt,
    tags: labels.length ? labels : existing.tags,
    metadataPatch: { linear: linearMeta },
  };

  if (input.executionMode) patch.executionMode = input.executionMode;
  if (input.spaceId !== undefined) patch.spaceId = input.spaceId;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.syncStatus !== false && !preserveExecutionState) patch.status = nextStatus;

  const item = await workItemUpdate({
    id: existing.id,
    patch,
  });

  return { created: false, synced: true, workItem: item, linearIssue: issue };
}

async function workItemPushToLinear(input = {}) {
  const id = assertString(input.id, 'id', { max: 160 });
  const item = await workItemGet({ id });
  if (!linearBridge.isConfigured()) {
    throw new Error('LINEAR_API_KEY is not configured. Complete the Linear setup Human Task first.');
  }

  const linked = item.metadata?.linear || {};
  const issueId = clampString(input.issue || linked.issueId || linked.identifier, 300);
  const team = clampString(input.team || linked.team || linearBridge.teamKey(), 300) || linearBridge.teamKey();
  const descriptionParts = [];
  if (item.objective) descriptionParts.push(item.objective);
  if (item.instructions) descriptionParts.push('## Execution notes\n' + item.instructions);
  if (item.resultSummary) descriptionParts.push('## Latest My Portal result\n' + item.resultSummary);

  const args = {
    title: item.title,
    description: descriptionParts.join('\n\n'),
    priority: workItemPriorityToLinear(item.priority),
    ...(input.syncStatus === false ? {} : { state: workItemStatusToLinear(item.status) }),
    ...(input.assignee !== undefined ? { assignee: input.assignee || null } : {}),
    ...(input.project !== undefined ? { project: input.project || null } : {}),
    ...(item.dueAt && /^\d{4}-\d{2}-\d{2}/.test(item.dueAt) ? { dueDate: item.dueAt.slice(0, 10) } : {}),
  };

  if (issueId) {
    args.id = issueId;
  } else {
    args.team = team;
  }

  const remote = await linearBridge.callTool({
    name: 'save_issue',
    arguments: args,
  });
  const issue = remote.data;
  if (!issue || typeof issue !== 'object') throw new Error('Linear save_issue did not return an issue object');

  const linearMeta = linearIssueMetadata(issue);
  const updated = await workItemUpdate({
    id,
    patch: {
      metadataPatch: {
        linear: {
          ...linked,
          ...linearMeta,
          team: linearMeta.team || team,
        },
      },
    },
  });

  return {
    created: !issueId,
    synced: true,
    workItem: updated,
    linearIssue: issue,
  };
}

async function migrateLegacyWorkItemStatuses() {
  const snapshot = await db().collection(COLLECTIONS.workItems).limit(1000).get();
  const legacy = snapshot.docs.filter((docSnapshot) => ['done', 'cancelled'].includes(docSnapshot.data()?.status));
  if (!legacy.length) return 0;

  const batch = db().batch();
  legacy.forEach((docSnapshot) => {
    const current = docSnapshot.data() || {};
    batch.update(docSnapshot.ref, {
      status: 'archived',
      legacyStatus: current.status,
      finishedAt: current.finishedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      revision: Number(current.revision || 1) + 1,
    });
  });
  await batch.commit();
  return legacy.length;
}

async function controlPlaneOverview(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 80, 10), 200);
  await migrateLegacyWorkItemStatuses();
  await bootstrapSpaceThemeOwnerMigration();
  await ensureLinearSetupTask();
  const database = db();
  const [workSnapshot, managerJobSnapshot, managerRunSnapshot, spaceSnapshot, runSnapshot, projectSnapshot, memoSnapshot] = await Promise.all([
    database.collection(COLLECTIONS.workItems).limit(Math.max(limit, 100)).get(),
    database.collection(COLLECTIONS.managerJobs).limit(100).get(),
    database.collection(COLLECTIONS.managerRuns).limit(100).get(),
    database.collection(COLLECTIONS.spaces).limit(100).get(),
    database.collection(THINKING_COLLECTIONS.runs).limit(100).get(),
    database.collection('projects').limit(100).get(),
    database.collection('memos').limit(150).get(),
  ]);

  const operatingModel = await agentHqOperatingModel();
  const systemChangeSnapshot = await database.collection(COLLECTIONS.systemChangeSets).limit(100).get();
  const recentSystemChanges = sortRecent(systemChangeSnapshot.docs.map(documentToObject)).slice(0, 20);

  const rawWork = workSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  const workItems = sortRecent(rawWork.map((item) => serialize(item)));
  const managerJobs = sortRecent(managerJobSnapshot.docs.map(documentToObject)).filter((item) => item.status === 'active');
  const managerRuns = sortRecent(managerRunSnapshot.docs.map(documentToObject)).filter((item) => ['ready', 'running'].includes(item.status));
  const spaces = sortRecent(spaceSnapshot.docs.map(documentToObject).map(normalizeSpaceObject)).filter((item) => item.status === 'active');
  const runs = sortRecent(runSnapshot.docs.map(documentToObject)).filter((item) => item.status === 'active');
  const projects = sortRecent(projectSnapshot.docs.map(documentToObject)).filter((item) => {
    const status = String(item.status || '').toLowerCase();
    return !['done', 'completed', 'archived', 'cancelled'].includes(status);
  });
  const actionMemos = sortRecent(memoSnapshot.docs.map(documentToObject))
    .filter((item) => ['next_action', 'inbox', 'project'].includes(item.status))
    .slice(0, 50);

  let linear = {
    ...linearBridge.configSummary(),
    ok: linearBridge.isConfigured(),
    issues: [],
    error: null,
  };
  if (input.includeLinear !== false) {
    try {
      const openLinear = await linearBridge.listOpenIssues({ limit: Math.min(limit, 100) });
      linear = { ...linear, ...openLinear, ok: true };
    } catch (error) {
      linear = {
        ...linear,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const nowMs = Date.now();
  const staleLeases = rawWork
    .filter((item) =>
      item.status === 'running' &&
      item.claimedBy &&
      timestampMillis(item.leaseExpiresAt) > 0 &&
      timestampMillis(item.leaseExpiresAt) <= nowMs
    )
    .map((item) => serialize(item));

  const openWork = workItems.filter((item) => !['archived', 'done', 'cancelled'].includes(item.status));
  const systemIncidents = workItems.filter((item) => item.sourceType === 'system_incident');
  const activeSystemIncidents = systemIncidents.filter((item) => !['archived', 'done', 'cancelled'].includes(item.status));
  const recentResolvedSystemIncidents = systemIncidents
    .filter((item) => ['archived', 'done', 'cancelled'].includes(item.status))
    .slice(0, 20);

  const linkedLinearKeys = new Map();
  workItems.forEach((item) => {
    const linked = item.metadata?.linear || {};
    [item.sourceType === 'linear_issue' ? item.sourceId : null, linked.issueId, linked.identifier]
      .filter(Boolean)
      .forEach((key) => linkedLinearKeys.set(String(key), item.id));
  });
  const linearIssues = (linear.issues || []).map((issue) => {
    const keys = [issue.id, issue.identifier].filter(Boolean).map(String);
    const linkedWorkItemId = keys.map((key) => linkedLinearKeys.get(key)).find(Boolean) || null;
    return { ...issue, linkedWorkItemId };
  });
  const unlinkedLinearIssues = linearIssues.filter((issue) => !issue.linkedWorkItemId);

  const agentWork = openWork.filter((item) => (item.executionMode || 'agent') === 'agent' && item.sourceType !== 'system_incident');
  const humanTasks = openWork.filter((item) => item.executionMode === 'human' && item.sourceType !== 'system_incident');
  const managerEscalations = openWork
    .filter((item) => item.metadata?.escalation?.status === 'reported')
    .sort((a, b) => Date.parse(b.metadata?.escalation?.reportedAt || b.updatedAt || '') - Date.parse(a.metadata?.escalation?.reportedAt || a.updatedAt || ''));
  const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const recommendedNext = agentWork
    .filter((item) => ['in_progress', 'ready'].includes(item.status))
    .sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2))
    .slice(0, 20);

  const unqueuedNextActions = [];
  for (const space of spaces) {
    for (const action of (space.nextActions || [])) {
      const normalized = String(action || '').trim().toLowerCase();
      if (!normalized) continue;
      const exists = openWork.some((item) =>
        item.spaceId === space.id &&
        [item.title, item.objective].some((value) => String(value || '').trim().toLowerCase() === normalized)
      );
      if (!exists) unqueuedNextActions.push({ spaceId: space.id, spaceTitle: space.title, action });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      ready: agentWork.filter((item) => item.status === 'ready').length,
      backlog: agentWork.filter((item) => item.status === 'backlog').length,
      inProgress: agentWork.filter((item) => item.status === 'in_progress').length,
      running: agentWork.filter((item) => item.status === 'running').length,
      blocked: agentWork.filter((item) => item.status === 'blocked').length,
      review: agentWork.filter((item) => item.status === 'review').length,
      archived: workItems.filter((item) => ['archived', 'done', 'cancelled'].includes(item.status)).length,
      humanTasks: humanTasks.length,
      activeSpaces: spaces.length,
      activeProjects: projects.length,
      activeManagerJobs: managerJobs.length,
      readyManagerRuns: managerRuns.filter((item) => item.status === 'ready').length,
      runningManagerRuns: managerRuns.filter((item) => item.status === 'running').length,
      activeRuns: runs.length,
      staleLeases: staleLeases.length,
      unqueuedNextActions: unqueuedNextActions.length,
      actionMemos: actionMemos.length,
      linearOpen: linearIssues.length,
      linearUnlinked: unlinkedLinearIssues.length,
      activeSystemIncidents: activeSystemIncidents.length,
      managerEscalations: managerEscalations.length,
      recentSystemChanges: recentSystemChanges.length,
    },
    recommendedNext,
    inProgress: agentWork.filter((item) => item.status === 'in_progress'),
    running: agentWork.filter((item) => item.status === 'running'),
    blocked: agentWork.filter((item) => item.status === 'blocked'),
    review: agentWork.filter((item) => item.status === 'review'),
    humanTasks,
    managerEscalations: managerEscalations.slice(0, 50),
    systemIncidents: {
      active: activeSystemIncidents.slice(0, 50),
      recentResolved: recentResolvedSystemIncidents,
    },
    recentSystemChanges,
    operatingModel,
    staleLeases,
    activeManagerJobs: managerJobs.slice(0, 50),
    managerRuns: managerRuns.slice(0, 50),
    activeRuns: runs.slice(0, 30),
    activeSpaces: spaces.slice(0, 50),
    activeProjects: projects.slice(0, 50),
    unqueuedNextActions: unqueuedNextActions.slice(0, 100),
    actionMemos,
    linear: {
      ...linear,
      issues: linearIssues.slice(0, 100),
      unlinkedIssues: unlinkedLinearIssues.slice(0, 100),
    },
    operatingProtocol: [
      'Call control_plane_overview before starting autonomous work.',
      'Prefer a resumable in_progress item or a ready work item; create one for an unqueued Space next action when appropriate. Backlog means deliberately deferred from near-term execution, so do not move active or ongoing work there merely to stop working on it. Never start a running item owned by another active lease. Linear issues are external candidates: import relevant unlinked issues with linear_issue_import_to_work_item before autonomous execution.',
      'Claim exactly one agent work item before execution. Claiming moves it to running; in_progress means the task is ongoing but no agent is actively executing it right now.',
      'Manager Jobs are schedule-agnostic queue managers. External schedulers should call manager_job_start, claim the returned Manager Run with manager_run_claim, load manager_job_get_context, then observe/reconcile/decide/delegate. A Manager Run may create zero or many Work Items and should not perform the underlying worker task itself. Use manager_run_create_work_item and manager_run_reconcile_work_item, then manager_run_finish.',
      'If an item requires a human-only action, explicit user judgment, account approval, physical action, or unavailable credential, call work_item_delegate_to_human instead of leaving it buried in chat or blocking the agent queue.',
      'Load the linked Space with space_get_context and start a Run when the task requires durable research or production context.',
      'Heartbeat long-running work before the lease expires.',
      'Finish as archived only when done. Review means implementation and validation are complete and only judgment remains. If unfinished work hits a capability, safety, validation, tool, state, or external-dependency problem, use work_item_report_problem to report it to the Manager as in_progress or blocked.',
      'Workers report problems to Managers first. Managers fix local task/routing problems and create system_incident records only for structural, recurring, cross-task, or manager-unresolvable failures.',
      'If the Work Item is linked to Linear, call work_item_push_to_linear after meaningful status/result changes so the external issue stays aligned.',
      'Release the item if you stop without producing a durable result and no problem report is needed.',
    ],
  };
}

async function healthCheck() {
  const started = Date.now();
  const [spaceSample, profileSample, methodSample, managerJobSample, managerRunSample, operatingModelSample, systemChangeSample] = await Promise.all([
    db().collection(COLLECTIONS.spaces).limit(1).get(),
    db().collection(COLLECTIONS.profileFacts).limit(1).get(),
    db().collection(COLLECTIONS.methods).limit(1).get(),
    db().collection(COLLECTIONS.managerJobs).limit(1).get(),
    db().collection(COLLECTIONS.managerRuns).limit(1).get(),
    db().collection(COLLECTIONS.operatingModels).limit(1).get(),
    db().collection(COLLECTIONS.systemChangeSets).limit(1).get(),
  ]);
  return {
    ok: true,
    databaseId: DATABASE_ID,
    collections: Object.values(COLLECTIONS),
    sampleSpaceCount: spaceSample.size,
    sampleProfileFactCount: profileSample.size,
    sampleMethodCount: methodSample.size,
    sampleManagerJobCount: managerJobSample.size,
    sampleManagerRunCount: managerRunSample.size,
    sampleOperatingModelCount: operatingModelSample.size,
    sampleSystemChangeCount: systemChangeSample.size,
    latencyMs: Date.now() - started,
  };
}

module.exports = {
  DATABASE_ID,
  COLLECTIONS,
  THINKING_COLLECTIONS,
  SPACE_STATUSES,
  SPACE_THEME_OWNERS,
  PROFILE_EVIDENCE_TYPES,
  PROFILE_STABILITY,
  PROFILE_STATUSES,
  DECISION_TYPES,
  DECISION_STATUSES,
  OPPORTUNITY_STATUSES,
  METHOD_STATUSES,
  METHOD_VERSION_STATUSES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_EXECUTION_MODES,
  MANAGER_JOB_STATUSES,
  MANAGER_JOB_CONCURRENCY_POLICIES,
  MANAGER_RUN_STATUSES,
  LINEAR_SETUP_WORK_ITEM_ID,
  INCIDENT_SEVERITIES,
  ESCALATION_CATEGORIES,
  OPERATING_MODEL_VERSION_STATUSES,
  SYSTEM_CHANGE_STATUSES,
  SYSTEM_CHANGE_TRIGGER_TYPES,
  AGENT_HQ_OPERATING_MODEL_ID,
  AGENT_HQ_OPERATING_MODEL,
  healthCheck,
  linearStatus,
  linearToolCatalog,
  linearToolCall,
  linearIssueImportToWorkItem,
  workItemPushToLinear,
  controlPlaneOverview,
  organizationGet: organizationRegistry.organizationGet,
  organizationList: organizationRegistry.organizationList,
  organizationCreate: organizationRegistry.organizationCreate,
  organizationUpdate: organizationRegistry.organizationUpdate,
  organizationGraduate: organizationRegistry.organizationGraduate,
  managerJobCreate,
  managerJobGet,
  managerJobSearch,
  managerJobUpdate,
  managerJobHistory,
  managerJobGetContext,
  managerJobStart,
  managerRunGet,
  managerRunClaim,
  managerRunHeartbeat,
  managerRunCreateWorkItem,
  managerRunReconcileWorkItem,
  managerRunFinish,
  workItemCreate,
  workItemGet,
  workItemGetExecutionContext,
  workItemSearch,
  workItemUpdate,
  workItemClaim,
  workItemHeartbeat,
  workItemFinish,
  workItemDelegateToHuman,
  workItemRelease,
  workItemReportProblem,
  agentHqOperatingModel,
  agentHqGovernanceView,
  operatingModelGetContext,
  operatingModelVersionGet,
  operatingModelVersionCreate,
  operatingModelVersionActivate,
  systemChangeCreate,
  systemChangeGet,
  systemChangeSearch,
  systemChangeUpdate,
  systemIncidentCreate,
  systemIncidentSearch,
  systemIncidentUpdate,
  systemIncidentResolve,
  spaceCreate,
  spaceGet,
  spaceUpdate,
  spaceSearch,
  spaceGetContext,
  bootstrapSpaceThemeOwnerMigration,
  spaceIdeaExists,
  spaceIdeaCreate,
  spaceIdeaGet,
  spaceIdeaSearch,
  spaceIdeaUpdate,
  spaceIdeaExpand,
  spaceIdeaLink,
  spaceIdeaGetContext,
  spaceIdeaMerge,
  spaceIdeaArchive,
  spaceRunExists,
  spaceRunStart,
  spaceRunFinish,
  spaceSourceAdd,
  spaceEvaluationAdd,
  spaceArtifactAdd,
  profileFactUpsert,
  profileFactUpdate,
  profileGetContext,
  decisionCreate,
  opportunityCreate,
  opportunityUpdate,
  methodCreate,
  methodGet,
  methodSearch,
  methodUpdate,
  methodVersionGet,
  methodVersionCreate,
  methodVersionActivate,
  methodGetContext,
  spaceDistillRun,
  bootstrapIncomeSearchMigration,
  bootstrapYoutubeEssayMethod,
};
