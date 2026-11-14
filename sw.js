// Network first, cache as fallback: always fresh when online, still opens at a ground with no signal.
const CACHE = 'boundary-v18';
const FILES = ['./', 'index.html', 'css/styles.css', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/scoring.js', 'js/lbw.js', 'js/store.js', 'js/camera.js', 'js/tracker.js', 'js/ground.js', 'js/voice.js', 'js/drs.js', 'js/hawkview.js', 'js/auth.js', 'js/firebase-config.js', 'js/form.js', 'js/pose.js', 'js/formview.js', 'privacy.html', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // 'reload' skips the browser's own cache, so an update never installs stale files.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // 'no-cache' makes the browser check with the server every time, so a fix reaches phones on the next open.
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      // Only whole, successful responses can be stored. Partial ones (video seeking) cannot.
      if (res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
