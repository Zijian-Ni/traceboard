/**
 * TB-A2 — Canvas swimlane engine (pure logic, no DOM).
 *
 * The DOM renderer is the accessible, inspectable path. This module is the
 * visual optimisation for traces large enough that one element per event
 * would stall the page. Everything here is unit-tested without a browser:
 * renderer selection, viewport ↔ time math, bucketed hit-testing, LOD.
 */

/** Switch to canvas at this many *filtered* events.
 *
 * Justification: each DOM event is an absolutely-positioned node (plus a
 * label, optional message, and an SVG connector). Playback highlight walks
 * every `.event-block` on every tick. A few thousand nodes is where style /
 * layout starts to hitch on a 1440p laptop; share URLs and typical Orchestra
 * runs stay well under this, so they keep the accessible DOM path.
 * 4 000 is "a few thousand" — high enough that small traces never flip,
 * low enough that a 100k-event drop never tries to mount 100k nodes.
 */
export const CANVAS_THRESHOLD = 4000

export const STATUS_RANK = Object.freeze({ ok: 0, info: 1, warn: 2, error: 3 })

export const LAYOUT = Object.freeze({
  labelW: 130,
  rulerH: 28,
  laneH: 56,
  laneGap: 8,
  pad: 12,
  minEventPx: 4,
  maxEventPx: 160,
  lodMinColPx: 1,
})

export const DEFAULT_BUCKET_COUNT = 4096

export function selectRenderer(eventCount, threshold = CANVAS_THRESHOLD) {
  return Number(eventCount) >= threshold ? 'canvas' : 'dom'
}

export function eventStatus(ev) {
  if (!ev) return 'info'
  if (ev.type === 'error' || ev.status === 'error') return 'error'
  if (ev.status === 'warn' || ev.status === 'warning') return 'warn'
  if (ev.status === 'ok') return 'ok'
  return 'info'
}

export function worseStatus(a, b) {
  return (STATUS_RANK[a] ?? 0) >= (STATUS_RANK[b] ?? 0) ? a : b
}

export function eventTimeMs(ev) {
  if (!ev) return NaN
  if (typeof ev.tsMs === 'number' && Number.isFinite(ev.tsMs)) return ev.tsMs
  if (typeof ev.ts === 'number' && Number.isFinite(ev.ts)) return ev.ts
  const t = Date.parse(ev.ts)
  return Number.isFinite(t) ? t : NaN
}

/** Binary search: first index with arr[i] >= value. */
export function lowerBound(arr, value) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Binary search: first index with arr[i] > value. */
export function upperBound(arr, value) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Inclusive-start, exclusive-end range of events whose time is in [t0, t1]. */
export function visibleRange(tsMs, t0, t1) {
  const lo = lowerBound(tsMs, t0)
  const hi = upperBound(tsMs, t1)
  return [lo, hi]
}

export function shouldUseLod({ visibleCount, trackW, minEventPx = LAYOUT.minEventPx }) {
  if (trackW <= 0) return true
  return visibleCount * minEventPx > trackW
}

export function bucketIndexForTime(t, startMs, durationMs, bucketCount) {
  if (bucketCount <= 0) return 0
  if (!(durationMs > 0)) return 0
  const u = (t - startMs) / durationMs
  if (u <= 0) return 0
  if (u >= 1) return bucketCount - 1
  return Math.floor(u * bucketCount)
}

/** Safe stats — never `Math.min(...n)` which throws on 100k+ events. */
export function computeWorldStats(events) {
  const agents = new Set()
  const types = new Set()
  let errors = 0
  let startMs = Infinity
  let endMs = -Infinity
  for (const ev of events) {
    if (ev?.agent) agents.add(ev.agent)
    if (ev?.type) types.add(ev.type)
    if (ev?.type === 'error' || ev?.status === 'error') errors++
    const t = eventTimeMs(ev)
    if (Number.isFinite(t)) {
      if (t < startMs) startMs = t
      if (t > endMs) endMs = t
    }
  }
  if (!Number.isFinite(startMs)) {
    startMs = 0
    endMs = 0
  }
  return {
    count: events.length,
    agents: [...agents],
    types: [...types],
    errors,
    startMs,
    endMs,
    durationMs: Math.max(endMs - startMs, 0),
    startISO: startMs ? new Date(startMs).toISOString() : null,
  }
}

export function resolveWorld(events, stats) {
  let startMs = stats?.startMs
  let endMs = stats?.endMs
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    const s = computeWorldStats(events)
    startMs = s.startMs
    endMs = s.endMs
  }
  const durationMs = Math.max((endMs ?? 0) - (startMs ?? 0), 1)
  return { startMs: startMs ?? 0, endMs: (startMs ?? 0) + durationMs, durationMs }
}

