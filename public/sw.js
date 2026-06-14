const CACHE_NAME = 'prenotazione-lezioni-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((error) => {
        console.error('Service worker install failed to cache app shell resources:', APP_SHELL, error);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(event.request.url);
  } catch (error) {
    console.warn(`Service worker received malformed request URL: ${event.request.url}`, error);
    return;
  }

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, copy).catch((error) => {
              console.warn(`Service worker cache write failed for ${event.request.url}:`, error);
            });
          });
        }
        return response;
      })
      .catch((error) => {
        console.warn(`Service worker fetch failed for ${event.request.url}, using cache fallback:`, error);
        return caches.match(event.request).then((cached) => {
          if (cached) {
            return cached;
          }

          const acceptsHtml =
            event.request.mode === 'navigate' ||
            event.request.headers.get('accept')?.includes('text/html');

          if (acceptsHtml) {
            return caches.match('/index.html');
          }

          return Response.error();
        });
      })
  );
});
