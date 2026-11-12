'use strict';

const { outcomeSchema } = require('./explorationBaseToolSchemas');

const string = (description, maxLength) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) });
const strings = (description, maxItems) => ({ type: 'array', description, items: { type: 'string' }, maxItems });
const submarineId = string('Submarine ID (lowercase kebab-case).', 80);
const actor = string('Who is writing (agent/host name). Optional.', 120);
const userAuthorized = { type: 'boolean', description: 'True only when the user explicitly approved this exact change.' };
const authorizationNote = string('Where/how the user approved it (quote or chat reference). Required with userAuthorized.', 600);
const mission = { ...outcomeSchema, description: 'The mission: what this submarine looks for, how one find is judged and when to stop. Owned by the user.' };
const loadout = {
  type: 'array', minItems: 1, maxItems: 8,
  description: 'Gear: Chat Skills / Intelligence Packs this submarine carries. A gear trained in a スキル錬成道場 always carries the version that 道場 released; untrained gear must pin versionNumber.',
  items: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['chat_skill', 'intelligence_pack'] },
      id: string('Skill or pack id.', 90),
      role: { type: 'string', enum: ['primary', 'support'], description: 'primary: the method of the mission. support: consulted for part of it.' },
      use: string('What this gear is used for on this submarine.', 300),
      dojoId: string('The 道場 that trains it, when several do.', 80),
      versionNumber: { type: 'integer', minimum: 1, description: 'Only for gear no 道場 trains.' },
      train: { type: 'boolean', description: 'Open a practice run in its 道場 on every sortie. Default: true for primary.' },
    },
    required: ['kind', 'id'], additionalProperties: false,
  },
};
const haulCanonical = {
  type: 'object', description: 'Where finds are stored canonically. "here" when the submarine is the store; otherwise the collection (e.g. job_opportunities) and the haul only indexes it.',
  properties: { where: string('here, or the canonical collection/operator.', 120), note: string('How haul.ref points into it.', 500) },
  additionalProperties: false,
};
const chartEntry = {
  type: 'object',
  properties: { statement: string('What the waters turned out to be like (about the target, not about how to search).', 1200), basis: string('What was observed.', 1200), limits: string('Where it may not hold.', 800) },
  required: ['statement', 'basis'], additionalProperties: false,
};

