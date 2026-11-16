# My Portal MCP Workspace (ChatGPT MCP Apps)

An authenticated, **read-only** ChatGPT MCP Apps sidebar that now opens on **スキル道場** and retains the original **Projects / Context** tab. No new DB, API billing, scheduler, or changes to the normal agent execution queue.

## Skill Dojo tab (new default)

- The global entrypoint remains `portal_workspace_open`, backed by the existing `ui://my-portal/workspace.html` resource.
- `portal_workspace_dojos` projects a compact, active-only list from `exploration_base_list` (name, ID, released method label, run/pending counts). It does not duplicate or mutate the dojo DB.
- `portal_workspace_dojo({id})` returns a compact read-only projection of `exploration_base_get({id,view:"brief"})`: objective, current released method and Skill, number of rated trials, pass rate, outstanding user evaluations, open run and warnings, latest run summary, next-step notes.
- Selecting a dojo loads details. **錬成を続ける** and **評価待ちを確認** send the selected canonical `dojo ID` and a corresponding instruction to `ui/update-model-context`. The user must send the composer message before an assistant begins working; button clicks never directly create trials, release Skill versions or record judgments.
- Any write remains a separate, deliberate action by the assistant through the normal `exploration_*` tools, with existing safeguards (e.g., user feedback only for acceptance, stalled/unfinished runs and training constraints). Do not treat AI evaluations as user ratings.
- Pass rate is shown as **未評価** when no rating-derived value is available, not fabricated as 0%. A method/version alone is not evidence of actual performance.

## Projects / Context tab (preserved)

- The original `portal_workspace_open` tool still projects Projects from `world_map_get` without exposing the full Agent Guide.
- The existing `portal_workspace_contexts({projectId})` tool lists short Context summaries; clicking **会話に追加** passes a selected ID and summary through `ui/update-model-context`. The assistant reads the authoritative `context_get` after submission.
- Both views share the same authenticated MCP/OAuth connection; the iframe receives data through standard `ui/initialize`, `tools/call`, and `ui/update-model-context` messaging, with no browser-side direct Firestore credentials.

## Deployment and manual acceptance

1. On the PR branch, syntax-check the embedded UI script and verify it registers four `portal_workspace_*` tools.
2. Deploy the My Portal Netlify MCP change through the normal release process, then refresh/reconnect the My Portal plugin so ChatGPT picks up the updated UI resource and tool schema.
3. Open **My Portal Workspace**. It should default to the Skill Dojo tab and show active dojos, with a detail pane for one selected dojo.
4. Choose a dojo, check the displayed version, rating rate, pending count and open-run warning against `exploration_base_get({id,view:"brief"})`. These are projections, not editable canonical records.
5. Click **錬成を続ける** or **評価待ちを確認**, submit the suggested message, and verify the assistant reads that exact dojo ID. No changes to the dojo are caused by clicking the UI button alone.
6. Switch to Projects / Context and confirm the previous context-selection workflow still functions. Also verify a non-existent resource URI still returns MCP error `-32002`.

If the UI does not appear, check ChatGPT host support for MCP Apps sidebar entrypoints, refresh the connector schema, and inspect `initialize`/resources negotiation. A merged source change alone does not prove a client displayed the new UI.

## Security and boundaries

The frontend is read-only. It does not write feedback, create new Skill training sessions, publish/migrate methods, enqueue Work Items, run an AI model, or trigger background jobs. No user scores are inferred. The user controls which dojo is attached to the conversation. Data sources remain canonical: `exploration_base_get` and relevant Chat Skills for skill-method training; independent Operator systems for factual measurement; Agent HQ Methods for Manager/Worker rather than chat Skills.
