/**
 * Traceboard v0.3 — cinematic multi-agent trace player
 */
import { setLang, t, currentLang } from './i18n.js'
import { getAgentColor, getTypeColor, getAllTypeKeys, getAllAgentKeys } from './colors.js'
import {
  parseJSONL, normalizeEvents, computeStats,
  groupByAgent, formatDuration, formatTimestamp,
  encodeTraceURL, decodeTraceURL
} from './trace.js'

let state = {
  events: [],
  filtered: [],
  stats: null,
  activeTypes: new Set(),
  selectedEvent: null,
  filename: 'trace.jsonl',
  summaryMarkdown: null,
  playback: { playing: false, idx: 0, timer: null, speed: 1 },
}

const $ = (id) => document.getElementById(id)
const $hero = $('hero')
const $viewer = $('trace-viewer')
const $dropZone = $('drop-zone')
const $fileInput = $('file-input')
const $btnDemo = $('btn-demo')
const $btnLang = $('btn-lang')
const $btnShare = $('btn-share')
const $btnExport = $('btn-export')
const $btnBack = $('btn-back')
const $btnReset = $('btn-reset-view')
const $typeFilters = $('type-filters')
const $lanes = $('lanes')
const $legend = $('legend')
const $ruler = $('time-ruler')
const $filename = $('trace-filename')
const $stats = $('trace-stats')
const $toast = $('toast')
const $drawer = $('detail-drawer')
const $backdrop = $('drawer-backdrop')
const $summaryBar = $('summary-bar')
const $summaryContent = $('summary-content')

async function init() {
  setLang('en')
  setupDrop()
  setupButtons()
  ensureChrome()
  checkURLHash()
}

function ensureChrome() {
  // particle canvas
  if (!$('tb-fx')) {
    const c = document.createElement('canvas')
    c.id = 'tb-fx'
    c.className = 'tb-fx'
    document.body.prepend(c)
    bootParticles(c)
  }
  // theme dock
  if (!$('tb-theme-dock')) {
    const dock = document.createElement('div')
    dock.id = 'tb-theme-dock'
    dock.innerHTML = `
      <button id="tb-theme-toggle" class="tb-theme-toggle">🎨</button>
      <div id="tb-theme-panel" class="tb-theme-panel" hidden>
        <div class="tb-theme-title">Atmosphere</div>
        <div class="tb-theme-presets">
          <button data-bg="aurora" class="tb-preset">Aurora</button>
          <button data-bg="midnight" class="tb-preset">Midnight</button>
          <button data-bg="nebula" class="tb-preset">Nebula</button>
          <button data-bg="ember" class="tb-preset">Ember</button>
        </div>
        <label class="tb-theme-upload">Custom image / GIF<input id="tb-bg-upload" type="file" accept="image/*,.gif" hidden/></label>
        <input id="tb-bg-opacity" type="range" min="8" max="80" value="28"/>
        <button id="tb-bg-clear" class="btn-ghost btn-sm">Clear custom</button>
      </div>
      <div id="tb-custom-bg" class="tb-custom-bg"></div>`
    document.body.appendChild(dock)
    const preset = localStorage.getItem('tb_bg_preset') || 'aurora'
    document.documentElement.dataset.bg = preset
    dock.querySelectorAll('.tb-preset').forEach(b => b.classList.toggle('active', b.dataset.bg === preset))
    const op = localStorage.getItem('tb_bg_opacity') || '28'
    document.documentElement.style.setProperty('--tb-custom-opacity', String(Number(op) / 100))
    dock.querySelector('#tb-bg-opacity').value = op
    const custom = localStorage.getItem('tb_bg_custom'); if (custom) applyCustom(custom)
    dock.querySelector('#tb-theme-toggle').onclick = (e) => {
      e.stopPropagation()
      const p = dock.querySelector('#tb-theme-panel')
      p.hidden = !p.hidden
    }
    dock.querySelectorAll('.tb-preset').forEach(btn => btn.onclick = () => {
      localStorage.setItem('tb_bg_preset', btn.dataset.bg)
      document.documentElement.dataset.bg = btn.dataset.bg
      dock.querySelectorAll('.tb-preset').forEach(b => b.classList.toggle('active', b === btn))
    })
    dock.querySelector('#tb-bg-upload').onchange = (e) => {
      const f = e.target.files?.[0]; if (!f) return
      const r = new FileReader()
      r.onload = () => { try { localStorage.setItem('tb_bg_custom', r.result) } catch {} ; applyCustom(r.result) }
      r.readAsDataURL(f)
    }
    dock.querySelector('#tb-bg-opacity').oninput = (e) => {
      localStorage.setItem('tb_bg_opacity', e.target.value)
      document.documentElement.style.setProperty('--tb-custom-opacity', String(Number(e.target.value) / 100))
    }
    dock.querySelector('#tb-bg-clear').onclick = () => { localStorage.removeItem('tb_bg_custom'); applyCustom(null) }
  }
}

