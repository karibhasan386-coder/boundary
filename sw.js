// Network first, cache as fallback: always fresh when online, still opens at a ground with no signal.
const CACHE = 'boundary-v12';
const FILES = ['./', 'index.html', 'css/styles.css', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/scoring.js', 'js/lbw.js', 'js/store.js', 'js/camera.js', 'js/tracker.js', 'js/ground.js', 'js/voice.js', 'js/drs.js', 'js/hawkview.js', 'js/auth.js', 'js/firebase-config.js', 'privacy.html', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