function emptyBucket() {
  return { count: 0, worst: 'ok', firstIdx: -1, errorIdx: -1 }
}

/**
 * Build per-lane sorted arrays + uniform time buckets.
 * Hit-testing and LOD read the buckets — they never scan all events.
 */
export function buildLaneIndex(events, opts = {}) {
  const world = resolveWorld(events, opts.stats)
  const bucketCount = opts.bucketCount ?? DEFAULT_BUCKET_COUNT
  const byAgent = new Map()

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const agent = ev.agent || 'unknown'
    let lane = byAgent.get(agent)
    if (!lane) {
      lane = { agent, items: [] }
      byAgent.set(agent, lane)
    }
    const t = eventTimeMs(ev)
    lane.items.push({
      ev,
      t: Number.isFinite(t) ? t : world.startMs,
      filteredIdx: i,
    })
  }

  const lanes = []
  for (const { agent, items } of byAgent.values()) {
    items.sort((a, b) => a.t - b.t || a.filteredIdx - b.filteredIdx)
    const n = items.length
    const tsMs = new Float64Array(n)
    const eventsArr = new Array(n)
    const filteredIdx = new Int32Array(n)
    const buckets = Array.from({ length: bucketCount }, emptyBucket)

    for (let i = 0; i < n; i++) {
      const item = items[i]
      tsMs[i] = item.t
      eventsArr[i] = item.ev
      filteredIdx[i] = item.filteredIdx
      const bi = bucketIndexForTime(item.t, world.startMs, world.durationMs, bucketCount)
      const b = buckets[bi]
      b.count++
      if (b.firstIdx < 0) b.firstIdx = i
      const st = eventStatus(item.ev)
      b.worst = worseStatus(b.worst, st)
      if (st === 'error' && b.errorIdx < 0) b.errorIdx = i
    }

    lanes.push({ agent, events: eventsArr, tsMs, filteredIdx, buckets })
  }

  return {
    world,
    bucketCount,
    lanes,
    eventCount: events.length,
  }
}

export function timeToX(t, viewport) {
  return (t - viewport.t0) * viewport.pxPerMs
}

export function xToTime(x, viewport) {
  return viewport.t0 + x / viewport.pxPerMs
}

export function createViewport(world, trackW) {
  const durationMs = Math.max(world.durationMs, 1)
  return {
    t0: world.startMs,
    t1: world.startMs + durationMs,
    pxPerMs: trackW / durationMs,
  }
}

export function syncViewportPx(vp, trackW) {
  vp.pxPerMs = trackW / Math.max(vp.t1 - vp.t0, 1e-9)
  return vp
}

export function clampViewport(vp, world, trackW) {
  const end = world.startMs + world.durationMs
  const minSpan = Math.max(1, Math.min(10, world.durationMs))
  let span = Math.max(minSpan, Math.min(world.durationMs, vp.t1 - vp.t0))
  let t0 = vp.t0
  let t1 = t0 + span
  if (t0 < world.startMs) {
    t0 = world.startMs
    t1 = t0 + span
  }
  if (t1 > end) {
    t1 = end
    t0 = t1 - span
  }
  if (t0 < world.startMs) t0 = world.startMs
  vp.t0 = t0
  vp.t1 = Math.max(t0 + minSpan, t1)
  if (vp.t1 > end && end > world.startMs) {
    vp.t1 = end
    vp.t0 = Math.max(world.startMs, vp.t1 - span)
  }
  return syncViewportPx(vp, trackW)
}

export function zoomAround(vp, world, anchorT, factor, trackW) {
  const curSpan = Math.max(vp.t1 - vp.t0, 1)
  const nextSpan = curSpan / (factor || 1)
  const u = curSpan > 0 ? (anchorT - vp.t0) / curSpan : 0.5
  vp.t0 = anchorT - u * nextSpan
  vp.t1 = vp.t0 + nextSpan
  return clampViewport(vp, world, trackW)
}

export function panByPx(vp, world, dx, trackW) {
  const dt = -dx / Math.max(vp.pxPerMs, 1e-12)
  vp.t0 += dt
  vp.t1 += dt
  return clampViewport(vp, world, trackW)
}

/** Nearest event index (in a sorted ts array) to time t. */
export function nearestEventIndex(tsMs, t) {
  if (!tsMs.length) return -1
  const i = lowerBound(tsMs, t)
  if (i <= 0) return 0
  if (i >= tsMs.length) return tsMs.length - 1
  return (t - tsMs[i - 1]) <= (tsMs[i] - t) ? i - 1 : i
}

/**
 * Map a track-local x (0..trackW) to the filtered-event index nearest that
 * time across all lanes. O(lanes · log n).
 */