const tools = [
  {
    name: 'submarine_list',
    description: 'List the fleet of Project Submarine: exploration jobs that carry skills/packs (gear) on a user-owned mission and bring back haul. Shows each mission, gear with the version its 道場 released, haul counts and the last sortie.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'paused', 'decommissioned'] } }, additionalProperties: false },
  },
  {
    name: 'submarine_get',
    description: 'Read a submarine before every sortie: mission, loadout with each gear body at the version its 道場 released, haul waiting for the user and confirmed, chart (what the waters are like), last sorties, warnings and protocol. view=full adds the logbook of sorties, declined haul and events.',
    inputSchema: {
      type: 'object',
      properties: { id: submarineId, view: { type: 'string', enum: ['brief', 'full'] }, includeBodies: { type: 'boolean', description: 'Default true. False omits gear bodies.' } },
      required: ['id'], additionalProperties: false,
    },
  },
  {
    name: 'submarine_commission',
    description: 'Commission a new submarine. Fixes the user-owned mission, so it needs userAuthorized and authorizationNote. migrateFromDojo copies a 道場 goal (when mission is omitted) and its achievements as haul.',
    inputSchema: {
      type: 'object',
      properties: {
        id: submarineId, name: string('Submarine name.', 120), hull: string('Hull number, e.g. SS-01.', 20), summary: string('What this submarine is for.', 1500),
        mode: { type: 'string', enum: ['standing', 'one_shot'], description: 'standing: sails on a schedule. one_shot: one request.' },
        mission, loadout, haulCanonical, projectIds: strings('World Home project IDs.', 20), routineJobIds: strings('Routine jobs that launch it.', 10),
        migrateFromDojo: string('道場 id to copy the goal and achievements from.', 80),
        userAuthorized, authorizationNote, actor,
      },
      required: ['id', 'name', 'summary', 'loadout', 'userAuthorized', 'authorizationNote'], additionalProperties: false,
    },
  },
  {
    name: 'submarine_update',
    description: 'Change a submarine between sorties: mission (user-owned: userAuthorized), loadout (reason required; skill/pack versions are still released by their 道場), name/summary/hull/mode/routineJobIds/haulCanonical, status (decommissioned needs userAuthorized), and chartEdits (add an entry, edit one by id, or retire one with a reason).',
    inputSchema: {
      type: 'object',
      properties: {
        submarineId, mission, loadout, name: string('Name.', 120), hull: string('Hull number.', 20), summary: string('Summary.', 1500),
        mode: { type: 'string', enum: ['standing', 'one_shot'] }, status: { type: 'string', enum: ['active', 'paused', 'decommissioned'] },
        routineJobIds: strings('Routine jobs that launch it.', 10), haulCanonical,
        chartEdits: {
          type: 'array', maxItems: 20,
          items: { type: 'object', properties: { id: string('F-nnn to edit; omit to add.', 20), statement: string('Statement.', 1200), basis: string('Basis.', 1200), limits: string('Limits.', 800), status: { type: 'string', enum: ['open', 'retired'] }, reason: string('Why it is retired.', 800), legacyRef: string('Where it came from (e.g. a 道場 hypothesis).', 120) }, additionalProperties: false },
        },
        reason: string('Why this changes.', 1000), userAuthorized, authorizationNote, actor,
      },
      required: ['submarineId'], additionalProperties: false,
    },
  },
  {
    name: 'submarine_sortie_start',
    description: 'Put to sea. Opens a sortie and, for every trained gear, a practice run in its 道場 (declare per 道場 the hypotheses under test with predictions, or leave it to an unknown-territory probe). Returns sortieId and dojoRuns (use those runIds for 道場 ledger writes) and the brief with gear bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        submarineId, objective: string('What this sortie looks for.', 800),
        dojoRuns: {
          type: 'array', maxItems: 8,
          items: {
            type: 'object',
            properties: {
              dojoId: string('道場 id.', 80),
              targets: { type: 'array', maxItems: 12, items: { type: 'object', properties: { hypothesisId: string('H-nnn.', 20), prediction: string('Predicted result.', 800) }, required: ['hypothesisId', 'prediction'], additionalProperties: false } },
              unknownTerritoryProbe: string('Unexplored area this sortie observes.', 800),
            },
            required: ['dojoId'], additionalProperties: false,
          },
        },
        takeover: { type: 'boolean', description: 'Abandon a stale sortie at sea and start a new one.' }, actor,
      },
      required: ['submarineId', 'objective'], additionalProperties: false,
    },
  },
  {
    name: 'submarine_sortie_finish',
    description: 'Return to port. Lists the haul (each find judged against mission.acceptance; ref = its ID in the canonical store when there is one), chart entries, and per-道場 reports (verdicts for the declared hypotheses). Closes the 道場 runs too. Haul stays a candidate until the user confirms it.',
    inputSchema: {
      type: 'object',
      properties: {
        submarineId, sortieId: string('S-nnn.', 20), summary: string('What was done and found.', 2500),
        haul: {
          type: 'array', maxItems: 30,
          items: {
            type: 'object',
            properties: {
              label: string('The find.', 300), ref: string('ID in the canonical store (e.g. personal_feed:abc, job_opportunities:xyz).', 600), url: string('URL.', 1000),
              evidence: string('How it meets each acceptance check.', 2000), sourceIds: strings('道場 sources it came from (S-nnn).', 10), gear: strings('Gear used, kind:id.', 8),
            },
            required: ['label', 'evidence'], additionalProperties: false,
          },
        },
        chart: { type: 'array', maxItems: 12, items: chartEntry },
        dojoReports: {
          type: 'array', maxItems: 8,
          items: {
            type: 'object',
            properties: {
              dojoId: string('道場 id.', 80), summary: string('What this sortie showed about the gear.', 2500),
              verdicts: { type: 'array', maxItems: 12, items: { type: 'object', properties: { hypothesisId: string('H-nnn.', 20), result: { type: 'string', enum: ['supported', 'contradicted', 'inconclusive'] }, observed: string('What was measured.', 1200) }, required: ['hypothesisId', 'result', 'observed'], additionalProperties: false } },
              notMovedReason: string('When this 道場 learned nothing.', 1000), nextStep: string('Next step for the gear.', 800),
            },
            required: ['dojoId'], additionalProperties: false,
          },
        },
        notMovedReason: string('Required when nothing came back.', 1000), nextStep: string('What the next sortie should do.', 800), costNote: string('Paid calls, quota used.', 400), actor,
      },
      required: ['submarineId', 'sortieId', 'summary'], additionalProperties: false,
    },
  },
  {
    name: 'submarine_haul_decide',
    description: 'The user confirms or declines a haul item. A confirmed item is mirrored to the 道場 of the gear that found it as an achievement. Requires userAuthorized and authorizationNote.',
    inputSchema: {
      type: 'object',
      properties: { submarineId, haulId: string('C-nnn.', 20), decision: { type: 'string', enum: ['confirmed', 'declined'] }, note: string('Note.', 800), userAuthorized, authorizationNote, actor },
      required: ['submarineId', 'haulId', 'decision', 'userAuthorized', 'authorizationNote'], additionalProperties: false,
    },
  },
  {
    name: 'submarine_haul_feedback',
    description: 'Record the user\'s evaluation of one haul item: an action (personal_feed: loved / saved / skipped; job_opportunities: apply / consider / pass; otherwise confirmed / candidate / declined) and/or a comment. The action is written back to the canonical store where it has a field (Discover feedback), decides the haul status (mirrored to the 道場), and the comment is kept as feedback the next sortie reads. Only for what the user actually said: userAuthorized + authorizationNote.',
    inputSchema: {
      type: 'object',
      properties: { submarineId, haulId: string('C-nnn.', 20), action: string('Action key from submarine_get actions.', 30), comment: string('The user\'s words.', 1000), userAuthorized, authorizationNote, actor },
      required: ['submarineId', 'haulId', 'userAuthorized', 'authorizationNote'], additionalProperties: false,
    },
  },
  {
    name: 'submarine_haul_list',
    description: 'Haul across the whole fleet, newest first: what every submarine brought back, with its status.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['candidate', 'confirmed', 'declined'] }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false },
  },
];

module.exports = { TOOLS: tools };
