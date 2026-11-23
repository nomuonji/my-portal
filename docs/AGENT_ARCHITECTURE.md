# Agent-side architecture: which registry answers which question

Every agent-side record belongs to exactly one layer. The layer is chosen by the question the record answers. `world_map_get` returns this table as `layers`.

## Canonical model: three concepts

There are **three conceptual entities**, not four peer layers:

1. **Agent Profile** — one default, cross-task identity: stable reasoning principles, values, behavior and authority boundaries. It is a setting, not an Agent Character or a selectable creative Mode.
2. **Intelligence** — reusable domain-specific world models and rules for interpreting evidence (for example MCC). It does not own an ordered production workflow, tool execution or Dojo ratings.
3. **Skill** — a procedure that produces a deliverable. An **atomic Skill** does one job; a **Skill Pack is a composite Skill** that chooses and sequences shared Skills. Pack is a subtype, not a fourth fundamental concept. A legacy coordinator Skill can remain as a compatibility entrypoint until the Dojo supports Pack releases.

Dojo is the independent training/version authority, Agent HQ is run governance, and Character/SNS Persona describes a fictional or publishing actor. Neither is a fourth cognitive capability concept. Avoid separate Personas/Modes/Orchestrator types at this layer.

**Ownership test:** agent-wide default principle → Profile; cross-task evidence interpretation → Intelligence; steps/tools/input→output → Skill; multiple Skills in one workflow → composite Skill/Pack; H/T, ratings and releases → Dojo; job status → HQ.

### Inventory and intended consolidation (2026-11-24)

| Current record | Intended home |
|---|---|
| reality-grounded-integrative-agent | One default Agent Profile; do not multiply specialized identities |
| marketing-creative-cognition (MCC) | Intelligence, retaining its market/audience/creative/commercial lenses |
| treasure-keyword-intelligence | Intelligence: search and commercial evidence interpretation |
| human-md-creative-intelligence | Optional Intelligence; consider merging with MCC creative lens only after comparative evidence |
| exploration-operations | Shared Dojo operating policy, not domain Intelligence |
| monetization-intelligence | Composite Skill / Monetization Pack |
| youtube-view-growth-intelligence | Composite Skill / YouTube concept Pack |
| video-production-intelligence | Composite Skill / finished Video production Pack |
| viral-post-pack | Already a composite Skill; buzz-content-ideation remains a compatibility adapter |

Do not merge YouTube concept and video production just because both use video: their outputs and Dojos differ.

### Migration rules

- Present a single **Skills** category with atomic/Pack subtypes, **Intelligence** as separate domain lenses, and **Agent Profile** under default settings. Do not add a new Registry, Capability or Orchestrator layer merely for renaming.
- Preserve old DB/API IDs and immutable versions. The names intelligencePacks and skillPacks are legacy physical storage, not additional conceptual distinctions.
- For the three workflow-shaped legacy Intelligences, extract actual stages and references into composite Skills **without copying their full bodies into competing live records**. Keep cognitive principles in Intelligence only if reusable beyond that workflow.
- Existing explorationBaseStore release targets are chat_skill and intelligence_pack; skill_pack is not yet a trainable target. Migrate no Dojo pointer until Pack version release/resolution can preserve human evaluation history, pinned approved versions and all original gates.
- Repoint consumers only after verifying live execution; retire old Intelligence aliases last, when no live Dojo, Submarine or client references remain. Do not overwrite trial verdicts or silently release unreviewed versions.

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
- State that changes run by run never goes into a Skill Pack, an Intelligence, or a Skill. Project state goes to a Context; exploration state goes to an Exploration Base.
- Promotion goes upward and slowly: a hypothesis may revise an individual Skill or the Skill Pack's composition after independent evidence and the corresponding release gate. General world-model claims become Intelligence only after evidence across contexts; do not conflate those with production steps.

## Entry point

`world_map_get` returns an index (about a quarter of the former payload). Records are read on demand with the tool of their layer. `world_map_get({detail:"full"})` returns every field and is rarely needed.

## Editing long stored texts

Routine job instructions, Chat Skill bodies and the Agent Guide accept exact-match partial edits (`instructionEdits`, `bodyEdits`, `agentGuideEdits`): a list of `{find, replace}` where every `find` must occur exactly once. Intelligences (legacy Intelligence Packs) and Profiles have `intelligence_pack_version_derive` (dependency rewrites) and `agent_profile_version_derive` (portfolio changes), which copy the rest of the definition on the server. Use these for small changes; resending a whole text to change one sentence invites silent transcription errors.

Write tools answer with what changed. `context_save` returns the saved Context and an event count, and `world_map_update` returns the compact map; read full histories with `context_get`.

