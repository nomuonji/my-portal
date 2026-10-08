# Public CMS: additive multi-site publishing

## Ownership

My Portal is a **headless content service**. The public app at `notes.antonbase.com` is only one consumer; it is not the CMS itself. Existing documents in the four websites remain unchanged unless a separately authorized repository engineering change is made.

| CMS site ID | Frontend | CMS route | Excluded repo-owned routes |
| --- | --- | --- | --- |
| antonbase-notes | nomuonji/antonbase-notes | /notes/ | existing pages |
| culture-institute | nomuonji/trend-blog | /features/ | /articles/ (Groq), /research/ (local records) |
| kaisha-compass | nomuonji/kaisha-compass | /features/ | /journey/, /topics/, /resources/ |
| knowledge-institute | nomuonji/learning-os | /features/ | /notes/, question bank, study history |

`siteId` is mandatory for the public list/get endpoint. Published-only projection already excludes drafts, private editorial review, sourceRefs, and internal SEO research. Each site only reads its own ID.

The site registry now includes `publicationContract` with `routePrefix`, `owner`, `mode='additive'`, `editorialScope`, and `excludedPaths`. Publication contracts are supplied by `public_content_editorial_prepare` along with the **current** global editorial Method so that each worker reads the additional site-specific constraints before editing. A contract is routing metadata, not permission to skip the mandatory editorial gate.

## Safety and quality

- The shared CMS stores distinct site-specific published snapshots. Never let Agent HQ write the Groq-controlled Markdown corpus, Kaisha's hardcoded journey data, or Learning OS's native Turso question/progress DB.
- Preserve the full prepare -> edit -> prepare -> approve -> privacy-scan -> publish lifecycle. Site-specific factual editorial review remains the producing organization's responsibility; default reader-facing Method alone is not an adequate legal/finance research check.
- `public_site_upsert` modifies registry metadata and **does not** publish content. A new entry can be active with zero articles.
- Do not move artifacts blocked by runtime safety checks into the CMS merely to evade the refusal. Private Artifact persistence and public CMS publication are different operations.
- A CMS entry may be surfaced only in its frontend's additive namespace. Do not merge it into Groq `/articles/`, native Learning OS `/notes/`, or Kaisha's fixed scene routes.
- Per-site build hooks are optional. SSR frontends fetch on demand and do not need a rebuild for article edits. Static consumers, such as Antonbase Notes, require a build hook or deployment before new pages appear.
- Frontend route semantics, sitemap coverage and 404s remain the responsibility of the site repository. A working `/api/public-content` does not prove an SSR deployment has shipped.

## Cutover check

1. Register sites with `public_site_upsert`. Keep `antonbase-notes` unchanged.
2. Deploy compatible CMS reading routes for each frontend and confirm with live anonymous GET. Verify existing routes and Groq posts are unaffected.
3. Set per-site `publicationContract` and ensure the editor sees it via `public_content_editorial_prepare`.
4. Produce an original, independently justified CMS article under the normal publication gate. Verify public API, rendered article, metadata and internal provenance isolation.
5. Only after live verification change each Agent HQ Manager's job scope and Worker Method to **CMS-only**. Existing blocked GitHub / Learning OS native write tasks remain blocked until the manager explicitly reconciles them; do not silently mark complete.
