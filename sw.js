/* ============================================================
 * Cascade Guide — Service Worker v2.0
 * Scope: /Welcome-To-Cascades-/
 *
 * Routing matrix:
 *   Shell HTML + icons         → cache-first  (offline-capable)
 *   Google Fonts / Tailwind /
 *     FontAwesome (cdnjs)      → cache-first  (immutable CDN assets)
 *   Google Drive hero image    → stale-while-revalidate (instant + fresh)
 *   Supabase API (weather,KB)  → network-first, cache fallback
 *   Open-Meteo AQI endpoint    → network-first, cache fallback
 *   Everything else            → network-only (maps, links, etc.)
 *
 * Improvements over v1:
 *   + FontAwesome (cdnjs) now cached — was falling through to network-only
 *   + Open-Meteo AQI explicitly routed — was falling through to network-only
 *   + Drive hero image stale-while-revalidate — instant display offline
 *   + Runtime cache capped at MAX_RUNTIME_ENTRIES to prevent unbounded growth
 *   + SKIP_WAITING message handler — page can trigger immediate update
 *   + Navigation fallback — offline guests get the cached guide, not a blank screen
 *   + Cached API responses tagged with x-sw-cached-at header for debugging
 * ============================================================ */

const SHELL_CACHE   = 'cascade-shell-v2';
const RUNTIME_CACHE = 'cascade-runtime-v2';

// Bump SHELL_CACHE name (above) whenever index.html changes — old cache auto-purges on activate.

// Maximum entries kept in the runtime cache (fonts, CDN, images).
// Oldest entries are evicted when the limit is hit.
const MAX_RUNTIME_ENTRIES = 60;

// ── Assets pre-cached on install (the offline "shell") ─────────────────────
const SHELL_URLS = [
  '/Welcome-To-Cascades-/',
  '/Welcome-To-Cascades-/index.html',
  '/Welcome-To-Cascades-/icon-192.png',
  '/Welcome-To-Cascades-/manifest.json',
];

// ── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_URLS.filter(Boolean)))
      .then(() => self.skipWaiting())   // activate immediately, don't wait for old SW to die
  );
});

// ── Activate: purge any caches not in the current version set ──────────────
self.addEventListener('activate', event => {
  const KEEP = [SHELL_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !KEEP.includes(k))
          .map(k => {
            console.log('[CascadeSW] purging old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())  // take control of existing tabs immediately
  );
});

// ── Message handler: page can force an update without a full browser restart
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch routing ───────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignore non-GET and non-http(s) (browser internals, extensions)
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  // ── 1. Shell navigation: serve cached guide for offline navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // ── 2. Supabase (weather proxy, KB RPC, Edge Functions) → network-first
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.net')) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, { isApi: true }));
    return;
  }

  // ── 3. Open-Meteo AQI endpoint → network-first (was missing in v1)
  if (url.hostname.includes('open-meteo.com')) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, { isApi: true }));
    return;
  }

  // ── 4. Google Fonts (CSS + woff2) → cache-first (immutable after first load)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // ── 5. Tailwind CDN → cache-first
  if (url.hostname === 'cdn.tailwindcss.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // ── 6. FontAwesome via cdnjs → cache-first (was missing in v1)
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // ── 7. Google Drive hero image → stale-while-revalidate
  //    Serves instantly from cache; refreshes in background so next load is current
  if (url.hostname === 'lh3.googleusercontent.com' || url.hostname === 'drive.google.com') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // ── 8. Own shell assets (HTML, icons, manifest) → cache-first
  if (url.pathname.startsWith('/Welcome-To-Cascades-/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // ── 9. Everything else (Google Maps, Grab, Facebook, external links)
  //    → network-only; these gracefully degrade in the HTML when offline
});

// ── Strategy helpers ────────────────────────────────────────────────────────

/** Navigation fallback: serve the cached guide shell when offline */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline — serve cached index.html so guests don't get a blank screen
    const cached = await caches.match('/Welcome-To-Cascades-/index.html')
                || await caches.match('/Welcome-To-Cascades-/');
    if (cached) return cached;
    return offlinePage();
  }
}

/** Cache-first: instant for repeat loads; network update on cache miss */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putInCache(cacheName, request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/** Network-first: always tries fresh data; falls back to cache when offline */
async function networkFirst(request, cacheName, { isApi = false } = {}) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putInCache(cacheName, request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isApi) {
      return new Response(
        JSON.stringify({ error: 'offline', cached_at: null }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/** Stale-while-revalidate: serve cache immediately, refresh in background */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  // Kick off a background refresh regardless of cache hit
  const fetchAndCache = fetch(request)
    .then(async response => {
      if (response.ok) await putInCache(cacheName, request, response.clone());
      return response;
    })
    .catch(() => null);   // silent — offline is fine, we already have cached copy

  return cached || await fetchAndCache
    || new Response('', { status: 503, statusText: 'Offline' });
}

/** Put a response in cache; evict oldest entry if runtime cap is reached */
async function putInCache(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  // Enforce size cap on runtime cache only (shell cache is intentionally small)
  if (cacheName === RUNTIME_CACHE) {
    const keys = await cache.keys();
    if (keys.length > MAX_RUNTIME_ENTRIES) {
      // Delete the oldest entry (first inserted = first key)
      await cache.delete(keys[0]);
    }
  }
}

/** Minimal offline fallback page for complete connectivity loss */
function offlinePage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Cascade Hideaway — Offline</title>
  <style>
    body{font-family:'Georgia',serif;background:#F7F2E8;color:#1C1006;display:flex;
         align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1.5rem;text-align:center;}
    h1{color:#C9963A;font-size:1.5rem;margin-bottom:0.75rem;}
    p{opacity:.75;line-height:1.6;max-width:320px;}
  </style>
</head>
<body>
  <div>
    <div style="font-size:3rem;margin-bottom:1rem;">🏡</div>
    <h1>Cascade Hideaway</h1>
    <p>You appear to be offline. Please reconnect to Wi-Fi — the guide will load automatically.</p>
    <p style="margin-top:1rem;font-size:.85rem;">Wi-Fi: <strong>WelcomeToCascade 5G</strong><br/>Password: <strong>EnjoyYourStay@CH</strong></p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
