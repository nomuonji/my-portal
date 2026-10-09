# MCP character image import

Use the `character_image_import` MCP tool to save a publicly available image in ImageKit and link it to an existing My Portal character.

Example tool arguments:

```json
{
  "characterId": "existing-character-id",
  "imageUrl": "https://public-image-host.example/path/to/image.png",
  "role": "auto",
  "confirm": true
}
```

- `characterId` selects an existing `characters` document.
- `imageUrl` is a public direct HTTPS image (max 8 MiB, no redirects, no IP literals or private/internal network endpoints).
- `imageBase64` is an alternative for inline images up to 3 MiB; only provide one of URL or base64.
- `role`: `auto` (first image is avatar), `avatar` (make it avatar and demote old avatars) or `reference`.
- `confirm: true` is required after the user explicitly approves this specific image. It is not authentication.

**Important:** ChatGPT `sandbox:/` paths or private `file_...` image identifiers cannot be fetched by the Netlify MCP server. The caller must supply a publicly reachable image URL or actual bytes in base64, or use a separate authorized byte-transfer mechanism. Do not report image registration until ImageKit and DB readback confirm it.

Implementation details:

- Uses the existing `IMAGEKIT_PRIVATE_KEY` on Netlify server-side. No new secrets are needed; the key is never included in tool output.
- Validates the actual image bytes (PNG/JPEG/WebP/GIF/AVIF), rather than trusting remote content-type or filename.
- For remote URLs, resolves public IPv4 DNS, pins the resolved IP for HTTPS/TLS, rejects credentials/custom ports/IP literals and does not follow redirects (SSRF guard).
- Uploads to `/my-portal/characters/<characterId>` and writes ImageKit fileId, CDN URL, filePath, type, byte size, SHA-256 and role into `characters.assets`.
- ImageKit is a public CDN: never import sensitive/private materials. File deletion remains manual.
- Checks SHA-256 for already-associated duplicates and uses an atomic Firestore/Turso transaction for DB append and avatar promotion. Separate ImageKit and DB operations cannot be a single transaction; a failed DB write after upload reports the orphan fileId for cleanup.
- Existing character data is preserved, other than `assets` and `updatedAt`.
- Call `portal_get` after import to confirm the saved asset is present.
- MCP's existing authorization controls are still necessary; the confirm flag does not confer access.

Verification: `npm run test:character-image`, also part of the `prebuild` checks.
