const CACHE_NAME = 'yao-collection-v47';
// Local previews must never replay development HTML, HMR tokens or TS modules.
// The downloadable, self-contained HTML remains available for offline practice.
const LOCAL_PREVIEW = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(self.location.hostname)
  || self.location.hostname.endsWith('.localhost');
const ownCache = (key) => /^(yao-competition-|yao-collection-)/.test(key);
const developmentPath = (path) => /\/(?:@vite|@id|@fs|@react-refresh|__vite|__vinext|node_modules)(?:\/|$)/.test(path)
  || /\.(?:tsx?|jsx)(?:$)/.test(path);
const CORE_ASSETS = [
  './',
  './competition-config.js',
  './pattern-current.html',
  './desktop.html',
  './nfc.html',
];
// Only cache the small entrance shell on install. Pictures are cached when
// actually viewed, rather than downloading unrelated multi-megabyte images.
const readCached = async (request) => {
  const current = await caches.open(CACHE_NAME);
  return current.match(request);
};

self.addEventListener('install', (event) => {
  event.waitUntil((LOCAL_PREVIEW ? Promise.resolve() : caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(CORE_ASSETS)).catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Preserve deployed offline bundles until a complete newer bundle is cached.
    // Only the broken local development cache needs immediate removal.
    caches.keys().then((keys) => Promise.all(keys.filter((key) => LOCAL_PREVIEW && ownCache(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'yao-preview-version') {
    event.ports?.[0]?.postMessage({ version: CACHE_NAME, localPreview: LOCAL_PREVIEW });
  }
});

self.addEventListener('fetch', (event) => {
  if (LOCAL_PREVIEW || event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || developmentPath(url.pathname)
    || /\/(api|current|patterns|health)(\/|$)/.test(url.pathname)) return;
  if(event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if(response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy)); }
      return response;
    }).catch(async()=> (await readCached(event.request)) || (await readCached(url.pathname.endsWith('pattern-current.html')?'./pattern-current.html':'./')) || (await caches.match(event.request)) || new Response('请联网打开一次展馆后再离线访问。',{headers:{'content-type':'text/plain;charset=utf-8'}})));
    return;
  }
  event.respondWith(
    readCached(event.request).then((cached) => {
      // Images/fonts and content-hashed bundles are reused with no background
      // redownload. Config still refreshes so a cached API setting cannot stick.
      if (cached && /\.(?:webp|png|jpe?g|svg|gif|woff2?)$/i.test(url.pathname)) return cached;
      if (cached && /\/assets\/[^/]+-[\w-]+\.(?:js|css)$/.test(url.pathname)) return cached;
      const network = fetch(event.request)
        .then(async (response) => {
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = response.clone();
            try { await (await caches.open(CACHE_NAME)).put(event.request, copy); } catch {}
          }
          return response;
        })
        .catch(() => cached || new Response('', { status: 503 }));
      return network;
    }),
  );
});
