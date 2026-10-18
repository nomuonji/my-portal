# Personal Taste — evidence-first data model (v2)

## Canonical storage and semantics

The sole canonical user taste ledger is `personalTasteEvidence`. `personalTasteEvidenceEvents` is an append-only revision history, and `personalTasteMeta` records idempotent structural migrations. The cross-domain profile is **derived at read time**; it is not a competing editable collection.

The model has four separate layers:

1. **Source** — `sourceRefs[]` points to the original user utterance, Discover feedback item, user-authored post, reference corpus, or bookmark. Source IDs should resolve to genuine records where possible; a missing URL is not evidence for an invented asset.
2. **Evidence** — one evaluative claim or inference, with `evidenceKind`, `direction`, `domain`, `detail`, `caveat`, `confidence`, `status`, and revision history.
3. **Structure** — `target:{kind,key,label}` records the **scope of the subject**, `facets:string[]` the specific reasons/characteristics discussed, and `appliesTo:string[]` the domains for which this evidence is applicable. All three fields are optional for old clients and normalized on write.
4. **Derived profile** — `taste_profile_get` / `?resource=taste_profile` and the `profile` member of `taste_evidence_list` compute source-linked facet counts, separate single vs independent repeated evidence, and show contradictory evaluations instead of smoothing them into one score.

### The evaluation is *not* the inferred personality

- `explicit_user` + `like|dislike|boundary` needs a direct user-message or concrete Discover evaluation.
- `expression_inference` contains authored X-expression hypotheses, direction `unknown`, and at least two source posts; it is not evidence the user likes similar media.
- `external_reference` identifies external teacher/source material, not confirmed user approval.
- `watch_later` identifies bookmarks. `saved` and `seen` are not equivalent to `loved`.
- `status=superseded|archived` remains in audit history but does not count toward the current profile.
- `target.kind=item` says **this item**; `pattern` says a recurring formal characteristic; `editorial_policy` is a feed/format decision. A rejected item must not be generalized into a rejected genre without explicit separate evidence.
- `facets` are features of a judgment, not diagnostic labels like “ironic person” or “anti-mainstream”. The facet's association with likes/dislikes is counted only from direct judgments. Editorial `boundary` appears separately.

### Target types

`item`, `creator`, `genre`, `pattern`, `format`, `editorial_policy`, `unspecified`.

Old records have `unspecified` if no target is present. Optional `target.key` is the real source key or semantic pattern key, not a generated creator ID. Facet names are Unicode NFKC-normalized, deduplicated and limited to 12. Apply tags narrowly; do not tag a broad domain when the user only judged a single work.

### Profile computation and confidence

The profile counts **active, explicit user verdicts only**. An identical source reference set across records is a single independent source, even if multiple rows were created. A facet is `single` until two independent original-source sets support it; `repeated` means repeated supporting records, **not** an algorithmically certified universal preference; `mixed` means explicit like and dislike evidence both exist. Each facet retains `evidenceIds`, source count, and domains for readback.

No numeric personality score, implicit preference promotion, inferred global dislike, or hidden priority rule is allowed. Unclassified older entries count as `uncategorized`; no automatic NLP relabeling on every read. The original four source-backed 2026-10-17 corrections receive a deterministic, auditable v2 annotation only; their verdict directions remain unchanged.

The profile scan is capped at 450 recent records to bound cost. `mayBeIncomplete` explicitly flags a cap hit. As the ledger grows, add index-backed pagination or cached projections with strict provenance before claiming the profile is exhaustive.

## Collection workflow

- When the user clearly evaluates something, look for the existing target/pattern and its earlier evidence, then save an evidence record linking the original utterance, its narrow target, facet(s), and caveats.
- Record a new independent evaluation as a new row; use revision-checked updates to **correct the same judgment**, not to absorb a genuinely new observation.
- Connect Discover's `loved`/`skipped` to item-scoped evidence. Other statuses remain unknown/non-affirmative. Avoid confusing skips for an item with genre dislike.
- For authored posts, preserve raw IDs as an expression-inference hypothesis until the user explicitly evaluates the resulting hypothesis. Do not automatically turn corpus similarity into favorite works.
- Evaluate suggestions against the read model *before* generation; retrieve `evidenceIds` for any high-impact decision and inspect exceptions and contrary cases. The final user decision overrides inferred heuristics.
- Feedback corrections are recorded in the append-only event collection, with reason and revision. Do not discard old opinions just because the current model changed.

## Scope and ownership

The My Portal `/taste` screen is the user-facing ledger; Discover, Meta, Creative Intelligence, Site Design, and Writing can read the same source-linked preference profile. They must not copy its verdicts into separate competing “taste” databases. Keywords Operator remains the canonical owner of *specific market idea ratings*; refer to those records through source IDs instead of silently transplanting all commercial votes into personal creative preferences.

## Validation checklist

- Legacy `explicit_user` without v2 fields still validates.
- Inference/reference/bookmark cannot assert likes/dislikes.
- Contradictory direct evidence remains visible; no cross-context blanket veto.
- Same source duplicated twice does not become independent repeated evidence.
- Only source-backed initial seed rows are structurally annotated.
- Verify Netlify build and connector deployment, then read back `taste_profile_get`, `taste_evidence_list`, and `/taste` before declaring production adoption.
