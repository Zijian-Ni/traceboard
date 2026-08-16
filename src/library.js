/**
 * TB-A3: Trace Library — IndexedDB (raw API, no library).
 * Stores recent traces: { id, name, addedAt, meta, blob, pinned }.
 * LRU eviction above ~200MB total blob size.
 */

const DB_NAME = 'traceboard-library'
const DB_VERSION = 1
const STORE = 'traces'
const MAX_BYTES = 200 * 1024 * 1024 // 200 MB

let _db = null

function openDB() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('addedAt', 'addedAt')
        store.createIndex('pinned', 'pinned')
      }
    }
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
    req.onerror = (e) => reject(e.target.error)
  })
}

function tx(mode = 'readonly') {
  return openDB().then(db => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    return { t, store }
  })
}

function toPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = (e) => reject(e.target.error)
  })
}

/** Save a trace. Returns the id. */
export async function saveTrace({ name, meta, events, text }) {
  const id = crypto.randomUUID()
  const blob = new Blob([text], { type: 'application/x-ndjson' })
  const entry = { id, name, addedAt: Date.now(), meta, blob, pinned: false }
  const { store } = await tx('readwrite')
  await toPromise(store.put(entry))
  await evictLRU()
  return id
}

/** Load all trace entries (without blob content). */
export async function listTraces() {
  const { store } = await tx()
  const all = await toPromise(store.getAll())
  return all.map(({ id, name, addedAt, meta, pinned, blob }) => ({
    id, name, addedAt, meta, pinned, byteSize: blob?.size ?? 0
  })).sort((a, b) => (b.pinned - a.pinned) || (b.addedAt - a.addedAt))
}

/** Get one trace entry with blob text. */
export async function loadTrace(id) {
  const { store } = await tx()
  const entry = await toPromise(store.get(id))
  if (!entry) return null
  const text = await entry.blob.text()
  return { ...entry, text }
}

/** Toggle pin state. */
export async function pinTrace(id, pinned) {
  const { store } = await tx('readwrite')
  const entry = await toPromise(store.get(id))
  if (!entry) return
  entry.pinned = pinned
  await toPromise(store.put(entry))
}

/** Delete one trace. */
export async function deleteTrace(id) {
  const { store } = await tx('readwrite')
  await toPromise(store.delete(id))
}

/** Clear all traces. */
export async function clearLibrary() {
  const { store } = await tx('readwrite')
  await toPromise(store.clear())
}

/** LRU eviction: delete oldest unpinned traces if total > MAX_BYTES. */
async function evictLRU() {
  const { store } = await tx()
  const all = await toPromise(store.getAll())
  const total = all.reduce((s, e) => s + (e.blob?.size ?? 0), 0)
  if (total <= MAX_BYTES) return

  // sort by addedAt asc, unpinned first
  const candidates = all
    .filter(e => !e.pinned)
    .sort((a, b) => a.addedAt - b.addedAt)

  let freed = 0
  const toDelete = []
  for (const c of candidates) {
    toDelete.push(c.id)
    freed += c.blob?.size ?? 0
    if (total - freed <= MAX_BYTES * 0.8) break
  }

  if (toDelete.length) {
    const { store: s2 } = await tx('readwrite')
    for (const id of toDelete) s2.delete(id)
  }
}

/** Estimate total library size in bytes. */
export async function libraryStats() {
  const { store } = await tx()
  const all = await toPromise(store.getAll())
  const total = all.reduce((s, e) => s + (e.blob?.size ?? 0), 0)
  return { count: all.length, totalBytes: total }
}
