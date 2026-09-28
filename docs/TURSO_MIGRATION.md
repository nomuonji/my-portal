# Turso migration

My Portal keeps Firebase Authentication but can move its document data from Firestore to Turso.

## Architecture

- Firebase Auth remains the login source.
- Server stores use `functions/documentDb.js`.
- Browser data calls use `src/documentDbClient.js`.
- `PORTAL_DB_BACKEND=firestore` keeps the current server behavior.
- `PORTAL_DB_BACKEND=turso` routes server/MCP data to Turso.
- `REACT_APP_PORTAL_DB_BACKEND=turso` routes the browser UI through the authenticated Netlify document API.
- Firestore is not deleted by the migration.

Turso stores Firestore-compatible documents in one SQLite table keyed by the full Firestore collection path and document ID. This intentionally preserves the current schema first; high-value collections can be normalized into dedicated SQL tables later without blocking the migration.

## Required secrets

Create a Turso database and configure these values directly in the local shell / Netlify environment. Do not paste tokens into chat or commit them.

```text
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

The migration script also needs existing Firebase Admin credentials:

```text
FIREBASE_SERVICE_ACCOUNT_JSON={...}
```

For production cutover add:

```text
PORTAL_DB_BACKEND=turso
REACT_APP_PORTAL_DB_BACKEND=turso
REACT_APP_PORTAL_DB_POLL_MS=15000
```

The browser never receives the Turso token. It continues to authenticate with Firebase and calls `/api/document-db`; the Netlify Function owns the Turso credentials.

## Quota-safe migration

The apply migration is resumable. It stores local progress in `.turso-migration-checkpoint.json`, including:

- each discovered collection/subcollection path
- the last successfully copied Firestore document ID
- source/target document counts and verification status

The checkpoint contains no service-account JSON, Turso auth token, or raw Turso URL. The target URL is stored only as a short SHA-256 fingerprint. The checkpoint is gitignored.

If Firestore returns a quota/resource-exhausted error, or the configured per-run read budget is reached, the script exits with code 75 after preserving the checkpoint. Run the same command later to resume from the saved position.

### Recommended path while Firestore quota is constrained

Do **not** run a dry-run first: a dry-run reads the source again and therefore wastes scarce Firestore reads.

Set a conservative per-run document budget and apply directly. `40000` leaves headroom below the Firebase free-tier daily document-read allowance for other app traffic and query minimum charges.

Bash / WSL:

```bash
export TURSO_DATABASE_URL='libsql://...'
export TURSO_AUTH_TOKEN='...'
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
export MIGRATION_READ_BUDGET=40000
npm run migrate:turso -- --apply
```

PowerShell:

```powershell
$env:TURSO_DATABASE_URL = 'libsql://...'
$env:TURSO_AUTH_TOKEN = '...'
$env:FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account",...}'
$env:MIGRATION_READ_BUDGET = '40000'
npm run migrate:turso -- --apply
```

If the process prints `[PAUSED]`, leave `.turso-migration-checkpoint.json` in place. After Firestore quota resets, run exactly the same command again.

Use a different checkpoint path only when intentionally running a separate migration:

```text
MIGRATION_CHECKPOINT_FILE=.migration/my-portal.json
```

To discard all saved progress and start from the beginning:

```bash
npm run migrate:turso -- --apply --reset-checkpoint
```

Do not use `--reset-checkpoint` merely because quota was exhausted.

### Multiple Firestore databases

By default the source database is `(default)`. If data still exists in more than one Firestore database, list them explicitly **from the first run and keep the value unchanged for every resume**:

```bash
FIRESTORE_SOURCE_DATABASE_IDS="(default),agent-ideas" npm run migrate:turso -- --apply
```

The checkpoint rejects a changed source-database list or a changed Turso target to prevent accidentally resuming into the wrong database.

Do not include two source databases that contain conflicting collection/document IDs unless the intended result is for the later source to replace the earlier one.

## Optional dry run

When read quota is not a concern:

```bash
npm run migrate:turso
```

Dry-run mode does not write Turso and does not create/resume a checkpoint. It recursively scans Firestore and reports source counts.

## Completion and verification

For each collection the apply migration compares the number of source documents copied with the count currently stored in Turso. A successful completed collection is printed as `[OK]`. Count mismatches are printed as `[MISMATCH]`, included in the final JSON summary, and make the command exit non-zero.

Firestore remains unchanged.

For the cleanest final snapshot, avoid editing My Portal while the last migration run is completing. The migration is a forward copy; it does not delete Turso rows that were deleted from Firestore after an earlier partial run.

## Server-first verification

Set only the server variables first:

```text
PORTAL_DB_BACKEND=turso
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
```

Keep `REACT_APP_PORTAL_DB_BACKEND` unset during this stage. MCP, Agent HQ, Agent Ideas, and server APIs can then be verified against Turso while the ordinary browser boards still use Firestore.

## Browser cutover

After server verification, set:

```text
REACT_APP_PORTAL_DB_BACKEND=turso
```

and rebuild the React app. Existing UI code uses the compatibility client. Former Firestore snapshot listeners become authenticated Turso queries with local write invalidation plus a 15-second polling fallback instead of persistent Firestore listeners.

### Temporary local build + manual Netlify deploy

While Netlify build minutes are exhausted, build on the local machine and upload the prebuilt result with Netlify CLI instead of asking Netlify to run the build.

The React flag must be present **during the local build** because Create React App embeds `REACT_APP_*` values into the bundle.

Bash / WSL:

```bash
export REACT_APP_PORTAL_DB_BACKEND=turso
export REACT_APP_PORTAL_DB_POLL_MS=15000
npm ci
npm run build
npx netlify deploy --prod --dir=build --functions=netlify/functions
```

PowerShell:

```powershell
$env:REACT_APP_PORTAL_DB_BACKEND = 'turso'
$env:REACT_APP_PORTAL_DB_POLL_MS = '15000'
npm ci
npm run build
npx netlify deploy --prod --dir=build --functions=netlify/functions
```

Keep the server-only Turso credentials in Netlify runtime environment variables; never put `TURSO_AUTH_TOKEN` in a `REACT_APP_*` variable.

## Rollback

Before browser cutover, rollback is immediate: set `PORTAL_DB_BACKEND=firestore` and leave `REACT_APP_PORTAL_DB_BACKEND` unset.

After Turso accepts new writes, Firestore is no longer automatically current. A later rollback must first copy the post-cutover Turso changes back to Firestore or those new writes would be absent. For that reason, keep Firestore intact until the Turso cutover has been verified and backed up.

## Optional separate hobby Firebase project

`REACT_APP_HOBBY_FIREBASE_CONFIG_JSON` can point the Hobby board at a different Firebase project. The standard migration script uses the service account for the main Firebase project and cannot silently migrate a separate project. If that environment variable is in use, migrate that project's `hobbies` / `hobby_tags` data with credentials for that project before enabling the browser-wide Turso flag.
