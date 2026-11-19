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
    pipelineStage: { type: 'string', enum: ['source', 'selection', 'transform', 'voice', 'gate', 'audience', 'unknown'], description: 'Hypothesis only: which part of the full sourcing-to-evaluation pipeline is under test. Not the evidence maturity stage.' },
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
    description: 'Read an Exploration Base before each run. loop.refinement provides calibrated forecast error, smoothed hypothesis estimates, uncertainty and a competing-hypothesis contrast; advisory, not proof. Read nextActions and design a discriminating test before generating outputs. view=state refreshes the loop, gates, pending evaluations and pinned method pointer without reloading its body or ledgers; use brief for the initial load or after a method/contract change. view=full adds item details, immutable revision history, runs and events.',
    inputSchema: {
      type: 'object',
      properties: { id: baseId, view: { type: 'string', enum: ['state', 'brief', 'full'] }, eventLimit: { type: 'integer', minimum: 1, maximum: 300 } },
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
    description: 'Release a new version of what this base trains: point at a Chat Skill or Intelligence Pack version in the DB (bodyRef.kind chat_skill / intelligence_pack, location = id, versionNumber), or an inline/pointer body for older bases. Refused while a run is open. After the first version it requires motivatingRunIds (finished runs that justify it) — or userAuthorized with authorizationNote when the user decided the change — and benchmark.passed=true, or noBenchmarkReason. When the base records trials, the released version also needs loop.gates.minRatedPerVersion rated trials first (so the two versions can be compared by pass rate) unless the user directed the change. Prefer an inline body (bodyRef.kind=inline): the base then holds the method text itself. Version labels are never reused. One insight from one run is a ledger entry, not a method version.',
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
    description: 'Open an exploration run. Read loop.refinement first, declare the tested hypothesis and forecast before observing outcomes. When testing a known competing explanation, supply experimentDesign with a distinct alternative and controlled difference; legacy exploratory probes may omit it. Pins method version. Prefer responseMode=compact after loading the base; returns run ID and pinned versions without a redundant full brief.',
    inputSchema: {
      type: 'object',
      properties: {
        baseId, objective: string('What this run is for.', 800),
        targets: {
          type: 'array', maxItems: 12,
          items: { type: 'object', properties: { hypothesisId: string('H-nnn.', 20), prediction: string('Expected measurement, stated before measuring.', 800) }, required: ['hypothesisId', 'prediction'], additionalProperties: false },
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
    name: 'exploration_trial_record',
    description: 'Record user-facing trials before presenting. Buzz-post dojo adds an enforced early rejection screen: 3+ candidate pool, 2+ rejected, 2+ observed sourcing lanes, accepted/rejected human-rated precedent, exact passage from the proposed copy, concrete hostile objection, and a pre-registered closingType (derived_consequence = the last beat follows directly from the material; author_added = the author added an analogy, counterfactual, title or similar). predictedPass is an honest forecast and no longer gates submission. Native quote practice is retired. Use editorialScreen or, from clients with the older MCP schema, screen:v1:<compact JSON> inside predictionNote (up to 600 characters). Other dojos are unchanged. A screen is an AI-only gate, NOT independent approval or a promise of engagement.',
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
              hypothesisIds: strings('H-nnn this sample tests. Required unless backfill.', 10),
              sourceIds: strings('S-nnn the material came from.', 10),
              predictedPass: { type: 'number', minimum: 0, maximum: 1, description: 'Chance the user passes it, stated before showing. Required unless backfill.' },
              predictionNote: string('Why that chance. For the viral-post-method-discovery dojo, an older MCP client MUST use screen:v1:<compact JSON> with the same structure as editorialScreen and <=600 characters.', 600),
              editorialScreen: {
                type: 'object',
                description: 'Buzz dojo ONLY. Enforced pre-submission screening; agent assertion is not a human rating. For old clients, encode this object as screen:v1:<JSON> in predictionNote.',
                properties: {
                  format: { type: 'string', enum: ['standalone'] },
                  pool: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'object', properties: {
                    title: string('Candidate premise (short, distinct).', 100),
                    sourceId: string('Observed source S-nnn from this dojo.', 20),
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
              version: { type: ['integer', 'null'], description: 'backfill only: skill/pack version that produced it.' },
              methodVersion: string('backfill only: method version label at the time.', 60),
              runId: string('backfill only: the run it was shown in.', 20),
              shownAt: string('backfill only: ISO time it was shown.', 40),
              rating: {
                type: 'object', description: 'backfill only: the rating the user gave at the time.',
                properties: {
                  verdict: { type: 'string', enum: ['pass', 'partial', 'fail', 'withdrawn'] },
                  userWords: string('What the user said, quoted.', 1500),
                  failStage: { type: 'string', enum: ['source', 'selection', 'transform', 'voice', 'gate', 'unknown'] },
                  failStageNote: string('Why that stage (agent guess unless the user said it).', 600),
                  reason: string('Why withdrawn.', 600),
                  ratedAt: string('ISO time of the rating.', 40),
                },
                required: ['verdict'], additionalProperties: false,
              },
            },
            required: ['label'], additionalProperties: false,
          },
        },
        backfill: { type: 'boolean', description: 'Import past samples as they were. Skips the hypothesis, prediction and pacing checks.' },
        actor,
      },
      required: ['baseId', 'trials'], additionalProperties: false,
    },
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
