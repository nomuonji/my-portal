# Consumer Models migration — 2026-11-18

My Portal owns audience research, independent of reusable reasoning Intelligence Packs.
This is stage 1, not a cutover. Keywords' source remains intact and canonical until
the local SQLite export, delta comparison, and consumers' endpoint switch are verified.

## Stage 1: copy and verify
The authorized owner requested complete relocation. 44 Firestore documents (5 current
models, 28 immutable versions, 11 aliases) were read from the live Keywords database and
saved byte-for-byte at the data level in archived My Portal migration snapshots. Six
repository seed files (426 input items), separately labeled **not a live SQLite export**,
were also captured. Exact original data stays in the private database, not Git.
The importer recreates the native collection paths, checks counts, cross-references,
seed file Git blob hashes, rejects overwritten/conflicting records, verifies readback,
and records a migration manifest. It does not delete the old records or change operators.

The one-time production-only Netlify flag CONSUMER_MODEL_SNAPSHOT_IMPORT=2026-11-18
runs the importer after build/tests. Alternatively the authenticated MCP import can
be called with explicit confirmation. The marker makes subsequent deploys no-ops.
The importer does not support merging with pre-existing divergent records.

## Before declaring complete
- Export every row of Keywords local consumer_model_seeds and consumer_model_observations
  incl. timestamps, provenance, status, IDs and labels. Compare live database vs repository
  files; do not fill missing observations from guesses. Copy exact rows to dedicated
  My Portal collections, verify all rows and counts; preserve file provenance.
- Capture and reconcile any Firestore source delta since the staging time; stop writes to
  old model storage during cutover. Add versioned writes with optimistic concurrency and
  immutable history to My Portal, and compatible model/seed/evidence reads for Keywords.
  Explicitly select model IDs per research run, preserve old discovery and treasury lineage.
- Verify end-to-end local and remote Keywords callers against the My Portal registry
  before changing the World Home route and retiring old write access.
- Do not delete originals until verified cutover; retain an inert rollback snapshot.
- The new UI and MCP are read-only research access during migration, not proof of cutover.

## Owner-approved scope revision (2026-11-18)
The unverified local SQLite rows are legacy and no longer a blocking requirement. Preserve them if available; do not claim their contents were copied. Future model authoring uses My Portal's revision-checked save and immutable versions. The approved flappe-consumer v0.1 is seeded from a private DB staging record; it is an unvalidated interpretation of a single anonymous article, not demographic evidence. Keywords cutover remains a separate verified step.
