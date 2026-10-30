# Job Opportunities Database

The dedicated `job_opportunities` collection stores real, public online-work opportunities, separate from generic My Portal Opportunities and user Thinking Space idea records. It uses the shared document database adapter, so it is supported by the configured Firestore or Turso backend without a new paid service or separate database credentials.

## Record identity and updates

- `sourceUrl` must be an HTTPS URL without embedded credentials.
- Stable ID: `job_` + the first 32 hexadecimal characters of SHA-256 over the canonical URL (tracking parameters and fragment removed).
- Repeated `job_opportunity_upsert` calls for the same canonical URL update the same record and refresh `lastVerifiedAt`; they do not create duplicates.
- A record stores only public job metadata and data-minimization notes. Do not store applicant personal details, submitted CVs, account tokens, private messages, or any real user identifiers.
- Status values: `active`, `watching`, `paused`, `closed`, `rejected`, `completed`. Use `watching` when location eligibility, pay, or privacy terms remain unverified; `active` requires an actual current official listing.
- In `attributes.requiredApplicantData`, store whether each field is required/optional/unknown, not the user's actual name, email, phone, address, account ID or identity documents.
- Always record a public official source URL, observation time, evidence/unknowns, and privacy risks. Do not assume a role is safe simply because the listing does not disclose an access request; mark access scope as unknown where necessary.

## Tools

- `job_opportunity_search`: search by text and optional status.
- `job_opportunity_get`: read by deterministic ID or official URL.
- `job_opportunity_upsert`: create or refresh a record using URL-based idempotency.

## Verification

Run `npm run test:job-opportunities` for URL canonicalization, stable IDs, schema constraints, sensitive URL rejection, and tool exposure. The suite is included in the Netlify prebuild checks.
