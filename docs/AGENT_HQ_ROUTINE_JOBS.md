# Agent HQ · Routine Jobs

Lightweight scheduled jobs share **one ChatGPT Scheduled Task slot**. This module is intentionally separate from HQ Manager/Worker queues and does not take over independent Operators or the Site SEO pipeline.

## Ownership

- **HQ Routine Job Registry** (`memos/agent-control/routineJobs`): execution instructions, target Operator, JST slots, enabled state, revision.
- **HQ Run Ledger** (`memos/agent-control/routineJobRuns`): one immutable slot claim plus success/failure and source-system readback.
- **Specialist Operator**: canonical content, credentials, inventory, outputs and approval state. Do not copy these into HQ.
- **ChatGPT Scheduled Task**: an execution clock only, not a copy of domain instructions.
- **Existing HQ dispatcher**: unchanged at 09:00/15:00/21:00 JST; executes Manager/Worker missions, not Routine Jobs.

## First job

`tweets-draft-replenishment` is seeded once with three JST slots: 04:30, 10:30, 16:30, preserving the former standalone task schedule. It only calls Tweets Operator to check account eligibility, create bounded **drafts**, and confirm inventory. No post publishing, account updates, deleting or affiliate actions.

## Tool flow for the dedicated scheduled runner

1. `routine_job_due({})` reads eligible slots and the current full instructions.
2. For each due job, `routine_job_claim({id,slotKey,agent,runnerId})`. Do **not** mutate the target Operator if `claimed:false`. Claiming is atomic and idempotent by JST date + slot.
3. Carry out its exact instructions using specialist tools. Keep target data in the target Operator.
4. Validate results with target-system readback, then call `routine_job_finish({runId,agent,status,resultSummary,validation,result})`. On failure, use status `failed` and retain concrete diagnostics. Never claim success without actual readback.
5. One job failing must not prevent other due jobs. Do not run more work than the available task runtime permits. No silent mutation of the schedule or unrelated tasks.

`routine_job_list` and `routine_job_runs` provide the Agent HQ UI and audit surface. `routine_job_upsert` changes job configuration with optimistic revision checks. The dashboard also exposes enabled/paused and editing.

## Clock semantics and recovery

Scheduling is currently locked to Asia/Tokyo HH:MM slots, with a 120-minute **start** window to allow normal scheduled runner delay. Missed windows do not backfill automatically, and a claimed slot is not retried with another idempotency key. Pending or failed work remains visible in the run ledger. Explicit recovery policies may be added later after incident evidence; never blindly replay a potentially successful Tweets Operator write.

The shared scheduled clock must include all configured job slots. Editing a job slot to another HH:MM alone does **not** alter ChatGPT's outer schedule.

## Rollout / cutover checklist

- Deploy API/MCP + dashboard and verify `routine_job_list` includes `tweets-draft-replenishment` with the correct active slots.
- Confirm the refreshed My Portal connector exposes the six `routine_job_*` tools in an actual scheduled execution context.
- Update the **existing** ChatGPT task "下書き補充" (do not create another schedule) to the Routine Job bootstrap, keeping 04:30/10:30/16:30 JST.
- At the next eligible tick verify due -> claim -> Tweets Operator draft saves and inventory readback -> finish, and HQ UI history.
- If any deployment/schema/runtime preflight fails, retain the old task prompt unchanged and report the unfinished cutover. Do not assert it is live.
