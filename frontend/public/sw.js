/* Unbored service worker — conservative offline shell.
 *
 * - Navigations: network-first, fall back to the cached app shell when offline.
 * - Same-origin static assets (Vite hashed files): stale-while-revalidate.
 * - Catalog data (browse, shortlist, items): stale-while-revalidate.
 * - /api/recommend and everything else: always network (never cached).
 * - Cross-origin requests (posters, fonts) are NOT intercepted: a fetch() from
 *   the worker is checked against CSP's connect-src, which doesn't list the image
 *   CDNs, so routing them through here got them refused. Letting the browser load
 *   them directly keeps them under img-src/font-src, where they're allowed.
 *
 * This can only ever *add* an offline fallback; it never intercepts the dynamic
 * recommendation call, so a stale cache can't serve a wrong pick.
 */
const CACHE = "unbored-v3";
const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((hit) => {
      const network = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Navigations → network-first, shell fallback offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(SHELL))
    );
    return;
  }

  // Dynamic recommendation + validation must never be cached.
  if (url.pathname.startsWith("/api/recommend") || url.pathname.startsWith("/api/llm")) {
    return;
  }

  // Cross-origin (posters, fonts): don't touch it — let the browser load it
  // directly so it's governed by img-src/font-src, not the worker's connect-src.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Catalog data: serve the cached copy for speed, but always refresh behind
  // it. Cache-first was wrong here — the catalog changes with each deploy, and
  // a cached-forever copy pinned clients to an old set of rows.
  if (
    url.pathname.startsWith("/api/browse/") ||
    url.pathname.startsWith("/api/search/") ||
    url.pathname.startsWith("/api/media/")
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin static assets.
  event.respondWith(staleWhileRevalidate(request));
});
