'use strict';

const STR = (description, maxLength = 2000) => ({ type: 'string', description, maxLength });
const PROPS = {
  title: STR('Concrete, appealing recommendation title; it may be an invitation to explore or play rather than a task or business action.', 180),
  ideaKey: STR('Stable topic identity across repeated runs. Reuse for the same underlying proposal, even if title changes.', 180),
  summary: STR('Explain the new experience, topic, activity or reconsideration. Personal/curiosity suggestions need not yield income, productivity or projects.', 2800),
  reason: STR('Why this matters now; distinguish actual evidence from inference.', 2500),
  nextStep: STR('An optional-feeling, low-friction first experience or experiment, not a mandatory productivity task.', 1200),
  category: STR('Open-ended topic label: film, literature, travel, history, science, business, relationships, everyday life, etc. Not limited to established interests.', 70),
  lens: { type: 'string', enum: ['projects','personal','curiosity','cross-cutting'], description: 'projects=existing work, personal=private everyday life/leisure/habits without sensitive inferences, curiosity=new hobbies/cultural/scientific/artistic/intellectual interests, cross-cutting=meta-level reframing. Choose personal or curiosity for novel non-work suggestions; do not relabel them as work.' },
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
  { name: 'meta_proposal_create', description: 'Store recommendations across projects AND hobbies, leisure, culture, entertainment, personal everyday life, new intellectual curiosities and surprising adjacent or distant interests. Do not make every recommendation a new app, monetization scheme or improvement to existing work. Avoid intrusive assumptions and sensitive inferences. Read meta_proposal_list first; rejected ideas must not be silently revived. Does not execute anything.',
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
