# Music + film taste connectors — account control

Accounts confirmed from browser when owner logged in:
- Trakt: current account display ID `__c4a362`; authorize via Trakt official PKCE.
- Last.fm: `https://www.last.fm/user/goodhangedman`; recently 0 scrobbles.

## Trakt 
API: official `https://api.trakt.tv`. Register your own app at `https://developer.trakt.tv/apps`. Requires GitHub verification; do not use third-party credentials. Application `My Portal`, redirect `https://my-portal-agent.netlify.app/trakt/callback`; copy PUBLIC Client ID into `/taste`. Do not use a Client Secret for PKCE.
- `trakt_connection_get` shows redacted connection.
- `trakt_profile_get` live reads `/sync/watchlist`, `/sync/ratings`, `/sync/history`; first page only; do not claim exhaustive counts or turn watchlist into likes.
- `trakt_entry_add` adds one film/show to watchlist or adds an explicit 1–10 rating only on a new user instruction. ID is Trakt canonical ID, not IMDb or AniList ID. If unknown, locate via Trakt discovery or ask.
- Store access and refresh tokens encrypted at rest (HKDF domain separated from existing server credential). Trakt uses single-use refresh tokens. The owner must consent to first OAuth. Never expose tokens.
- No auto-copy of Filmarks records. A migration would need an explicit mapping and verification pass.

## Last.fm
Last.fm official read-only API. Obtain an API key at `https://www.last.fm/api/account/create`; `/taste` accepts API Key only. No API Secret needed. `lastfm_profile_get` reads user.getInfo, user.getTopArtists, user.getTopTracks, user.getRecentTracks, user.getLovedTracks; when user has no scrobbles, the system honestly shows zero. Scrobbling must be separately enabled in the listener's music app (Spotify, etc.). Listening frequency is weak behavioral evidence; `Loved` tracks are explicit positive evidence. Do not map listen counts to personalTasteEvidence direct positive scores.

## Agent usage
Before recommending films/dramas, when connected call `trakt_profile_get`; before music recommendations call `lastfm_profile_get`. Cite original source context if making claims. Only the user explicitly evaluates tastes, not generic platform favorites or completed entries. New MCP tools may require reconnecting My Portal plugin before appearing in ChatGPT.

## Privacy
No account password or Last.fm API Secret is requested. Last.fm API Key is used only server-side and not reflected in readback. Trakt access is OAuth PKCE with random state + short expiration + temporary verifier; account token encrypted at rest. No bulk ingestion of third-party data. Disconnect/revocation can be done from Trakt; official external source remains authoritative.
