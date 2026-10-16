const CACHE = 'clipsync-static-v2';
const SHELL = ['/offline.html', '/offline.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('clipsync-static-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/offline.html')) || Response.error()));
    return;
  }
  if (url.search || url.hash || request.headers.has('authorization')) return;
  const asset = SHELL.includes(url.pathname) || /^\/_next\/static\/.+\.(?:js|css|woff2?)$/.test(url.pathname);
  if (!asset) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type !== 'opaque' && !response.headers.get('cache-control')?.includes('no-store')) {
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, response.clone())));
    }
    return response;
  })));
});