function applyCustom(url) {
  const layer = $('tb-custom-bg')
  if (!layer) return
  if (url) { layer.style.backgroundImage = `url(${url})`; layer.classList.add('show') }
  else { layer.style.backgroundImage = ''; layer.classList.remove('show') }
}

function bootParticles(c) {
  const ctx = c.getContext('2d')
  const parts = Array.from({ length: 40 }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
    r: Math.random() * 2 + .3, a: Math.random() * .3 + .05,
    c: ['rgba(0,229,199,.9)', 'rgba(168,85,247,.9)', 'rgba(56,189,248,.8)'][Math.floor(Math.random() * 3)]
  }))
  const resize = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0) }
  resize(); addEventListener('resize', resize, { passive: true })
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const loop = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy
      if (p.x < 0) p.x = innerWidth; if (p.x > innerWidth) p.x = 0
      if (p.y < 0) p.y = innerHeight; if (p.y > innerHeight) p.y = 0
      ctx.globalAlpha = p.a; ctx.fillStyle = p.c
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    requestAnimationFrame(loop)
  }
  loop()
}

function setupDrop() {
  $dropZone.addEventListener('click', () => $fileInput.click())
  $dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $fileInput.click() })
  $dropZone.addEventListener('dragover', e => { e.preventDefault(); $dropZone.classList.add('drag-over') })
  $dropZone.addEventListener('dragleave', () => $dropZone.classList.remove('drag-over'))
  $dropZone.addEventListener('drop', e => {
    e.preventDefault(); $dropZone.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]; if (file) loadFile(file)
  })
  $fileInput.addEventListener('change', () => { if ($fileInput.files[0]) loadFile($fileInput.files[0]) })
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop', e => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && /\.(jsonl|json|ndjson)$/i.test(file.name)) loadFile(file)
  })
}

async function loadFile(file) {
  loadTraceText(await file.text(), file.name)
}

async function loadDemo() {
  try {
    const [traceRes, summaryRes] = await Promise.all([
      fetch('./demo/trace.jsonl'),
      fetch('./demo/summary.md').catch(() => null)
    ])
    if (!traceRes.ok) throw new Error('Demo trace not found')
    const text = await traceRes.text()
    const summary = summaryRes ? await summaryRes.text() : null
    loadTraceText(text, 'triple-run-2026-08-15/trace.jsonl', summary)
  } catch (err) {
    showToast('❌ ' + err.message, 'error')
  }
}

function loadTraceText(text, filename, summary = null) {
  const raw = parseJSONL(text)
  if (!raw.length) return showToast('⚠️ No valid events found', 'warn')
  const events = normalizeEvents(raw)
  state.events = events
  state.filtered = events
  state.stats = computeStats(events)
  state.filename = filename
  state.activeTypes = new Set()
  state.selectedEvent = null
  state.summaryMarkdown = summary
  stopPlayback()
  state.playback = { playing: false, idx: 0, timer: null, speed: state.playback?.speed || 1 }
  showViewer()
  renderAll()
  showToast(t('toast_loaded') + ` (${events.length} ${t('events')})`)
  // auto-start subtle playback after short delay
  setTimeout(() => { if (!state.playback.playing) startPlayback() }, 600)
}

function showViewer() {
  $hero.classList.remove('visible'); $hero.classList.add('hidden')
  $viewer.classList.remove('hidden')
  document.body.classList.add('viewer-on')
}
function showHero() {
  stopPlayback()
  $viewer.classList.add('hidden')
  $hero.classList.remove('hidden'); $hero.classList.add('visible')
  document.body.classList.remove('viewer-on')
  closeDrawer()
}

function renderAll() {
  updateToolbar()
  renderTypeFilters()
  renderSummary()
  ensurePlaybackBar()
  renderLanes()
  renderLegend()
  applyPlaybackHighlight()
}

function updateToolbar() {
  const { count, agents, durationMs } = state.stats
  $filename.textContent = state.filename.split('/').pop()
  $stats.textContent = `${count} ${t('events')} · ${agents.length} ${t('agents')} · ${formatDuration(durationMs)}`
}

