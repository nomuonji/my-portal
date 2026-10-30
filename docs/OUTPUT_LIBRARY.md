# Output Library

My Portal's Output Library stores AI/human-created deliverables independently from social posts, ideas, and public publishing.

## Data model

- \`outputs\`: stable identity and mutable catalogue metadata (title, free-form type, summary, tags, metadata JSON, lifecycle, current version pointer, aggregate rating).
- \`output_versions\`: immutable content snapshots. Every content edit creates a new version. A version stores format, optional external URL, change summary, model, prompt notes, and creation time.
- \`output_feedback\`: immutable, version-specific evaluations. Each record stores an overall 1–5 score, extensible dimension scores, verdict, notes, strengths, and improvements.

The collections live in the existing default My Portal document database, so Firestore and the existing Turso-compatible document layer use the same data model. Binary media should be stored externally and referenced by URL; arbitrary type-specific attributes belong in the metadata JSON object.

## Rules

- Never overwrite a saved version's content. Use \`output_version_create\`.
- Never rewrite a saved evaluation. Add another \`output_feedback_add\` record for a new judgment.
- Evaluation always points to a specific \`versionId\`; newer versions do not inherit older scores.
- \`type\` is a free-form string. Common values include \`song\`, \`lyrics\`, \`article\`, \`video\`, \`script\`, \`image\`, \`code\`, and \`prompt\`.
- Metadata is intentionally extensible. Example for music: \`genre\`, \`sunoStylePrompt\`, \`tempo\`, \`vocalType\`. Example for video: \`duration\`, \`aspectRatio\`, \`sourceAssets\`.
- Archiving hides a deliverable from the active working set but preserves every version and evaluation.

## My Portal MCP

- \`output_list\`: find existing outputs.
- \`output_get\`: read a deliverable with version and feedback history.
- \`output_create\`: create the record and initial version atomically.
- \`output_version_create\`: append a new version with a transactionally allocated version number.
- \`output_feedback_add\`: append a score/feedback record to one exact version.
- \`output_update\`: update catalogue metadata or archive status; content remains version-controlled.

The authenticated \`/outputs\` screen provides the same workflows visually.
