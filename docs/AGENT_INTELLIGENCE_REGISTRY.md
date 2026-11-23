# Agent Intelligence Registry

The Agent Intelligence Registry stores host-independent Agent Profiles and reusable **Intelligences** (historical API name: Intelligence Pack). **Skill Pack** means a composite Skill, not a fourth cognitive concept. The existing `skillPacks` registry is a compatibility implementation of that subtype; `intelligencePacks` stores reusable domain lenses. It does not create or run agents.

## Canonical records

- agentProfiles is the Profile index; agentProfileVersions stores immutable version documents.
- intelligencePacks is the **legacy-named Intelligence** index; intelligencePackVersions stores immutable Intelligence versions. Retain these IDs and APIs to avoid invalidating references.
- The first approved composite Intelligence is marketing-creative-cognition (MCC). Its five cognition lenses are not a Skill Pack, personas, or operating modes.
- The Registry uses the existing AGENT_IDEAS_DATABASE_ID Document DB selection, including the Firestore/Turso adapter. It does not reuse intelligence_raw_documents, chatSkills, Agent HQ Methods, characters, or Contexts as Registry collections.

Each root index holds summary, status, and currentVersionNumber. A version document is immutable and uses the ID plus a six-digit version suffix. Version writes require expectedCurrentVersion and confirm=true; stale writers and attempted version replacement are rejected.

## Agent Profile

An Agent Profile is one integrated identity. The identity object should describe the coherent combination of worldview, values, epistemology, reasoning, judgment, expression and behavior. Organizing those attributes into fields does not create separately switchable modes.

The legacy field `intelligencePortfolio` lists optional Intelligence references, not workflow Packs. They are not all loaded for every request; an optional versionNumber pins an immutable Intelligence version.

## Intelligence (legacy API: Intelligence Pack)

An Intelligence defines reusable domain cognition: purpose/scope, applicability, world model, epistemology/evidence standards, input contract, reasoning procedures, evaluation criteria, contribution contract, dependencies, limits and failure modes.

A composite Intelligence may contain internal lenses. The agent selects only relevant lenses. This does **not** create a workflow or distinct persona. Skill, Method, Tool, Knowledge and Policy bodies remain canonical elsewhere; Intelligence may refer to their expertise but should not own their task sequence.

## Composition and Bundle Resolver

The calling agent has one default Agent Profile and selects only the Intelligences that matter for the task. My Portal does not make semantic selection decisions.

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

## Exploration Bases

Intelligences hold reusable domain judgment across changing methods. Composite Skills (called Packs in the UI) own executable production workflows. State that moves during an exploration (outcome contract, method version, hypotheses, constraints, runs) lives in an Exploration Base; see EXPLORATION_BASE.md. A Pack references a base with a dependency of resourceType exploration_base and never copies its content.