function renderTypeFilters() {
  const types = getAllTypeKeys(state.events)
  $typeFilters.innerHTML = ''
  for (const type of types) {
    const col = getTypeColor(type)
    const chip = document.createElement('button')
    chip.className = 'chip' + (state.activeTypes.has(type) ? '' : ' active')
    chip.textContent = type
    chip.style.borderColor = col.border
    chip.style.color = '#fff'
    chip.style.background = col.bg
    chip.onclick = () => toggleTypeFilter(type)
    $typeFilters.appendChild(chip)
  }
}

function toggleTypeFilter(type) {
  if (state.activeTypes.has(type)) state.activeTypes.delete(type)
  else state.activeTypes.add(type)
  applyFilters()
}

function applyFilters() {
  state.filtered = state.activeTypes.size === 0
    ? state.events
    : state.events.filter(e => !state.activeTypes.has(e.type))
  // keep playback index in range
  state.playback.idx = Math.min(state.playback.idx, Math.max(0, state.filtered.length - 1))
  renderTypeFilters()
  ensurePlaybackBar()
  renderLanes()
  applyPlaybackHighlight()
}

function renderSummary() {
  if (!state.summaryMarkdown) { $summaryBar.classList.add('hidden'); return }
  const html = state.summaryMarkdown
    .replace(/^#+\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n{2,}/g, ' · ')
    .replace(/\n/g, ' ')
  $summaryContent.innerHTML = html.slice(0, 480) + (html.length > 480 ? '…' : '')
  $summaryBar.classList.remove('hidden')
  $('btn-close-summary').onclick = () => $summaryBar.classList.add('hidden')
}

function ensurePlaybackBar() {
  let bar = $('playback-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'playback-bar'
    $('toolbar')?.insertAdjacentElement('afterend', bar)
  }
  const max = Math.max(state.filtered.length - 1, 0)
  bar.innerHTML = `
    <button id="btn-play" class="btn-sm btn-ghost">${state.playback.playing ? '⏸ Pause' : '▶ Play'}</button>
    <button id="btn-step" class="btn-sm btn-ghost">⏭</button>
    <button id="btn-replay" class="btn-sm btn-ghost">⟲</button>
    <label class="speed-label">Speed
      <select id="play-speed">
        <option value="0.5">0.5×</option>
        <option value="1">1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
      </select>
    </label>
    <div class="scrub-wrap">
      <div class="scrub-fill" id="scrub-fill"></div>
      <input id="play-scrub" type="range" min="0" max="${max}" value="${state.playback.idx}" />
    </div>
    <span id="play-pos">${state.filtered.length ? state.playback.idx + 1 : 0}/${state.filtered.length}</span>
  `
  const speed = bar.querySelector('#play-speed')
  if (speed) speed.value = String(state.playback.speed)
  bar.querySelector('#btn-play').onclick = togglePlayback
  bar.querySelector('#btn-step').onclick = () => { stopPlayback(); stepPlayback(1) }
  bar.querySelector('#btn-replay').onclick = () => { stopPlayback(); state.playback.idx = 0; applyPlaybackHighlight(true); ensurePlaybackBar() }
  bar.querySelector('#play-speed').onchange = e => { state.playback.speed = Number(e.target.value) || 1 }
  bar.querySelector('#play-scrub').oninput = e => {
    stopPlayback()
    state.playback.idx = Number(e.target.value) || 0
    applyPlaybackHighlight(true)
    updateScrubFill()
  }
  updateScrubFill()
}

function updateScrubFill() {
  const max = Math.max(state.filtered.length - 1, 1)
  const pct = (state.playback.idx / max) * 100
  const fill = $('scrub-fill')
  if (fill) fill.style.width = pct + '%'
}

function togglePlayback() {
  if (state.playback.playing) stopPlayback()
  else startPlayback()
  ensurePlaybackBar()
}

function startPlayback() {
  if (!state.filtered.length) return
  state.playback.playing = true
  const tick = () => {
    if (!state.playback.playing) return
    if (state.playback.idx >= state.filtered.length - 1) {
      stopPlayback(); ensurePlaybackBar(); return
    }
    state.playback.idx += 1
    applyPlaybackHighlight(true)
    updateScrubFill()
    const pos = $('play-pos')
    if (pos) pos.textContent = `${state.playback.idx + 1}/${state.filtered.length}`
    const scrub = $('play-scrub')
    if (scrub) scrub.value = String(state.playback.idx)
    state.playback.timer = setTimeout(tick, 650 / (state.playback.speed || 1))
  }
  state.playback.timer = setTimeout(tick, 180)
}

function stopPlayback() {
  state.playback.playing = false
  if (state.playback.timer) clearTimeout(state.playback.timer)
  state.playback.timer = null
}

function stepPlayback(delta) {
  state.playback.idx = Math.max(0, Math.min(state.filtered.length - 1, state.playback.idx + delta))
  applyPlaybackHighlight(true)
  ensurePlaybackBar()
}

function applyPlaybackHighlight(open = false) {
  const ev = state.filtered[state.playback.idx]
  // playhead
  const head = $('playhead')
  if (head && ev && state.stats?.durationMs && ev.ts) {
    const ratio = (new Date(ev.ts).getTime() - state.stats.startMs) / state.stats.durationMs
    head.style.left = `calc(130px + ${Math.max(0, Math.min(1, ratio)) * 100}% * 1)` // fallback below
  }
  document.querySelectorAll('.event-block').forEach(b => {
    const idx = Number(b.dataset.idx)
    b.classList.toggle('is-current', !!(ev && idx === ev._idx))
    b.classList.toggle('is-past', !!(ev && idx <= ev._idx))
    b.classList.toggle('is-future', !!(ev && idx > ev._idx))
  })
  // move playhead precisely using current block
  if (ev) {
    const block = document.querySelector(`.event-block[data-idx="${ev._idx}"]`)
    const laneTrack = block?.parentElement
    const ph = $('playhead')
    if (block && laneTrack && ph) {
      const left = block.offsetLeft + 130
      ph.style.transform = `translateX(${left}px)`
      ph.classList.add('on')
    }
    if (open) {
      document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
      block?.classList.add('selected')
      openDrawer(ev)
      block?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }
  updateScrubFill()
}

function renderLanes() {
  $lanes.innerHTML = ''
  $ruler.innerHTML = ''
  const events = state.filtered
  if (!events.length) {
    $lanes.innerHTML = `<p class="scroll-hint">${t('no_trace')}</p>`
    return
  }
  const groupMap = groupByAgent(events)
  const agents = [...groupMap.keys()]
  const containerW = $lanes.parentElement.clientWidth - 130 - 40
  const trackW = Math.max(containerW, 560)

  // global playhead layer
  let stage = $('lane-stage')
  if (!stage) {
    stage = document.createElement('div')
    stage.id = 'lane-stage'
    $lanes.parentElement.insertBefore(stage, $lanes)
  }
  stage.innerHTML = `<div id="playhead" class="playhead"><i></i></div>`
  // move lanes into stage if needed
  if ($lanes.parentElement !== stage) stage.appendChild($lanes)

  renderRuler(state.stats, trackW)

  for (const agent of agents) {
    const agentEvents = groupMap.get(agent)
    $lanes.appendChild(createLane(agent, agentEvents, trackW))
  }
}

function renderRuler(stats, trackW) {
  const origin = document.createElement('div')
  origin.className = 'ruler-origin'
  $ruler.appendChild(origin)
  const track = document.createElement('div')
  track.className = 'ruler-track'
  track.style.width = trackW + 'px'
  const ticks = 8
  for (let i = 0; i <= ticks; i++) {
    const pct = i / ticks
    const label = document.createElement('span')
    label.className = 'ruler-label'
    label.style.left = (pct * 100) + '%'
    const ms = stats.startMs + pct * stats.durationMs
    label.textContent = stats.durationMs ? formatTimestamp(new Date(ms).toISOString()) : `+${(pct * stats.durationMs / 1000).toFixed(0)}s`
    track.appendChild(label)
  }
  $ruler.appendChild(track)
}

function createLane(agent, events, trackW) {
  const col = getAgentColor(agent)
  const lane = document.createElement('div')
  lane.className = 'lane'
  lane.style.setProperty('--agent', col.bg)

  const label = document.createElement('div')
  label.className = 'lane-label'
  label.innerHTML = `<span class="dot" style="background:${col.bg}"></span>${col.label || agent}`
  label.style.color = col.bg

  const track = document.createElement('div')
  track.className = 'lane-track'
  track.style.width = trackW + 'px'

  // connector path
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('lane-links')
  svg.setAttribute('width', String(trackW))
  svg.setAttribute('height', '64')
  track.appendChild(svg)

  const blocks = []
  for (const ev of events) {
    const block = createEventBlock(ev, trackW, events)
    track.appendChild(block)
    blocks.push({ ev, block })
  }

  // draw links after layout
  requestAnimationFrame(() => {
    let d = ''
    for (let i = 0; i < blocks.length - 1; i++) {
      const a = blocks[i].block
      const b = blocks[i + 1].block
      const x1 = a.offsetLeft + a.offsetWidth
      const x2 = b.offsetLeft
      const y = 32
      if (x2 > x1) d += `M ${x1} ${y} C ${x1 + 20} ${y}, ${x2 - 20} ${y}, ${x2} ${y} `
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('stroke', col.bg)
    path.setAttribute('stroke-opacity', '0.35')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-dasharray', '4 6')
    path.classList.add('link-path')
    svg.appendChild(path)
  })

  lane.appendChild(label)
  lane.appendChild(track)
  return lane
}

function createEventBlock(ev, trackW, agentEvents = []) {
  const col = getTypeColor(ev.type)
  const block = document.createElement('div')
  block.className = 'event-block'
  block.dataset.idx = String(ev._idx)
  block.style.background = col.bg
  block.style.borderColor = col.border
  if (ev.type === 'error') block.classList.add('is-error')

  let left = 8
  let width = Math.max(56, Math.min(120, trackW / Math.max(state.events.length, 1) * 1.4))
  if (ev.ts && state.stats.durationMs) {
    const tsMs = new Date(ev.ts).getTime()
    const ratio = (tsMs - state.stats.startMs) / state.stats.durationMs
    left = Math.max(4, Math.round(ratio * trackW))
    const next = agentEvents.find(e => e._idx > ev._idx && e.ts)
    if (next) {
      const nMs = new Date(next.ts).getTime()
      const wRatio = Math.max(0, (nMs - tsMs) / state.stats.durationMs)
      width = Math.max(48, Math.min(160, Math.round(wRatio * trackW * 0.85)))
    }
  }
  block.style.left = left + 'px'
  block.style.width = width + 'px'

  const type = document.createElement('span')
  type.className = 'event-block-label'
  type.textContent = (ev.type === 'phase_start' || ev.type === 'phase_end') ? (ev.phase || ev.type) : ev.type
  block.appendChild(type)

  if (ev.message) {
    const msg = document.createElement('span')
    msg.className = 'event-block-msg'
    msg.textContent = String(ev.message).slice(0, 64)
    block.appendChild(msg)
  }

  block.title = `[${ev.type}] ${ev.message || ''}`
  block.addEventListener('click', (e) => {
    e.stopPropagation()
    stopPlayback()
    const i = state.filtered.findIndex(x => x._idx === ev._idx)
    if (i >= 0) state.playback.idx = i
    document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
    block.classList.add('selected')
    applyPlaybackHighlight(false)
    openDrawer(ev)
    ensurePlaybackBar()
  })
  return block
}

function renderLegend() {
  $legend.innerHTML = ''
  for (const type of getAllTypeKeys(state.events)) {
    const col = getTypeColor(type)
    const item = document.createElement('div')
    item.className = 'legend-item'
    item.innerHTML = `<div class="legend-dot" style="background:${col.border}"></div><span>${type}</span>`
    $legend.appendChild(item)
  }
  for (const agent of getAllAgentKeys(state.events)) {
    const col = getAgentColor(agent)
    const item = document.createElement('div')
    item.className = 'legend-item'
    item.innerHTML = `<div class="legend-dot" style="background:${col.bg};border-radius:50%"></div><span>${col.label || agent}</span>`
    $legend.appendChild(item)
  }
}

function openDrawer(ev) {
  state.selectedEvent = ev
  const col = getTypeColor(ev.type)
  const badge = $('drawer-event-type')
  badge.textContent = ev.type
  badge.style.background = col.bg
  badge.style.borderColor = col.border
  badge.style.color = col.border
  $('drawer-agent').textContent = ev.agent || '—'
  $('drawer-phase').textContent = ev.phase || '—'
  $('drawer-time').textContent = formatTimestamp(ev.ts)

  const agentEvents = state.events.filter(e => e.agent === ev.agent && e.phase === ev.phase)
  const times = agentEvents.map(e => e.ts ? new Date(e.ts).getTime() : NaN).filter(Number.isFinite)
  const $durRow = $('drawer-duration-row')
  if (times.length >= 2) {
    $('drawer-duration').textContent = formatDuration(Math.max(...times) - Math.min(...times))
    $durRow.classList.remove('hidden')
  } else $durRow.classList.add('hidden')

  $('drawer-message').textContent = ev.message || '—'
  $('drawer-raw').textContent = JSON.stringify(ev._raw, null, 2)
  $drawer.classList.remove('hidden'); $drawer.classList.add('open')
  $backdrop.classList.remove('hidden'); $backdrop.classList.add('open')
}

function closeDrawer() {
  $drawer.classList.remove('open'); $backdrop.classList.remove('open')
  setTimeout(() => { $drawer.classList.add('hidden'); $backdrop.classList.add('hidden') }, 260)
  document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
  state.selectedEvent = null
}

function shareTrace() {
  if (!state.events.length) return
  if (state.events.length > 50) return showToast(t('toast_share_small'))
  const encoded = encodeTraceURL(state.events)
  const url = location.origin + location.pathname + '#trace=' + encoded
  document.querySelector('.share-popup')?.remove()
  const popup = document.createElement('div')
  popup.className = 'share-popup'
  popup.innerHTML = `
    <div class="share-popup-title">${t('share_title')}</div>
    <p style="font-size:11px;color:var(--text-dim)">${t('share_note')}</p>
    <input readonly value="${url}" id="share-url-input"/>
    <button class="btn-primary" style="font-size:12px;padding:6px 16px" id="btn-copy-url">Copy</button>`
  document.body.appendChild(popup)
  $('share-url-input').select()
  $('btn-copy-url').onclick = () => navigator.clipboard.writeText(url).then(() => { showToast(t('toast_copied')); popup.remove() })
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 100)
}

function exportSnapshot() {
  const html = `<!doctype html><meta charset=utf-8><title>Traceboard Snapshot</title>
  <body style="font-family:monospace;background:#060d1a;color:#e2e8f0;padding:24px">
  <h1 style="color:#00e5c7">Traceboard Snapshot</h1>
  <div style="color:#64748b;margin-bottom:16px">${state.filename} · ${state.events.length} events · ${new Date().toISOString()}</div>
  <table style="border-collapse:collapse;width:100%;font-size:12px">
  <tr style="background:#112240"><th>Time</th><th>Type</th><th>Agent</th><th>Phase</th><th>Message</th></tr>
  ${state.filtered.map(ev => `<tr>
    <td style="border:1px solid #1e3a5f;padding:5px 8px">${formatTimestamp(ev.ts)}</td>
    <td style="border:1px solid #1e3a5f;padding:5px 8px">${ev.type}</td>
    <td style="border:1px solid #1e3a5f;padding:5px 8px">${ev.agent}</td>
    <td style="border:1px solid #1e3a5f;padding:5px 8px">${ev.phase || ''}</td>
    <td style="border:1px solid #1e3a5f;padding:5px 8px">${(ev.message || '').replace(/</g, '<')}</td>
  </tr>`).join('')}
  </table>`
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'traceboard-snapshot.html'; a.click()
  showToast(t('toast_export'))
}

function checkURLHash() {
  const hash = location.hash
  if (!hash.startsWith('#trace=')) return
  const raw = decodeTraceURL(hash.slice('#trace='.length))
  if (raw?.length) loadTraceText(raw.map(e => JSON.stringify(e)).join('\n'), 'shared-trace.jsonl')
}

let toastTimer
function showToast(msg, type = 'info') {
  $toast.textContent = msg
  $toast.classList.remove('hidden')
  $toast.style.borderColor = type === 'error' ? 'var(--rose)' : 'var(--teal)'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $toast.classList.add('hidden'), 3200)
}

function setupButtons() {
  $btnDemo.onclick = loadDemo
  $btnLang.onclick = () => { setLang(currentLang === 'en' ? 'zh' : 'en'); if (state.stats) updateToolbar() }
  $btnShare.onclick = shareTrace
  $btnExport.onclick = exportSnapshot
  $btnBack.onclick = showHero
  $btnReset.onclick = () => { state.activeTypes.clear(); applyFilters() }
  $('btn-close-drawer').onclick = closeDrawer
  $backdrop.onclick = closeDrawer
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrawer()
    if (!state.events.length) return
    if (e.key === ' ') { e.preventDefault(); togglePlayback(); ensurePlaybackBar() }
    if (e.key === 'ArrowRight') { stopPlayback(); stepPlayback(1) }
    if (e.key === 'ArrowLeft') { stopPlayback(); stepPlayback(-1) }
  })
  let resizeTimer
  addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { if (state.events.length) renderLanes() }, 200)
  })
}

init()
