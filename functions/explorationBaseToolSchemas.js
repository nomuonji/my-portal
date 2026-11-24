'use strict';

const string = (description, maxLength) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) });
const strings = (description, maxItems) => ({ type: 'array', description, items: { type: 'string' }, maxItems });
const baseId = string('Exploration Base ID (lowercase kebab-case).', 80);
const actor = string('Who is writing (agent/host name). Optional.', 120);
const userAuthorized = { type: 'boolean', description: 'True only when the user explicitly approved this exact change.' };
const authorizationNote = string('Where/how the user approved it (quote or chat reference). Required with userAuthorized.', 600);

const textureReview = {
  type:'object',
  description:'Preserve qualitative observations before abstraction: actual artifact wording, rhythm, register, emotional temperature, visual/audio texture, contextual exceptions. Compare 2-4 actual S/T cases; quote exact body or stored media/ref, never invent evidence or human motives.',
  properties:{
    cases:{type:'array',minItems:2,maxItems:4,items:{type:'object',properties:{
      caseId:string('Actual rated T-nnn or observed S-nnn.',20),
      anchor:string('Exact 4-1000 chars from stored original body, or its exact stored image/media/ref URL.',1000),
      observation:string('Concrete sensory/stylistic/semantic feature in the original; for media include where/when observed. Do not substitute generic adjectives.',900),
      context:string('Speaker, audience, situation, medium and/or preceding/following details needed to understand this feature.',900),
    },required:['caseId','anchor','observation','context'],additionalProperties:false}},
    distinction:string('Explain the subtle differences between cases at the level of concrete expression, rhythm, context, texture or analogous domain-specific features; do not infer user motives from verdicts.',1200),
    transfer:string('Reproducible way to transfer the quality into another case without copying the surface.',1200),
    boundary:string('Near-miss, exception, or when a superficially similar technique fails.',1200),
    uncertainty:string('What is directly observed, what remains interpretation, what is unavailable or not yet verified.',900),
  },required:['cases','distinction','transfer','boundary','uncertainty'],additionalProperties:false,
};

