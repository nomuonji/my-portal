# Agent-side architecture: which registry answers which question

Every agent-side record belongs to exactly one layer. The layer is chosen by the question the record answers. `world_map_get` returns this table as `layers`.

| Question | Layer | Holds | Read with |
|---|---|---|---|
| Where does this work live, and what is canonical? | World Home | routes, projects, Agent Guide | `world_map_get` |
| What are the numbers and the actual data? | Operator / Repo | measurements, inventory, published state | each Operator |
| What has been decided in this project, and where are we? | Context | purpose, decisions, corrections, current state, next actions | `context_list`, `context_get` |
| Where does this exploration stand? | Exploration Base | outcome contract, method version, hypotheses, constraints, runs | `exploration_base_get` |
| How is it done? | Chat Skill | procedures | `chat_skill_get` |
| How is it judged? | Agent Profile / Intelligence Pack | how evidence is read, domain model, known failure modes; no steps or thresholds | `cognitive_bundle_resolve` |
| What is the contract for scheduled or delegated work? | HQ Method | Manager/Worker contracts only | `method_get_context` |
| What are the person's long-running themes? | Thinking Space | human thinking; no chat logs or agent state | `space_get_context` |

## Rules

- Nothing is written in two layers. When two layers seem to fit, pick the one whose question the record answers and link from the other.
- A procedure is a Chat Skill even when it began as an HQ Method. HQ Methods are for Manager/Worker runs.
- State that changes run by run never goes into a Pack or a Skill. Project state goes to a Context; exploration state goes to an Exploration Base.
- Promotion goes upward and slowly: a hypothesis in a base becomes Pack cognition only after it has held across explorations or method versions.

## Entry point

`world_map_get` returns an index (about a quarter of the former payload). Records are read on demand with the tool of their layer. `world_map_get({detail:"full"})` returns every field and is rarely needed.
