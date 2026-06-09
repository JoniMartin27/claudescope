// ClaudeScope service worker — static app-shell caching only.
// 100% local: it caches the shell so the dashboard works offline, and NEVER
// caches /api/* (data changes every run). No network is touched beyond the
// same-origin shell the browser already loaded.
// Bump CACHE on every shell change so returning visitors don't get a stale
// app. The fetch handler also uses stale-while-revalidate as a second guard.
const CACHE = 'claudescope-v0.5.0';
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/report.js',
  '/styles.css',
  '/widget.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic — be tolerant if one asset is momentarily missing.
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Only ever touch same-origin requests.
  if (url.origin !== self.location.origin) return;

  // API responses are live data — always go to the network, never cache.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigations + shell assets: STALE-WHILE-REVALIDATE. Serve the cached copy
  // instantly (works offline), but always fetch in the background and update
  // the cache — so a new app.js/index.html is picked up on the next load
  // instead of being pinned to a stale shell forever.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') {
            return caches.match('/index.html').then((shell) => shell || Response.error());
          }
          return cached || Response.error();
        });
      // Prefer the fast cached copy; the network refresh updates the cache for
      // next time. If nothing is cached yet, wait for the network.
      return cached || network;
    })
  );
});
