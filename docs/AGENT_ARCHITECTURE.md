# Agent-side architecture: which registry answers which question

Every agent-side record belongs to exactly one layer. The layer is chosen by the question the record answers. `world_map_get` returns this table as `layers`.

| Question | Layer | Holds | Read with |
|---|---|---|---|
| Where does this work live, and what is canonical? | World Home | routes, projects, Agent Guide | `world_map_get` |
| What are the numbers and the actual data? | Operator / Repo | measurements, inventory, published state | each Operator |
| What has been decided in this project, and where are we? | Context | purpose, decisions, corrections, current state, next actions | `context_list`, `context_get` |
| Where does this exploration stand? | Exploration Base | outcome contract, method version, hypotheses, constraints, runs | `exploration_base_get` |
| Which Skills make the finished product? | Skill Pack | stages, entry Skill, member Skill references, dojo linkage; never copy member bodies | `skill_pack_get` |
| How is an individual stage done? | Chat Skill | reusable procedures | `chat_skill_get` |
| How is it judged? | Agent Profile / Intelligence | how evidence is read, world models, known failure modes; no task steps | `intelligence_pack_get` (legacy name), `cognitive_bundle_resolve` |
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

