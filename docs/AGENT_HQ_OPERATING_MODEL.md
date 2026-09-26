# Agent HQ Operating Model

> Current operating contract for My Portal Agent HQ.
> This document describes **how the system should behave now**. Historical reasons belong in `AGENT_HQ_DECISION_LOG.md`.

## 1. Purpose

Agent HQ coordinates autonomous work without turning chat history into the source of truth.

The basic organization is:

```text
Human
  ↓ sets direction / approves exceptional decisions
Manager
  ↓ discovers, reconciles, prioritizes, delegates
Work Bundle
  ↓
Worker
  ↓ executes, validates, delivers
Manager
  ↓ handles escalations / outcomes / incidents
```

My Portal owns durable operational state. External schedulers own *when* Manager/Worker runs happen.

## 2. Roles

### Human
- Sets mission, boundaries, quality/safety expectations and major policy.
- Handles genuinely human-only actions and judgments.
- Reports a system concern when Agent HQ appears to behave incorrectly.

### Manager
- Owns a mission and outcome, not a quota of task cards.
- Runs Observe → Reconcile → Decide → Delegate.
- Reconciles existing blocked/in-progress/review work before producing more work.
- Creates executable Work Bundles only when the current Worker has the required capability.
- Receives Worker problem reports first.
- Fixes local task/routing problems itself where possible.
- Creates a System Incident only for structural, recurring, cross-task, or manager-unresolvable problems.
- Includes Incident handling and recurrence checks in periodic outcome reviews.

### Worker
- Claims one executable item before acting.
- Executes the requested work; it does not replace delivery with broad management.
- Uses only capabilities actually available in its runtime.
- If execution cannot continue, reports the problem to the Manager with facts/evidence.
- Does not create System Incidents directly under normal operation.

## 3. Work Item state semantics

| State | Meaning |
| --- | --- |
| `backlog` | Deliberately deferred from near-term execution. |
| `ready` | Unclaimed **and executable by the intended current Worker**. |
| `running` | Actively claimed and being executed now. |
| `in_progress` | Unfinished, not currently claimed, but a known compatible route exists to resume. |
| `blocked` | Unfinished and currently not executable because of capability, safety, permissions, external dependency, etc. |
| `review` | Implementation and validation are complete; only Manager/Human judgment remains. |
| `archived` | Closed terminal history: completed, withdrawn, merged, or resolved. |

### Invariants
- Never put unfinished capability/write failures into `review`.
- `review` is not a generic handoff bucket.
- Do not put work in `ready` if the current Worker cannot complete it end-to-end.
- Do not move ongoing work to `backlog` merely because an execution session ended.
- A running item with an active lease belongs to its claimant.
- Normal completed work does not require Manager approval when acceptance criteria and required validation are satisfied.
- Incidents are excluded from the ordinary Worker queue.

## 4. Work Bundle granularity

The default unit is an executable **work bundle**, not a micro-task.

Bundle work when:
- repository is shared,
- execution context is compatible,
- build/deploy/validation can be shared,
- safety/approval/lock boundaries are compatible.

Do not bundle merely because files live in the same repository.

Split when:
- safety boundaries differ,
- release/approval boundaries differ,
- locks conflict,
- risk differs materially,
- validation or measurement windows are independent.

## 5. Methods and runtime requirements

Execution manuals live in My Portal Methods, not in external scheduler prompts.

- **Manager Method** — how a Manager observes, reconciles, decides, delegates, reviews outcomes, and handles incidents.
- **Worker Method** — how a Worker executes, validates, delivers, and reports problems.
- **Manager Job** — owns a Manager Method and may define a default Worker Method for generated Work Items.
- **Work Item** — owns the concrete WHAT and may override the default Worker Method for exceptional work.

Each active Method version may declare:

```json
{
  "protocol": {
    "runtimeRequirements": {
      "requiredCapabilities": [],
      "requiredTools": [],
      "optionalCapabilities": [],
      "optionalTools": []
    }
  }
}
```

External runners must report only tools/capabilities that are **actually available in that invocation**. My Portal compares those declarations with the pinned Method requirements before execution.

### Version pinning

- A Manager Run pins the active Manager Method version when `manager_job_start` materializes the run.
- A Work Item keeps a Worker Method reference; the active Worker Method version is resolved and pinned on the first successful Worker claim.
- Historical work therefore remains traceable to the exact manual used even after Method improvements.

### Scheduler boundary

