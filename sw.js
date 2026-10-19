// Offline-cache voor de app zelf. Verzoeken naar Google/PDOK/OSRM gaan altijd via het netwerk.
const CACHE = 'ritlog-v6';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'i18n.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Netwerk eerst (zodat updates direct binnenkomen), cache als terugval.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // cache: 'no-cache' = altijd bij de server navragen of er een nieuwere versie is
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
