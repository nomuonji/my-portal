# Public CMS publication: mandatory editorial handoff

As of 2026-10-08, a draft may be published only after the active `Public Content Publishing` Method has been obtained and reviewed **for that specific draft revision**.

## Motivation

An AI may skip reading the publication Method and still call `public_content_create`, `public_content_update`, and `public_content_publish`. Natural-language instructions in a separate chat or repo are not an enforcement boundary. A privacy regex scan is also not a reader-quality review.

## Required workflow

1. `public_content_get`: inspect the current draft, previous snapshot and provenance.
2. `method_get_context` is useful for planning; the **enforced** retrieval is `public_content_editorial_prepare(siteId,slug)`, which fetches the active Method's current instructions, protocol, quality gates and returns a unique `reviewId` for the fingerprinted draft.
3. Read the full Method returned by prepare. Perform the Reader Contract, whole-article structural edit, terminology check, running example or justified reference structure, fact/uncertainty check, and semantic privacy check. For substantially revised content, perform another prepare **after the last edit**.
4. `public_content_editorial_approve(siteId,slug,reviewId,checks,reviewNotes,reviewer,confirm=true)`. Every check is true only if the reviewer actually performed it. The notes (80+ characters) should describe what a first-time reader understands and any remaining limitation. Attestation is a human/agent editorial judgment; no automatic model quality score is implied.
5. `public_content_privacy_scan` and `public_content_publish(siteId,slug,confirm=true)`. The backend verifies that the approval refers to the current draft SHA-256 fingerprint and **currently active Method version**, that the checks are complete and that approval is not stale. If the draft or Method changes, return to prepare.

## Enforcement

- The prepare operation makes an actual server-side read of `methods` and `methodVersions` (My Portal data). It returns the current Method content to the caller and creates a private review record.
- The approve operation validates the prepared record, method version, unchanged draft and completed attestations. Approval metadata is stored privately; no reviewer identity or private provenance enters the public projection.
- `public_content_publish` rejects missing, unapproved, stale, altered-draft and outdated-method receipts. It additionally retains the existing deterministic privacy scan and private/public snapshot boundary.
- There is **no new user-visible page type**. CMS drafts and published notes remain exactly the same public content model.
- Existing published snapshots remain readable; gate is enforced on new publish/re-publish operations. An existing published page may have a new draft while the old public snapshot is still displayed.
- Method changes activate automatically: on the next prepare/publish, the active Method version is resolved from My Portal rather than copied into scheduler prompts.
- The check is not a semantic proof that prose is good. A reviewer can lie; approval is recorded and attributable in the private audit record. The enforceable invariant is **no unreviewed or old-draft publication through this API**.
- Reviewer identities should be functional (e.g. `chatgpt_editor`), not personal information. Reviews are private data.

## Regression tests

`node scripts/public-cms-smoke.js` verifies that the policy rejects missing approvals, prepared-but-not-approved receipts, wrong Method version, altered content hashes, expired approvals, and incomplete checklists.

Additional integration acceptance: prepare an actual draft; read returned Method version; approve; publish; modify the draft; ensure re-publish now fails until a new prepare/approve. Repeat after activating a new Method version.

## Recovery

If the rules service or database becomes unavailable, fail closed: the previous published snapshot remains available, and editors may save a draft but cannot publish new revisions until the source of truth recovers. Do not silently bypass this gate through an alternative publish route.
