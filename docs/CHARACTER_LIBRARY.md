# Character Library & ImageKit storage

Route: `/characters` — signed-in users can create, update, search, archive, and associate characters with Projects and external account references. The canonical record collection is `characters` and works with the existing Firestore/Turso document adapter. The character record schema is additive and does not migrate Tweets Operator records.

## Required ImageKit setup

Add these **server-side** Netlify environment variables (Functions scope, all contexts used by the portal):

- `IMAGEKIT_PUBLIC_KEY`: ImageKit public API key (`public_...`).
- `IMAGEKIT_PRIVATE_KEY`: ImageKit private API key (`private_...`), never commit or expose via `REACT_APP_*`.

The existing `FIREBASE_SERVICE_ACCOUNT_JSON` Netlify secret must also be configured for token verification. No browser secret or build-time ImageKit variable is needed. Find the public/private keys in ImageKit Developer Options. Use a restricted upload-scoped key where the provider permissions allow it.

After setting variables, deploy the Netlify functions. The server refuses to mint upload signatures unless both ImageKit keys are configured. It verifies the Firebase ID token and verified email before returning a unique, 120-second signed upload grant. The browser uploads the original file directly to ImageKit.

**Security boundary:** Authentication is not a single-owner check: with the current Google sign-in configuration, any account that can sign in to this Firebase app and has a verified email can request an ImageKit upload grant. This single-user convenience mode removes an explicit email allowlist; it does not prevent signups by other Google accounts. If the portal is ever exposed to other users, restrict Firebase sign-in/authorization at the application level or restore a stable owner-UID check before enabling uploads for them.

## Image management

- Files upload to `/my-portal/characters/<character-id>` in the ImageKit Media Library.
- First uploaded image is the avatar; subsequent images are references, and any image may be promoted to avatar.
- Documents store the provider's `fileId`, file path, public CDN URL, filename, mime type, and role, **not** the binary bytes.
- Allowed initial types are JPEG, PNG, WebP, GIF, and AVIF; browser interface rejects files over 8 MiB. ImageKit's free plan has its own size and capacity limits.
- **Images are public by URL** in this first version. Do not upload private or sensitive material. Private ImageKit files require a separately authorized signed-delivery workflow.
- Removing an image from a character only unlinks it from the document. Actual deletion from ImageKit Media Library is manual so character edits cannot destroy originals.
- Uploaded files that fail DB association may need manual cleanup in ImageKit Media Library.

## Production checklist

1. Configure the two ImageKit Netlify keys and verify the existing Firebase Admin secret.
2. Confirm the Netlify deploy includes `/api/imagekit-auth` and the `/characters` SPA route.
3. When using Firestore as browser backend, deploy the updated `firestore.rules` separately; Netlify deploy does not apply Firebase rules.
4. Sign in with your verified Firebase Google account; create and save a character.
5. Upload a small test JPEG; reload and verify the character card, avatar, and DB asset metadata.
6. Confirm unauthenticated requests cannot receive upload grants; confirm no private key appears in browser bundles, API JSON, or logs. A verified user with access to Firebase sign-in is not blocked by this endpoint.
7. Check ImageKit storage and bandwidth in the dashboard. The free plan stops new uploads at 3 GB of DAM storage and stops delivery after its 20 GB/month traffic quota.

## Future extensions

Move to a shared, cross-domain asset catalog (`assets`) when another part of My Portal needs ImageKit, keeping stable ImageKit file IDs and ownership references. Add private file delivery, asset lifecycle/garbage collection, and version history rather than mirroring Images into Turso or Firestore. Twitter/Tweets Operator remains the owner of its own posting persona configuration; character `externalRefs` are merely links.
