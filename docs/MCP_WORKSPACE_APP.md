# My Portal Workspace (ChatGPT MCP Apps)

An authenticated, **read-only** sidebar for **スキル道場** (the default tab) and **Projects / Context** (preserved).

## Compatibility: why the Skill Dojo tab uses an existing tool

ChatGPT may cache the MCP `tools/list` schema across a connection even when the deployed MCP Apps HTML resource changes. The initial Dojo UI implementation used two new tool names, `portal_workspace_dojos` and `portal_workspace_dojo`. With a cached older schema, the UI showed `Unknown tool` after a successful deploy.

**Current implementation:** the existing registered `portal_workspace_open({})` now projects both `projects` and `dojos` in one authenticated, read-only response. The UI does not call any new tool names and therefore does not depend on plugin-schema refresh to load the Dojo tab.

The projection is built from existing `explorationBaseStore.list({status:"active"})` entries, including the released method/Skill references, user-rating counts, pass rate, pending evaluations, open run ID, last run summary and next action. The detailed canonical data remains available through normal `exploration_base_get({id,view:"brief"})` in the assistant after conversation handoff. The client never fetches or writes Firestore directly.

The original `portal_workspace_contexts({projectId})` still provides concise Context summaries under Projects / Context.

## UI behavior and authorization

- Pick a dojo to inspect its status and latest training result.
- **錬成を続ける** and **評価待ちを確認** only call `ui/update-model-context` with the selected dojo ID and an instruction. The assistant starts after the user submits the conversation message.
- All training, scoring and method release rules remain with the canonical `exploration_*` tools. UI selection does not create a training run or mark a candidate as accepted.
- The pass rate is `未評価` when no rating exists. The list snapshot is intentionally concise; the agent must reopen the selected dojo for execution.
- No new database, scheduled job, Work Item, OAuth scope, API billing or model runtime is added.

## Checks

1. Verify the app UI script parses and only calls `portal_workspace_open` / `portal_workspace_contexts`.
2. Verify `portal_workspace_open` returns `projects` and `dojos`, with bounded text and correct `awaitingCount` / `loop.passRate` projection, including genuinely unrated dojos.
3. Deploy through Netlify, reopen the ChatGPT sidebar app, and confirm the Dojo tab lists the existing active bases without the old `Unknown tool` error.
4. Select a dojo and check counts against `exploration_base_get({id,view:"brief"})`, then test the handoff buttons.
5. Switch to Projects / Context and check its selection / handoff flow. A missing resource URI should still return MCP `-32002`.

If the host renders a previously cached HTML resource, close and reopen My Portal Workspace; refresh the ChatGPT plugin only if the old resource remains active after redeploy.

## Security

This app is authenticated through the existing MCP OAuth. All displayed data is a read-only projection from the My Portal service. Project/Context and Dojo choices are attached to a conversation only when the user explicitly clicks the button. No user rating, irreversible release or publication is performed from the iframe.
