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
| Outcome contract | user | Statement, unit, target count, acceptance checks, final indicator, proxies (explicitly not success), deadline, run budget, stop conditions |
| Method | agent | Where the body lives (repo, document, or inline), active version label, change history with motivating runs and benchmark result |
| Hypothesis ledger | agent | `conjecture → observed → reproduced → yielded_candidate → yielded_outcome`; only the last two are win patterns. Rejected hypotheses stay with their reason |
| Constraints | per item | `user` (agent may only propose), `environment` (measured property of tools/world, needs a basis), `agent` (provisional threshold, revisable with a reason) |
| Position | server | Run log: declared predictions, verdicts, which fixed points moved, stalled-run counter |

## Rules the server enforces

- Creating a base, changing the outcome, confirming achievements, and touching user-owned constraints require `userAuthorized=true` with `authorizationNote`. An outcome passed without it is stored as a pending proposal.
- Item IDs (`H-nnn`, `K-nnn`, `R-nnn`, `A-nnn`) are assigned by the base and never reused. Earlier labels go in `legacyIds`.
- A hypothesis stage needs the evidence it claims: one entry for `observed`, two for `reproduced`, a `candidate` entry for `yielded_candidate`, an `outcome` entry plus a confirmed achievement on the base for `yielded_outcome`. Advancing needs new evidence in the same call; demoting, rejecting and reopening need a reason.
- A run declares its target hypotheses with predictions before measuring (or an unknown-territory probe). Only one run is open per base.
- The method version cannot change while a run is open. After the first version, a new one needs finished motivating runs and `benchmark.passed=true` (or a stated reason why no benchmark exists). Version labels are never reused.
- Finishing a run needs a verdict for every declared hypothesis. A run that moved no fixed point must say why and increments `stalledRuns`; three in a row raise a warning in the brief.
- When the outcome is `confirmedBy: user`, achievements stay candidates until the user confirms them.

## What stays elsewhere

Measured data (keyword demand, SERPs, job listings) stays in its operator. The base records where it is in `canonicalData` and refers to records by ID. A method body kept in a repository stays there with its code and tests; the base holds the pointer.

## MCP operations

`exploration_base_list`, `exploration_base_get`, `exploration_base_create`, `exploration_outcome_set`, `exploration_method_version_set`, `exploration_item_upsert`, `exploration_run_start`, `exploration_run_finish`.

`exploration_base_get` with `view=brief` is the single call that starts a run. Packs may reference a base as a dependency with `resourceType: exploration_base`; `cognitive_bundle_resolve` loads the brief when the caller selects it. `world_map_get` lists the bases.

## Storage

Collections `explorationBases`, `explorationBaseItems`, `explorationBaseRuns`, `explorationBaseEvents` in the Agent Ideas document database. Events are append-only.
