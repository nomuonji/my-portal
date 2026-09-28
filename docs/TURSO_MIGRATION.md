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

## 1. Dry-run the Firestore scan

```bash
npm run migrate:turso
```

This recursively discovers Firestore collections and subcollections and reports document counts without writing to Turso.

By default the source database is `(default)`. If data still exists in more than one Firestore database, list them explicitly:

```bash
FIRESTORE_SOURCE_DATABASE_IDS="(default),agent-ideas" npm run migrate:turso
```

Do not include two source databases that contain conflicting collection/document IDs unless the intended result is for the later source to replace the earlier one.

## 2. Copy and verify

```bash
npm run migrate:turso -- --apply
```

The copy is idempotent by collection path + document ID. After every collection is copied, the script compares Firestore and Turso document counts. It exits non-zero if any copied collection has a count mismatch.

Firestore remains unchanged.

## 3. Server-first verification

Set only the server variables first:

```text
PORTAL_DB_BACKEND=turso
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
```

Keep `REACT_APP_PORTAL_DB_BACKEND` unset during this stage. MCP, Agent HQ, Agent Ideas, and server APIs can then be verified against Turso while the ordinary browser boards still use Firestore.

## 4. Browser cutover

After server verification, set:

```text
REACT_APP_PORTAL_DB_BACKEND=turso
```

and deploy again. Existing UI code uses the compatibility client. Former Firestore snapshot listeners become authenticated Turso queries with local write invalidation plus a 15-second polling fallback instead of persistent Firestore listeners.

## Rollback

Before browser cutover, rollback is immediate: set `PORTAL_DB_BACKEND=firestore` and leave `REACT_APP_PORTAL_DB_BACKEND` unset.

After Turso accepts new writes, Firestore is no longer automatically current. A later rollback must first copy the post-cutover Turso changes back to Firestore or those new writes would be absent. For that reason, keep Firestore intact until the Turso cutover has been verified and backed up.

## Optional separate hobby Firebase project

`REACT_APP_HOBBY_FIREBASE_CONFIG_JSON` can point the Hobby board at a different Firebase project. The standard migration script uses the service account for the main Firebase project and cannot silently migrate a separate project. If that environment variable is in use, migrate that project's `hobbies` / `hobby_tags` data with credentials for that project before enabling the browser-wide Turso flag.
