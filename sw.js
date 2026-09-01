/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER — Ryder Cup Elkofen
   ═══════════════════════════════════════════════════════════

   Zweck: Die App muss sich auf dem Platz auch ohne Empfang
   öffnen lassen. Ohne Service Worker lädt nicht einmal die
   index.html, dann hilft der beste Offline-Schnappschuss nichts.

   Cache-Namen werden aus dem SCOPE (Installationspfad) abgeleitet.
   Dadurch kann dieselbe Datei in mehreren Apps liegen, ohne dass
   sich die Aufräum-Routinen gegenseitig die Caches löschen.

   ── Strategie ──────────────────────────────────────────────
   Eigene Dateien   : network-first  (neue Version gewinnt, wenn online)
   Fremd-Bibliotheken: cache-first    (Firebase-SDK, Schriften — ändern sich nie)
   Firebase-Daten   : NIE cachen      (Live-Daten, muss immer echt sein)
   ═══════════════════════════════════════════════════════════ */

// Bei jedem neuen App-Build hochzählen — erzwingt frischen App-Cache
const VERSION = '2026-07-24x';

// Scope-abhängiger Namensraum, z.B. "_rydercup_" → getrennt von anderen Apps
const SCOPE_KEY = new URL(self.registration.scope).pathname
  .replace(/[^a-z0-9]/gi, '_');

const APP_PREFIX    = `rc_app_${SCOPE_KEY}_`;
const APP_CACHE     = APP_PREFIX + VERSION;
const VENDOR_CACHE  = `rc_vendor_${SCOPE_KEY}`;   // ohne Version: Fremdcode ist stabil

// Dateien, die die App zum Starten braucht
const APP_FILES = [
  './',
  './index.html',
  './ryder-icon-180.png',
  './ryder-icon-192.png',
  './ryder-icon-512.png'
];

// Fremd-Hosts, die dauerhaft gecacht werden dürfen
const VENDOR_HOSTS = [
  'www.gstatic.com',        // Firebase SDK
  'fonts.googleapis.com',   // Schrift-CSS
  'fonts.gstatic.com'       // Schrift-Dateien
];

// Hosts, die NIEMALS gecacht werden dürfen (Live-Daten)
const NEVER_CACHE = [
  'firebaseio.com',
  'firebasedatabase.app',
  'supabase.co',
  'googleapis.com/identitytoolkit'
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // Einzeln laden: eine fehlende Datei soll nicht die ganze
    // Installation scheitern lassen
    await Promise.all(APP_FILES.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[sw] nicht vorgeladen:', url); }
    }));
    self.skipWaiting();
  })());
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => {
      // NUR eigene, veraltete App-Caches löschen.
      // Fremde Namensräume (andere Apps) bleiben unangetastet.
      if (name.startsWith(APP_PREFIX) && name !== APP_CACHE) {
        return caches.delete(name);
      }
    }));
    await self.clients.claim();
  })());
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;

  // Nur GET behandeln — Schreibvorgänge nie abfangen
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Live-Daten immer direkt durchreichen
  if (NEVER_CACHE.some(h => url.href.includes(h))) return;

  // Fremd-Bibliotheken: cache-first
  if (VENDOR_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Eigene Dateien: network-first
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
});

/** Erst Cache, sonst Netz — für Fremdcode der sich nicht ändert */
async function cacheFirst(req) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // Kein Empfang und nichts im Cache
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

/** Erst Netz, sonst Cache — damit online immer die neue Version gewinnt */
async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    // Seitenaufruf ohne Treffer → gecachte index.html ausliefern
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

// Erlaubt der App, ein Update sofort zu übernehmen
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
