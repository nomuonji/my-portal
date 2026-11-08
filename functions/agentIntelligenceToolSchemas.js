'use strict';

const string = (description, maxLength, minLength) => ({
  type: 'string', description, maxLength, ...(minLength ? { minLength } : {}),
});
const object = (description) => ({ type: 'object', description, additionalProperties: true });
const confirm = {
  type: 'boolean',
  description: 'Write to the Agent Intelligence Registry only after the user explicitly authorizes this change.',
};
const positiveVersion = (description) => ({ type: 'integer', minimum: 1, description });
const portfolioEntry = {
  type: 'object',
  properties: {
    packId: string('Intelligence Pack ID.', 80, 2),
    versionNumber: positiveVersion('Pin to an exact Pack version; omit to allow the current version.'),
    availability: { type: 'string', enum: ['core', 'available'] },
    selectionHint: string('Selection guidance; not an automatic selection rule.', 800),
  },
  required: ['packId'],
  additionalProperties: false,
};
const selectedIntelligence = {
  type: 'object',
  properties: {
    packId: string('Selected Pack ID from the Agent Profile portfolio.', 80, 2),
    versionNumber: positiveVersion('Exact Pack version to resolve; omission selects the current version.'),
    componentIds: { type: 'array', items: string('Component ID in a composite Pack.', 80, 2), maxItems: 30 },
    selectionRationale: string('Why this Pack/components are needed for this task.', 1000, 8),
    loadLevel: { type: 'string', enum: ['summary', 'full'] },
  },
  required: ['packId', 'selectionRationale'],
  additionalProperties: false,
};
const tools = [
  {
    name: 'agent_profile_list',
    description: 'List Agent Profiles from the host-independent Agent Intelligence Registry. Returns index metadata only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: string('Search profile metadata.', 300),
        status: { type: 'string', enum: ['active', 'paused', 'archived'] },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        scanLimit: { type: 'integer', minimum: 1, maximum: 500, default: 250 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'agent_profile_get',
    description: 'Read an Agent Profile and an exact immutable version. Omitting versionNumber reads the current version.',
    inputSchema: {
      type: 'object',
      properties: {
        id: string('Agent Profile ID.', 80, 2),
        versionNumber: positiveVersion('Exact historical version; omission selects current.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'agent_profile_version_create',
    description: 'Create an Agent Profile or append an immutable version. Requires expectedCurrentVersion (0 for a new Profile) and explicit confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: object('Complete canonical Agent Profile definition.'),
        expectedCurrentVersion: { type: 'integer', minimum: 0 },
        changeSummary: string('Why this version was created.', 2000),
        confirm,
      },
      required: ['profile', 'expectedCurrentVersion', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'intelligence_pack_list',
    description: 'List reusable Intelligence Packs from the host-independent Registry. Returns selector metadata only, not full Pack bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        query: string('Search Pack metadata and task signals.', 300),
        status: { type: 'string', enum: ['active', 'paused', 'archived'] },
        kind: { type: 'string', enum: ['atomic', 'composite'] },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        scanLimit: { type: 'integer', minimum: 1, maximum: 500, default: 250 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'intelligence_pack_get',
    description: 'Read an Intelligence Pack and an exact immutable version, including world model, evidence standards, procedures, components and canonical dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        id: string('Intelligence Pack ID.', 80, 2),
        versionNumber: positiveVersion('Exact historical version; omission selects current.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'intelligence_pack_version_create',
    description: 'Create an Intelligence Pack or append an immutable version. Requires expectedCurrentVersion (0 for a new Pack) and explicit confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        pack: object('Complete Intelligence Pack definition.'),
        expectedCurrentVersion: { type: 'integer', minimum: 0 },
        changeSummary: string('Why this version was created.', 2000),
        confirm,
      },
      required: ['pack', 'expectedCurrentVersion', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'cognitive_bundle_resolve',
    description: 'Validate an Agent-selected set of exact Intelligence Pack versions and dependencies, then return an ephemeral host-neutral Resolved Cognitive Bundle. The resolver does not choose Intelligence, execute reasoning, run tools, adapt to hosts, or manage runs.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: string('Agent Profile ID.', 80, 2),
        profileVersionNumber: positiveVersion('Exact Agent Profile version; omission selects current.'),
        taskFrame: object('Task objective/request, deliverable, success criteria, constraints, domains and evidence needs.'),
        selectedIntelligences: { type: 'array', items: selectedIntelligence, minItems: 1, maxItems: 20 },
        selectedDependencies: {
          type: 'array',
          items: string('Optional or recommended canonical dependency key: resourceType:canonicalRef.', 600, 3),
          maxItems: 100,
        },
        compositionPlan: object('Agent-selected stages, dependency edges, parallel groups, critique targets and synthesis rule.'),
        knownConflicts: { type: 'array', items: object('Known disagreement or unresolved conflict.'), maxItems: 50 },
      },
      required: ['profileId', 'taskFrame', 'selectedIntelligences'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'agent_intelligence_bootstrap',
    description: 'Idempotently register the initial Marketing & Creative Cognition Composite Intelligence Pack (v1) from the approved specification. Does not create an Agent Profile or modify existing Pack records.',
    inputSchema: {
      type: 'object',
      properties: { confirm },
      required: ['confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];
module.exports = { TOOLS: tools };
