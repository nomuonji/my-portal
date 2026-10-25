/*
 * In-memory cache for the portal's own GET /api/* requests.
 *
 * Every page loads its data on mount, so moving between pages re-fetched the
 * same payloads over and over. This keeps successful GET responses for a short
 * while and serves them again when a page is re-entered.
 *
 * Freshness rules (correctness over savings):
 *   - Only same-origin GET requests to /api/ with an OK response are cached.
 *   - Any non-GET request to /api/ (a save, delete, action) clears the cache.
 *   - Requests made right after a click on a <button> (e.g. "更新") go to the
 *     network, so explicit refresh buttons always return fresh data.
 *   - fetch(url, { cache: 'no-store' | 'reload' | 'no-cache' }) bypasses it.
 *   - Concurrent identical requests share one network call.
 *   - Login/logout clears it.
 */
const TTL_MS = Math.max(Number(process.env.REACT_APP_API_CACHE_TTL_MS) || 3 * 60 * 1000, 0);
const CLICK_BYPASS_MS = 2000;
const MAX_ENTRIES = 80;

const cache = new Map(); // key -> { at, status, statusText, headers, body }
const inflight = new Map(); // key -> Promise<entry|null>
let bypassUntil = 0;
let installed = false;

export function clearApiCache() {
  cache.clear();
}

function resolveRequest(input, init) {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request;
  const rawUrl = isRequest ? input.url : String(input);
  let url;
  try {
    url = new URL(rawUrl, window.location.href);
  } catch (_) {
    return null;
  }
  const method = String(init?.method || (isRequest ? input.method : 'GET') || 'GET').toUpperCase();
  const cacheMode = init?.cache || (isRequest ? input.cache : undefined);
  return { url, method, cacheMode };
}

function toResponse(entry) {
  return new Response(entry.body, { status: entry.status, statusText: entry.statusText, headers: entry.headers });
}

function remember(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

export function installApiCache() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);

  // A click on a real button (refresh, save, tab...) means "the user wants current data".
  window.addEventListener('click', (event) => {
    const target = event.target;
    const button = target && typeof target.closest === 'function' ? target.closest('button') : null;
    if (button && !button.closest('a')) bypassUntil = Date.now() + CLICK_BYPASS_MS;
  }, true);

  window.fetch = async (input, init) => {
    const req = resolveRequest(input, init);
    if (!req || req.url.origin !== window.location.origin || !req.url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const response = await nativeFetch(input, init);
      cache.clear();
      return response;
    }
    if (req.method === 'HEAD' || TTL_MS === 0) return nativeFetch(input, init);

    const key = req.url.pathname + req.url.search;
    const bypass = ['no-store', 'reload', 'no-cache'].includes(req.cacheMode) || Date.now() < bypassUntil;
    const hit = cache.get(key);
    if (!bypass && hit && Date.now() - hit.at < TTL_MS) return toResponse(hit);
    if (!bypass && inflight.has(key)) {
      const shared = await inflight.get(key);
      if (shared) return toResponse(shared);
    }

    const pending = (async () => {
      const response = await nativeFetch(input, init);
      if (!response.ok) return { response, entry: null };
      const body = await response.clone().text();
      const entry = {
        at: Date.now(),
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        body,
      };
      remember(key, entry);
      return { response, entry };
    })();
    const sharedEntry = pending.then((result) => result.entry, () => null);
    inflight.set(key, sharedEntry);
    try {
      const { response } = await pending;
      return response;
    } finally {
      if (inflight.get(key) === sharedEntry) inflight.delete(key);
    }
  };
}
