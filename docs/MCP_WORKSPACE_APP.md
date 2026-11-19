# My Portal Workspace — ChatGPT MCP Apps

The authenticated sidebar **道場統括 / スキル道場** is an interactive *training workbench*; the original **Projects / Context** tab remains available. Existing OAuth and the `ui://my-portal/workspace.html` entrypoint remain unchanged.

## Dojo Command Center

The default **道場統括** tab is the on-demand front door. It shows at most three real pending samples from across active dojos, round-robin across the fetched bases. The reserved read-only `portal_workspace_contexts({projectId:"dojo:__queue"})` route loads at most three bases and reports the overall pending count, separate outcome confirmations, and explicit per-base errors. The existing single-dojo and Project/Context tabs remain.

- Images: render the canonical trial `imageUrl` (including extensionless URLs) plus HTTPS image links in the body/ref, deduplicated, at most four. HTTPS body and ref links are clickable, with source host labels. Resource CSP permits known image origins (Rakuten, Amazon, YouTube, X, ImageKit, Shopify, Yahoo, etc.); other origins or image failures retain a clickable image URL rather than proxying arbitrary URLs. No server-side external image fetch, secrets, or HTML injection.
- Batch review: stage explicit verdicts using the composite baseId/trialId key, write one canonical `exploration_trial_rate` call per base, verify each group from a fresh dojo detail, and report partial failure rather than pretending cross-base atomicity. Ambiguous writes block retry until explicit refresh. No new approval/confirmation permissions.
- Dispatch: `portal_workspace_contexts({projectId:"dojo:__dispatch"})` selects up to three distinct release targets, excluding open runs, pending samples and five or more pending outcome confirmations. It prioritizes sustained non-passes for research, then fewer current-version evaluations, then older activity. It rechecks live detail gates, compiles a bounded snapshot of version/revision/next actions/hypotheses, and does not claim or execute a run. This mechanical ordering is advisory; Dojo Master revalidates evidence and live gates before acting.
- Start or save-and-continue requests use `ui/update-model-context` and explicit user-triggered `ui/message`. The model executes in the conversation; no independent subagent, scheduled job or external LLM provider is created. Manual context handoff remains available if the host cannot send a message. A message acknowledgement is not proof of completion. No automatic retry of uncertain sends.
- This release batches user ratings, not arbitrary experiment writes; existing canonical experiment mutations remain unchanged.

## Skill Dojo workbench

- **道場一覧 / 検索 / フィルタ**: all active dojos, those with pending trial/outcome evaluations, and those showing a sustained failure streak. Summary data comes from the established `portal_workspace_open({})` tool, backed by `exploration_base_list({status:"active"})`. Display counts distinguish **見本の評価待ち** (`loop.awaiting`) from **成果の確認待ち** (`outcome.awaitingConfirmation`).
- **進行状況**: method version, currently released skill, number of runs, ratings, pass rate, current/previous skill performance (with sample sizes), outstanding run / warnings, whether research is required before the next sample, previous run and proposed next action.
- **錬成を進める**: choose research/hypothesis verification, evidence-backed sample generation, or failure/calibration analysis. A selection becomes an explicit `ui/update-model-context` handoff; training starts **only after the user submits the message**. When the canonical dojo gate requires research, sample generation is disabled in the selector.
- **見本を評価**: expands up to five pending trial samples from the compact projection of `exploration_base_get({id,view:"brief"})` served by the existing `portal_workspace_contexts({projectId:"dojo:<id>"})`. Shows the real trial body and a source link when safe. The user explicitly clicks 合格 / 惜しい / ボツ, optionally adds a short note, and then **この評価を保存**. This calls the existing `exploration_trial_rate` with the exact trial ID, a verbatim representation of the user's selected verdict/note, and `failStage:"unknown"`. The app then reads back the same compact projection to verify that the trial has left the awaiting queue before showing success or updating stats. A tool error never counts as a rating. If the write may have committed but readback failed, saving that trial is blocked until the user explicitly refreshes, to avoid accidental duplicate feedback.
- **成果の確認待ち**: distinct from trials; it remains a **conversation handoff** so the existing confirmation flow, provenance, and user-approval gates are preserved. Never call `exploration_trial_rate` to confirm an unrelated outcome.
- **仮説・改善**: display current hypothesis candidates and their historical rating counts without treating self-scoring as success. Pick one hypothesis to include its ID in an investigation handoff.
- **手動更新** refreshes the currently selected dojo. Selection state is ephemeral in the iframe. No scheduled job, background agent, or Work Item is created. The command-center start is an explicit conversation message, not a background worker.

## MCP compatibility

The initial Dojo UI called two new app-only tool names, which existing ChatGPT connections cached as unknown. To prevent recurrence, the global app still uses the **registered** `portal_workspace_open` and `portal_workspace_contexts`. The UI requests selected-dojo details through the already-registered `portal_workspace_contexts` tool, using the reserved `dojo:<id>` scope. The server internally calls canonical `exploration_base_get` and returns only a small read-only projection (pending trial bodies, observed ratings, gates, selected hypotheses, next action), avoiding the 50–210 KB full brief in the iframe. Rating invokes the already-existing `exploration_trial_rate` tool. The original project Context behavior is unchanged for normal project IDs. No additional MCP tool name is introduced. `exploration_trial_rate` is an explicit write, invoked only on the user's confirmation in the UI. All data remains in its canonical dojo store.

The inline vanilla JS app uses standard MCP Apps `ui/initialize`, `tools/call`, and `ui/update-model-context`. It does not contact Netlify or Firestore via browser `fetch`, expose secrets, or add build dependencies. Failed detail calls fall back to a list summary with conversation handoff, rather than silently displaying invented records.

## Verification

1. Parse the embedded HTML JavaScript and check tool call names against the registered MCP actions.
2. Use representative dojo snapshots including a dojo with pending trials, a dojo that requires research before another sample, and one with an outcome awaiting confirmation.
3. Exercise the mock iframe bridge in a DOM harness: choose the keyword dojo, view three real pending trial bodies, select a verdict and note, simulate `exploration_trial_rate`, read back the changed queue, and confirm that only the chosen trial disappears. Separately exercise hypothesis selection/handoff and the original Context tab.
4. Run the production Netlify preview and CI checks; merge only after suitable checks. After deployment, reopen My Portal Workspace in ChatGPT to refresh its HTML resource.
5. For live acceptance, submit **an actual rating intentionally** in the UI, then independently confirm it appears in `exploration_base_get`. Do **not** perform a write to production merely as a smoke test.

## Rules of evidence

All percentages are computed by the canonical server and include their evaluated sample sizes, not invented AI self-assessments. The user selects the verdict. AI may investigate and prepare samples, but may not forge user approval or loosen dojo stopping criteria. Repo branch changes alone do not prove a Netlify deployment or host rendering.
