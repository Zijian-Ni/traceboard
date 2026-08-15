// Trace parsing, validation, stats

export function parseJSONL(text) {
  const lines = text.trim().split('\n')
  const events = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      events.push(obj)
    } catch {
      console.warn('Skipping invalid JSON line:', trimmed.slice(0, 80))
    }
  }
  return events
}

export function normalizeEvents(raw) {
  return raw.map((ev, idx) => ({
    _idx: idx,
    ts: ev.ts || ev.timestamp || ev.time || null,
    type: ev.type || ev.event_type || 'unknown',
    agent: (ev.agent || ev.agent_id || 'unknown').toLowerCase(),
    phase: ev.phase || ev.stage || null,
    message: ev.message || ev.msg || ev.content || '',
    detail: ev.detail || ev.data || null,
    _raw: ev,
  }))
}

export function computeStats(events) {
  const timestamps = events
    .filter(e => e.ts)
    .map(e => new Date(e.ts).getTime())
    .filter(t => !isNaN(t))

  const startMs = timestamps.length ? Math.min(...timestamps) : 0
  const endMs   = timestamps.length ? Math.max(...timestamps) : 0
  const durationMs = endMs - startMs

  const agents = [...new Set(events.map(e => e.agent))]
  const types  = [...new Set(events.map(e => e.type))]

  return {
    count: events.length,
    agents,
    types,
    startMs,
    endMs,
    durationMs,
    startISO: startMs ? new Date(startMs).toISOString() : null,
  }
}

export function computeEventLayout(events, stats, trackWidthPx) {
  if (!stats.durationMs || !trackWidthPx) return events.map(() => ({ left: 0, width: 8 }))

  return events.map(ev => {
    const tsMs = ev.ts ? new Date(ev.ts).getTime() : stats.startMs
    const offsetRatio = (tsMs - stats.startMs) / stats.durationMs
    const left = Math.max(0, offsetRatio * trackWidthPx)

    // Estimate width based on phase (find matching phase_end)
    const width = 8
    return { left: Math.round(left), width }
  })
}

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

// Group events by agent for swimlanes
export function groupByAgent(events) {
  const map = new Map()
  for (const ev of events) {
    const a = ev.agent || 'unknown'
    if (!map.has(a)) map.set(a, [])
    map.get(a).push(ev)
  }
  return map
}

// Encode trace as base64url for URL sharing
export function encodeTraceURL(events, maxEvents = 50) {
  const slice = events.slice(0, maxEvents)
  const jsonStr = JSON.stringify(slice.map(e => e._raw))
  const b64 = btoa(unescape(encodeURIComponent(jsonStr)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function decodeTraceURL(b64url) {
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonStr = decodeURIComponent(escape(atob(b64)))
    return JSON.parse(jsonStr)
  } catch { return null }
}
