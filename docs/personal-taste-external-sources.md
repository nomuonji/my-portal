# Personal Taste — Filmarks / Booklog external source ingestion

## Linked accounts

- Filmarks Clip!: https://filmarks.com/users/postmodern137/clips
- Booklog shelf: https://booklog.jp/users/nomuman

These are **self-curated activity lists**. They are not proof of a positive preference.
Filmarks's public `Clip!` is "want to watch", not `Mark!` or a user rating. A
Filmarks work-page community average must NEVER be treated as the owner's score.
Booklog's registration is shelf activity; its reading status, user-supplied rating
(0 means not rated), and review are distinct fields.

## Data separation

- `personalTasteEvidence`: original direct user judgments, cautious expression hypotheses, references, and explicit watch-later entries; revision history unchanged.
- `personalTasteExternalSources`: **raw, user-imported snapshots**, one document per account. Nothing here automatically becomes an `explicit_user` judgment or increments taste-profile positive/negative counts.
- `taste_external_sources_list` (MCP) and `/api/agent-ideas?resource=taste_external_sources`: read source summaries (or imported items with `includeItems=true`). They are advisory input for recommendations, not new authoritative likes.
- `taste_external_import` (authenticated browser UI): validates records, normalizes stable IDs, and replaces one source snapshot idempotently using its digest. Each source is backed by the original provider URL. No credentials are received or stored.

## Import paths

**Booklog:** official desktop export `本棚 → スパナ → エクスポート` as CSV.
Client-side parser accepts comma delimiters, escaped quotes, embedded newlines, UTF-8 with BOM and Shift_JIS fallback. The 17-column export stores title, author, ISBN, registration/read dates, reading status, category/tags, and the owner's numeric rating. It does **not** send the private memo column. Review text is opt-in only.

**Filmarks:** user supplies title/movie-link pairs or copied anchor-list HTML from their Clip! page. ID must belong to `filmarks.com/movies/{id}`, and its type is `want_to_watch`. If multiple pages are needed, combine them into one import; each new import is a full snapshot, not an incremental append. Filmarks offers no verified official CSV/API export in this implementation. No periodic page polling or background scraping is introduced.

## Product behavior

The `/taste` screen always shows source links and connection status, allows an import preview and explicit save, reports imported item counts, and offers a few preview titles. No inference across genres or film/book subjects is made from a single clip, shelf entry, or star rating. Agents may use this as interest evidence when suggesting new content, but must prefer explicitly stated good/bad feedback from `personalTasteEvidence`.

## Limitations

The service stores up to 1200 rows per source and 650 KB of normalized JSON per source document. Large review payloads are rejected before writing. Automatic cross-site OAuth syncing was not authorized or implemented. Filmarks list changes and Booklog updates require a new user import. Do not claim full account synchronization, mark all watched/read based only on titles, or represent a raw rating as a personal taste verdict without separately interpreting the original numeric scale.
