const ROUTE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100 },
    title: { type: 'string', minLength: 1, maxLength: 140 },
    description: { type: 'string', maxLength: 750 },
    keywords: { type: 'array', items: { type: 'string' }, maxItems: 25 },
    primary: { type: 'string', maxLength: 150 },
    projectId: { type: ['string', 'null'], maxLength: 160 },
    tools: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    spaceIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    boundary: { type: 'string', maxLength: 1000 },
    url: { type: ['string', 'null'], maxLength: 500 },
  },
  required: ['id', 'title'],
};
const TOOLS = [
  {
    name: 'world_map_get',
    description: 'FIRST ENTRYPOINT for user-specific project conversations. Read world_map_get once first, then FOLLOW its agentGuide.instructions (the canonical, editable bootstrap protocol stored in My Portal, not ChatGPT custom instructions). Use its routes, Projects, Contexts and Skills to select relevant authoritative tools. This is not a Space and does not change scheduled Managers or Workers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'world_map_update',
    description: 'Revision-checked update for World Home routes/boundaries and the canonical agentGuide bootstrap instructions. Agent Guide governs chat initialization; not scheduled Manager/Worker instructions. Does not change connected Operators, Projects, Spaces or Skills.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        expectedRevision: { type: 'integer', minimum: 0 },
        routes: { type: 'array', maxItems: 80, items: ROUTE },
        hiddenRouteIds: { type: 'array', maxItems: 100, items: { type: 'string' } },
        boundaries: { type: 'array', maxItems: 40, items: { type: 'string' } },
        agentGuide: { type: 'object', additionalProperties: false, description: 'Canonical ChatGPT conversation bootstrap rules stored in World Home. Not instructions for autonomous Manager/Worker.', properties: {
          title: {type:'string',minLength:1,maxLength:150},
          instructions: {type:'string',minLength:250,maxLength:20000},
          minimalCustomInstruction: {type:'string',minLength:1,maxLength:350},
        }, required:['title','instructions','minimalCustomInstruction'] },
        confirm: { type: 'boolean', description: 'Confirm explicit authority to edit the navigation directory, not to change underlying systems.' },
      },
      required: ['expectedRevision', 'confirm'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];
module.exports = { TOOLS };
