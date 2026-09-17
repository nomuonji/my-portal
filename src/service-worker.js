/* eslint-disable no-restricted-globals */

// CRA's Workbox InjectManifest replaces this placeholder with the production
// asset manifest at build time. Keeping the service worker in src/ ensures a
// new worker is generated whenever the app build changes.
const precacheManifest = self.__WB_MANIFEST || [];
const precacheUrls = precacheManifest.map((entry) => (
  typeof entry === 'string' ? entry : entry.url
));

const revisionSeed = precacheManifest
  .map((entry) => (typeof entry === 'string' ? entry : `${entry.url}:${entry.revision || ''}`))
  .join('|');

let hash = 0;
for (let i = 0; i < revisionSeed.length; i += 1) {
  hash = ((hash << 5) - hash + revisionSeed.charCodeAt(i)) | 0;
}

const CACHE_PREFIX = 'my-portal-precache-';
const CACHE_NAME = `${CACHE_PREFIX}${Math.abs(hash)}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(precacheUrls))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations are network-first so a newly deployed index.html is visible
  // immediately when online, with the precache only as an offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => (
          (await caches.match(request))
          || (await caches.match('/index.html'))
          || (await caches.match('/'))
        ))
    );
    return;
  }

  // Hashed CRA assets are immutable, so cache-first is safe and fast.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
