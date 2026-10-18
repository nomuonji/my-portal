# AniList @topgear — AI-operable manga/anime account

Owner profile: https://anilist.co/user/topgear/

## Live public API (zero setup)
- Official https://graphql.anilist.co; no OAuth for public records
- `anilist_profile_get` reads all custom and normal lists for both ANIME and MANGA, deduplicates by media ID, and preserves statuses and personally given scores separately (0 = unrated)
- `anilist_media_search` finds IDs, `anilist_entry_get` reads a specific user list entry.
- All reads fetch fresh official API data; do not treat a PLANNING entry as confirmation of liking. No arbitrary inferred likes or direct preference ledger promotion.

## Optional authorized writes
- `anilist_entry_save` changes exactly one media entry, only on specific user instruction. It accepts status, owner score (0–100), progress, volumes, and requires a concrete `changeReason`. It reads the old entry before changing fields and reads back AniList after mutation. No bulk writes, delete or unfollow API.
- AniList OAuth scopes **are not granular**; the owner approves broad account access. Tokens last approximately 1 year, no refresh support. Disclose the breadth and allow the user to revoke authorization at AniList.
- The client registration must be performed in https://anilist.co/settings/developer by the account owner; the assistant cannot impersonate owner approval.
- Create new API Client: Name = `My Portal`, Redirect URL = `https://my-portal-agent.netlify.app/anilist/callback`.
- Paste ONLY the numeric public Client ID into My Portal `/taste`; do not paste Client Secret (unused).
- The UI redirects using OAuth **implicit grant** and captures the URL fragment at the redirect route. The Firebase-authenticated Portal client sends the token to its authenticated server API; the server verifies `Viewer.name=topgear` and JWT expiry before storing AES-256-GCM encrypted token in `personalTasteConnections/anilist-topgear`.
- Store `ANILIST_TOKEN_ENCRYPTION_KEY` as a 32-byte Netlify secret environment variable available to Functions. Never send access tokens in MCP outputs. Reauthorize on expiry; do not silently self-approve.
- `anilist_connection_get` reports status without credentials; `anilist_entry_save` returns a clear error if OAuth not approved.

## Agent behavior
When recommending anime/manga, first call `anilist_profile_get({type:'ALL'})` and consult explicit judgments on `personalTasteEvidence`. Personal scores are stronger than just list membership; planning is only weak interest. When asked to add, mark complete or score, search IDs, inspect existing entry and call `anilist_entry_save` with user instruction and verify returned after state. This operates AniList itself, not merely a My Portal copy.

This project keeps existing Filmarks/Booklog source imports and avoids modifying their credentials or records. New MCP tool registrations may require refreshing/reconnecting the My Portal connector before they become visible in chat.
