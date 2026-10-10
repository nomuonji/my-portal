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
    description: 'FIRST ENTRYPOINT for ChatGPT user-specific work. Read the top-level My Portal world map BEFORE choosing between Sites Operator, Keywords Operator, My Portal Spaces, Skills, Projects and GitHub. Returns live Project/Space/Method indexes plus route and canonical-source guidance. This is NOT a Space and does NOT modify scheduled Managers or Workers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'world_map_update',
    description: 'Edit the meta-level My Portal world map navigation routes/boundaries after a confirmed addition, retirement or change of responsibility. Does not modify target Operators, Projects, Spaces, Methods, or scheduled agents. Routes are optional overrides of built-in defaults; new Projects/Spaces/Methods are indexed automatically.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        expectedRevision: { type: 'integer', minimum: 0 },
        routes: { type: 'array', maxItems: 80, items: ROUTE },
        hiddenRouteIds: { type: 'array', maxItems: 100, items: { type: 'string' } },
        boundaries: { type: 'array', maxItems: 40, items: { type: 'string' } },
        confirm: { type: 'boolean', description: 'Confirm explicit authority to edit the navigation directory, not to change underlying systems.' },
      },
      required: ['expectedRevision', 'confirm'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];
module.exports = { TOOLS };
