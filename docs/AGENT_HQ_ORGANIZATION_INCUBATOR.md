# Agent HQ 組織インキュベーター — 2026-10-08

## Purpose / authority boundary

My Portal Agent HQ is the operator of **small, incubating** agent organizations. It is **not** a parent control plane for every mature operator. The user sets each organization's mission and quality/safety boundaries. An independent organization owns its own Manager, tasks, policy and operational database. My Portal retains only read-only graduation history and may consume public or permissioned service interfaces like any other client.

**Sites Operator / SEO is already independent.** Do not reactivate the archived My Portal SEO Manager Job, create replacement HQ SEO Manager Jobs, move canonical SEO queues back into HQ, or treat unresolved historical SEO Incidents as instructions to operate Sites Operator. Current SEO operations and policies remain in Sites Operator.

## Reuse from Sites Operator (concepts, not SEO-specific machinery)

| Reusable idea | Incubator implementation | Deliberately NOT copied |
| --- | --- | --- |
| Outcome-oriented Manager | Organization mission + outcomeContract; Manager is responsible for measured outcomes | SEO traffic, clicks, rankings as universal metrics |
| Macro-policy separated from worker procedure | Organization operatingPolicy (objective, allocation, risk constraints, evaluation windows); Manager Method is a versioned execution procedure | Fixed allocation percentages or SEO incident policy |
| Evidence-led decision | Record primary evidence, unknowns, counterevidence and time windows in domain Methods / execution receipts | SEO's GSC/GA4 ingestion or indexation model |
| Valid executable work | Organization-bound Manager must use Worker Method, actual Worker capability profile and validationStrategy before a ready/in_progress bundle | Task creation for inventory quotas |
| Deduplication / traceability | Existing Manager Run dedupeKey, pinned Manager Method, Work Item evidence; newly pinned organizationPolicyRevision | Duplicate Site Operator SEO task queue |
| Incident & governance history | Existing structured Incident, MethodVersion, OperatingModelVersion and SystemChangeSet | SEO recovery control plane |
| Graduation / source-of-truth ownership | Explicit cutover, freeze HQ writers, verify no open HQ Manager Runs or work, record independent owner | Permanent HQ management over graduated operations |

## Lifecycle

1. **Idea:** Thinking Space discusses the institution, its goal and useful research.
2. **Incubating:** organization_create registers mission, domain, output quality, policy, specialist system of record and outcome contract; Manager Job is linked by `organizationId`. It may create zero Work Items when no valuable executable work exists.
3. **Graduation ready:** organization_update changes to `graduation_ready` after a target independent operator, technical migration and human review are planned. HQ remains the owner during preparation.
4. **Independent:** organization_graduate is an explicit handoff. It requires targetSystem, canonicalOwner, verifiedAt, evidence, humanApproval. All linked HQ Manager Jobs must be paused or archived. All related Manager Runs and Manager-created Work Items must be closed. The final transaction changes the ownership state. HQ Manager start/delegation checks this state transactionally, and cannot restart independent work.
5. **Archived:** unused or retired incubating organization; no new HQ scheduling.

`independent` is a terminal HQ state, not a synonym for `paused`. Any future cooperation with an independent organization is a service interaction, not an HQ Worker assignment. A new incubator organization may be created later if the user separately authorizes that mission.

## System-of-record split

- **HQ owns** organization registry, incubator mission and policy, Manager Jobs/Runs, Worker Work Items, Methods, governance, incidents and handoff record.
- **Domain systems own** specialized facts: Culture Institute's X observations and culture records in its own repository/DB; Knowledge Institute's notes and legal/learning facts in Learning OS.
- **Shared specialists** (My Portal Creative Intelligence, Keywords Operator, GitHub) are called through their own interfaces. Their data is not copied into HQ unless bounded evidence references are needed.

Avoid storing large research corpora in HQ. The registry may contain small evaluation metadata and evidence references only.

## Manager operating contract

Each organization Manager loads:
- The active HQ Operating Model and its own current Manager Method.
- `manager_job_get_context`, including the linked organization policy, mission and outcomeContract.
- Existing open tasks, escalation queue and execution receipts before adding new work.
- Specialist system current data: do **not** treat the HQ registry as proof of publication, verification or performance.

Use Observe → Reconcile → Decide → Delegate → Verify → Evaluate. A Manager may recommend a new domain policy but must not silently revise mission, risk/safety rules or independently elevate an unverified observation into policy. Record unknown/missing measurements as unknown, never zero. Choose work by expected mission impact and evidence; empty runs are valid.

