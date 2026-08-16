/**
 * Traceboard Service Worker — PWA offline support.
 * Caches static assets so the app works fully offline.
 */

const CACHE_NAME = 'traceboard-v0.4.0'

// Assets to cache on install
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './demo/trace.jsonl',
  './demo/claude-code.jsonl',
  './demo/otel-genai.jsonl',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  // Network-first for navigation, cache-first for assets
  const { request } = e
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    )
    return
  }
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type === 'opaque') return resp
        // Cache JS/CSS/JSONL assets
        if (/\.(js|css|jsonl|json|woff2?)$/i.test(request.url)) {
          const copy = resp.clone()
          caches.open(CACHE_NAME).then(c => c.put(request, copy))
        }
        return resp
      })
    })
  )
})