export function eventIndexAtX(index, x, trackW, viewport = null) {
  const vp = viewport ?? createViewport(index.world, trackW)
  const t = xToTime(x, vp)
  let best = -1
  let bestDist = Infinity
  for (const lane of index.lanes) {
    const i = nearestEventIndex(lane.tsMs, t)
    if (i < 0) continue
    const d = Math.abs(lane.tsMs[i] - t)
    if (d < bestDist) {
      bestDist = d
      best = lane.filteredIdx[i]
    }
  }
  return best
}

export function visibleEventCount(index, viewport) {
  let n = 0
  for (const lane of index.lanes) {
    const [lo, hi] = visibleRange(lane.tsMs, viewport.t0, viewport.t1)
    n += hi - lo
  }
  return n
}

/**
 * Fold precomputed time-buckets into `columnCount` density bands for one lane.
 * Worst status wins — an error in the column is never dropped.
 */
export function aggregateFromBuckets(buckets, world, t0, t1, columnCount) {
  const cols = new Array(columnCount)
  for (let i = 0; i < columnCount; i++) {
    cols[i] = { count: 0, status: 'ok', eventIdx: -1, errorIdx: -1 }
  }
  const span = t1 - t0
  if (span <= 0 || !buckets.length || columnCount <= 0) return cols

  const bucketSpan = world.durationMs / buckets.length
  let i0 = Math.floor((t0 - world.startMs) / bucketSpan)
  let i1 = Math.floor((t1 - world.startMs) / bucketSpan)
  if (i0 < 0) i0 = 0
  if (i1 >= buckets.length) i1 = buckets.length - 1
  if (i0 > i1) return cols

  for (let i = i0; i <= i1; i++) {
    const b = buckets[i]
    if (!b.count) continue
    const mid = world.startMs + (i + 0.5) * bucketSpan
    let col = Math.floor(((mid - t0) / span) * columnCount)
    if (col < 0) col = 0
    if (col >= columnCount) col = columnCount - 1
    const c = cols[col]
    c.count += b.count
    if ((STATUS_RANK[b.worst] ?? 0) > (STATUS_RANK[c.status] ?? 0)) c.status = b.worst
    if (c.eventIdx < 0) c.eventIdx = b.firstIdx
    if (b.errorIdx >= 0) {
      c.errorIdx = b.errorIdx
      c.eventIdx = b.errorIdx
    }
  }
  return cols
}

/**
 * Walk a visible slice and aggregate into columns. Used when zoomed in far
 * enough that buckets are coarser than a pixel (still O(visible), not O(n)
 * of the whole trace). An error in the slice always paints its column red.
 */
export function aggregateVisibleEvents(lane, t0, t1, columnCount) {
  const cols = new Array(columnCount)
  for (let i = 0; i < columnCount; i++) {
    cols[i] = { count: 0, status: 'ok', eventIdx: -1, errorIdx: -1 }
  }
  const span = t1 - t0
  if (span <= 0 || columnCount <= 0) return cols
  const [lo, hi] = visibleRange(lane.tsMs, t0, t1)
  for (let i = lo; i < hi; i++) {
    let col = Math.floor(((lane.tsMs[i] - t0) / span) * columnCount)
    if (col < 0) col = 0
    if (col >= columnCount) col = columnCount - 1
    const c = cols[col]
    c.count++
    const st = eventStatus(lane.events[i])
    if ((STATUS_RANK[st] ?? 0) > (STATUS_RANK[c.status] ?? 0)) c.status = st
    if (c.eventIdx < 0) c.eventIdx = i
    if (st === 'error') {
      c.errorIdx = i
      c.eventIdx = i
    }
  }
  return cols
}

export function useBucketLod(viewport, world, bucketCount) {
  const msPerPx = (viewport.t1 - viewport.t0) / Math.max(viewport.pxPerMs, 1e-12)
  const msPerBucket = world.durationMs / Math.max(bucketCount, 1)
  // Buckets are useful while a pixel covers at least ~¼ of a bucket.
  return msPerPx * 4 >= msPerBucket
}

export function laneAtY(y, layout = LAYOUT) {
  const body = y - layout.rulerH
  if (body < 0) return -1
  const stride = layout.laneH + layout.laneGap
  return Math.floor(body / stride)
}

export function laneTop(laneIndex, layout = LAYOUT) {
  return layout.rulerH + laneIndex * (layout.laneH + layout.laneGap)
}

export function canvasHeight(laneCount, layout = LAYOUT) {
  return layout.rulerH + laneCount * (layout.laneH + layout.laneGap) + layout.pad
}

