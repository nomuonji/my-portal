# Agent Intelligence Registry

The Agent Intelligence Registry stores host-independent Agent Profiles and reusable Intelligence Packs. It does not create or run agents.

## Canonical records

- agentProfiles is the Profile index; agentProfileVersions stores immutable version documents.
- intelligencePacks is the Pack index; intelligencePackVersions stores immutable version documents.
- The first approved Composite Pack is marketing-creative-cognition (Marketing & Creative Cognition). Its five cognition areas are components within one Pack, not separate personas or operating modes.
- The Registry uses the existing AGENT_IDEAS_DATABASE_ID Document DB selection, including the Firestore/Turso adapter. It does not reuse intelligence_raw_documents, chatSkills, Agent HQ Methods, characters, or Contexts as Registry collections.

Each root index holds summary, status, and currentVersionNumber. A version document is immutable and uses the ID plus a six-digit version suffix. Version writes require expectedCurrentVersion and confirm=true; stale writers and attempted version replacement are rejected.

## Agent Profile

An Agent Profile is one integrated identity. The identity object should describe the coherent combination of worldview, values, epistemology, reasoning, judgment, expression and behavior. Organizing those attributes into fields does not create separately switchable modes.

intelligencePortfolio contains available Pack references. It is not a list of Packs that should always be loaded. An optional versionNumber pins a Pack to an exact version.

## Intelligence Pack

A Pack defines reusable cognition: purpose/scope, applicability, world model, epistemology/evidence standards, input contract, reasoning procedures, evaluation criteria, contribution contract, dependencies, limits and failure modes.

A Composite Pack may contain components. The calling agent selects the components relevant to the task. A component is not a separate identity. Skill/Method/Tool/Knowledge/Policy bodies remain with their canonical systems and are referenced rather than copied into the Pack definition.

## Composition and Bundle Resolver

The Agent Profile-aware calling agent is responsible for understanding the task and selecting the minimum sufficient Intelligence set/components. My Portal does not make semantic selection decisions.

cognitive_bundle_resolve validates the caller's choices, resolves exact Profile/Pack versions, loads required internal Chat Skills and HQ Method versions, and returns an ephemeral host-neutral bundle. Recommended/optional dependencies are only loaded when the caller includes resourceType:canonicalRef in selectedDependencies. External Tool/Operator/Policy/Knowledge references are returned as reference-only and are never executed or fetched by arbitrary URL.

The resolver does not:
- choose an Intelligence Pack or component;
- execute a Pack's reasoning;
- execute MCP/API tools or grant permissions;
- create, own, schedule or manage Runs;
- create a host-specific Claude/Codex/ChatGPT prompt or configuration.

Unresolvable required dependencies are returned in unresolvedGaps; they are never silently substituted. The bundle is not persisted.

## MCP operations

- agent_profile_list, agent_profile_get, agent_profile_version_create
- intelligence_pack_list, intelligence_pack_get, intelligence_pack_version_create
- cognitive_bundle_resolve
- agent_intelligence_bootstrap (idempotently creates the initial MCC Pack if absent)

No Agent Profile is pre-seeded: its substantive identity must be explicitly authored rather than invented by an implementation migration.
