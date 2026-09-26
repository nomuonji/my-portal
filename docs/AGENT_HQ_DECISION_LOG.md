# Agent HQ Decision Log

This log records **important operating/architecture decisions and why they changed**.
It is intentionally not a duplicate of git history.

## 2026-09-26 — Manager and Worker are separate roles

**Decision:** Manager observes/reconciles/decides/delegates. Worker executes actual work.

**Why:** A single role doing both management and implementation made it difficult to distinguish queue quality from actual delivery.

**Consequence:** Manager Run and Worker Work Item have separate lifecycle/receipts.

---

## 2026-09-26 — Scheduler timing is external

**Decision:** My Portal Manager Jobs are schedule-agnostic. ChatGPT Scheduled Tasks (or another runner) own cadence/timezone.

**Why:** Scheduling state duplicated inside the project becomes stale and makes the project less portable.

---

## 2026-09-26 — Work Item granularity is an execution bundle

**Decision:** Do not fill ready inventory with micro-tasks. Bundle compatible work that shares repo/context/validation/deploy boundaries.

**Why:** Fine-grained tasks filled ready inventory without representing meaningful Worker sessions.

**Guardrail:** Same repository alone is not enough. Safety, lock, release and validation boundaries must also be compatible.

---

## 2026-09-26 — Completed history is separate from active queue

**Decision:** `archived` work leaves the active board. Recent completions are shown separately; long-term retention is system housekeeping, not Manager responsibility.

**Why:** Completed cards were overwhelming operational work.

---

## 2026-09-26 — Review means judgment-only

**Decision:** `review` means implementation and validation are already complete and only Manager/Human judgment remains.

**Why:** Unfinished work was being moved to review, creating retry/review loops and obscuring whether anything had actually shipped.

**Related Incident:** SEO Worker unfinished tasks entered review.

---

## 2026-09-26 — Ready requires capability match

**Decision:** A Manager may count work as ready only when the intended Worker has a legitimate path to complete it end-to-end.

**Why:** BUNGU work required local build capabilities unavailable in the Scheduled Worker, while chonmage work mixed safety boundaries and failed during GitHub writes.

**Consequence:** Work Items can declare `metadata.execution.requiredCapabilities` and a concrete `validationStrategy`.

---

## 2026-09-26 — Worker reports problems to Manager first

**Decision:** Worker does not normally create Incidents directly. It reports execution problems to its Manager; Manager triages them.

**Why:** Workers see local failures but lack the portfolio/system context to decide whether every failure is structural.

**Escalation rule:**
- local task issue → Manager fixes/reroutes,
- structural/recurring/manager-unresolvable issue → System Incident,
- policy/safety/credential/major architecture decision → Human.

---

## 2026-09-26 — System Incident reuses Work Item storage

**Decision:** Incident records use `sourceType=system_incident` rather than a second task subsystem.

**Why:** We need durable root-cause/prevention history without adding another large operational model.

**UI consequence:** Incidents are displayed separately and excluded from normal Worker queue inventory.

---

## 2026-09-26 — Site SEO Manager outcome is traffic growth

**Decision:** The Site SEO Manager is ultimately evaluated by measured organic access growth, not task count.

**Primary evidence:** Analytics organic sessions and Search Console clicks, principally recent 28 days vs prior 28 days, with 7-day signals and 90-day durability checks.

---

## 2026-09-27 — Weekly Manager reports include Incident handling

**Decision:** Periodic Manager outcome reports include Worker escalations, Manager fixes, Incidents created/resolved, unresolved structural issues, prevention, and recurrence checks.

**Why:** The Human should see not just mission outcomes but whether the operating system itself is learning from failures.


## Implementation anchors

These are not the full git history; they are recovery anchors for the current operating model.

- `bb3d258371925192aff4fedb42825be41346e224` — Operating Model constant, Worker→Manager problem reporting, System Incident storage/helpers, Control Plane Incident exposure.
- `beefd2c1500f7d00ee4860a8700ffba5f06cde25` — MCP schemas for Operating Model, escalation and Incident operations.
- `a2a8243d2f3051e8b7087053ef23511a325f50fe` — production MCP routes and server version 1.8.0.
- `1ac1a029dd7419ba5a7c1d0f200624aa93c4d398` — Agent HQ UI separates System Incidents from the normal Worker queue/history.
- `da9a8fbd603fb94c1622f5c0383cd381a0b7557c` — Context Store governance documentation aligned with the Operating Model.
- `1fb372b54129c9aa77aa30e30f5d4bea7b24b6b8` — Manager Job Context includes Worker escalations, related Incidents, capability policy, and Operating Model.
