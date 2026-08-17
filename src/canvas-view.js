/**
 * TB-A2 — Canvas swimlane widget.
 *
 * Draws lanes / events / ruler to a <canvas> with devicePixelRatio scaling.
 * Pan, wheel+pinch zoom, playback head, hover tooltip, click → drawer.
 *
 * Colour comes from CSS custom properties (aurora-ui tokens) — no hex.
 */

import { t } from './i18n.js'
import { getAgentColor, getTypeColor } from './colors.js'
import { formatTimestamp } from './trace.js'
import {
  LAYOUT,
  buildLaneIndex,
  createViewport,
  clampViewport,
  zoomAround,
  panByPx,
  timeToX,
  xToTime,
  hitTest,
  shouldUseLod,
  visibleEventCount,
  visibleRange,
  useBucketLod,
  aggregateFromBuckets,
  aggregateVisibleEvents,
  eventWidthPx,
  eventStatus,
  eventTimeMs,
  canvasHeight,
  laneTop,
} from './canvas-lanes.js'

const TOKEN_FALLBACKS = {
  '--ink-1': 'rgb(232, 238, 252)',
  '--ink-2': 'rgb(185, 198, 228)',
  '--ink-3': 'rgb(132, 150, 187)',
  '--bg': 'rgb(5, 8, 20)',
  '--bg-2': 'rgb(10, 15, 34)',
  '--surface': 'rgba(12, 18, 40, 0.72)',
  '--surface-solid': 'rgb(12, 18, 40)',
  '--border': 'rgba(148, 183, 255, 0.14)',
  '--border-strong': 'rgba(148, 183, 255, 0.28)',
  '--accent': 'rgb(56, 189, 248)',
  '--aurora-teal-400': 'rgb(52, 211, 153)',
  '--aurora-cyan-400': 'rgb(56, 189, 248)',
  '--aurora-violet-400': 'rgb(167, 139, 250)',
  '--status-ok': 'rgb(52, 211, 153)',
  '--status-warn': 'rgb(251, 191, 36)',
  '--status-danger': 'rgb(248, 113, 113)',
  '--status-info': 'rgb(56, 189, 248)',
}

function token(el, name) {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || TOKEN_FALLBACKS[name] || 'transparent'
}

function statusColor(palette, status) {
  if (status === 'error') return palette.danger
  if (status === 'warn') return palette.warn
  if (status === 'ok') return palette.ok
  return palette.info
}

