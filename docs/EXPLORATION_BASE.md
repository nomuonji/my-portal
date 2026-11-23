# Exploration Base

An Exploration Base holds the fixed points an agent carries while exploring territory where the right method is not yet known. There is one base per exploration. It exists because fast-moving exploration state had nowhere to live and leaked into Intelligence Pack versions and Context logs.

## Boundary with Intelligence Packs

Ask one question: "Does this still hold when the method version changes, or when it is taken to another exploration?"

- Yes → Intelligence Pack. How evidence is read, which inferences are forbidden, known failure modes. Slow, immutable versions.
- No → Exploration Base. Steps, thresholds, scoring rules, hypotheses, constraints, progress.

A hypothesis or rule moves from a base into a Pack only after it has held across several explorations or method versions, and only as a deliberate Pack revision.

## Fixed points

| Fixed point | Owner | Content |
|---|---|---|
| Outcome contract | user | Statement, unit, acceptance checks (a count target is optional and unused by 道場), final indicator, proxies (explicitly not success), deadline, run budget, stop conditions |
| Method | agent | Where the body lives (repo, document, or inline), active version label, change history with motivating runs and benchmark result |
| Hypothesis ledger | agent | `conjecture → observed → reproduced → yielded_candidate → yielded_outcome`; only the last two are win patterns. Rejected hypotheses stay with their reason |
| Constraints | per item | `user` (agent may only propose), `environment` (measured property of tools/world, needs a basis), `agent` (provisional threshold, revisable with a reason) |
| Loop | server | Trials (samples shown to the user) with the hypotheses they test, the predicted chance of passing and the user's rating; pass rate by released version; how often the prediction matched |
| Position | server | Run log: declared predictions, verdicts, which fixed points moved, stalled-run counter |

## Rules the server enforces

- Creating a base, changing the outcome, confirming achievements, and touching user-owned constraints require `userAuthorized=true` with `authorizationNote`. An outcome passed without it is stored as a pending proposal.
- Item IDs (`H-nnn`, `K-nnn`, `R-nnn`, `A-nnn`) are assigned by the base and never reused. Earlier labels go in `legacyIds`.
- A hypothesis stage needs the evidence it claims: one entry for `observed`, two for `reproduced`, a `candidate` entry for `yielded_candidate`, an `outcome` entry plus a confirmed achievement on the base for `yielded_outcome`. Advancing needs new evidence in the same call; demoting, rejecting and reopening need a reason.
- A run declares its target hypotheses with predictions before measuring (or an unknown-territory probe). Only one run is open per base.
- The method version cannot change while a run is open. After the first version, a new one needs finished motivating runs and `benchmark.passed=true` (or a stated reason why no benchmark exists). Version labels are never reused.
- Finishing a run needs a verdict for every declared hypothesis. A run that moved no fixed point must say why and increments `stalledRuns`; three in a row raise a warning in the brief.
- When the outcome is `confirmedBy: user`, achievements stay candidates until the user confirms them.

## The improvement loop

A 道場 is measured by one number: the pass rate of what its released version produces, compared across versions. There is no count target to reach.

1. `exploration_trial_record` before a sample is shown. It names the open hypotheses the sample tests and `predictedPass` (0–1). A sample tied to no hypothesis is refused.
2. `exploration_trial_rate` when the user reacts, quoting their words (`pass`, `partial`, `fail`). The rating is counted on the version that produced the sample and written to each tested hypothesis: a pass as evidence, a non-pass as a counterexample. Evaluations of submarine haul are counted in the same pass rate.
3. `exploration_base_get` returns `loop`: pass rate by version, trials waiting for the user, prediction hit rate, the score of each hypothesis, where non-passes were lost, and `nextActions`.

Pacing the server enforces (thresholds are in `functions/explorationLoop.js` and are provisional):

