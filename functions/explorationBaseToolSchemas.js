'use strict';

const string = (description, maxLength) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) });
const strings = (description, maxItems) => ({ type: 'array', description, items: { type: 'string' }, maxItems });
const baseId = string('Exploration Base ID (lowercase kebab-case).', 80);
const actor = string('Who is writing (agent/host name). Optional.', 120);
const userAuthorized = { type: 'boolean', description: 'True only when the user explicitly approved this exact change.' };
const authorizationNote = string('Where/how the user approved it (quote or chat reference). Required with userAuthorized.', 600);

const outcome = {
  type: 'object',
  description: 'Outcome contract of the exploration. Owned by the user.',
  properties: {
    statement: string('What the exploration must produce, in one or two sentences.', 1200),
    unit: string('What counts as one achievement (e.g. one keyword the user decided to write).', 300),
    target: {
      type: 'object',
      properties: { min: { type: 'integer', minimum: 1 }, max: { type: 'integer', minimum: 1 } },
      required: ['min'], additionalProperties: false,
    },
    acceptance: string('How one achievement is judged, including every check it must pass.', 1500),
    confirmedBy: { type: 'string', enum: ['user', 'measurement'], description: 'user: achievements stay candidates until the user confirms. measurement: counted on record.' },
    finalIndicator: string('The real-world result this is for (e.g. referral clicks in 90 days).', 800),
    proxies: strings('Metrics that are proxies, not the outcome. Listing them here marks them as not-success.', 20),
    deadline: string('ISO date, or empty when the user set none.', 40),
    budget: {
      type: 'object',
      properties: { maxRuns: { type: 'integer', minimum: 1 }, note: string('Cost limits in words.', 500) },
      additionalProperties: false,
    },
    stopConditions: strings('When to stop and report instead of running again.', 12),
    priority: string('How important this exploration is relative to other work.', 300),
  },
  required: ['statement', 'unit', 'target', 'acceptance'],
  additionalProperties: false,
};
const method = {
  type: 'object',
  description: 'The exploration method under test. The body lives in exactly one place; the base records where, which version is active and why.',
  properties: {
    title: string('Method name.', 220),
    version: string('Version label, never reused (e.g. tsk-v26).', 60),
    summary: string('What this version is / what changed and why.', 2000),
    bodyRef: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['chat_skill', 'intelligence_pack', 'inline', 'repo', 'document', 'hq_method'], description: 'Prefer chat_skill or intelligence_pack: the base then trains that DB skill/pack and releases one pinned version of it.' },
        location: string('chat_skill / intelligence_pack: its id. Otherwise repo full name, document URL or ID.', 500),
        versionNumber: { type: 'integer', minimum: 1, description: 'chat_skill / intelligence_pack: the version this base releases for execution.' },
        path: string('Path inside the repo.', 500),
        commit: string('Commit of this version, when known.', 80),
      },
      additionalProperties: false,
    },
    body: string('Method text when kept inline in the base.', 20000),
    benchmarkRef: string('Where the fixed known-answer cases live.', 500),
  },
  required: ['title', 'version', 'summary'],
  additionalProperties: false,
};
const evidence = {
  type: 'array', maxItems: 20,
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['observation', 'candidate', 'outcome'], description: 'observation: the phenomenon was seen. candidate: it produced a candidate that passed the acceptance checks. outcome: it produced a confirmed achievement.' },
      ref: string('What was observed, concretely.', 600),
      source: string('URL or canonical record ID.', 600),
      date: string('Observation date.', 40),
    },
    required: ['ref'], additionalProperties: false,
  },
};
const item = {
  type: 'object',
  description: 'Omit id to create (the base assigns H-nnn / K-nnn / S-nnn). Pass id to update; only the fields you pass change.',
  properties: {
    id: string('Existing item ID.', 20),
    title: string('Hypothesis: short name.', 160),
    statement: string('Hypothesis: the claim. Constraint: the rule.', 1500),
    mechanism: string('Hypothesis: why it would hold (required on create).', 2000),
    limits: string('Hypothesis/source: where it does not apply.', 1500),
    locator: string('Source: URL, search query or tool call that reaches it (required on create).', 600),
    coverage: string('Source: what it yields for this outcome and why it is worth trying (required on create).', 1500),
    stage: { type: 'string', enum: ['conjecture', 'observed', 'reproduced', 'yielded_candidate', 'yielded_outcome'], description: 'Hypothesis/source stage. For a source: conjecture = untried, observed = tried and gave relevant material, reproduced = useful in two runs, yielded_candidate = a candidate passing the acceptance came from it, yielded_outcome = a confirmed achievement came from it. Only yielded_candidate and yielded_outcome count as win patterns. Advancing needs addEvidence in the same call.' },
    status: { type: 'string', description: 'Hypothesis/source: open | rejected | retired. Constraint: active | relaxed | retired. Changes need reason.' },
    addEvidence: evidence,
    addCounterexamples: strings('Hypothesis: counterexamples. Source: misses (tried, nothing usable) to append.', 20),
    owner: { type: 'string', enum: ['user', 'environment', 'agent'], description: 'Constraint owner. user: only the user may add/change/relax. environment: a measured property of the tools/world, needs basis. agent: provisional threshold the agent may revise with a reason.' },
    basis: string('Constraint (environment): the measurement that established it.', 1500),
    rationale: string('Constraint: why it exists.', 1500),
    check: string('Constraint: how a violation is detected.', 800),
    legacyIds: strings('Earlier labels for the same thing (e.g. "P22", "I12 (tsk-v24)").', 12),
    reason: string('Why this change is made. Required for rejection, demotion, reopening and agent-constraint changes.', 1500),
  },
  additionalProperties: false,
};

