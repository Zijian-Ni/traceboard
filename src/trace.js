/**
 * Traceboard trace.js v2 — delegates to vendored trace-kit
 */
export {
  parseTrace,
  computeStats,
  detectFormat,
  redact,
  redactTrace,
  hasSecrets,
  toJSONL,
  EVENT_TYPES,
} from './vendor/trace-kit/index.js'

// ─── legacy helpers (unchanged, used throughout main.js) ───────────────────

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function formatTimestamp(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
  } catch { return iso }
}

export function groupByAgent(events) {
  const map = new Map()
  for (const ev of events) {
    const a = ev.agent || 'unknown'
    if (!map.has(a)) map.set(a, [])
    map.get(a).push(ev)
  }
  return map
}

// ─── lz-string compressed share (TB-2) ────────────────────────────────────
import LZString from 'lz-string'

export const MAX_SHARE_URL = 8000

/**
 * Encode events as lz-string compressed v2 share fragment.
 * Strips `raw` field to reduce size.
 */
export function encodeShareURL(events) {
  const slim = events.map(({ ts, type, agent, phase, name, message, status, durationMs }) => {
    const o = { ts, type, agent }
    if (phase) o.phase = phase
    if (name) o.name = name
    if (message) o.message = message
    if (status) o.status = status
    if (durationMs != null) o.durationMs = durationMs
    return o
  })
  return LZString.compressToEncodedURIComponent(JSON.stringify(slim))
}

/**
 * Decode a v2 share fragment.
 *
 * Accepts BOTH payload shapes on purpose:
 *   - a JSON array   (what encodeShareURL above produces)
 *   - newline-delimited JSON (what Aurora Orchestra's "Open in Traceboard"
 *     button produces, since it compresses its trace as JSONL)
 *
 * Traceboard is the consumer at the end of the suite's data flow, so it is the
 * component that should be liberal in what it accepts. Being strict here meant
 * the cross-tool deep link silently decoded to null and the loop that the whole
 * suite is built around appeared broken to the user.
 */
export function decodeShareURL(encoded) {
  try {
    const text = LZString.decompressFromEncodedURIComponent(encoded)
    if (!text) return null

    const trimmed = text.trim()
    if (!trimmed) return null

    // Fast path: a JSON array (or single object) document.
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const doc = JSON.parse(trimmed)
        if (Array.isArray(doc)) return doc
        // A single object is only a valid payload if it is not JSONL below.
        if (!trimmed.includes('\n')) return [doc]
      } catch {
        // Fall through to JSONL parsing: a JSONL payload also starts with '{'.
      }
    }

    // JSONL path.
    const events = []
    for (const line of trimmed.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try { events.push(JSON.parse(s)) } catch { /* skip bad line */ }
    }
    return events.length ? events : null
  } catch { return null }
}

/** Legacy base64url share (v1) — kept for backwards compat. */
export function encodeLegacyURL(events, maxEvents = 50) {
  const slice = events.slice(0, maxEvents)
  const jsonStr = JSON.stringify(slice.map(e => e.raw ?? e))
  const b64 = btoa(unescape(encodeURIComponent(jsonStr)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function decodeLegacyURL(b64url) {
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonStr = decodeURIComponent(escape(atob(b64)))
    return JSON.parse(jsonStr)
  } catch { return null }
}

// Keep old names for any callers
export { encodeLegacyURL as encodeTraceURL, decodeLegacyURL as decodeTraceURL }