const outcome = {
  type: 'object',
  description: 'Outcome contract of the exploration. Owned by the user.',
  properties: {
    statement: string('What the exploration must produce, in one or two sentences.', 1200),
    unit: string('What counts as one achievement (e.g. one keyword the user decided to write).', 300),
    target: {
      type: 'object',
      description: 'Optional count target. Leave it out for a 道場: it is measured by the pass rate of its released version, not by a count.',
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
  required: ['statement', 'unit', 'acceptance'],
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
        kind: { type: 'string', enum: ['chat_skill', 'skill_pack', 'intelligence_pack', 'inline', 'repo', 'document', 'hq_method'], description: 'Prefer chat_skill or skill_pack: they use one dojo release discipline. intelligence_pack remains legacy compatibility.' },
        location: string('chat_skill / skill_pack / intelligence_pack: its id. Otherwise repo full name, document URL or ID.', 500),
        versionNumber: { type: 'integer', minimum: 1, description: 'chat_skill / skill_pack / intelligence_pack: the version this base releases for execution.' },
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
    researchProtocol: {
      type: 'object',
      description: 'New Skill/Pack hypotheses require this six-stage research protocol plus formationReview citing two real observed S/T cases. Legacy hypotheses retain their original data. This is a design check, not proof of a method.',
      properties: {
        acquisition: string('Exactly where and how to collect comparable original cases (source, query, sample window).', 900),
        selection: string('Observable inclusion/exclusion criteria BEFORE seeing the target output; distinguish strong/weak source material.', 900),
        transformation: string('Reproducible creative operation from material to standalone post, not merely a genre or stylistic label.', 900),
        control: string('Competing method, matched factors and what is held constant.', 900),
        prediction: string('Precommitted user-rating or other actual observable difference, not AI self-PASS.', 900),
        falsification: string('Concrete result that would reject or revise the hypothesis, even if a few copies appear plausible.', 900),
      },
      required: ['acquisition','selection','transformation','control','prediction','falsification'],
      additionalProperties: false,
    },
    textureReview,
    formationReview: {
      type: 'object',
      description: 'Required on NEW Skill/Pack H. One-off examples and ideas belong to source S-nnn instead. Server checks case IDs and evidence state, not causal truth.',
      properties: {
        caseRefs: {type:'array',minItems:2,maxItems:8,uniqueItems:true,items:string('An S-nnn with sourceRole=observation and observed evidence, or a genuinely human-rated T-nnn in this base.',20)},
        changedOperation: string('The concrete method operation varied before inspecting the new artifact, not a topic label.',900),
        rivalExplanation: string('Competing explanation for past outcomes and at least one confound.',900),
        transferTest: string('Compare this method against a control on a different independent material; predict a falsifier.',900),
        priorArtDecision: string('Why observation/idea or a refinement of an existing H is insufficient; cite relevant older H.',900),
      },
      required:['caseRefs','changedOperation','rivalExplanation','transferTest','priorArtDecision'],
      additionalProperties:false,
    },
    pipelineStage: { type: 'string', enum: ['source', 'selection', 'transform', 'voice', 'gate', 'audience', 'unknown'], description: 'Hypothesis only: which part of the full sourcing-to-evaluation pipeline is under test. Not the evidence maturity stage.' },
    polarity: { type: 'string', enum: ['positive', 'negative'], description: 'All dojos: positive predicts successful outcomes (default for legacy), negative predicts a falsifiable failure mode. Negative hypotheses are validated separately and cannot be ranked as positive win patterns.' },
    limits: string('Hypothesis/source: where it does not apply.', 1500),
    locator: string('Source: URL, search query or tool call that reaches it (required on create).', 600),
    coverage: string('Source: what it yields for this outcome and why it is worth trying (required on create).', 1500),
    sourceRole: {type:'string',enum:['source','observation','idea'],description:'S-nnn: acquisition channel, observed case, or unvalidated idea. Idea records cannot be formation evidence.'},
    originalProof:{type:'object',description:'Optional direct-original citation with an exact excerpt observed by the agent. Needed for Buzz recovery after persistent user rejections. The server verifies format and link within source metadata, but cannot independently attest that the external text is real.',properties:{
      originalUrl:string('Direct original post/page permalink, HTTPS; not a search result/summary feed.',1000),
      excerpt:string('At least 16 exact characters from the original text, not a summary of it.',1100),
      verification:{type:'string',enum:['direct_original']},
    },required:['originalUrl','excerpt','verification'],additionalProperties:false},
    stage: { type: 'string', enum: ['conjecture', 'observed', 'reproduced', 'yielded_candidate', 'yielded_outcome'], description: 'Hypothesis/source stage. For a source: conjecture = untried, observed = tried and gave relevant material, reproduced = useful in two runs, yielded_candidate = a candidate passing the acceptance came from it, yielded_outcome = a confirmed achievement came from it. Only yielded_candidate and yielded_outcome count as win patterns. Advancing needs addEvidence in the same call.' },
    status: { type: 'string', description: 'Hypothesis/source: open | rejected | retired. Constraint: active | relaxed | retired. Changes need reason.' },
    addEvidence: evidence,
    addCounterexamples: strings('Hypothesis: counterexamples. Source: misses (tried, nothing usable) to append.', 20),
    owner: { type: 'string', enum: ['user', 'environment', 'agent'], description: 'Constraint owner. user: only the user may add/change/relax. environment: a measured property of the tools/world, needs basis. agent: provisional threshold the agent may revise with a reason.' },
    basis: string('Constraint (environment): the measurement that established it.', 1500),
    rationale: string('Constraint: why it exists.', 1500),
    check: string('Constraint: how a violation is detected.', 800),
    legacyIds: strings('Earlier labels for the same thing (e.g. "P22", "I12 (tsk-v24)").', 12),
    targetSkillIds: strings('Optional target Chat Skill IDs for cross-skill learning. Exact dependencies are reviewed, not automatically edited or released.',12),
    targetModuleIds: { type:'array',minItems:1,maxItems:7,uniqueItems:true,
      items:{type:'string',enum:['root','source','selection','transform','voice','gate','audience']},
      description:'Optional explicit Skill module(s) this hypothesis examines. Legacy H records retain inferred root or pipeline module without being rewritten.' },
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
    description: 'Read an Exploration Base before each run. loop.refinement provides calibrated forecast error, smoothed hypothesis estimates, uncertainty and a competing-hypothesis contrast; advisory, not proof. Read nextActions and design a discriminating test before generating outputs. view=state refreshes the loop, gates, pending evaluations and pinned method pointer without reloading its body or ledgers; use brief for the initial load or after a method/contract change. view=full adds item details, immutable revision history, runs and events.',
    inputSchema: {
      type: 'object',
      properties: { id: baseId, view: { type: 'string', enum: ['state', 'brief', 'full'] }, eventLimit: { type: 'integer', minimum: 1, maximum: 300 } },
      required: ['id'], additionalProperties: false,
    },
  },
  {
    name:'exploration_skill_graph_get',
    description:'Read the Skill-module → hypothesis lineage → original human-rated trials graph without rewriting any H/T/feedback record. Also returns stewardship.skillImprovement: candidate routes from human-rated cases to individual target Skills; these require diagnosis, validation and target-dojo release, never auto-edit. Returns stewardship.portfolio: cross-module branch worklist, partial-support and negative hypothesis follow-ups, unreviewed capacity and maintenance actions. Agent must consult the entire human-feedback and hypothesis history, steward multiple branches, generate as many distinct artifacts as research supports (usually 1–3 when capacity permits), and reconcile new user feedback before proposing a merge. Deterministic states are shadow estimates, not human ratings or approved Skill rules. summary returns recent trial excerpts; full returns original cases.',
    inputSchema:{type:'object',properties:{
      baseId,view:{type:'string',enum:['summary','full'],description:'summary (default) or full legacy trial references'},
    },required:['baseId'],additionalProperties:false},
  },
  {
    name:'exploration_hypothesis_relation_upsert',
    description:'Create 1-12 additional proposed hypothesis connections between existing H-nnn IDs: derivation, narrowing, contradiction, complement, synthesis, supersession. Append-only proposals: confirmed/causal status cannot be self-declared. Directed lineage cycles are rejected. Existing hypotheses, trial IDs and ratings remain unchanged.',
    inputSchema:{type:'object',properties:{
      baseId,actor,
      relations:{type:'array',minItems:1,maxItems:12,items:{type:'object',properties:{
        sourceId:string('Existing source hypothesis H-nnn in this dojo.',20),
        targetId:string('Existing different target hypothesis H-nnn in this dojo.',20),
        relation:{type:'string',enum:['derives_from','narrows','synthesizes','supersedes','contradicts','complements']},
        rationale:string('Explain why these hypotheses may be related, 15-900 chars. This is an agent proposal, not an accepted fact.',900),
        evidenceIds:strings('Optional exact existing T-nnn cases linked to this proposal.',16),
      },required:['sourceId','targetId','relation','rationale'],additionalProperties:false}},
    },required:['baseId','relations'],additionalProperties:false},
  },
  {
    name:'exploration_skill_rule_proposal_upsert',
    description:'Attach an exact existing rule quotation from the pinned released Skill/Pack version to real hypothesis IDs and genuine human-rated trial evidence. Create an immutable add/replace/retire proposal. Server calculates evidence eligibility (not quality, causal proof, release authorization or automatic text modification). When there are no independent matched comparisons, a proposal stays blocked. This never edits the released Skill.',
    inputSchema:{type:'object',properties:{
      baseId,actor,
      proposal:{type:'object',properties:{
        action:{type:'string',enum:['add','replace','retire']},
        moduleId:{type:'string',enum:['root','source','selection','transform','voice','gate','audience']},
        sourceMethodVersion:string('Exact method version label currently pinned by this dojo.',80),
        existingRuleId:string('Optional current SR-... rule ID from graph.skillRules.inventory. For replace/retire, the server resolves its exact text; longer rules also require a unique quote.',40),
        existingRuleAnchor:string('For replace/retire: exact unique 16-600 character quote from the pinned Skill or Pack body. Not inferred by LLM.',600),
        replacementText:string('For add/replace: proposed 16-1200 character new rule. Never auto-adopted.',1200),
        hypothesisIds:strings('1-4 real positive H-nnn hypotheses governing this rule.',4),
        supportingTrialIds:strings('1-20 genuine human PASS T-nnn IDs linked to hypotheses.',20),
        counterexampleTrialIds:strings('1-20 human non-PASS T-nnn IDs. Not counted as support.',20),
        rationale:string('Specific reason to add/change/retire this Skill rule (30-1200 chars).',1200),
        refutingObservation:string('What new human feedback would refute this rule change (30-900 chars).',900),
      },required:['action','moduleId','sourceMethodVersion','hypothesisIds','supportingTrialIds','counterexampleTrialIds','rationale','refutingObservation'],additionalProperties:false}
    },required:['baseId','proposal'],additionalProperties:false},
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
    name: 'exploration_method_target_migrate',
    description: 'One-time classification-only migration of an already released legacy Intelligence workflow to Skill Pack. Requires original canonical dojo and matching id/version, no open run, confirm=true. Preserves method.version, every H/T verdict, history and existing approved version; does not release a draft or alter success gates.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId: string('Canonical existing dojo ID', 160),
        packId: string('Legacy composite Intelligence ID (now Skill Pack ID)', 90),
        confirm: {type:'boolean',enum:[true]},
        actor: string('Agent/source of authorized migration', 200),
      },required:['baseId','packId','confirm'],additionalProperties:false,
    },
  },
  {
    name: 'exploration_method_version_set',
    description: 'Release a new version of what this base trains: point at a Chat Skill or Skill Pack version (bodyRef.kind chat_skill / skill_pack; legacy intelligence_pack is still accepted, location=id, versionNumber), or an inline/pointer body for older bases. Refused while a run is open. After the first version it requires motivatingRunIds (finished runs that justify it) — or userAuthorized with authorizationNote when the user decided the change — and benchmark.passed=true, or noBenchmarkReason. When the base records trials, the released version also needs loop.gates.minRatedPerVersion rated trials first (so the two versions can be compared by pass rate) unless the user directed the change. Prefer an inline body (bodyRef.kind=inline): the base then holds the method text itself. Version labels are never reused. One insight from one run is a ledger entry, not a method version.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, method,
        motivatingRunIds: strings('Finished run IDs whose results justify this version.', 20),
        ruleProposalIds: strings('Optional exact MR-... Skill-rule proposals to include in this release; must pass live evidence eligibility, pinned-version checks, and the actual new body diff unless the user explicitly authorized a change. Never self-certifies quality.',12),
        benchmark: { type: 'object', properties: { passed: { type: 'boolean' }, ref: string('Test/command/record.', 500), cases: string('Known cases checked.', 1000) }, additionalProperties: false },
        noBenchmarkReason: string('Why there is no benchmark yet.', 600),
        userAuthorized, authorizationNote, actor,
      },
      required: ['baseId', 'method'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_item_upsert',
    description: 'Create or update hypotheses, sources or constraints of an Exploration Base (up to 40 per call). New Skill/Pack H requires researchProtocol AND formationReview backed by two observed S/T refs, a method operation, a rival cause, a cross-material test and a prior-art decision. One-off ideas/observations use sourceRole on S, not H. Existing H remain editable. Sources are where candidates come from (a site, feed, search query, API); they climb the same verified ladder as hypotheses, so record hits as evidence and misses as counterexamples, and reject sources that keep yielding nothing. Hypothesis stages: conjecture → observed → reproduced → yielded_candidate → yielded_outcome; the server enforces the evidence each stage needs, and only the last two are win patterns. Rejected hypotheses are kept with their reason. Constraints carry an owner; user-owned ones need userAuthorized. Pass runId when the change comes from the open run.',
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
    description: 'In persistent-failure Buzz research, create a discriminating experimentDesign before any new user-facing trial, compare several independent candidate mechanisms, and do not reuse quarantined self-clearing negative hypotheses. Open an exploration run and pin its method. Test success and failure hypotheses in parallel: targets plus negativeTargets (the server auto-pins one open failure hypothesis for positive runs when omitted). Optional crossDojoEvidence validates a real user-rated source-dojo pass/fail pair and stores the unproven transfer mechanism with a controlled receiver experimentDesign. Receiver pass/fail remains exclusively based on its own later human feedback. Prefer responseMode=compact after loading the base.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, objective: string('What this run is for.', 800),
        targets: {
          type: 'array', maxItems: 12,
          items: { type: 'object', properties: { hypothesisId: string('H-nnn.', 20), prediction: string('Expected measurement, stated before measuring.', 800) }, required: ['hypothesisId', 'prediction'], additionalProperties: false },
        },
        negativeTargets: {
          type: 'array', maxItems: 6,
          description: 'Failure-mode hypotheses (polarity=negative) to test alongside positive targets; open H-nnn IDs and falsifiable precommitted predictions. When specified, each user-facing trial requires negativeReview covering all targets.',
          items: { type:'object', properties: { hypothesisId: string('Open negative H-nnn.',20), prediction: string('Predicted failure condition and how it would be falsified.',800) }, required:['hypothesisId','prediction'], additionalProperties:false },
        },
        unknownTerritoryProbe: string('Area outside the known hypotheses this run will observe.', 800),
        experimentDesign: {
          type: 'object',
          description: 'Optional but recommended common-dojo discriminator. Identifies which pipeline stage changes, holds other factors comparable, and states a falsifying observation before experimentation. It cannot claim causality from one trial.',
          properties: {
            contrastedHypothesisIds: strings('Distinct open competing hypotheses, not repeated target IDs.', 6),
            changedStage: { type: 'string', enum: ['source', 'selection', 'transform', 'voice', 'gate', 'audience'] },
            intervention: string('What changes in this experimental arm.', 900),
            comparison: string('Which baseline or alternative approach is compared.', 900),
            controls: string('What source/selection/voice/measurement conditions stay comparable.', 900),
            expectedDifference: string('Predicted observable difference between target and competing hypotheses.', 900),
            refutingObservation: string('Which outcome would reject the favored explanation.', 900),
          },
          required: ['contrastedHypothesisIds', 'changedStage', 'intervention', 'comparison', 'controls', 'expectedDifference', 'refutingObservation'],
          additionalProperties: false,
        },
        crossDojoEvidence: {
          type: 'array', minItems: 1, maxItems: 3,
          description: 'Optional structured peer-dojo transfer evidence. Requires experimentDesign. The source positive and negative MUST exist as human-rated trials. This records receiver-side hypothesis provenance, not an automatic success or approval.',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              sourceBaseId: string('Source dojo ID; must differ from receiving baseId.', 80),
              positiveTrialId: string('Real human-rated pass from source dojo (T-nnn).', 20),
              negativeTrialId: string('Real human-rated fail or partial from source dojo (T-nnn).', 20),
              hypothesizedMechanism: string('Transferable process mechanism, not copied words or creative surface.', 850),
              applicabilityConditions: string('When the mechanism can and cannot apply at receiving dojo.', 850),
              falsification: string('Observable receiver-side result that would reject this transferred mechanism.', 850),
            },
            required: ['sourceBaseId', 'positiveTrialId', 'negativeTrialId',
              'hypothesizedMechanism', 'applicabilityConditions', 'falsification'],
          },
        },
        takeover: { type: 'boolean', description: 'Abandon a stale open run and start a new one.' },
        responseMode: { type: 'string', enum: ['brief', 'compact'], description: 'compact returns the committed run receipt only; brief (default) also reloads the base.' },
        actor,
      },
      required: ['baseId', 'objective'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_run_finish',
    description: 'Close the run with observed verdicts. If 3+ consecutive non-passes, a mere finished run does NOT clear the next-trial gate: provide failureAnalysis with at least two real rated failures, an accepted/external positive comparator, two competing explanations with for/against evidence and falsification, acknowledged uncertainty, false-positive gate diagnosis when applicable, and a discriminating next test. Each claim remains a hypothesis, not proven causality. Ratings remain the user\'s alone. Prefer responseMode=compact to return the committed run and refreshed loop (including nextActions) without reloading the entire base.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, runId: string('R-nnn.', 20), summary: string('What was done and found.', 2500),
        verdicts: {
          type: 'array', maxItems: 12,
          items: { type: 'object', properties: { hypothesisId: string('H-nnn.', 20), result: { type: 'string', enum: ['supported', 'contradicted', 'inconclusive'] }, observed: string('What was actually measured.', 1200) }, required: ['hypothesisId', 'result', 'observed'], additionalProperties: false },
        },
        negativeVerdicts: {
          type: 'array', maxItems: 6,
          description: 'Required for each declared negativeTarget. Inconclusive is valid when no independent human test exists; internal rejection does not prove a hypothesis.',
          items: { type:'object', properties: { hypothesisId: string('Declared negative H-nnn.',20), result: { type:'string', enum:['supported','contradicted','inconclusive'] }, observed: string('What was observed, with uncertainty.',1200) }, required:['hypothesisId','result','observed'], additionalProperties:false },
        },
        screenedOut: {
          type: 'array', maxItems: 20, description: 'Candidates stopped internally after a negative-hypothesis check. Never counted as a human-rated fail or pass.',
          items: { type:'object', properties: { hypothesisId: string('Declared negative H-nnn.',20), candidate: string('Candidate label, not fake finished user-facing trial.',300), observedRisk: string('Specific failure risk observed.',700), counterEvidence: string('Positive counterexample and why the risk remains fatal.',700) }, required:['hypothesisId','candidate','observedRisk','counterEvidence'], additionalProperties:false },
        },
        achievements: {
          type: 'array', maxItems: 20,
          items: { type: 'object', properties: { label: string('The achievement (e.g. the keyword).', 300), ref: string('ID in the canonical operator data.', 600), evidence: string('How each acceptance check was met.', 2000), hypothesisIds: strings('Hypotheses that led to it.', 10), sourceIds: strings('Sources it came from (S-nnn).', 10) }, required: ['label', 'evidence'], additionalProperties: false },
        },
        failureAnalysis: {
          type: 'object',
          description: 'Evidence audit after 3+ consecutive non-passes. This is NOT a claim that causes have been proved. Without it, new trial/release remains blocked.',
          properties: {
            caseRefs: strings('At least two actual recent user-rated non-pass IDs (trial/haul) from this dojo.', 12),
            contrastRefs: strings('Accepted user-rated trial/haul IDs or public HTTPS URLs with a real positive example.', 12),
            alternatives: {
              type: 'array', minItems: 2, maxItems: 6,
              items: { type: 'object', properties: {
                stage: { type: 'string', enum: ['source', 'selection', 'transform', 'voice', 'gate', 'audience', 'unknown'] },
                claim: string('One falsifiable candidate cause, not a concluded fact.', 750),
                forEvidence: string('Concrete observations that favor this alternative.', 950),
                againstEvidence: string('A counterexample, a missing measurement or observation arguing against it.', 950),
                falsification: string('Observable result that would reject this cause.', 950),
              }, required: ['stage', 'claim', 'forEvidence', 'againstEvidence', 'falsification'], additionalProperties: false },
            },
            uncertainty: string('What cannot be inferred from the observed user feedback; do not invent rejection reasons.', 1200),
            falsePositiveAudit: string('Where the agent PASS/quality prediction failed on the rejected samples (mandatory if it assigned >=0.5 to any cited failure).', 1200),
            nextTest: { type: 'object', properties: {
              sourcingChange: string('What changes upstream in evidence collection/source selection.', 900),
              selectionChange: string('What changes in evaluation/choice before generating output.', 900),
              predictedDifference: string('A measurable precommitted outcome.', 900),
              refutingObservation: string('What observed result would refute this intervention.', 900),
            }, required: ['sourcingChange', 'selectionChange', 'predictedDifference', 'refutingObservation'], additionalProperties: false },
          },
          required: ['caseRefs', 'contrastRefs', 'alternatives', 'uncertainty', 'nextTest'],
          additionalProperties: false,
        },
        notMovedReason: string('Required when the run changed no fixed point.', 1000),
        costNote: string('Paid calls, quota used.', 400),
        nextStep: string('What the next run should do.', 800),
        responseMode: { type: 'string', enum: ['brief', 'compact'], description: 'compact returns run and refreshed loop; brief (default) also reloads the base.' },
        actor,
      },
      required: ['baseId', 'runId', 'summary'], additionalProperties: false,
    },
  },
  {
    name:'exploration_research_read',
    description:'MANDATORY before creating trial candidates in any dojo with earlier user feedback. Read ALL pages of the historical inventory in ascending order (page=0,1,...): every previous hypothesis including negative/retired ones, full claim, mechanism, limits, evidence, counterexamples, revisions, run results and every actual user rating with their original words. Do not select only the favorite two hypotheses. Research synthesis cannot proceed until all pages are read.',
    inputSchema: { type:'object', properties: {
      baseId, runId:string('Open research run ID.',20),
      page:{type:'integer',minimum:0,description:'Zero-based history page. Must start at 0 and follow the nextPage value, without skipping pages.'},
    },required:['baseId','runId','page'],additionalProperties:false },
  },
  {
    name:'exploration_research_synthesize',
    description:'After ALL hypothesis/feedback pages including original artifact bodies are read, preserve concrete qualitative distinctions in textureReview (or existing comparison/tension fields on legacy clients), and register a dialectical proposal and, if new human ratings await maintenance, treeReview must cover all rated cases and every touched hypothesis branch. Then it can propose refinements, splits, or merges; all agent interpretations remain hypotheses. Prior flow: cite a real prior thesis and competing hypothesis (if at least 2 exist), quote their actual claims, cite real human pass and fail feedback, explain tension, propose a testable synthesis/revision and its falsifying observation. Required before existing recall tests and trial recording. Does not itself change hypotheses or certify user acceptance.',
    inputSchema: { type:'object', properties: {
      baseId,runId:string('Open run ID with completed research reading.',20),
      textureReview,
      synthesis:{type:'object',properties:{
        thesisId:string('Existing historical hypothesis ID.',20),
        antithesisId:string('A second actual existing hypothesis ID when it truly competes or complements the first; omit if no meaningful contrast exists.',20),
        relationship:{type:'string',enum:['competing','complementary','unresolved'],description:'Competing: incompatible predictions under shared conditions; complementary: both may hold under different conditions; unresolved: no substantiated opposition yet. Do not invent contradictions.'},
        thesisAnchor:string('Exact 8-160 character quote from actual thesis claim, mechanism or limits.',160),
        antithesisAnchor:string('Exact 8-160 character quote from competing claim, mechanism or limits.',160),
        passFeedbackId:string('Real historical human-accepted trial or feedback ID, if one exists.',160),
        passFeedbackAnchor:string('Exact quoted words from that human acceptance (>=2 chars when text exists).',160),
        failFeedbackId:string('Real historical human-rejected or partial trial or feedback ID, if one exists.',160),
        failFeedbackAnchor:string('Exact quoted words from that human rejection or partial rating (>=2 chars when text exists).',160),
        action:{type:'string',enum:['revise','synthesize','retain','retire']},
        tension:string('Empirical/logical tension, compatibility, or why no established contradiction is known; separate human words from the agent\'s interpretation.',1200),
        proposedClaim:string('Revised or integrated, falsifiable hypothesis that follows from the evidence.',1200),
        comparison:string('Observable contrast/controls and how the alternative explanations would be distinguished.',1200),
        falsification:string('What future observation or human response would specifically refute the proposal.',1200),
      },required:['thesisId','thesisAnchor','tension','proposedClaim','comparison','falsification','action'],additionalProperties:false},
      treeReview:{type:'object',description:'Required whenever new user-rated Trials exist since the last tree synthesis; reconcile every newly affected hypothesis branch before new output.',properties:{
        reviewedTrialIds:strings('ALL pending newly human-rated T-nnn IDs exposed by graph.stewardship.feedbackReview (max 120).',120),
        reviewedExternalRefs:strings('ALL newly confirmed/declined submarine haul refs in graph.stewardship.feedbackReview (max 120).',120),
        crossBranchSummary:string('How the latest real feedback changes the relation among branches, rather than only restating verdicts (40-1500 chars).',1500),
        branchDecisions:{type:'array',minItems:0,maxItems:120,items:{type:'object',properties:{
          hypothesisId:string('One affected H-nnn ID; each affected branch must be reviewed once.',20),
          action:{type:'string',enum:['retain','refine','split','merge_candidate','retire','unresolved']},
          rationale:string('Compare actual human feedback with the hypothesis; do not assert an unknown rejection cause as fact (30-900 chars).',900),
          nextFalsification:string('Specific new test or observation that could refute the chosen next action (25-900 chars).',900),
        },required:['hypothesisId','action','rationale','nextFalsification'],additionalProperties:false}},
      },required:['reviewedTrialIds','crossBranchSummary','branchDecisions'],additionalProperties:false},
    },required:['baseId','runId','synthesis'],additionalProperties:false},
  },
  {
    name: 'exploration_recall_prepare',
    description: 'Only AFTER exploration_research_read and exploration_research_synthesize (when feedback history exists). Before generating a candidate, retrieve related human-rated texts AND prior TESTED hypothesis statements, mechanisms, limiting conditions, recorded human pass/fail IDs, counterexamples, past run results and revisions. Four further cases are provided without labels for a historical-label check. The returned agent hypotheses are NOT proven causal explanations.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, runId: string('Open run ID (R-nnn).',20),
        topic: string('Specific research premise or audience situation, supplied before candidate drafting, 8-400 characters.',400),
        hypothesisIds: strings('Positive hypotheses being researched; improves relevance of retrieved cases.',10),
      },
      required: ['baseId','runId','topic'], additionalProperties:false,
    },
  },
  {
    name: 'exploration_recall_check',
    description: 'Classify all four historical challenge cases (>=3/4 correct) AND explicitly review every returned historical hypothesis, quoting its claim and falsifier and citing a true linked pass/fail pair with proposed transfer and rejection conditions. No trial can be registered without the reviews. One check per run; this is NOT proof of causality or the quality of new work.',
    inputSchema: {
      type:'object',
      properties: {
        baseId, runId: string('Open run ID with a prepared recall challenge.',20),
        predictions: { type:'array', minItems:4, maxItems:4, items: { type:'object',
          properties: {
            caseId: string('Assigned historical T-nnn or haul case ID.',160),
            predictedVerdict: { type:'string', enum:['pass','fail'] },
            quote: string('Exact 8-160 character quote from this challenge case body or label.',160),
            reason: string('Observable reason for predicting pass/fail; 20-700 chars, do not infer the user\'s hidden motive as fact.',700),
          },
          required:['caseId','predictedVerdict','quote','reason'],additionalProperties:false,
        } },
        hypothesisReviews: { type:'array', maxItems:2, description:'One review for EACH returned historicalHypothesis; omit only when no historicalHypotheses were returned.', items: { type:'object',
          properties: {
            hypothesisId: string('Exact ID of a retrieved historical hypothesis.',20),
            claimAnchor: string('8-160 literal characters from its actual statement/mechanism.',160),
            limitAnchor: string('8-160 literal characters from its limits or an actual counterexample.',160),
            passCaseId: string('Real past human PASS trial linked to this hypothesis.',20),
            failCaseId: string('Real past human FAIL trial linked to this hypothesis.',20),
            transferCondition: string('Specific observable reason this old success mechanism could apply to the current research topic (25-650 chars).',650),
            refutingCondition: string('Specific observable reason this claim may be false or fail when transferred (25-650 chars).',650),
          },
          required:['hypothesisId','claimAnchor','limitAnchor','passCaseId','failCaseId','transferCondition','refutingCondition'],additionalProperties:false,
        } },
      },
      required:['baseId','runId','predictions'],additionalProperties:false,
    },
  },
  {
    name: 'exploration_trial_record',
    description: 'BUZZ RECOVERY: after 8+ consecutive real human non-passes, the server rejects a Buzz sample lacking a precommitted discriminating experimentDesign, a selected source with direct originalProof, or an independently identifiable single positive primary hypothesis. Repeatedly self-cleared negative reviews with >=3 human rejects and 0 passes are quarantined; use a newly tested negative arm. Model forecast below the human base rate is a one-way veto, NEVER proof of quality when it is high. All historical H/T stay unchanged. Record user-facing trials before presenting. If historical user ratings exist, full paginated exploration_research_read plus grounded exploration_research_synthesize are mandatory, including ALL prior hypotheses (not just the best two) and all user feedback words. For human-rated dojos with >=4 accepted and >=4 rejected historical texts, a run must have passed exploration_recall_prepare + exploration_recall_check (>=3 of 4) first. This is in addition to the existing learningAudit. ALL trial-based dojos with 3+ rated results and both an accepted and rejected case require learningAudit with exact quotes from both human-rated case texts, plus the claimed transfer mechanism and counterexample. Old clients can use learning:v1:<compact JSON> in predictionNote (<=600 characters). The Buzz screen alone no longer satisfies the learning review. Buzz-post dojo adds an enforced early rejection screen: 3+ candidate pool, 2+ rejected, 2+ observed sourcing lanes, accepted/rejected human-rated precedent, exact passage from the proposed copy, concrete hostile objection, and a pre-registered closingType (derived_consequence = the last beat follows directly from the material; author_added = the author added an analogy, counterfactual, title or similar). predictedPass is an honest forecast and no longer gates submission. Native quote practice is retired. Use editorialScreen or, from clients with the older MCP schema, screen:v1:<compact JSON> inside predictionNote (up to 600 characters). Other dojos are unchanged. A screen is an AI-only gate, NOT independent approval or a promise of engagement.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, runId: string('The open run these samples belong to.', 20),
        trials: {
          type: 'array', minItems: 1, maxItems: 30,
          items: {
            type: 'object',
            properties: {
              label: string('Short name of the sample (first words of the post, the keyword, the title).', 300),
              body: string('The sample itself, as shown.', 4000),
              ref: string('Where the sample lives (Output ID, haul ref, URL). Used to avoid recording it twice. An https URL is shown to the user as a link button on the rating card: for a product, pass the product page URL here.', 600),
              imageUrl: string('Optional public https URL of a picture the user needs to judge the sample (product photo, thumbnail). Shown on the rating card. Pass it for every product sample. To add a picture to a sample that is already waiting, record it again with the same ref and an imageUrl: only the picture is added.', 1000),
              mediaUrl: string('Public HTTPS URL of the completed artifact (video, image or external player). Do not use local paths, ephemeral sandbox:/// refs or planned: IDs as completion evidence. An awaiting sample can be completed by recording the same ref with a mediaUrl; its original prediction and hypothesis IDs are retained.', 1000),
              hypothesisIds: strings('H-nnn this sample tests. Required unless backfill.', 10),
              sourceIds: strings('S-nnn the material came from.', 10),
              executionResources:{type:'array',maxItems:20,description:'Agent-reported actual resource use for attribution, not a planned dependency. This alone never independently verifies a tool call or consumer-model effect.',items:{
                type:'object',properties:{
                  kind:{type:'string',enum:['consumer_model','tool','skill']},
                  id:string('Canonical consumer model, tool or Skill ID.',100),
                  version:string('Exact model or Skill version used; optional for tools.',80),
                  receiptRef:string('Concrete invocation/result reference: record ID, URL or call receipt.',600),
                  purpose:string('How this resource influenced the actual sample.',500),
                },required:['kind','id','receiptRef','purpose'],additionalProperties:false,
              }},
              evaluationPhase:{type:'string',enum:['exploration','validation'],description:'Optional experiment phase fixed before user sees the trial; old ratings remain legacy_unclassified.'},
              segmentKey:string('Condition or subhypothesis segment, assigned BEFORE human evaluation; historical trials without this field are not retrospectively relabeled.',120),
              materialKey:string('Optional source identity for de-duplication and matched comparisons; not proof of randomization.',120),
              comparisonKey:string('Validation comparison ID; paired treatment/control samples must use the same ID and materialKey.',120),
              experimentArm:{type:'string',enum:['treatment','control'],description:'Validation arm fixed before user rating; the control sample may lack the target hypothesis.'},
              plannedFactors:{type:'object',maxProperties:8,description:'Optional stable snake_case keys with string values fixed before feedback (no post-hoc segmentation).',additionalProperties:{type:'string',maxLength:100}},

              predictedPass: { type: 'number', minimum: 0, maximum: 1, description: 'Chance the user passes it, stated before showing. Required unless backfill.' },
              predictionNote: string('Why that chance. Older MCP clients use learning:v1:<compact JSON> for the general learning review, or screen:v1:<compact JSON> for the Buzz-specific screen. Each is limited to 600 characters.', 600),
              negativeReview: {
                type: 'object', description: 'All dojos: declared failure hypotheses are checked BEFORE user-facing trial submission. Required if the run has negativeTargets; unresolved risks must be screenedOut instead.',
                properties: { checks: { type:'array', minItems:1, maxItems:8, items: { type:'object', properties: {
                  hypothesisId: string('Declared negative H-nnn.',20),
                  rejectedCaseId: string('Actual earlier human fail/partial in this dojo.',20),
                  acceptedCaseId: string('Actual earlier human pass in this dojo, used as a counterexample.',20),
                  acceptedAnchor: string('Exact 8+ characters from the accepted case text or label.',160),
                  rejectedAnchor: string('Exact 8+ characters from the rejected case text or label.',160),
                  bodyAnchor: string('Exact 8+ characters from candidate body/label.',160),
                  observedRisk: string('Strongest failure mechanism that could apply to this candidate.',700),
                  counterEvidence: string('Why the candidate is not explained by this failure mechanism, citing visible evidence.',700),
                  decision: { type:'string', enum:['cleared'], description:'Only cleared hypotheses may be submitted; unresolved means screen out internally.' },
                }, required:['hypothesisId','rejectedCaseId','acceptedCaseId','acceptedAnchor','rejectedAnchor','bodyAnchor','observedRisk','counterEvidence','decision'], additionalProperties:false } } },
                required:['checks'], additionalProperties:false,
              },
              learningAudit: {
                type: 'object',
                description: 'All dojos: mandatory with 3+ rated samples including a human pass and fail. The server validates real rated case IDs and exact quotes from each, NOT whether the agent correctly infers the mechanism. Buzz screen:v1 alone is never an acceptable substitute.',
                properties: {
                  positiveCaseId: string('Actual prior user-accepted T-nnn or human-confirmed haul ID from this dojo.', 160),
                  negativeCaseId: string('Actual prior user-rejected T-nnn or human-declined haul ID from this dojo.', 160),
                  positiveAnchor: string('Exact 8+ character quote from positiveCaseId body or label.', 160),
                  negativeAnchor: string('Exact 8+ character quote from negativeCaseId body or label.', 160),
                  mechanism: string('Specific feature of the positive case that made it a plausible success, NOT a generic label or proven causal claim.', 700),
                  transferCondition: string('Concrete observable condition under which that feature also exists in the proposed candidate.', 700),
                  failureContrast: string('Why the candidate avoids the negative case mechanism, with an observable difference.', 700),
                  fatalRisk: string('Strongest reason a skeptical reader/user would reject this candidate.', 700),
                  riskResolution: string('Observed reason that the fatal risk is not present, or why the candidate has been rejected internally.', 700),
                  bodyAnchor: string('Exact text span (8+ characters) of the candidate/label to which the comparison applies.', 160),
                  decision: { type: 'string', enum: ['submit', 'reject'], description: 'Rejects may remain internal; only submit can be registered as a user-facing trial.' },
                },
                required: ['positiveCaseId', 'negativeCaseId', 'positiveAnchor', 'negativeAnchor', 'mechanism', 'transferCondition', 'failureContrast', 'fatalRisk', 'riskResolution', 'bodyAnchor', 'decision'],
                additionalProperties: false,
              },
              editorialScreen: {
                type: 'object',
                description: 'Buzz dojo ONLY. Enforced pre-submission screening; agent assertion is not a human rating. For old clients, encode this object as screen:v1:<JSON> in predictionNote.',
                properties: {
                  format: { type: 'string', enum: ['standalone'] },
                  pool: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'object', properties: {
                    title: string('Candidate premise (short, distinct).', 100),
                    sourceId: string('Observed source S-nnn from this dojo.', 20),
                    hypothesisId: string('Hypothesis H-nnn for this candidate. Mandatory in prolonged Buzz recovery, with >=2 distinct conceptual arms in the pool.',20),
                    decision: { type: 'string', enum: ['selected', 'rejected'] },
                    reason: string('Specific reason selected or rejected; not a numeric self-score.', 350),
                  }, required: ['title', 'sourceId', 'decision', 'reason'], additionalProperties: false } },
                  positiveCaseId: string('Actual previously user-accepted text T-nnn.', 20),
                  negativeCaseIds: strings('2+ actual previously user-rejected texts T-nnn.', 5),
                  readerQuote: string('Exact 8+ character phrase present in the submitted text.', 120),
                  distinctValue: string('New reader payoff beyond source recap; 12+ characters.', 300),
                  strongestObjection: string('Strongest hostile reading from a skeptical reader; 12+ characters.', 300),
                  closingType: { type: 'string', enum: ['derived_consequence', 'author_added'], description: 'How the post closes, classified before the user sees it: derived_consequence = follows directly from the material; author_added = an analogy, counterfactual, title or other device the author added.' },
                },
                required: ['format', 'pool', 'positiveCaseId', 'negativeCaseIds', 'readerQuote', 'distinctValue', 'strongestObjection', 'closingType'],
                additionalProperties: false,
              },
            },
            required: ['label'], additionalProperties: false,
          },
        },
        actor,
      },
      required: ['baseId', 'trials'], additionalProperties: false,
    },
  },
  {
    name: 'exploration_skill_improvement_seed',
    description: 'One-time idempotent bootstrap of specialist Skill review work orders from original human-rated trials. Reads existing H/T without rewriting verdicts or approving any Skill. Can be used for older dojos whose ratings predate the durable inbox.',
    inputSchema:{type:'object',properties:{
      baseId,actor,confirm:{type:'boolean',enum:[true]},
    },required:['baseId','confirm'],additionalProperties:false},
  },
  {
    name: 'exploration_skill_improvement_review',
    description: 'Record an agent evidence-based triage of an outstanding specialist Skill feedback work order. Compare actual user-rated cases and at least two plausible explanations, plan a discriminating test, and when appropriate propose a candidate rule. This does not edit/release Skills or invent user ratings. The target Skill requires its own dojo-approved release.',
    inputSchema:{type:'object',properties:{
      baseId,actor,review:{type:'object',properties:{
        targetSkillId:string('Destination specialist Chat Skill ID.',90),
        moduleId:string('Affected module ID (source/selection/transform/voice/gate/audience).',25),
        trialIds:{type:'array',items:{type:'string',maxLength:20},minItems:1,maxItems:50,uniqueItems:true},
        action:{type:'string',enum:['compare_more','rule_candidate','not_a_skill_defect']},
        rationale:string('Evidence-based reason with exact observed case distinctions; distinguish human words from agent inference.',1800),
        competingExplanations:string('At least two plausible causes and why current examples do not resolve them.',1800),
        nextDiscriminatingExperiment:string('Concrete treatment/control, variables held constant, forecast and refuting observation.',1600),
        candidateRule:string('Specific falsifiable replacement/addition to the target Skill (proposal only).',1200),
      },required:['targetSkillId','moduleId','trialIds','action','rationale','competingExplanations','nextDiscriminatingExperiment'],additionalProperties:false},
    },required:['baseId','review'],additionalProperties:false},
  },
  {
    name: 'exploration_trial_rate',
    description: 'Record what the user said about trials. verdict: pass (the user accepted it), partial (close, e.g. "60点" / "惜しい"), fail, or withdrawn (never shown or no longer relevant; needs reason). userWords must quote the user: a self-score is not a rating. The rating is added to the pass rate of the version that produced the sample and to each hypothesis the trial tested (a pass as evidence, a non-pass as a counterexample). failStage is where the pipeline lost it (source, selection, transform, voice, gate); mark it unknown unless the user said why. Returns the updated loop with nextActions.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId,
        ratings: {
          type: 'array', minItems: 1, maxItems: 30,
          items: {
            type: 'object',
            properties: {
              id: string('T-nnn.', 20),
              verdict: { type: 'string', enum: ['pass', 'partial', 'fail', 'withdrawn'] },
              userWords: string('What the user said, quoted. Required unless withdrawn.', 1500),
              failStage: { type: 'string', enum: ['source', 'selection', 'transform', 'voice', 'gate', 'unknown'] },
              failStageNote: string('Why that stage (agent guess unless the user said it).', 600),
              reason: string('Why withdrawn.', 600),
            },
            required: ['id', 'verdict'], additionalProperties: false,
          },
        },
        actor,
      },
      required: ['baseId', 'ratings'], additionalProperties: false,
    },
  },
];

module.exports = { TOOLS: tools, outcomeSchema: outcome };
