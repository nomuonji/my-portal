# Agent-side architecture: which registry answers which question

Every agent-side record belongs to exactly one layer. The layer is chosen by the question the record answers. `world_map_get` returns this table as `layers`.

## Canonical model: Profile / Skill Pack / Skill

Three *different* concepts remain, with a shared capability lifecycle for Skill and Skill Pack:

1. **Agent Profile** — the agent's default identity, cross-task principles, behavior and authority boundaries. No duplicate Agent Character/Modes hierarchy.
2. **Skill Pack** — an intentional composition of specialist Skills, their stages and handoffs, for a larger capability. Packs can have an `intelligence` or `workflow` specialization; each Pack is versioned and evaluated, just like a Skill, while remaining conceptually distinct.
3. **Skill** — a single reusable cognitive **or** operational capability. Thinking, observing, judgment and generating ideas are all valid Skills. `skillType=intelligence` is a specialization of Skill, not a separate registry or permission model.

**Intelligence is not a top-level concept.** It is a type label on a Skill or Skill Pack. A Skill is free to reason and judge; it does not need a separate Intelligence just to have a worldview or evaluation criteria. Extract a shared Intelligence Skill only when more than one independently useful Skill/Pack really needs the same model.

Dojo owns H/T hypotheses, genuine human pass/fail feedback and approved version selection. Agent HQ owns work scheduling and permissions. Characters and SNS Personas are creative/publishing identities, not Agent Profiles.

### Mapping of historical Intelligence IDs

| Historical ID | New conceptual owner | Migration status |
|---|---|---|
| `marketing-creative-cognition` (MCC) | Intelligence-type **Skill Pack**, five cognitive areas | Legacy immutable versions projected through `skill_pack_get` without copying bodies |
| `monetization-intelligence` | Workflow **Skill Pack** | Old stage/Skill references projected; original Dojo release version enforced in execution |
| `youtube-view-growth-intelligence` | Workflow **Skill Pack** (YouTube show/concept) | Same projection and Dojo constraints |
| `video-production-intelligence` | Workflow **Skill Pack** (finished videos) | Same projection and Dojo constraints |
| `treasure-keyword-intelligence` | Intelligence **Skill** | Move method body to `chatSkills`, keep old immutable versions as historical provenance |
| `human-md-creative-intelligence` | Intelligence **Skill** | Move body to `chatSkills`, keep old history as provenance |
| `exploration-operations` | Shared exploration/governance **Skill** | Not a separate Intelligence. Respect Dojo's existing hard release rules |
| `viral-post-pack` | Existing workflow **Skill Pack** | Continues to refer to the Dojo-released `buzz-content-ideation` coordinator and specialist Skills |

MCC should reference existing `creative-thinking`, `consumer-model-context`, `market-research-orchestrator`, etc. Do not clone their full bodies. A reusable cognitive rule already fully owned by an existing Skill should not be replicated merely to fill an "Intelligence" category.

### Non-destructive compatibility and release protection

- The collections `intelligencePacks` and `intelligencePackVersions` are **legacy immutable history and API compatibility** for earlier releases. Physical storage names do not establish an independent cognitive concept. Never delete them while Dojos, Submarines or Agent Profile portfolios still reference them.
- The `skill_pack_get` bridge returns the exact requested immutable legacy version; when asked to execute, it selects the **actual Dojo-released version**, not an unapproved latest draft. Members resolve through their own approved Skill versions.
- The release gate accepts both `chat_skill` and `skill_pack` targets, with `intelligence_pack` retained for old records. A dedicated migration operation rebinds only the three canonical workflow Dojos without rewriting the method label, human ratings, trials or history.
- Migrating the latest draft into a new Pack without approval, silently increasing pass counts or resetting H/T history is prohibited. Legacy API names may remain until all callers migrate; their presence is not evidence that Intelligence remains an independent capability layer.
- An optional Intelligence subtype is purely capability metadata. It does not grant permissions, change safety/publication policy or imply factual correctness.

## Other registries are operational storage, not cognitive concepts

World Home, Operator/Repo, Context, Exploration Base/Dojo, Agent HQ Method and Thinking Space still own navigation, actual data, state, experiments and work. These are necessary systems but not additional categories of AI capabilities.


| Question | Layer | Holds | Read with |
|---|---|---|---|
| Where does this work live, and what is canonical? | World Home | routes, projects, Agent Guide | `world_map_get` |
| What are the numbers and the actual data? | Operator / Repo | measurements, inventory, published state | each Operator |
| What has been decided in this project, and where are we? | Context | purpose, decisions, corrections, current state, next actions | `context_list`, `context_get` |
| Where does this exploration stand? | Exploration Base | outcome contract, method version, hypotheses, constraints, runs | `exploration_base_get` |
| What ability is needed, atomic or composite? | **Skill (atomic / Pack)** | reusable procedures; Pack stages, member references and dojo link, without copying bodies | `chat_skill_get`, `skill_pack_get` |
| What domain interpretation is useful? | **Intelligence** | domain world models and evidence reasoning, not task steps | `intelligence_pack_get` (legacy), `cognitive_bundle_resolve` |
| What are the agent-wide defaults? | **Agent Profile** | one default identity and stable behavior/authority boundaries | `agent_profile_get` |
| What is the contract for scheduled or delegated work? | HQ Method | Manager/Worker contracts only | `method_get_context` |
| What are the person's long-running themes? | Thinking Space | human thinking; no chat logs or agent state | `space_get_context` |

## Rules

- Nothing is written in two layers. When two layers seem to fit, pick the one whose question the record answers and link from the other.
- A procedure is a Chat Skill even when it began as an HQ Method. HQ Methods are for Manager/Worker runs.
- State that changes run by run never goes into a Skill Pack or Skill. Project state goes to a Context; exploration state goes to an Exploration Base.
- Promotion goes upward and slowly: a hypothesis may revise an individual Skill or the Skill Pack's composition after independent evidence and the corresponding release gate. General world-model claims can become reusable Intelligence Skills only after independent evidence across contexts; do not force every local judgment into another Skill.

## Entry point

`world_map_get` returns an index (about a quarter of the former payload). Records are read on demand with the tool of their layer. `world_map_get({detail:"full"})` returns every field and is rarely needed.

## Editing long stored texts

Routine job instructions, Chat Skill bodies and the Agent Guide accept exact-match partial edits (`instructionEdits`, `bodyEdits`, `agentGuideEdits`): a list of `{find, replace}` where every `find` must occur exactly once. Intelligences (legacy Intelligence Packs) and Profiles have `intelligence_pack_version_derive` (dependency rewrites) and `agent_profile_version_derive` (portfolio changes), which copy the rest of the definition on the server. Use these for small changes; resending a whole text to change one sentence invites silent transcription errors.

Write tools answer with what changed. `context_save` returns the saved Context and an event count, and `world_map_update` returns the compact map; read full histories with `context_get`.

