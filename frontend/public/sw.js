/* Unbored service worker — offline shell + the catalog pack.
 *
 * - Navigations: network-first, fall back to the cached app shell when offline.
 * - /data/manifest.json: network-first, cached copy offline. When a new
 *   manifest arrives, pack files it no longer names are dropped.
 * - /data/<name>.<hash>.<ext>: cache-first. The hash is in the name, so a
 *   cached copy can never be stale. Precached on install, so the engine works
 *   offline from the second visit on.
 * - /api/*: never intercepted (AI calls are per request and must not be cached).
 * - Cross-origin requests (posters, fonts) are NOT intercepted: a fetch() from
 *   the worker is checked against CSP's connect-src, which doesn't list the image
 *   CDNs. Letting the browser load them keeps them under img-src/font-src.
 * - Other same-origin static assets: stale-while-revalidate.
 */
const CACHE = "unbored-v5";
const PACK = "unbored-pack";
const SHELL = "/index.html";
const MANIFEST = "/data/manifest.json";
const HASHED = /^\/data\/[a-z]+\.[0-9a-f]{12}\.[a-z]+$/;

async function precachePack() {
  try {
    const res = await fetch(MANIFEST, { cache: "no-cache" });
    if (!res.ok) return;
    const manifest = await res.clone().json();
    const cache = await caches.open(PACK);
    await cache.put(MANIFEST, res);
    await cache.addAll(Object.values(manifest.files).map((f) => `/data/${f}`));
    await prunePack(manifest);
  } catch {
    /* offline at install: the pack is cached on first use instead */
  }
}

async function prunePack(manifest) {
  const keep = new Set(Object.values(manifest.files).map((f) => `/data/${f}`));
  const cache = await caches.open(PACK);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (HASHED.test(path) && !keep.has(path)) await cache.delete(req);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(SHELL))
      .then(precachePack)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== PACK).map((k) => caches.delete(k)))
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

async function cacheFirst(request) {
  const cache = await caches.open(PACK);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function manifestNetworkFirst(request) {
  const cache = await caches.open(PACK);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(MANIFEST, res.clone());
      res.clone().json().then(prunePack).catch(() => {});
    }
    return res;
  } catch {
    const hit = await cache.match(MANIFEST);
    if (hit) return hit;
    throw new Error("offline and no cached manifest");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(SHELL)));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname === MANIFEST) {
    event.respondWith(manifestNetworkFirst(request));
    return;
  }
  if (HASHED.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
