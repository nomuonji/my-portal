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

This is shared infrastructure for buzz posts, keyword discovery, SEO, video ideas,
Discover, and other Exploration Bases. Topic-specific evidence checks and acceptance
requirements stay in their respective operators and skills. A server-suggested
ranking is not proof of causality and does not launch autonomous experiments.

## What stays elsewhere

Measured data (keyword demand, SERPs, job listings) stays in its operator. The base records where it is in `canonicalData` and refers to records by ID. A method body kept in a repository stays there with its code and tests; the base holds the pointer.

## MCP operations

`exploration_base_list`, `exploration_base_get`, `exploration_base_create`, `exploration_outcome_set`, `exploration_method_version_set`, `exploration_item_upsert`, `exploration_run_start`, `exploration_run_finish`, `exploration_trial_record`, `exploration_trial_rate`.

`exploration_base_get` with `view=brief` is the single call that starts a run. Packs may reference a base as a dependency with `resourceType: exploration_base`; `cognitive_bundle_resolve` loads the brief when the caller selects it. `world_map_get` lists the bases.

## Storage

Collections `explorationBases`, `explorationBaseItems`, `explorationBaseRuns`, `explorationBaseEvents`, `explorationBaseTrials` in the Agent Ideas document database. Events are append-only.
