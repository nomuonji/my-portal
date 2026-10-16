'use strict';

const STR = (description, maxLength = 2000) => ({ type: 'string', description, maxLength });
const PROPS = {
  title: STR('Specific, decision-oriented Japanese proposal title.', 180),
  ideaKey: STR('Stable topic identity across repeated runs. Reuse for the same underlying proposal, even if title changes.', 180),
  summary: STR('What to change or explore, and what outcome it might create.', 2800),
  reason: STR('Why this matters now; distinguish actual evidence from inference.', 2500),
  nextStep: STR('Single concrete next action, not a general slogan.', 1200),
  category: STR('Open-ended category such as strategy, learning, economics, product, workflow, life, or culture.', 70),
  priority: { type: 'string', enum: ['now', 'soon', 'explore'] },
  uncertainty: STR('Known gaps and uncertainties, if any.', 900),
  context: { type: 'array', maxItems: 14, items: STR('Relevant project, chat topic or decision key.', 160) },
  evidence: { type: 'array', maxItems: 8, items: { type: 'object',
    additionalProperties: false, properties: {
      label: STR('Source description; may describe a direct user decision.', 140),
      observation: STR('Concrete observation supporting the recommendation.', 700),
      url: STR('Verified source URL, optional.', 1000),
      checkedAt: STR('When this evidence was actually checked, optional.', 40),
    },
  } },
  origin: STR('Agent or source category, not a fabricated conversation ID.', 80),
};
const TOOLS = [
  { name: 'meta_proposal_list', description: 'Read the recent cross-chat strategic recommendation ledger and user feedback BEFORE suggesting new priorities. Unlike Agent HQ, it covers the entire user activity, including possible new directions. This does not read every ChatGPT conversation.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      status: { type: 'string', enum: ['new', 'considering', 'accepted', 'rejected', 'done'] },
    } }, annotations: { readOnlyHint: true },
  },
  { name: 'meta_proposal_get', description: 'Read one stored meta-level recommendation and its feedback.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: STR('Proposal ID', 100) }, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  { name: 'meta_proposal_create', description: 'Persist one new non-duplicative cross-project or life-level recommendation with an evidence trail and actionable next step. Does not execute it or override the user’s feedback. Rejected ideas are not silently revived. Read meta_proposal_list first.',
    inputSchema: { type: 'object', additionalProperties: false, properties: PROPS,
      required: ['title','summary','reason','nextStep'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  { name: 'meta_proposal_feedback', description: 'Record the human decision and reason for a meta recommendation; use expectedRevision to prevent stale overwrites. Never infer human acceptance.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      id: STR('Stored proposal ID', 100),
      status: { type: 'string', enum: ['new','considering','accepted','rejected','done'] },
      feedback: STR('User-written rationale or decision note', 1800),
      expectedRevision: { type: 'integer', minimum: 1 },
    }, required: ['id','status','expectedRevision'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];
module.exports = { TOOLS };