- At most 6 trials wait unrated; more are refused until those are rated or withdrawn.
- After 3 consecutive non-passes, new trials are refused until a run finishes after the last rating: the run is closed with verdicts and the hypotheses are re-derived from sourcing and selection, not wording.
- A hypothesis tested by a rated trial in a run cannot be closed as `inconclusive`.
- When a base records trials, the released version needs 3 rated trials before a new version replaces it, unless the user directed the change. The replaced version's pass rate is stored in the method history.

## Measurement-confirmed dojos (no human pass/fail)

When `outcome.confirmedBy === 'measurement'`, the evidence source is the measured external result, **not** the user's subjective pass rate. These dojos still register forecasts before inspecting outcomes, keep counterexamples and missingness, and never treat an agent's self-grade as a measurement.

- Old, withdrawn editorial trials remain in the audit log; they do not create a requirement to collect new human ratings.
- Releasing a revised Skill/Pack without an explicit user-directed change requires **at least two distinct finished runs with recorded evidence movement** and a `benchmark.passed=true` containing an actual reference and case description. The run log alone does not prove causal independence, so the agent must inspect provenance and controls.
- User-confirmed dojos keep the existing `minRatedPerVersion`, failure-analysis and other rating gates unchanged. Changing a dojo's outcome contract still needs the user's explicit authorization.
- A case-classification benchmark is not a Google indexing-forecast benchmark. Report the distinction; prospective accuracy requires later labels from unexposed URLs.

## Hypothesis Refinement Loop (shared by every dojo)

The server now returns `loop.refinement` alongside the existing per-version pass rate.
It is **advisory**, never a user evaluation or automatic method promotion.

1. **Prediction calibration:** Rated, precommitted forecasts are compared with user pass/fail
   (`partial` counts as non-pass). Read `calibration.meanBias` (positive = overconfident),
   `brier` and `baselineBrier` (smaller is better), and the conservatively shrunk
   `suggestedAdjustment` (available after five rated forecasts). The original
   `predictedPass` and each user rating stay unchanged; the adjustment is not a way
   to evade a domain-specific submission threshold. Small samples have high uncertainty.
2. **Competing hypotheses:** Open hypotheses are ranked for further investigation
   using sparse-data-smoothed pass estimates and uncertainty. The rank is **not**
   a claim that the first hypothesis is the best idea. `loop.refinement.contrast`
   gives two proposed explanations and flags shared rated trials or unclassified
   pipeline stages as `confounded`. A shared trial is *not* independent evidence
   for two causes.
3. **Experimental design:** Tag a hypothesis using `exploration_item_upsert`
   `pipelineStage: source|selection|transform|voice|gate|audience|unknown`.
   For a discriminating trial, `exploration_run_start.experimentDesign` supplies:
   `contrastedHypothesisIds`, `changedStage`, `intervention`,
   `comparison`, `controls`, `expectedDifference`, and `refutingObservation`.
   The backend checks those fields, the existence of distinct open alternatives,
   and preserves the design in the run **before results**. Legacy runs, exploratory
   probes and existing schedules may omit the design; they are not retroactively
   claimed to be controlled experiments.
4. **Revision lineage:** Meaningful edits to a hypothesis's title, claim, mechanism,
   limits, pipeline stage, evidence maturity, or status append a bounded
   `revisionHistory` snapshot (previous/next fields, reason and run ID).
   Appending evidence or a user's rating alone does not rewrite the claim.
5. **Next step:** After each user evaluation, inspect calibration *and* actual
   positive/negative examples, compare at least two causal alternatives, and
   precommit which observation would refute the favorite explanation. Do not
   simply negate a failed wording pattern. Evaluate changes with subsequent
   user-rated cases, preserving the same outcome contract and quality gates.

### Hypothesis formation gate (all Skill/Pack dojos; new H only)

An observed case or untested idea is **not** a reusable production hypothesis. The existing `source` ledger now distinguishes `sourceRole=source|observation|idea` under the original S-nnn IDs. A field observation or idea goes into S-nnn first; do not mint an H-nnn for each topic, punchline or reformulation. Only evidence-bearing sources, not `sourceRole=idea`, can justify formation.

