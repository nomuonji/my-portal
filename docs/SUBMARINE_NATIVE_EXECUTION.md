# Native experimental submarine execution

The registry stores immutable experimental versions separately from production Skill/Pack releases. The dojo authors complete bodies and frozen dependencies **before** execution. Only a selected version and an ordinary request + public sources go into the producer input. No runtime hypothesis instructions or automatic release.

MCP:
- submarine_variant_import: migrate an existing Output DB pool by exact output/version ID. Idempotent per unchanged variant; no destructive changes.
- submarine_variant_register / list / get: create/read isolated versions with optimistic revision checks.
- submarine_execute: one AMD text call, original result persisted under submarineExecutions. Identical requestKey does not repeat the call (including failures); use a new key only for an intentional new run.
- submarine_execution_prepare / record: external agent path with lease and actual result, same immutable version.
- submarine_execution_list / harvest: review original results; harvest notes are not user ratings.

Authenticated REST bridge: existing /api/agent-ideas GET resource=submarine_variants or submarine_executions&id=...; POST action=submarine_execute, submarine_variant_import or submarine_execution_harvest. Uses existing Firebase user authorization. MCP uses existing OAuth.

## AMD setup
Server-side environment variables only: AMD_TOKENLAB_API_KEY, AMD_TOKENLAB_MODEL (actual enabled model ID), SUBMARINE_AMD_ENABLED=1, SUBMARINE_AMD_DAILY_CALL_LIMIT (explicit 1–100; UTC day). Default disabled. Do not use a paid fallback. Enable only after confirming account quota/cost and consent to external processing. Endpoint fixed to https://api.tokenlab.amd.com/v1/chat/completions; 22s timeout, 2048 max output tokens, no retries. Each attempted call consumes the daily call allowance even if failed. No credentials returned/logged. Call must explicitly set confirm and confirmExternalProcessing; do not put secrets/private data in skills, requests or excerpts.

Example tool arguments: { "submarineId":"viral-post", "versionId":"viral-post__V04__v000001", "requestKey":"unique-stable-request-key", "task":"日本語の単独投稿を1本作って", "sources":[{"url":"https://example.org/article","excerpt":"Replace with actually retrieved public text","retrievedAt":"actual ISO timestamp"}], "confirm":true, "confirmExternalProcessing":true }

Limitations: supplied public source excerpts only, no live browsing/tool calling or image/video execution in API mode. Source authenticity is caller responsibility. Fixed skill/module texts are native; dynamic MCC/consumer data not fetched by this MVP. Record actual response model and usage; never equate raw results to passed formal trials. Production release and dojo gates remain unchanged. External agent path records reported execution, not proof of prompt isolation. Native and legacy sortie use a common exclusion lock. Do not switch scheduled fleet runner until import, provider configuration and live readback have been verified. Rollback by disabling AMD, keeping existing runner and retaining native receipts.