External Scheduled Tasks own:
- when to wake up,
- which My Portal Manager Job or Worker runner to bootstrap.

They should not duplicate:
- detailed Manager/Worker procedures,
- tool lists,
- validation policy,
- state semantics,
- incident policy.

The bootstrap exception is My Portal itself: if My Portal is unavailable, the runner cannot load its Method or persist an Incident, so it must stop rather than improvise and report the bootstrap failure directly to the Human.

## 5. Capability-aware dispatch

Manager-created ready work should record, where material:

```json
{
  "metadata": {
    "execution": {
      "requiredCapabilities": [],
      "validationStrategy": {}
    }
  }
}
```

The Manager must compare required capabilities with the configured Worker capability profile before counting the item as ready inventory.

If a capability gap is discovered:
1. Redesign the validation/execution route using an available legitimate capability, or
2. use `blocked` until a valid route exists, or
3. delegate a genuinely human-only step to Human Tasks.

Do not blindly retry the same Worker with the same capability gap.

## 6. Worker → Manager escalation

A Worker problem report contains:
- symptom,
- category,
- attempted actions,
- evidence,
- affected work,
- required capability if known,
- next possible step if known.

Categories:
- `capability`
- `safety`
- `external_dependency`
- `state`
- `validation`
- `tool_error`
- `unknown`

The Work Item should move to:
- `in_progress` when a known compatible next route exists,
- `blocked` when it currently cannot be completed.

The Worker should use the canonical `work_item_report_problem` operation rather than pretending unfinished work is complete.

## 7. Manager triage

Manager examines escalations before creating more inventory.

### Local problem
If changing the task scope, bundle, priority, validation, or route fixes it, Manager fixes the Work Item. No Incident.

### Alternate route
If another legitimate capability/validation route can complete it, Manager reroutes it. No Incident unless the same mismatch keeps recurring.

### System Incident
Create an Incident when one or more are true:
- the same class of problem recurs,
- fixing one Work Item would not prevent recurrence elsewhere,
- Operating Model / Method / code / schema / connector / scheduler must change,
- Manager cannot resolve it through normal reconciliation,
- data loss, auth, permissions, or a safety-boundary issue is involved.

### Human escalation
Mission, policy, important architecture, quality/safety boundaries, credentials/permissions, or genuinely human-only decisions go to the Human.

## 8. System Incidents

System Incidents reuse Work Items with:

```text
sourceType = system_incident
```

They are **not normal Worker queue inventory**.

Canonical incident metadata:

```json
{
  "incident": {
    "status": "open | investigating | resolved",
    "severity": "low | medium | high | critical",
    "detectedBy": "worker | manager | human",
    "symptom": "...",
    "rootCause": "...",
    "affectedManagerJobIds": [],
    "relatedWorkItemIds": [],
    "fix": "...",
    "prevention": "...",
    "operatingModelChanged": false,
    "evidence": []
  }
}
```

Resolution means:

```text
Detect → Diagnose → Repair → Regression check → Prevention
```

not merely "the error disappeared."

## 9. Manager mission and outcome review

A Manager owns a measurable mission. Activity volume is not the outcome.

For the current Site SEO Manager the primary mission is to increase organic access measured by Analytics / Search Console.

Periodic human reports include:
- Mission status,
- outcome metrics,
- delivered changes,
- operating health,
- problems/failures,
- Incident handling,
- unresolved Incidents,
- root-cause hypotheses,
- next priorities,
- self-improvement,
- whether prior Incidents recurred.

## 10. Durable governance artifacts

Three layers are kept distinct:

- **Operating Model** — how Agent HQ should behave now. This file.
- **Decision Log** — why important architecture/operating decisions changed.
- **System Incidents** — concrete failures, root causes, fixes and prevention stored in My Portal.

When a System Incident reveals a new invariant:
1. record the Incident,
2. fix the system,
3. update the Decision Log,
4. update this Operating Model if the current expected behavior changed.

## 11. Repair workflow when the Human says "My Portal seems wrong"

1. Load `control_plane_overview`.
2. Read `agent_hq_operating_model`.
3. Inspect active/recent System Incidents.
4. Compare expected behavior vs actual behavior.
5. Decide whether this is:
   - an isolated Work Item problem,
   - a Manager/Method problem,
   - or an Agent HQ system problem.
6. Repair the narrowest correct layer.
7. Record structural failures as Incidents and important design changes in the Decision Log.