For **new** H-nnn in Skill/Pack dojos (chat_skill, skill_pack, intelligence_pack), the server now requires the existing six-field `researchProtocol`, an explicit non-`unknown` `pipelineStage`, at least one `targetModuleIds` entry, and **`formationReview`**:

- `caseRefs`: at least two distinct, server-resolved S-nnn/T-nnn examples. S must explicitly have `sourceRole=observation` **and** original proof or recorded observations (not a mere collection feed or idea); T must have a real pass/partial/fail verdict. Bare names or invented sample IDs are rejected. This is provenance verification, not independent factual attestation.
- `changedOperation`: one operational change to sourcing, selection, transformation, voice, gating or audience judgment — not a phenomenon title.
- `rivalExplanation`: another plausible cause, including confounds.
- `transferTest`: a contrast test on a **different** material, with a falsifying result.
- `priorArtDecision`: why to create a genuinely new mechanism rather than record the single anecdote/idea or refine an earlier H. Cite relevant historical H when applicable.

The server validates fields, existing case IDs and recorded verdicts. It cannot determine semantic novelty or causal proof: the agent must compare actual originals, user feedback and similar H first. Repeat the same subject with different names is not an independent replication. New H remain conjectures until verified. **Legacy H/T/S, current method release pointers, manual acceptance, publication permissions and existing runtime gates remain unchanged.** The gate is applied at creation, so an ordinary revision to a legacy hypothesis does not require backfilling it.

This is shared infrastructure for buzz posts, keyword discovery, SEO, video ideas,
Discover, and other Exploration Bases. Topic-specific evidence checks and acceptance
requirements stay in their respective operators and skills. A server-suggested
ranking is not proof of causality and does not launch autonomous experiments.

## What stays elsewhere

Measured data (keyword demand, SERPs, job listings) stays in its operator. The base records where it is in `canonicalData` and refers to records by ID. A method body kept in a repository stays there with its code and tests; the base holds the pointer.

## Shared learning transfer (all dojos)

The default loop is **evidence → candidate mechanism → applicability check → submission → human verdict / measured outcome**. A renamed hypothesis or more checklist items do not imply learning. The learning data in exploration_base_get(view=brief|state|full).loop.learning is a casebook shared by every dojo:

- acceptedCases and rejectedCases are actual rated trial texts or explicitly decided submarine haul, with IDs, origins, and tested hypotheses. Source success is not creator success.
- promisingHypotheses reports only cases with at least three ratings and a smoothed rate (not proof of causality). no_accepted_example and no_rejected_example mean the system lacks a usable human contrast; use independent source or controlled research instead of fabricating one.
- auditCoverage distinguishes genuinely reviewed trial comparisons from Buzz legacy screening. measuredWins is separate for measurement-confirmed dojos. These are not new success metrics.
- The loop's nextActions requires comparing successful and failed cases before selecting another sample. A positive hypothesis with three or more actual human-rated outcomes and no passes is now blocked at trial recording, not merely mentioned in nextActions. Create a substantially different mechanism under a new hypothesis ID rather than recycling the losing ID.

**Mandatory full historical research and feedback review (shared dojo harness).** The earlier six-case teaching excerpt and two-hypothesis recall were insufficient for hypothesis-driven improvement. Whenever there is earlier human feedback, the run must complete the following **before any new trial is registered**:

