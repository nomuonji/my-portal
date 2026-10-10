# Public CMS publication: mandatory editorial handoff

As of 2026-10-08, a draft may be published only after the active `Public Content Publishing` Method has been obtained and reviewed **for that specific draft revision**.

## Motivation

An AI may skip reading the publication Method and still call `public_content_create`, `public_content_update`, and `public_content_publish`. Natural-language instructions in a separate chat or repo are not an enforcement boundary. A privacy regex scan is also not a reader-quality review.

## Required workflow

1. **Before the first draft edit,** call `public_content_editorial_prepare(siteId,slug)`. For a new slug it returns `mode=begin_writing`; for an existing draft `mode=review_draft`. Both return the current active Method instructions, protocol and quality gates. Read the Method before starting the actual writing.
2. Carry the returned `reviewId` as `editorialSessionId` on `public_content_create` or `public_content_update` (when writing public-facing content). Creation/editing without the matching, unexpired Method session is refused by the CMS. This covers skipped instructions **at the start**, not just at publish time.
3. Edit the full draft following the Reader Contract, narrative structure, concrete walkthrough or justified reference format, terminology, fact/uncertainty and privacy rules. **After the last public-facing edit**, call `public_content_editorial_prepare` again; the new `mode=review_draft` receipt is bound to the final content fingerprint.
4. `public_content_editorial_approve(siteId,slug,reviewId,checks,reviewNotes,reviewer,confirm=true)`. Every check is true only if the reviewer actually performed it. The notes (80+ characters) should describe what a first-time reader understands and any remaining limitation. Attestation is a human/agent editorial judgment; no automatic model quality score is implied.
5. `public_content_privacy_scan` and `public_content_publish(siteId,slug,confirm=true)`. The backend verifies that the approval refers to the current draft SHA-256 fingerprint and **currently active Method version**, that the checks are complete and that approval is not stale. If the draft or Method changes, return to prepare.

## Enforcement

- The prepare operation makes an actual server-side read of `methods` and `methodVersions` (My Portal data). It returns the current Method content to the caller and creates a private writing session (before the initial draft exists) or a draft-bound review record (after it exists).
- The content create/update operations reject missing or outdated writing-session IDs. The approve operation validates the prepared record, method version, unchanged draft and completed attestations. Approval metadata is stored privately; no reviewer identity or private provenance enters the public projection.
- `public_content_publish` rejects missing, unapproved, stale, altered-draft and outdated-method receipts. It additionally retains the existing deterministic privacy scan and private/public snapshot boundary.
- There is **no new user-visible page type**. CMS drafts and published notes remain exactly the same public content model.
- Existing published snapshots remain readable; gate is enforced on new publish/re-publish operations. An existing published page may have a new draft while the old public snapshot is still displayed.
- Method changes activate automatically: on the next prepare/publish, the active Method version is resolved from My Portal rather than copied into scheduler prompts.
- The check is not a semantic proof that prose is good. A reviewer can lie; approval is recorded and attributable in the private audit record. The enforceable invariant is **no unreviewed or old-draft publication through this API**.
- Reviewer identities should be functional (e.g. `chatgpt_editor`), not personal information. Reviews are private data.

## Antonbase Notes: private editorial-angle evidence (v9+)

For `siteId=antonbase-notes`, starting with Public Content Publishing Method v9, merely passing the seven generic checks and a 80-character boilerplate `reviewNotes` is insufficient. The approval step must include **four substantive, newline-delimited private fields** in `reviewNotes`, each with a real, source-grounded explanation:

```text
sourceMotive: <why the work/story began, and what outcome was sought>
readerPull: <concrete observation/question that makes an unknown reader continue>
angleAlternatives: <at least one discarded angle, chosen approach, and reason>
leadCheck: <how the actual title/summary/first two paragraphs were tested>
```

Each field must be more than a terse placeholder. The server rejects an absent, generic or empty field before saving an editorial approval.

The server additionally rejects identical evidence repeated under different labels (ignoring whitespace and punctuation) and long same-character filler. These are narrow anti-boilerplate checks, **not automated evidence that the writing is engaging**: the editor must still compare real alternatives, read the actual lead and record the specific reason the reader will care. Other CMS sites continue to use their own genre-specific rules; old Method versions are not retroactively blocked. Additional `storyVsFacts` and `omittedPrivateContext` evidence remains required by Method guidance.

This is an **execution-accountability check, not a semantic AI quality score**. A model can still write a plausible but wrong review, so an editor must actually read the full draft and discard a weak angle. Private review evidence is never included in anonymous public content projection.

## Regression tests

`node scripts/public-cms-smoke.js` verifies that the policy rejects missing approvals, prepared-but-not-approved receipts, wrong Method version, altered content hashes, expired approvals, and incomplete checklists.

Additional integration acceptance: prepare a nonexistent slug and obtain a writing session; verify create rejects absent session and accepts the exact prepared session; prepare again for the created draft; approve; publish; confirm that editing an existing draft without a session is rejected; repeat prepare before editing, then verify re-publish fails until a new final-draft review. Repeat after activating a new Method version.

## Recovery

If the rules service or database becomes unavailable, fail closed: the previous published snapshot remains available, and editors may save a draft but cannot publish new revisions until the source of truth recovers. Do not silently bypass this gate through an alternative publish route.