/**
 * Hit-test in track space.
 * `x` is canvas-pixel x (includes the label column).
 * `y` is canvas-pixel y.
 *
 * Returns `{ event, lane, laneEventIdx, filteredIdx, probes }` or null.
 * `probes` is how many events were inspected — used by tests to prove we
 * do not linear-scan the trace on every mousemove.
 */
export function hitTest(index, x, y, viewport, layout = LAYOUT) {
  const probes = { buckets: 0, events: 0 }
  if (!index?.lanes?.length) return null
  const li = laneAtY(y, layout)
  if (li < 0 || li >= index.lanes.length) return null
  if (x < layout.labelW) return null

  const lane = index.lanes[li]
  const trackX = x - layout.labelW
  const t = xToTime(trackX, viewport)
  const top = laneTop(li, layout)
  if (y < top || y > top + layout.laneH) return null

  const visible = visibleRange(lane.tsMs, viewport.t0, viewport.t1)
  const visibleCount = visible[1] - visible[0]
  const trackW = Math.max(1, (viewport.t1 - viewport.t0) * viewport.pxPerMs)
  const lod = shouldUseLod({ visibleCount, trackW, minEventPx: layout.minEventPx })

  if (lod) {
    probes.buckets++
    if (useBucketLod(viewport, index.world, index.bucketCount)) {
      const bi = bucketIndexForTime(t, index.world.startMs, index.world.durationMs, index.bucketCount)
      const b = lane.buckets[bi]
      const pick = b && b.count ? (b.errorIdx >= 0 ? b.errorIdx : b.firstIdx) : -1
      if (pick < 0) return { event: null, lane, laneEventIdx: -1, filteredIdx: -1, probes, column: true }
      return {
        event: lane.events[pick],
        lane,
        laneEventIdx: pick,
        filteredIdx: lane.filteredIdx[pick],
        probes,
        column: true,
      }
    }
    const cols = Math.max(1, Math.round(trackW))
    const col = Math.max(0, Math.min(cols - 1, Math.floor(trackX)))
    const bands = aggregateVisibleEvents(lane, viewport.t0, viewport.t1, cols)
    const band = bands[col]
    if (!band || band.eventIdx < 0) return { event: null, lane, laneEventIdx: -1, filteredIdx: -1, probes, column: true }
    return {
      event: lane.events[band.eventIdx],
      lane,
      laneEventIdx: band.eventIdx,
      filteredIdx: lane.filteredIdx[band.eventIdx],
      probes,
      column: true,
    }
  }

  // Zoomed in: binary-search the neighbourhood, then test a tiny window.
  const mid = nearestEventIndex(lane.tsMs, t)
  if (mid < 0) return null
  const lo = Math.max(0, mid - 4)
  const hi = Math.min(lane.events.length, mid + 5)
  let best = -1
  let bestDist = Infinity
  for (let i = lo; i < hi; i++) {
    probes.events++
    const evX = timeToX(lane.tsMs[i], viewport)
    const w = eventWidthPx(lane, i, viewport, layout)
    if (trackX >= evX - 2 && trackX <= evX + w + 2) {
      const d = Math.abs(trackX - (evX + w / 2))
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
  }
  if (best < 0) return null
  return {
    event: lane.events[best],
    lane,
    laneEventIdx: best,
    filteredIdx: lane.filteredIdx[best],
    probes,
    column: false,
  }
}

export function eventWidthPx(lane, i, viewport, layout = LAYOUT) {
  const t = lane.tsMs[i]
  const tNext = i + 1 < lane.tsMs.length
    ? lane.tsMs[i + 1]
    : t + (48 / Math.max(viewport.pxPerMs, 1e-12))
  const w = Math.max(0, tNext - t) * viewport.pxPerMs * 0.85
  return Math.max(layout.minEventPx, Math.min(layout.maxEventPx, w))
}

/** Synthetic Aurora-shaped events for benches and tests. */
export function makeSyntheticTrace({
  count = 200_000,
  agents = 6,
  startMs = 1_723_000_000_000,
  stepMs = 50,
  errorEvery = 10_000,
} = {}) {
  const names = ['xiaoluo', 'hermes', 'dsh', 'phoenix', 'sentinel', 'oracle']
  const types = ['phase_start', 'agent_call', 'tool_call', 'tool_result', 'llm_call', 'note', 'phase_end']
  const events = new Array(count)
  const agentN = Math.max(1, agents)
  for (let i = 0; i < count; i++) {
    const isError = errorEvery > 0 && i > 0 && i % errorEvery === 0
    events[i] = {
      _idx: i,
      ts: new Date(startMs + i * stepMs).toISOString(),
      type: isError ? 'error' : types[i % types.length],
      agent: names[i % agentN],
      status: isError ? 'error' : 'ok',
      message: isError ? `synthetic error ${i}` : `event ${i}`,
    }
  }
  return events
}