1. `exploration_research_read(baseId, runId, page=0)`, followed by exactly the advertised `nextPage` until `ready_to_synthesize`. All registered hypotheses are included, even retired, rejected, negative and never-tested hypotheses. Each page contains original claims, proposed mechanisms, limits, evidence, counterexamples, revision history and user-rating statistics; every past trial/haul verdict and `userWords` is included separately, including critical feedback and partial acceptances. This is an exhaustive paginated inventory, not the favored two hypotheses or latest six examples. A stable history digest blocks stale partial scans.
2. `exploration_research_synthesize` with a real prior thesis, a genuine competing/complementary hypothesis **when one exists**, quotations from their actual claims and the user's original acceptance/rejection words, concrete conditions, a revision or synthesis proposal, and a refuting observation. Do not manufacture an antithesis if none can be established: use `relationship=unresolved` with the uncertainty made explicit. A `revise`, `synthesize`, or `retire` action is only a proposal until `exploration_item_upsert` actually changes the thesis, derives a new hypothesis, or retires the old one. The server now links such ledger updates to their antecedent hypotheses and feedback evidence (`researchLineage`) and rejects a new user-facing trial if a declared revision/derivation/retirement was never applied; `synthesize` trials must test the new derived hypothesis. `retain` leaves a theory available for further discriminating tests rather than proliferating new IDs. All claims remain AI hypotheses until later user evaluations.
3. The previously introduced `exploration_recall_prepare` / `exploration_recall_check` (for 4+ real pass and 4+ real fail) and any `learningAudit`, `negativeReview`, Buzz screening, or research failure gate remain **additional** requirements. Only real subsequent user ratings determine whether the synthesis improves the method.

The backend checks page completeness and order, snapshot consistency, IDs and literal claim citations before allowing the next trial. It **cannot verify that an LLM truly understands all the historical prose**, that two verbal hypotheses are genuinely opposites, or that a new proposal is right. Automated creative self-scores cannot substitute for later external feedback. Dojos without past feedback have no inventory preflight requirement for their first trial; measurement-confirmed operations retain their own measurement-based contract. Old MCP clients must refresh to expose the two research tools; they cannot bypass the gate via the previous `learningAudit` fields.

**Pre-generation historical recall checkpoint (new).** In addition to historical sample text, the prepare response now returns up to two **historically tested hypotheses** relevant to the current run. Each record includes its actual statement, proposed mechanism, limits, supporting evidence, counterexamples, earlier revisions, recorded run verdicts, and real linked pass/fail cases. The check cannot pass unless the agent explicitly reviews every returned hypothesis: exact claim/limit quotes, an actual linked pass and fail, and separate transfer/falsification conditions. Merely citing hypothesis IDs or a positive example does not count. The review only guarantees the evidence was referenced; it does not independently validate the mechanism.

**Pre-generation historical recall checkpoint (new).** A user-reviewed dojo with at least four actual past passes and four actual past fails must complete a server-scored recall check **once per open run**, before recording new trials:

1. Start the run; call `exploration_recall_prepare` with an actual research premise (`topic`) and, where relevant, `hypothesisIds`. The server ranks **all** rated texts by shared hypotheses and topic overlap, rather than using only the six representative cases from `loop.learning`. It returns two labeled passes and two labeled fails to study, plus four different historical samples with their verdicts omitted.
2. Compare the real texts and their differences; call `exploration_recall_check` **once**, predicting pass/fail for all four challenge cases with literal quotes and observable reasons. The server checks the original human verdicts and requires at least **3 of 4** correct. A failed or skipped check blocks `exploration_trial_record` for that run. Start a new research run after investigating the mismatch; repeated guessing in the same run is refused.
3. For a passing run, the ordinary `learningAudit`, Buzz `editorialScreen`, and any `negativeReview` are **still mandatory** per their existing conditions. New trial records preserve the recall score and the studied/challenged IDs. **Only later user feedback counts toward the actual success rate.**

This is a modest historical-label consistency check, not a truly blind benchmark: other history APIs may reveal the same verdicts. The server verifies ID, text, history order and answer correctness, **not** the causal truth of the agent's explanation or the quality of its next creation. The challenge is a safeguard against unexamined transfer, not proof of taste. If there are fewer than four passes or four fails, the new check is not imposed; existing safeguards remain. Measurement-confirmed dojos and trusted historical imports are unaffected. New MCP fields/tools require the connector schema to refresh.

**Pre-submission transfer review.** A new user-facing trial in any trial-based base with at least three prior rated outcomes and both an actual acceptance and rejection must include learningAudit (or legacy learning:v1: JSON in predictionNote, maximum 600 characters) before exploration_trial_record succeeds:

