# Human-curated Source Library

> **2026-10-28:** this registry is now the source list of the Discover RSS reader. RSS sources become `active` once their feed is fetched and parsed (rights review is no longer required for private reading), and an hourly job fetches them. See `docs/DISCOVER_RSS_READER.md`; the "no scheduled ingestion" paragraph below is historical.

## What this stores

My Portal **情報源ライブラリ** (`/curation-sources`) stores **ongoing sources** whose items have already been selected by real human editors, juries, votes or curators. This is **not** a bookmark list of individual articles and not an automated scraper. The source registry is the authoritative catalog, separate from `reading_list_urls` and existing Agent Idea `sources` provenance.

The persistent collection is `curation_sources` in the portal's default document DB, compatible with its Firestore or Turso adapter. It is accessible to the authenticated UI and, after MCP connector schema refresh, to the usual `portal_status`, `portal_search`, `portal_get`, `portal_create`, `portal_update` and `portal_delete` tools (write tools require explicit user confirmation).

### Registry contract

- Stable ID: `curation_` + first 32 hex characters of SHA-256(canonical HTTPS source URL), avoiding duplicate entries when imported again. URL cannot change in-place; register a new source for a changed canonical URL.
- Metadata: `title`, `url`, optional `feedUrl`, `selectionType`, `selectionDescription`, `accessMethod`, `rightsStatus`, `fetchVerification`, optional `rightsEvidenceUrl`, `status`, `useCase`, `notes`, `tags`, timestamps and `schemaVersion: 1`.
- `status`: `candidate`, `active`, `paused`, `archived`. The archive action is non-destructive.
- `rightsStatus`: `unreviewed`, `permitted`, `restricted`. Never assume an RSS URL implies commercial permission or republication rights.
- `fetchVerification`: `untested`, `verified`, `failed`.
- `active` requires all of: `rightsStatus=permitted`, `fetchVerification=verified`, a factual `rightsEvidenceUrl`, and a `feedUrl` when `accessMethod=rss`. The schema validator also normalizes unproven MCP writes back to `candidate`.
- `storageScope=url_metadata_only` is forced; no raw article text, personal details, or content copies are stored in this registry.

There is deliberately **no scheduled ingestion** in this feature. "Active" means the source has been cleared for future *metadata-based* ingestion, not that the system will fetch, cache or republish full content. Any future acquisition worker must re-check permissions, robots/terms, source-specific restrictions, removal handling, rate limits and licensing itself.

## Initial suggested sources

The empty screen offers **調査済み候補6件を登録**, including MetaFilter's editorial/RSS highlights and popular comments, Not Always Right, kottke.org, Boing Boing, and デイリーポータルZの月刊新人賞. Every imported entry starts with `candidate / unreviewed / untested`, even if a feed URL is known. Import checks stable IDs and does not overwrite existing source records.

## Verification

Run `npm run test:curation-sources`, followed by `npm run build`. For manual acceptance, sign in to My Portal, visit `/curation-sources`, import the six candidates, verify search/filter, edit one, archive it, and refresh to confirm persistence. In a ChatGPT MCP connector refreshed to this deployment, use `portal_search(collection='curation_sources')` to confirm the same documents. Do not claim that UI build passing proves the production DB has data.
