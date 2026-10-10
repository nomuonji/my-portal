# My Portal MCP Workspace (ChatGPT MCP Apps)

This is a **read-only proof of concept** embedded in the existing My Portal MCP endpoint. It keeps the existing OAuth, JSON-RPC HTTP endpoint, data stores and other tools unchanged.

## What it does

- `portal_workspace_open` provides a **global sidebar entrypoint** backed by `ui://my-portal/workspace.html`.
- The iframe lists Projects from the existing `world_map_get` registry, using a small projected payload without the large Agent Guide, methods or internal routing data.
- Selecting a Project invokes `portal_workspace_contexts({ projectId })` and shows short Context summaries, not full canonical Context documents.
- Clicking **会話に追加** sends one explicitly selected Context ID, Project ID and summary to `ui/update-model-context`. The assistant can then call `context_get` to read canonical history. No automatic context injection or database writes.
- Two MCP resource methods are added: `resources/list` and `resources/read`. The view uses the standard MCP Apps `ui/initialize` / `tools/call` / `ui/update-model-context` JSON-RPC postMessage bridge.
- Existing tools, server URL, OAuth tokens, Agent HQ work item execution and Manager schedules remain unchanged.

## Implementation choices

The iframe uses inline vanilla HTML/CSS/JavaScript, following the [OpenAI MCP Apps quickstart](https://developers.openai.com/plugins/build/app-quickstart), so the Netlify function needs **no new npm packages, build scripts, external domains or CSP exceptions**. The `openai/ui` metadata uses the [MCP Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md). The SDK is *not* installed: this proof implements the small compatible wire-level surface directly.

MCP compatibility: current connection supports `2025-06-18` and earlier. `resources` and the legacy `experimental` OpenAI capability are advertised in `initialize`. No global upgrade to the MCP 2026 protocol is performed.

## Testing after deploy

1. Refresh the installed My Portal plugin so it re-reads `tools/list`.
2. In a supported ChatGPT client (Work browser or compatible Desktop/mobile version), open **My Portal Workspace** from the plugin sidebar entrypoint. Classic ChatGPT clients may not support it.
3. Confirm the existing My Portal Projects load. Select **My Portal**; its Contexts should appear.
4. Choose a Context and click **会話に追加**. Confirm that the composer context indicates the selection; ask ChatGPT to continue from the attached Context. Verify it reads the canonical `context_get` record, not just the summary.
5. Verify existing `world_map_get`, `context_list`, and other MCP tools still work. Verify a missing resource URI returns `-32002`.

If the entrypoint does not appear, check host compatibility, refresh the plugin schema, then inspect `initialize` capability negotiation and `resources/read`. Do **not** assume the source change alone means that all clients render the UI.

## Security and boundaries

This plugin remains authenticated through the existing MCP OAuth. Tool data is sent to ChatGPT's sandboxed iframe only through the host MCP bridge. The workspace does not expose direct database credentials or fetch the API via browser JavaScript. Tool results are read-only; selecting a Context does not mutate authoritative data. Attach only information you want in the active conversation. Never use this demo to migrate the Manager/Worker runtime or context source of truth.