~~~json
{
  "positiveCaseId": "T-001",
  "negativeCaseId": "T-002",
  "positiveAnchor": "Exact passage from the accepted case",
  "negativeAnchor": "Exact passage from the rejected case",
  "mechanism": "Specific feature that might explain success; a falsifiable hypothesis, not a label",
  "transferCondition": "Observable facts that make the feature applicable to this candidate",
  "failureContrast": "Concrete difference from the failed case",
  "fatalRisk": "Strongest reason this candidate may be rejected",
  "riskResolution": "Observed evidence resolving that risk",
  "bodyAnchor": "An exact 8+ character passage in the sample or its label",
  "decision": "submit"
}
~~~

Case IDs are validated against **real past verdicts of the same dojo**. Positive/negative text anchors must match the immutable historical trial bodies (or labels), and the new candidate's bodyAnchor must match its actual text. Unmatched quotes, missing reviews and decision=reject are refused. The server checks these **mechanically verifiable facts only**—not humor, market success or the validity of the agent's inferred mechanism. A fabricated but plausible-looking riskResolution is still unverified, not evidence of a human PASS. When evidence is insufficient, the trial may be exploratory; it is not silently treated as transfer of a proven pattern.

**Legacy compatibility:** Buzz screen:v1: still parses as an editorial screening packet, but **cannot authorize learning transfer or negative-hypothesis clearance**. To submit, use native editorialScreen (including closingType) together with native learningAudit, or native editorialScreen plus learning:v1: in predictionNote with the two historical text anchors. **Some older MCP schemas omit editorialScreen.closingType** and cannot carry both records; those clients cannot submit Buzz trials until the connector's tool schema is refreshed. The server intentionally fails closed instead of silently assuming a closing type. Trusted offline backfills and measurement-confirmed bases are unaffected by ordinary trial-gate requirements. Historical backfill is **disabled in the runtime/MCP store** and only enabled by constructing an explicitly trusted migration store; agents cannot import arbitrary PASS verdicts or choose historical skill versions through the public trial tool. Submarine haul decisions update the same casebook.

The contract is shared by all domains (social, SEO, keywords, video, products, monetization, work, Discover), but **what constitutes an accepted outcome** remains domain-specific and user-owned. Nothing authorizes changing the mission, relaxing constraints, scheduling jobs, publishing, or creating new versions without the existing release gates.

## MCP operations

`exploration_base_list`, `exploration_base_get`, `exploration_base_create`, `exploration_outcome_set`, `exploration_method_version_set`, `exploration_item_upsert`, `exploration_run_start`, `exploration_run_finish`, `exploration_research_read`, `exploration_research_synthesize`, `exploration_recall_prepare`, `exploration_recall_check`, `exploration_trial_record`, `exploration_trial_rate`.

`exploration_base_get` with `view=brief` is the single call that starts a run. Packs may reference a base as a dependency with `resourceType: exploration_base`; `cognitive_bundle_resolve` loads the brief when the caller selects it. `world_map_get` lists the bases.

## Storage

Collections `explorationBases`, `explorationBaseItems`, `explorationBaseRuns`, `explorationBaseEvents`, `explorationBaseTrials` in the Agent Ideas document database. Events are append-only.

## Parallel negative hypotheses — shared by every dojo

A dojo must study **what makes a candidate fail**, not only which mechanism predicts success. These are distinct, falsifiable hypotheses in the same canonical Exploration Base, not a second dojo, skill or recurring job.