export function createCanvasView({
  container,
  onSelect,
  onHover,
} = {}) {
  const wrap = document.createElement('div')
  wrap.className = 'tb-canvas-wrap'
  wrap.setAttribute('role', 'application')
  wrap.setAttribute('aria-label', t('canvas_aria'))

  const canvas = document.createElement('canvas')
  canvas.className = 'tb-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  wrap.appendChild(canvas)

  const ring = document.createElement('div')
  ring.className = 'tb-canvas-ring'
  ring.hidden = true
  wrap.appendChild(ring)

  const tooltip = document.createElement('div')
  tooltip.className = 'tb-canvas-tooltip'
  tooltip.hidden = true
  wrap.appendChild(tooltip)

  container.appendChild(wrap)

  const ctx = canvas.getContext('2d', { alpha: false })
  const state = {
    events: [],
    stats: null,
    index: null,
    viewport: null,
    layout: { ...LAYOUT },
    cssW: 0,
    cssH: 0,
    dpr: 1,
    selectedIdx: -1,
    playIdx: -1,
    hover: null,
    dirty: true,
    raf: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointers: new Map(),
    pinch: null,
    destroyed: false,
  }

  function palette() {
    return {
      ink1: token(wrap, '--ink-1'),
      ink2: token(wrap, '--ink-2'),
      ink3: token(wrap, '--ink-3'),
      bg: token(wrap, '--bg'),
      bg2: token(wrap, '--bg-2'),
      surface: token(wrap, '--surface-solid'),
      border: token(wrap, '--border'),
      borderStrong: token(wrap, '--border-strong'),
      accent: token(wrap, '--accent'),
      teal: token(wrap, '--aurora-teal-400'),
      cyan: token(wrap, '--aurora-cyan-400'),
      violet: token(wrap, '--aurora-violet-400'),
      ok: token(wrap, '--status-ok'),
      warn: token(wrap, '--status-warn'),
      danger: token(wrap, '--status-danger'),
      info: token(wrap, '--status-info'),
    }
  }

  function trackW() {
    return Math.max(80, state.cssW - state.layout.labelW)
  }

  function resize() {
    const rect = wrap.getBoundingClientRect()
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.floor(rect.width))
    const lanes = state.index?.lanes.length ?? 1
    const h = Math.max(120, canvasHeight(lanes, state.layout))
    if (w === state.cssW && h === state.cssH && dpr === state.dpr) {
      if (state.viewport) clampViewport(state.viewport, state.index.world, trackW())
      return
    }
    state.cssW = w
    state.cssH = h
    state.dpr = dpr
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (state.viewport && state.index) clampViewport(state.viewport, state.index.world, trackW())
    markDirty()
  }

  function setTrace(events, stats) {
    state.events = events || []
    state.stats = stats
    state.index = buildLaneIndex(state.events, { stats })
    state.viewport = createViewport(state.index.world, Math.max(trackW(), 400))
    state.hover = null
    resize()
    clampViewport(state.viewport, state.index.world, trackW())
    markDirty()
  }

  function setPlayback(filteredIdx, { selected = false } = {}) {
    state.playIdx = filteredIdx
    if (selected) state.selectedIdx = filteredIdx
    ensureVisible(filteredIdx)
    markDirty()
  }

  function setSelected(filteredIdx) {
    state.selectedIdx = filteredIdx
    ensureVisible(filteredIdx)
    markDirty()
  }

  function ensureVisible(filteredIdx) {
    if (filteredIdx < 0 || !state.index || !state.viewport) return
    const ev = state.events[filteredIdx]
    if (!ev) return
    const t = eventTimeMs(ev)
    if (!Number.isFinite(t)) return
    const vp = state.viewport
    const pad = (vp.t1 - vp.t0) * 0.08
    if (t < vp.t0 + pad || t > vp.t1 - pad) {
      const span = vp.t1 - vp.t0
      vp.t0 = t - span / 2
      vp.t1 = t + span / 2
      clampViewport(vp, state.index.world, trackW())
    }
  }

  function resetView() {
    if (!state.index) return
    state.viewport = createViewport(state.index.world, trackW())
    markDirty()
  }

  function markDirty() {
    state.dirty = true
    if (!state.raf) state.raf = requestAnimationFrame(frame)
  }

  function frame() {
    state.raf = 0
    if (state.destroyed) return
    if (!state.dirty) return
    state.dirty = false
    draw()
    placeChrome()
  }

  function draw() {
    if (!state.index || !state.viewport) {
      ctx.fillStyle = token(wrap, '--bg')
      ctx.fillRect(0, 0, state.cssW, state.cssH)
      return
    }
    const pal = palette()
    const L = state.layout
    const vp = state.viewport
    const tw = trackW()

    ctx.fillStyle = pal.bg
    ctx.fillRect(0, 0, state.cssW, state.cssH)

    drawRuler(pal, L, vp, tw)
    state.index.lanes.forEach((lane, i) => drawLane(lane, i, pal, L, vp, tw))
    drawPlayhead(pal, L, vp)
  }

  function drawRuler(pal, L, vp, tw) {
    ctx.fillStyle = pal.bg2
    ctx.fillRect(0, 0, state.cssW, L.rulerH)
    ctx.strokeStyle = pal.border
    ctx.beginPath()
    ctx.moveTo(0, L.rulerH - 0.5)
    ctx.lineTo(state.cssW, L.rulerH - 0.5)
    ctx.stroke()

    ctx.fillStyle = pal.ink3
    ctx.font = '10px JetBrains Mono, ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    ctx.fillText('t', L.labelW - 10, L.rulerH / 2)

    const ticks = 8
    ctx.textAlign = 'center'
    for (let i = 0; i <= ticks; i++) {
      const u = i / ticks
      const t = vp.t0 + u * (vp.t1 - vp.t0)
      const x = L.labelW + u * tw
      ctx.strokeStyle = pal.border
      ctx.beginPath()
      ctx.moveTo(x, L.rulerH - 6)
      ctx.lineTo(x, L.rulerH)
      ctx.stroke()
      ctx.fillStyle = pal.ink3
      ctx.fillText(formatTimestamp(new Date(t).toISOString()), x, L.rulerH / 2 - 2)
    }
  }

  function drawLane(lane, i, pal, L, vp, tw) {
    const y = laneTop(i, L)
    const col = getAgentColor(lane.agent)
    ctx.fillStyle = pal.surface
    ctx.fillRect(0, y, state.cssW, L.laneH)
    ctx.strokeStyle = pal.border
    ctx.strokeRect(0.5, y + 0.5, state.cssW - 1, L.laneH - 1)

    // label column
    ctx.fillStyle = pal.bg2
    ctx.fillRect(0, y, L.labelW, L.laneH)
    ctx.beginPath()
    ctx.arc(14, y + L.laneH / 2, 4, 0, Math.PI * 2)
    ctx.fillStyle = col.bg
    ctx.fill()
    ctx.fillStyle = col.bg
    ctx.font = '600 11px Inter, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const label = (col.label || lane.agent).slice(0, 16)
    ctx.fillText(label, 24, y + L.laneH / 2)

    // baseline
    ctx.strokeStyle = pal.border
    ctx.beginPath()
    ctx.moveTo(L.labelW, y + L.laneH / 2)
    ctx.lineTo(state.cssW, y + L.laneH / 2)
    ctx.stroke()

    ctx.save()
    ctx.beginPath()
    ctx.rect(L.labelW, y, tw, L.laneH)
    ctx.clip()

    const [lo, hi] = visibleRange(lane.tsMs, vp.t0, vp.t1)
    const visibleCount = hi - lo
    const lod = shouldUseLod({ visibleCount, trackW: tw, minEventPx: L.minEventPx })

    if (lod) {
      const cols = Math.max(1, Math.round(tw))
      const bands = useBucketLod(vp, state.index.world, state.index.bucketCount)
        ? aggregateFromBuckets(lane.buckets, state.index.world, vp.t0, vp.t1, cols)
        : aggregateVisibleEvents(lane, vp.t0, vp.t1, cols)
      const max = bands.reduce((m, b) => Math.max(m, b.count), 1)
      for (let c = 0; c < bands.length; c++) {
        const b = bands[c]
        if (!b.count) continue
        const h = Math.max(3, (b.count / max) * (L.laneH - 10))
        ctx.fillStyle = statusColor(pal, b.status)
        ctx.globalAlpha = b.status === 'error' ? 1 : 0.55 + 0.45 * (b.count / max)
        ctx.fillRect(L.labelW + c, y + L.laneH - 5 - h, 1, h)
      }
      ctx.globalAlpha = 1
    } else {
      for (let k = lo; k < hi; k++) {
        const ev = lane.events[k]
        const x = L.labelW + timeToX(lane.tsMs[k], vp)
        const w = eventWidthPx(lane, k, vp, L)
        const typeCol = getTypeColor(ev.type)
        const st = eventStatus(ev)
        ctx.fillStyle = st === 'error' ? pal.danger : typeCol.border
        ctx.globalAlpha = 0.85
        const bh = 18
        ctx.fillRect(x, y + (L.laneH - bh) / 2, Math.max(1, w), bh)
        if (w > 36) {
          ctx.globalAlpha = 0.95
          ctx.fillStyle = pal.ink1
          ctx.font = '9px Inter, system-ui, sans-serif'
          ctx.textAlign = 'left'
          ctx.fillText(String(ev.type || '').slice(0, 14), x + 3, y + L.laneH / 2)
        }
      }
      ctx.globalAlpha = 1
    }

    ctx.restore()
  }

  function drawPlayhead(pal, L, vp) {
    const ev = state.events[state.playIdx]
    if (!ev) return
    const t = eventTimeMs(ev)
    if (!Number.isFinite(t)) return
    const x = L.labelW + timeToX(t, vp)
    if (x < L.labelW - 2 || x > state.cssW + 2) return
    ctx.strokeStyle = pal.teal
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, state.cssH)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.fillStyle = pal.teal
    ctx.beginPath()
    ctx.arc(x, 6, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  function placeChrome() {
    const ev = state.events[state.selectedIdx]
    if (!ev || !state.index || !state.viewport) {
      ring.hidden = true
      return
    }
    const t = eventTimeMs(ev)
    if (!Number.isFinite(t)) {
      ring.hidden = true
      return
    }
    const L = state.layout
    const vp = state.viewport
    const x = L.labelW + timeToX(t, vp)
    let laneI = state.index.lanes.findIndex((ln) => ln.agent === (ev.agent || 'unknown'))
    if (laneI < 0) laneI = 0
    const y = laneTop(laneI, L)
    const w = 18
    ring.hidden = false
    ring.className = 'tb-canvas-ring aurora-ring'
    ring.style.left = `${x - 4}px`
    ring.style.top = `${y + 10}px`
    ring.style.width = `${w}px`
    ring.style.height = `${L.laneH - 20}px`
  }

  function localXY(e) {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function showTip(hit, e) {
    if (!hit?.event) {
      tooltip.hidden = true
      onHover?.(null)
      return
    }
    const ev = hit.event
    tooltip.hidden = false
    tooltip.textContent = `[${ev.type}] ${ev.agent || ''} — ${ev.message || formatTimestamp(ev.ts)}`
    const r = wrap.getBoundingClientRect()
    tooltip.style.left = `${Math.min(r.width - 12, e.clientX - r.left + 12)}px`
    tooltip.style.top = `${Math.max(8, e.clientY - r.top - 28)}px`
    onHover?.(ev)
  }

  function onMove(e) {
    if (state.dragging) {
      const dx = e.clientX - state.lastX
      state.lastX = e.clientX
      state.lastY = e.clientY
      panByPx(state.viewport, state.index.world, dx, trackW())
      markDirty()
      return
    }
    const { x, y } = localXY(e)
    const hit = hitTest(state.index, x, y, state.viewport, state.layout)
    state.hover = hit
    showTip(hit, e)
  }

  function onDown(e) {
    if (e.button !== 0 && e.pointerType !== 'touch') return
    canvas.setPointerCapture?.(e.pointerId)
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (state.pointers.size === 2) {
      const pts = [...state.pointers.values()]
      state.pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        midT: xToTime((localXY(e).x - state.layout.labelW), state.viewport),
      }
      state.dragging = false
      return
    }
    state.dragging = true
    state.lastX = e.clientX
    state.lastY = e.clientY
    state.moved = false
  }

  function onPointerMove(e) {
    if (state.pointers.has(e.pointerId)) {
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    if (state.pointers.size === 2 && state.pinch) {
      const pts = [...state.pointers.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const factor = dist / Math.max(state.pinch.dist, 1)
      state.pinch.dist = dist
      zoomAround(state.viewport, state.index.world, state.pinch.midT, factor, trackW())
      markDirty()
      return
    }
    if (state.dragging && Math.abs(e.clientX - state.lastX) > 2) state.moved = true
    onMove(e)
  }

  function onUp(e) {
    state.pointers.delete(e.pointerId)
    if (state.pointers.size < 2) state.pinch = null
    const wasDrag = state.dragging && state.moved
    state.dragging = false
    if (wasDrag) return
    const { x, y } = localXY(e)
    const hit = hitTest(state.index, x, y, state.viewport, state.layout)
    if (hit?.event) {
      state.selectedIdx = hit.filteredIdx
      markDirty()
      onSelect?.(hit.event, hit.filteredIdx)
    }
  }

  function onWheel(e) {
    if (!state.viewport || !state.index) return
    e.preventDefault()
    const { x } = localXY(e)
    const anchor = xToTime(x - state.layout.labelW, state.viewport)
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    zoomAround(state.viewport, state.index.world, anchor, factor, trackW())
    markDirty()
  }

  function onLeave() {
    tooltip.hidden = true
    state.hover = null
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerleave', onLeave)
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => resize())
    : null
  ro?.observe(wrap)
  addEventListener('resize', resize, { passive: true })

  return {
    el: wrap,
    setTrace,
    setPlayback,
    setSelected,
    resetView,
    resize,
    markDirty,
    get index() { return state.index },
    get viewport() { return state.viewport },
    destroy() {
      state.destroyed = true
      cancelAnimationFrame(state.raf)
      ro?.disconnect()
      removeEventListener('resize', resize)
      wrap.remove()
    },
  }
}
