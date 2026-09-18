const store = require('./contextStore');

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const string = (description, maxLength) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) });
const stringArray = (description, maxItems = 50) => ({ type: 'array', description, maxItems, items: { type: 'string' } });
const jsonObject = (description) => ({ type: 'object', description, additionalProperties: true });

const spaceFields = {
  title: string('Long-running thinking theme title.', 300),
  summary: string('Compact description of the theme.', 5000),
  goal: string('Current goal for the theme.', 8000),
  status: { type: 'string', enum: store.SPACE_STATUSES },
  currentBrief: string('Current state distilled for the next session.', 16000),
  nextActions: stringArray('Concrete next actions.', 100),
  tags: stringArray('Loose tags.', 50),
  domains: stringArray('Broad domains such as work, english-learning, housing.', 30),
};

const profileFactFields = {
  statement: string('A user fact or preference phrased without overclaiming.', 4000),
  scope: string('Context scope such as global, work, learning, or space:<spaceId>.', 240),
  category: string('Grouping such as work_preferences, technical_preferences, communication_preferences, temporary_context.', 120),
  evidenceType: { type: 'string', enum: store.PROFILE_EVIDENCE_TYPES },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  stability: { type: 'string', enum: store.PROFILE_STABILITY },
  status: { type: 'string', enum: store.PROFILE_STATUSES },
  source: jsonObject('Optional structured provenance.'),
  sourceRunId: string('Run that supplied the evidence.', 160),
};

const decisionFields = {
  subjectType: string('Type of subject being decided on.', 80),
  subjectId: string('Optional idea/opportunity/project ID.', 160),
  decision: { type: 'string', enum: store.DECISION_TYPES },
  reason: string('Why the decision was made.', 12000),
  status: { type: 'string', enum: store.DECISION_STATUSES },
  metadata: jsonObject('Additional decision metadata.'),
  createdInRunId: string('Run that produced the decision.', 160),
};

const opportunityFields = {
  title: string('Concrete real-world opportunity title.', 500),
  summary: string('Why this opportunity matters.', 8000),
  type: string('Opportunity type such as oss_bounty, microgrant, job, contest.', 120),
  status: { type: 'string', enum: store.OPPORTUNITY_STATUSES },
  sourceUrl: string('Source-of-truth URL.', 3000),
  originIdeaId: string('Legacy or originating idea ID.', 160),
  reward: string('Reward or compensation text.', 500),
  deadline: string('Deadline text or ISO date.', 120),
  attributes: jsonObject('Structured opportunity metadata.'),
  createdInRunId: string('Run that found the opportunity.', 160),
};