- Register ordinary success hypotheses with `exploration_item_upsert(kind="hypothesis", polarity="positive")` (also the legacy default). Register potential failure modes with `polarity="negative"`, an observable trigger, a competing positive case and a falsifier. The same H-nnn identity/evidence/revision-history lifecycle applies. A negative hypothesis is **not** a human rejection verdict.
- In `exploration_run_start`, specify `targets` (positive) and preferably `negativeTargets` (failure modes) with independent predictions. If an ordinary positive run omits negative targets but the dojo has registered open failure hypotheses, the shared server **automatically precommits one** (same pipeline stage if possible, otherwise a deterministic rotation). Explicit negative targets or an explicitly contrasted negative hypothesis override automatic selection. Pure unknown-territory research probes without positive targets do not auto-enroll.
- Before `exploration_trial_record`, use `negativeReview.checks` for **each declared negative target**: `hypothesisId`, one real `rejectedCaseId`, one real accepted `acceptedCaseId`, exact `acceptedAnchor`/`rejectedAnchor` quotes from those human-rated examples, an exact candidate `bodyAnchor`, `observedRisk` and `counterEvidence`. Only a justified `decision="cleared"` may be shown to the human; unresolved candidates are **not** registered as user trials.
- At `exploration_run_finish`, use `screenedOut` to record such withheld candidates against their failure hypothesis and `negativeVerdicts` to record the research outcome, including `inconclusive` when not tested independently. Internal rejections are **unverified** and must never be counted as user failures, passes, market outcomes or evidence that a negative gate actually works.
- Once the user rates a cleared trial, `loop.negativeLearning` reports `clearedAndPassed`, `clearedButRejected` (missed failure risks), `screenedOutUnverified`, review coverage and per-hypothesis misses; the familiar `loop.current.passRate` still counts **only actual human ratings**. The positive hypothesis scoreboard and calibration exclude negative hypotheses so they are not mislabeled as win patterns.
- Older recorded runs remain readable. Runs with no `negativeTargets` have no verified negative preflight and are called out in the loop when a dojo has both passed and rejected cases. This compatibility does **not** imply a negative test occurred. For new work, test positive and negative hypotheses concurrently; inspect false-clearance misses before repeating the same source, selection or transformation.

This is a common server-side protocol, not a universal list of bad styles: different dojos must derive failure mechanisms from their own authentic rejected and accepted cases. For example, SNS may test predictable endings, SEO may test non-indexable source demand, video may test a weak retention hook, and monetization may test a missing distribution-to-purchase link. User verdicts and original acceptance gates remain unchanged.

### Compatibility for existing ChatGPT MCP connections (schema pinned before release)

Existing `exploration_item_upsert` schemas cannot send `polarity`. To classify a hypothesis **without changing its title or overwriting legacy IDs**, use the existing `reason` field on an upsert: `"[polarity:negative] <why this hypothesis predicts failure>"`. The server persists `polarity=negative` and records a revision. This explicit directive may also be used on creation; omitting it preserves the legacy positive default. Do not silently classify by words such as “bad” or “failure” in a title.

Existing `exploration_run_start` clients can precommit a **single negative comparison** with `experimentDesign.contrastedHypothesisIds` referring to an open negative hypothesis (alongside an ordinary positive `targets`). The server copies the negative hypothesis' stored statement into the run's `negativeTargets` *before* output generation. If the client omits this field entirely, the server automatically selects one failure hypothesis for positive-target runs. Non-negative contrasts retain existing behavior. Multiple negative contrasts require native review fields.

Where a dojo already has real accepted/rejected user examples, a fully validated `learning:v1:` audit with exact accepted/rejected quotes may be mapped to **one** negative preflight, flagged `preflight_legacy_derived_unverified`, not as independent approval. A Buzz `screen:v1:` packet by itself **never** clears that risk. Native `negativeReview` remains preferred; a screened-out candidate should never be submitted merely to satisfy the schema.

When rating cases are insufficient for a comparison (particularly measurement-led or zero-pass dojos), `negativeReview.status=insufficient_human_contrast` is recorded without fake comparators or claiming gate coverage. Research can continue, but such samples are not counted among successful preflight reviews.

At finish, older MCP clients can put the negative hypothesis verdict in the existing `verdicts` array in addition to normal positive-target verdicts. The server persists those as `negativeVerdicts`; an **explicitly selected** negative arm still requires a verdict. If the arm was automatically enrolled and no verdict was provided, it is closed as `inconclusive` (never auto-supported). The new `screenedOut` structured field requires an updated connector schema; do not invent screening counts on older clients. Reconnecting the connector eventually enables the native fields.
