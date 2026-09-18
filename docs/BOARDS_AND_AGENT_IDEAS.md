# Portal Boards / Agent Ideas contract

## Portal Boards = canonical human collection

`/boards` is the canonical UI for the three short-form Portal boards.

Two-level hierarchy:

1. Large board category
   - `ideas` — 企画・ビジネス。ビジネス・企画・作りたいもの・試したいこと寄り。
   - `hobbies` — 興味・趣味。興味がある物・人・場所・作品・テーマ。
   - `stocks` — ネタ・表現。ネタ帳・大喜利・ユーモア・文体・言い回し・センスなど、感覚的な素材。
2. Tag category inside each large board
   - `tags`
   - `hobby_tags`
   - `stock_tags`

The existing `CollectionBoard` tag UI remains the source of truth for the second level.

Legacy routes `/ideaboard`, `/hobbyboard`, and `/stockboard` redirect to `/boards?board=...`.

## Agent Ideas = mirrored candidate layer

Agent Ideas does not define an independent taxonomy.

`agent_idea_categories` is synchronized from the Portal board hierarchy:

- large category: `portalBoard` = `ideas | hobbies | stocks`
- second-level category: `portalTag`
- `mirrorSource = portal`

Only Portal tags that are currently represented by visible board items are mirrored. If a Portal tag disappears, its mirrored Agent category is archived rather than deleted.

Each mirrored category can add Agent-only configuration without changing the Portal taxonomy:

- `description`
- `instructions`
- `targetCount`
- `requestedCount`
- `status` (`active | paused`)

The default target stock is 5 Agent Ideas per mirrored tag.

## Generation loop

Agents should:

1. call `idea_generation_work`
2. process only categories with `neededCount > 0`
3. follow `portalBoard`, `portalTag`, `description`, and `instructions`
4. create each candidate with `idea_create` and the returned `categoryId`
5. never write directly into Portal boards during generation

`idea_create` re-syncs the Portal mirror before writing, so deleted/stale tag categories cannot continue receiving new Agent Ideas.

## Adoption / promotion

When the user adopts an Agent Idea, call `idea_promote_to_portal` or use the UI action **本家ボードへ採用**.

Promotion:

1. creates a new short-form Portal item in the mirrored `portalCollection`
2. applies the mirrored Portal tag
3. stores provenance (`promotedFromAgentIdeaId`, `promotedFromAgentCategoryId`)
4. changes the Agent Idea status to `promoted`
5. keeps the Agent Idea in storage for history, while removing it from the normal candidate view

Promotion is intentionally different from deletion.

## Separation from Thinking Workspace

Thinking Workspace / Context Store is a separate long-running reasoning layer.

- Portal Boards: human-curated short-form collection
- Agent Ideas: AI-generated candidates mirroring Portal taxonomy
- Thinking Workspace: long-running themes, decisions, opportunities, profile context and session continuation

Do not use Agent Ideas as a substitute for a Space, and do not automatically move Space ideas into Agent Ideas.
