// Knot & Thread Tales — Service Worker
// Bump this on every deploy that changes cached files, same idea as the
// ?v=20260721 query strings already used on styles.css/app.js/config.js.
const CACHE_VERSION = 'ktt-v20260926';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=20260721',
  './config.js?v=20260721',
  './app.js?v=20260721',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests — this leaves the Supabase API
  // (product data, prices, stock) and any third-party requests to hit the
  // network directly and unmodified, so catalog data never goes stale from
  // a cache.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // Hash-router SPA: every in-app "page" is really index.html. For
  // navigations, try the network first so visitors get the latest deploy,
  // falling back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache-first, refreshing the cache in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
