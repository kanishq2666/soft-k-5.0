const CACHE_NAME = 'ashoka-playout-offline-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/ashoka-icon.svg',
  '/videos/ch1.mp4',
  '/videos/ch2.mp4',
  '/videos/ch3.mp4',
  '/videos/ch4.mp4',
  '/videos/ch5.mp4',
  '/videos/ch6.mp4',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && res.ok && res.status === 200) {
              await cache.put(url, res);
            }
          } catch {
            // Ignore offline precache miss
          }
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (req.headers && req.headers.get('range')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const fallbackHtml = await caches.match('/index.html');
          if (fallbackHtml) return fallbackHtml;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
