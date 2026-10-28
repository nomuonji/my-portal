# Discover — lightweight personal RSS reader

`/discover` is a private RSS reader. It replaced the AI-curated "寄り道" shelf as the
main view on 2026-10-28. AI-curated picks still written by `personal_feed_*` appear in the
same stream as the source **AI選書** and follow the same retention.

## Data

| Collection | Purpose | Retention |
|---|---|---|
| `curation_sources` (default DB) | Source registry = 情報源ライブラリ. One registry for UI, MCP and the fetcher. | permanent (archive is non-destructive) |
| `discoverReaderItems` | Feed items: title, link, ≤280-char excerpt, author, feed categories, thumbnail URL, precomputed features, read/feedback state. No article bodies. | 7 days by publish date; `loved`/`saved` 30 days |
| `discoverReaderSignals` | One compact record per reacted item (`sig-<itemId>`): features, label, opened, applied evidence. | **never purged** — this is the learning data |
| `discoverReaderModel/current` | Feature counters `[feature, positive, negative]` (≤4000) derived from signals. | permanent |
| `discoverReaderModel/lastRun` | Last scheduled run summary. | overwritten |
| `personalDiscoveryFeed` (legacy AI picks) | Shown as "AI選書"; purged with the same rule by ingestion time. Reactions were converted to signals once (`discoverReaderModel/legacy-import-v1`). | 7 / 30 days |

## Reading queue (2026-10-28)

`/discover` asks for a **queue** once per filter set (`resource=discover_queue`: sort, view
unread/all/saved, type, sourceId, q). The server scores and **interleaves sources** (greedy
re-rank: score − 0.45 × same-source items among the last 8; 新着 uses recency with a lighter
penalty) and returns all ordered ids plus the first 30 items. The screen then loads further
pages by id (`resource=discover_items&ids=…`) as you scroll.

**Read on scroll:** when an item scrolls off the top of the screen, every item above the screen
is marked read (batched every 2.5 s, flushed with keepalive when the page is hidden). The 未読
view excludes read items, so the next visit doesn't repeat them. Read state is never a taste
signal. It can be turned off with the 「スクロールで既読」 toggle (stored per browser).

## Fetching

`netlify/functions/discover-reader-fetch.mts` runs `@hourly`: fetches due sources (default
interval 60 min, min 30, backs off ×4 after 3 failures), then purges. It is plain polling —
no AI calls. Each request uses HTTPS only, SSRF checks on every redirect hop (private/link-local
addresses refused), a 9 s timeout, a 2.5 MB cap, and ETag/Last-Modified. Only entries published
within 7 days are ingested; reacted items never re-enter after expiry (signal tombstone); undated
entries are remembered per source so they don't reappear.

Each source keeps `reader.seen` (ids in its latest feed snapshots, ≤400). A routine fetch only
touches the database for entries that are new to the feed (existence + signal check), then
writes one source update. In production a database round trip is ~0.7 s, so the earlier
"check every entry on every fetch" version could not finish within the 10 s/30 s function limits
and left no fetch record. `lastRun` is written at start (`status: running`) and at the end
(`status: done`, per-source `timings`), so a cut-off run is visible. Changing a source's feed URL
or archiving it deletes that source's unreacted items and resets `seen`.

Supported formats: RSS 2.0, RSS 1.0/RDF (e.g. はてブ), Atom (incl. YouTube channel feeds →
videos play inline). A site/channel page URL is resolved through `<link rel="alternate">`.

## Source registry rules (schema v2)

An `rss` source can be `active` when its feed was actually fetched and parsed
(`fetchVerification=verified`) and it is not `restricted`. Reading a public feed's
title/link/excerpt privately is the intended use of RSS, so republication-rights review is not
required for reading; it still never implies permission to store or republish bodies
(`storageScope=url_metadata_only`). Non-RSS sources keep the stricter rights-evidence gate.
New v2 fields: `category` (shelf label), `priority` (-2..+2 ranking nudge),
`fetchIntervalMinutes`, and fetcher-owned `reader.*` health fields.

## Preference learning

Signals and their weights:

- `loved` → +1 (explicit; mirrored to `personalTasteEvidence` as an item-level like)
- `skipped` → −1 (explicit; mirrored as an item-level dislike)
- `saved` → +0.5 (watch later; ranking only, never a like in the taste ledger)
- opened / clicked through → +0.25 (behaviour; ranking only)
- marking read → no signal

Features: source, host, author, feed categories, title/excerpt terms (Intl.Segmenter, kanji
kept, particles/stopwords dropped), video type. Score = Σ damped feature weights
(source/host/author/category) + term average + source priority + freshness decay over 7 days
+ a small exploration bonus for items with no learned evidence. Each item returns `why[]`.

## MCP tools

`discover_source_list`, `discover_source_test`, `discover_source_upsert`, `discover_fetch_now`,
`discover_items_list`, `discover_item_feedback`, `discover_taste_model_get`. Agents should
change sources only after the user agrees in conversation; `discover_item_feedback` records the
user's own reaction only. `portal_*` on `curation_sources` still works for raw registry edits.

## Verification

`npm run test:discover-reader` (parser fixtures, model, and an end-to-end flow against an
in-memory DB with stubbed network). Production checks: `/discover` loads, `discover_fetch_now`
returns per-source results, `discoverReaderModel/lastRun` updates hourly.