const TOOLS = [
  {
    name: 'space_create',
    description: 'Create a long-running thinking Space above Agent Idea Space. Use Spaces for durable themes, not one-off scratch ideas or execution projects.',
    inputSchema: objectSchema(spaceFields, ['title']),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'space_get',
    description: 'Read one Space by ID.',
    inputSchema: objectSchema({ id: string('Space ID.', 160) }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'space_search',
    description: 'Find long-running Spaces so a new session can resume the right theme before loading its context pack.',
    inputSchema: objectSchema({
      query: string('Substring query over title, summary, goal, brief, tags, and domains.', 300),
      status: { type: 'string', enum: store.SPACE_STATUSES },
      tag: string('Exact tag.', 100),
      domain: string('Exact domain.', 100),
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      scanLimit: { type: 'integer', minimum: 1, maximum: 500 },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'space_update',
    description: 'Update a Space current brief, goal, next actions, or metadata without changing its child records.',
    inputSchema: objectSchema({
      id: string('Space ID.', 160),
      expectedRevision: { type: 'integer', minimum: 1 },
      patch: objectSchema({
        title: spaceFields.title,
        summary: spaceFields.summary,
        goal: spaceFields.goal,
        status: spaceFields.status,
        currentBrief: spaceFields.currentBrief,
        nextActions: spaceFields.nextActions,
        tags: spaceFields.tags,
        domains: spaceFields.domains,
      }),
    }, ['id', 'patch']),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'space_get_context',
    description: 'Return a session-resume Context Pack for one Space: current state, goal, scoped profile facts, decisions, active ideas, active opportunities, sources, runs, artifacts, projects, and next actions.',
    inputSchema: objectSchema({
      id: string('Space ID.', 160),
      ideaLimit: { type: 'integer', minimum: 1, maximum: 200, default: 80 },
      opportunityLimit: { type: 'integer', minimum: 1, maximum: 200, default: 80 },
      recentLimit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      includeArtifacts: { type: 'boolean', default: true },
      includeInferred: { type: 'boolean', default: true },
    }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'profile_get_context',
    description: 'Return relevant User Model facts filtered by Space, scope, or category. Explicit statements and inferred facts remain distinguishable.',
    inputSchema: objectSchema({
      spaceId: string('Optional Space ID. Adds global, space-local, and matching domain scopes.', 160),
      scopes: stringArray('Additional exact scopes.', 50),
      categories: stringArray('Exact categories.', 50),
      includeInferred: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 80 },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'profile_fact_upsert',
    description: 'Create or refresh a durable User Model fact. Never convert an inference into explicit evidence unless the user actually said or confirmed it.',
    inputSchema: objectSchema(profileFactFields, ['statement', 'scope', 'category', 'evidenceType', 'stability']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'profile_fact_update',
    description: 'Edit or archive a User Model fact by ID, including user corrections to what the AI currently believes.',
    inputSchema: objectSchema({
      id: string('Profile fact ID.', 160),
      patch: objectSchema({
        statement: profileFactFields.statement,
        scope: profileFactFields.scope,
        category: profileFactFields.category,
        evidenceType: profileFactFields.evidenceType,
        confidence: profileFactFields.confidence,
        stability: profileFactFields.stability,
        status: profileFactFields.status,
        source: profileFactFields.source,
        sourceRunId: profileFactFields.sourceRunId,
        confirm: { type: 'boolean', description: 'Refresh lastConfirmedAt after an explicit user confirmation.' },
      }),
    }, ['id', 'patch']),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'decision_create',
    description: 'Store a durable adopt/reject/hold/defer/supersede decision separately from idea attributes.',
    inputSchema: objectSchema({
      spaceId: string('Owning Space ID.', 160),
      ...decisionFields,
    }, ['spaceId', 'decision', 'reason']),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'opportunity_create',
    description: 'Create a concrete real-world Opportunity distinct from a speculative Idea.',
    inputSchema: objectSchema({
      spaceId: string('Owning Space ID.', 160),
      ...opportunityFields,
    }, ['spaceId', 'title']),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'opportunity_update',
    description: 'Update the status or details of an existing concrete Opportunity.',
    inputSchema: objectSchema({
      id: string('Opportunity ID.', 160),
      expectedRevision: { type: 'integer', minimum: 1 },
      patch: objectSchema({
        title: opportunityFields.title,
        summary: opportunityFields.summary,
        type: opportunityFields.type,
        status: opportunityFields.status,
        sourceUrl: opportunityFields.sourceUrl,
        reward: opportunityFields.reward,
        deadline: opportunityFields.deadline,
        attributes: jsonObject('Replace attributes.'),
        attributesPatch: jsonObject('Shallow-merge attributes.'),
      }),
    }, ['id', 'patch']),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'space_distill_run',
    description: 'Distill the end of a conversation/run into a Space: refresh brief and next actions, attach legacy ideas, and persist new profile facts, decisions, opportunities, and ideas in one workflow.',
    inputSchema: objectSchema({
      spaceId: string('Target Space ID.', 160),
      runId: string('Optional run being distilled.', 160),
      summary: spaceFields.summary,
      goal: spaceFields.goal,
      currentBrief: spaceFields.currentBrief,
      status: spaceFields.status,
      nextActions: spaceFields.nextActions,
      tags: spaceFields.tags,
      domains: spaceFields.domains,
      attachIdeaIds: stringArray('Existing idea IDs to associate with this Space without deleting or migrating them.', 200),
      profileFacts: { type: 'array', maxItems: 50, items: objectSchema(profileFactFields, ['statement', 'scope', 'category', 'evidenceType', 'stability']) },
      decisions: { type: 'array', maxItems: 50, items: objectSchema(decisionFields, ['decision', 'reason']) },
      opportunities: { type: 'array', maxItems: 50, items: objectSchema(opportunityFields, ['title']) },
      ideas: {
        type: 'array',
        maxItems: 50,
        items: objectSchema({
          title: string('Idea title.', 300),
          summary: string('Idea summary.', 3000),
          content: string('Idea body.', 30000),
          type: string('Idea type.', 80),
          status: { type: 'string', enum: ['active', 'paused', 'archived', 'promoted'] },
          maturity: { type: 'string', enum: ['seed', 'exploring', 'developed', 'validated', 'execution_ready'] },
          tags: stringArray('Tags.', 50),
          domains: stringArray('Domains.', 30),
          attributes: jsonObject('Idea metadata.'),
          createdInRunId: string('Run ID.', 160),
        }, ['title']),
      },
    }, ['spaceId']),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

module.exports = { TOOLS };