## Unified scheduler / system-side dispatch

Only **one thin external ChatGPT Scheduled Task** is needed for all HQ-incubated organizations. It is a clock/runner, not a policy carrier.

**Canonical dispatch selection** is calculated by the existing `control_plane_overview` response, field `dueManagerJobs`, from each Manager Job's `metadata.hqDispatch`:

```json
{ "enabled": true, "frequency": "daily", "timeZone": "Asia/Tokyo", "localHour": 8 }
```

The general `schedulerDispatchContract` in the active Agent HQ Operating Model is the only instruction for scheduling/execution. Managers hold substantive goals and domain rules in current Job + version-pinned Manager Method and organization Mission/Policy. Workers hold execution rules in Worker Methods. **No domain instructions, queue-size quotas, hardcoded Manager IDs or per-org hours in the external prompt.**

Dispatcher rules are tested in `scripts/hq-dispatch-smoke.js` and enforced by `functions/hqDispatcher.js`:
- Only Manager Jobs with explicit opt-in, `status=active`, HQ-owned incubating/graduation_ready organizations and valid dispatch configuration are eligible. Inactive, independent, archived, unaffiliated or unconfigured jobs (including the HQ Outcome Auditor) are ignored.
- The hourly clock observes the current Tokyo-local date. Each daily manager becomes due at/after its configured local hour and may start once per Tokyo-local day. No backlog replay of missed days.
- The returned item includes a deterministic `invocationId`. Pass it unchanged to `manager_job_start` so retries cannot create duplicate Runs. Then claim the Run, load its pinned Method/current context, execute, finish and report actual result. If an earlier Run is open, reconcile rather than generating duplicate work.
- The same overview exposes `hqDispatch.dueWorkItems` for executable, unclaimed Worker tasks originating from active HQ-owned, opted-in Managers. Re-read the overview after any Manager delegation; then claim at most a bounded number of available Worker tasks using their pinned Worker Methods and real capabilities. Leave unexecutable tasks in the correct blocked/review state, not success.
- In the next clock tick, only still-due Managers are considered. A Manager may create zero Work Items; this is not an error.
- If `dueManagerJobs` is empty, no Manager runs are started. Organization graduation automatically removes it from scheduling without editing the clock task.
- Adding another small organization requires configuring `hqDispatch` on its own Manager Job, not editing the shared Scheduled Task.
- Separate independent Operators (such as Sites Operator) own their own schedules and do not appear in HQ due lists.

**Current incubation configuration:** Culture Institute Manager scheduled at 08:00 JST, Knowledge Institute Manager at 15:00 JST. Both are managed in their own Job metadata and can be changed without changing the outer clock. The single outer Scheduled Task runs hourly; timing is flexible, so execution may be delayed within the hour. Do not report a missed hour as a missed organization day without checking lastStartedAt.

## Graduation checklist (human decision)

- Independent runtime and specialized database are demonstrably ready.
- Ownership and canonical data paths are named and verified.
- Incubated Manager Jobs are **paused/archived** and external schedules disabled.
- No HQ Manager Runs remain ready/running; no HQ worker work remains open.
- All in-flight data, receipts, Methods and pending incidents are handed over or closed with provenance.
- Human explicitly approves the architecture/ownership transfer.
- `organization_graduate` records evidence and moves the registry to independent; no generic organization_update can bypass the ownership gate.

## Examples (proposed, not provisioned by this document)

- `culture-institute`: initial specialist `nomuonji/trend-blog`; goal: accumulate verified cultural observations, recurring patterns and genuinely useful creative outputs. Not measured by article count alone.
- `knowledge-institute`: initial specialist Learning OS; goal: verified, sourced and internally consistent living knowledge; keep the separate learner-specific review/attempt state intact.

Neither organization requires an independent backend during incubation. Set up Manager Method, Worker Method, a named runner and scheduling **only after** mission, initial evidence, quality gate and actual capability have been confirmed.

## Rollback

- Before graduation: restore the previous OperatingModelVersion/MethodVersion; restore the organization policy using revision/history and explicitly recorded approval; pause the involved Manager Job if ownership is uncertain.
- After graduation: HQ **does not** reclaim control by rolling back an organization record. A new explicit human-approved migration is required; the former independent system remains authoritative until cutover.
