/**
 * TB-A2 — canvas swimlane index + viewport maths.
 *
 * These tests cover the pure logic behind the canvas renderer: the parts that
 * decide *which* renderer runs, how events collapse into buckets, and how the
 * viewport pans/zooms without escaping the world. The drawing itself needs a
 * real canvas, so it is exercised in the browser rather than here.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CANVAS_THRESHOLD,
  LAYOUT,
  selectRenderer,
  eventStatus,
  worseStatus,
  eventTimeMs,
  lowerBound,
  upperBound,
  visibleRange,
  shouldUseLod,
  bucketIndexForTime,
  computeWorldStats,
  buildLaneIndex,
  createViewport,
  clampViewport,
  zoomAround,
  panByPx,
  timeToX,
  xToTime,
  nearestEventIndex,
} from '../src/canvas-lanes.js'

const T0 = Date.parse('2026-08-17T00:00:00.000Z')

function ev(i, { agent = 'alpha', type = 'note', status, stepMs = 1000 } = {}) {
  return {
    ts: new Date(T0 + i * stepMs).toISOString(),
    agent,
    type,
    status,
    message: `event ${i}`,
    _idx: i,
  }
}

function makeEvents(n, opts) {
  return Array.from({ length: n }, (_, i) => ev(i, opts))
}

describe('renderer selection', () => {
  it('keeps the accessible DOM renderer for ordinary traces', () => {
    assert.equal(selectRenderer(0), 'dom')
    assert.equal(selectRenderer(1), 'dom')
    assert.equal(selectRenderer(CANVAS_THRESHOLD - 1), 'dom')
  })

  it('switches to canvas once the DOM cost stops being viable', () => {
    // The threshold is inclusive: at exactly CANVAS_THRESHOLD events we are
    // already past the point where one DOM node per event pays off.
    assert.equal(selectRenderer(CANVAS_THRESHOLD), 'canvas')
    assert.equal(selectRenderer(1_000_000), 'canvas')
  })

  it('honours a caller-supplied threshold', () => {
    assert.equal(selectRenderer(50, 10), 'canvas')
    assert.equal(selectRenderer(5, 10), 'dom')
  })
})

describe('status ranking', () => {
  it('reads status from either the status field or an error type', () => {
    assert.equal(eventStatus({ status: 'error' }), 'error')
    assert.equal(eventStatus({ type: 'error' }), 'error')
    assert.equal(eventStatus({ status: 'warn' }), 'warn')
    assert.equal(eventStatus({ type: 'note' }), 'info')
  })

  it('keeps the worst status when many events collapse into one bucket', () => {
    assert.equal(worseStatus('ok', 'error'), 'error')
    assert.equal(worseStatus('error', 'warn'), 'error')
    assert.equal(worseStatus('info', 'ok'), 'info')
  })
})

describe('time helpers', () => {
  it('returns NaN rather than 0 for unparseable timestamps', () => {
    assert.ok(Number.isNaN(eventTimeMs({ ts: 'not-a-date' })))
    assert.ok(Number.isNaN(eventTimeMs({})))
    assert.equal(eventTimeMs({ ts: '2026-08-17T00:00:00.000Z' }), T0)
  })

  it('binary searches a sorted array the way a range query needs', () => {
    const arr = [10, 20, 20, 30, 40]
    assert.equal(lowerBound(arr, 20), 1)
    assert.equal(upperBound(arr, 20), 3)
    assert.equal(lowerBound(arr, 0), 0)
    assert.equal(upperBound(arr, 100), 5)
  })

  it('derives a visible slice from a time window', () => {
    const arr = [0, 100, 200, 300, 400]
    assert.deepEqual(visibleRange(arr, 100, 300), [1, 4])
  })
})

describe('level of detail', () => {
  it('draws individual events while they still fit', () => {
    assert.equal(shouldUseLod({ visibleCount: 100, trackW: 1000 }), false)
  })

  it('collapses to buckets once events would be sub-pixel', () => {
    assert.equal(shouldUseLod({ visibleCount: 5000, trackW: 1000 }), true)
  })

  it('treats a zero-width track as always collapsed', () => {
    assert.equal(shouldUseLod({ visibleCount: 1, trackW: 0 }), true)
  })
})

describe('bucketing', () => {
  it('clamps out-of-range times into the first and last bucket', () => {
    assert.equal(bucketIndexForTime(-100, 0, 1000, 10), 0)
    assert.equal(bucketIndexForTime(99999, 0, 1000, 10), 9)
  })

  it('degrades safely when a trace has no duration', () => {
    assert.equal(bucketIndexForTime(5, 0, 0, 10), 0)
    assert.equal(bucketIndexForTime(5, 0, 1000, 0), 0)
  })
})

describe('world stats', () => {
  it('summarises a large trace without spreading it onto the call stack', () => {
    // Math.min(...events) throws RangeError around 100k+ args; this must not.
    const events = makeEvents(200_000)
    const stats = computeWorldStats(events)
    assert.equal(stats.count, 200_000)
    assert.equal(stats.startMs, T0)
    assert.equal(stats.durationMs, 199_999 * 1000)
  })

  it('counts errors from both the type and the status field', () => {
    const stats = computeWorldStats([
      ev(0, { type: 'error' }),
      ev(1, { status: 'error' }),
      ev(2),
    ])
    assert.equal(stats.errors, 2)
  })

  it('survives a trace where nothing has a usable timestamp', () => {
    const stats = computeWorldStats([{ agent: 'a' }, { agent: 'b' }])
    assert.equal(stats.startMs, 0)
    assert.equal(stats.durationMs, 0)
    assert.deepEqual(stats.agents.sort(), ['a', 'b'])
  })
})

describe('lane index', () => {
  it('groups events per agent and keeps a link back to the filtered list', () => {
    const events = [
      ev(0, { agent: 'alpha' }),
      ev(1, { agent: 'beta' }),
      ev(2, { agent: 'alpha' }),
    ]
    const index = buildLaneIndex(events, { bucketCount: 8 })
    assert.equal(index.eventCount, 3)
    const alpha = index.lanes.find(l => l.agent === 'alpha')
    assert.equal(alpha.events.length, 2)
    // filteredIdx must point at the position in the array we were handed,
    // otherwise clicking a canvas event selects the wrong row.
    assert.deepEqual([...alpha.filteredIdx], [0, 2])
  })

  it('sorts each lane by time even when the input is unordered', () => {
    const events = [ev(5), ev(1), ev(3)]
    const index = buildLaneIndex(events, { bucketCount: 8 })
    const lane = index.lanes[0]
    const ts = [...lane.tsMs]
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b))
    assert.deepEqual([...lane.filteredIdx], [1, 2, 0])
  })

  it('remembers the worst status in every bucket so errors survive zoom-out', () => {
    const events = [
      ev(0, { status: 'ok' }),
      ev(1, { status: 'error' }),
      ev(2, { status: 'ok' }),
    ]
    const index = buildLaneIndex(events, { bucketCount: 1 })
    const bucket = index.lanes[0].buckets[0]
    assert.equal(bucket.count, 3)
    assert.equal(bucket.worst, 'error')
    assert.ok(bucket.errorIdx >= 0, 'an error bucket must point at the error')
  })

  it('files events with a broken timestamp at the start of the world', () => {
    const index = buildLaneIndex([{ agent: 'a', ts: 'garbage' }], { bucketCount: 4 })
    assert.equal(index.lanes[0].tsMs[0], index.world.startMs)
  })

  it('labels agent-less events instead of dropping them', () => {
    const index = buildLaneIndex([{ ts: new Date(T0).toISOString() }])
    assert.equal(index.lanes[0].agent, 'unknown')
  })
})

describe('viewport', () => {
  const world = { startMs: T0, endMs: T0 + 10_000, durationMs: 10_000 }
  const trackW = 1000

  it('starts showing the whole trace', () => {
    const vp = createViewport(world, trackW)
    assert.equal(vp.t0, world.startMs)
    assert.equal(vp.t1, world.startMs + world.durationMs)
    assert.equal(timeToX(vp.t0, vp), 0)
    assert.equal(Math.round(timeToX(vp.t1, vp)), trackW)
  })

  it('round-trips between time and screen space', () => {
    const vp = createViewport(world, trackW)
    const t = world.startMs + 3210
    assert.ok(Math.abs(xToTime(timeToX(t, vp), vp) - t) < 1e-6)
  })

  it('cannot be panned off either end of the trace', () => {
    const vp = createViewport(world, trackW)
    zoomAround(vp, world, world.startMs + 5000, 4, trackW)
    panByPx(vp, world, 100_000, trackW)
    assert.ok(vp.t0 >= world.startMs, 'panned past the start')
    panByPx(vp, world, -100_000, trackW)
    assert.ok(vp.t1 <= world.endMs + 1e-6, 'panned past the end')
  })

  it('never zooms out beyond the full trace', () => {
    const vp = createViewport(world, trackW)
    zoomAround(vp, world, world.startMs, 0.001, trackW)
    clampViewport(vp, world, trackW)
    assert.ok(vp.t1 - vp.t0 <= world.durationMs + 1e-6)
  })

  it('keeps the anchor time under the cursor while zooming in', () => {
    const vp = createViewport(world, trackW)
    const anchor = world.startMs + 2500
    const before = timeToX(anchor, vp)
    zoomAround(vp, world, anchor, 2, trackW)
    const after = timeToX(anchor, vp)
    assert.ok(Math.abs(before - after) < 1, 'anchor drifted while zooming')
  })

  it('keeps a usable span on a zero-duration trace', () => {
    const flat = { startMs: T0, endMs: T0, durationMs: 0 }
    const vp = createViewport(flat, trackW)
    clampViewport(vp, flat, trackW)
    assert.ok(vp.t1 > vp.t0, 'a flat trace must still have a drawable span')
    assert.ok(Number.isFinite(vp.pxPerMs))
  })
})

describe('hit testing', () => {
  it('snaps to the closest event on either side of the pointer', () => {
    const ts = [0, 100, 200, 300]
    assert.equal(nearestEventIndex(ts, 140), 1)
    assert.equal(nearestEventIndex(ts, 160), 2)
    assert.equal(nearestEventIndex(ts, -50), 0)
    assert.equal(nearestEventIndex(ts, 9999), 3)
  })

  it('reports no hit for an empty lane', () => {
    assert.equal(nearestEventIndex([], 10), -1)
  })
})

describe('layout contract', () => {
  it('reserves the same label gutter the DOM renderer uses', () => {
    // main.js positions the DOM playhead at `calc(130px + ...)`; if these ever
    // disagree the two renderers drift apart visually.
    assert.equal(LAYOUT.labelW, 130)
  })
})