const tools = [
  {
    name: 'exploration_base_list',
    description: 'List Exploration Bases: one per ongoing exploration of unknown territory (outcome, method version, progress, stalled-run count). Use to find the base before any exploration run.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'paused', 'closed'] } }, additionalProperties: false },
  },
  {
    name: 'exploration_base_get',
    description: 'Read an Exploration Base. Call this first in every exploration run. view=brief returns the fixed points in one call: outcome contract and progress, active method version, constraints grouped by owner, hypothesis and source ledgers by stage (including rejected ones), last runs, warnings and the run protocol. view=full adds item details, method history, runs and the event log.',
    inputSchema: {
      type: 'object',
      properties: { id: baseId, view: { type: 'string', enum: ['brief', 'full'] }, eventLimit: { type: 'integer', minimum: 1, maximum: 300 } },
      required: ['id'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_base_create',
    description: 'Create an Exploration Base for one exploration. Fixes the user-owned outcome contract, so it requires userAuthorized=true and authorizationNote. Canonical measurement data stays in its operator; the base only points to it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: baseId, title: string('Base title.', 220), summary: string('What is being explored and for what.', 1500),
        projectIds: strings('World Home project IDs.', 20), domains: strings('Domains.', 20),
        canonicalData: strings('Where the measured data lives (operator collection, repo path).', 12),
        packRefs: {
          type: 'array', maxItems: 12, description: 'Intelligence Packs to load for this exploration.',
          items: { type: 'object', properties: { packId: string('Pack ID.', 80), role: string('Why this Pack.', 200) }, required: ['packId'], additionalProperties: false },
        },
        outcome, method, userAuthorized, authorizationNote, actor,
      },
      required: ['id', 'title', 'summary', 'outcome', 'userAuthorized', 'authorizationNote'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_outcome_set',
    description: 'Change the outcome contract, rename or re-describe the base (title/summary/domains/canonicalData), confirm or decline candidate achievements, resolve proposals, or pause/close the base. All of these belong to the user: with userAuthorized=true they are applied; an outcome passed without it is stored as a pending proposal (reason required) and nothing changes.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, outcome,
        title: string('New base title (user-authorized).', 220),
        summary: string('New description of what is explored and for what (user-authorized).', 1500),
        domains: strings('Replacement domain list (user-authorized).', 20),
        canonicalData: strings('Replacement list of where the measured data lives (user-authorized).', 12),
        confirmAchievements: {
          type: 'array', maxItems: 30,
          items: { type: 'object', properties: { id: string('Achievement ID (A-nnn).', 20), decision: { type: 'string', enum: ['confirmed', 'declined'] }, note: string('The user\'s words.', 800) }, required: ['id', 'decision'], additionalProperties: false },
        },
        resolveProposalIds: strings('Proposal IDs the user has decided on.', 30),
        status: { type: 'string', enum: ['active', 'paused', 'closed'] },
        reason: string('Why. Required for a proposal.', 1500),
        runId: string('Open run that produced the proposal.', 20),
        userAuthorized, authorizationNote, actor,
      },
      required: ['baseId'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_method_version_set',
    description: 'Release a new version of what this base trains: point at a Chat Skill or Intelligence Pack version in the DB (bodyRef.kind chat_skill / intelligence_pack, location = id, versionNumber), or an inline/pointer body for older bases. Refused while a run is open. After the first version it requires motivatingRunIds (finished runs that justify it) — or userAuthorized with authorizationNote when the user decided the change — and benchmark.passed=true, or noBenchmarkReason. Prefer an inline body (bodyRef.kind=inline): the base then holds the method text itself. Version labels are never reused. One insight from one run is a ledger entry, not a method version.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, method,
        motivatingRunIds: strings('Finished run IDs whose results justify this version.', 20),
        benchmark: { type: 'object', properties: { passed: { type: 'boolean' }, ref: string('Test/command/record.', 500), cases: string('Known cases checked.', 1000) }, additionalProperties: false },
        noBenchmarkReason: string('Why there is no benchmark yet.', 600),
        userAuthorized, authorizationNote, actor,
      },
      required: ['baseId', 'method'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_item_upsert',
    description: 'Create or update hypotheses, sources or constraints of an Exploration Base (up to 40 per call). Sources are where candidates come from (a site, feed, search query, API); they climb the same verified ladder as hypotheses, so record hits as evidence and misses as counterexamples, and reject sources that keep yielding nothing. Hypothesis stages: conjecture → observed → reproduced → yielded_candidate → yielded_outcome; the server enforces the evidence each stage needs, and only the last two are win patterns. Rejected hypotheses are kept with their reason. Constraints carry an owner; user-owned ones need userAuthorized. Pass runId when the change comes from the open run.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, kind: { type: 'string', enum: ['hypothesis', 'constraint', 'source'] },
        items: { type: 'array', minItems: 1, maxItems: 40, items: item },
        runId: string('The open run this change belongs to.', 20),
        userAuthorized, authorizationNote, actor,
      },
      required: ['baseId', 'kind', 'items'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_run_start',
    description: 'Open an exploration run. Declare the hypotheses under test with the result you predict before measuring, and/or the unexplored area you will observe. Pins the method version. Only one run is open per base. Returns the runId and the current brief.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, objective: string('What this run is for.', 800),
        targets: {
          type: 'array', maxItems: 12,
          items: { type: 'object', properties: { hypothesisId: string('H-nnn.', 20), prediction: string('Expected measurement, stated before measuring.', 800) }, required: ['hypothesisId', 'prediction'], additionalProperties: false },
        },
        unknownTerritoryProbe: string('Area outside the known hypotheses this run will observe.', 800),
        takeover: { type: 'boolean', description: 'Abandon a stale open run and start a new one.' },
        actor,
      },
      required: ['baseId', 'objective'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_run_finish',
    description: 'Close the open run: a verdict (supported / contradicted / inconclusive, with what was measured) for every declared hypothesis, achievements found, and a summary. The server counts which fixed points the run moved; a run that moved none must give notMovedReason and is recorded as stalled. Achievements stay candidates until the user confirms them when the outcome is user-confirmed.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, runId: string('R-nnn.', 20), summary: string('What was done and found.', 2500),
        verdicts: {
          type: 'array', maxItems: 12,
          items: { type: 'object', properties: { hypothesisId: string('H-nnn.', 20), result: { type: 'string', enum: ['supported', 'contradicted', 'inconclusive'] }, observed: string('What was actually measured.', 1200) }, required: ['hypothesisId', 'result', 'observed'], additionalProperties: false },
        },
        achievements: {
          type: 'array', maxItems: 20,
          items: { type: 'object', properties: { label: string('The achievement (e.g. the keyword).', 300), ref: string('ID in the canonical operator data.', 600), evidence: string('How each acceptance check was met.', 2000), hypothesisIds: strings('Hypotheses that led to it.', 10), sourceIds: strings('Sources it came from (S-nnn).', 10) }, required: ['label', 'evidence'], additionalProperties: false },
        },
        notMovedReason: string('Required when the run changed no fixed point.', 1000),
        costNote: string('Paid calls, quota used.', 400),
        nextStep: string('What the next run should do.', 800),
        actor,
      },
      required: ['baseId', 'runId', 'summary'], additionalProperties: false,
    },
  },
];

module.exports = { TOOLS: tools, outcomeSchema: outcome };
