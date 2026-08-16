/**
 * Traceboard — main entry point
 * Aurora dark theme · multi-agent trace player · zero backend
 */
import { setLang, t, currentLang } from './i18n.js'
import { getAgentColor, getTypeColor, getAllTypeKeys, getAllAgentKeys } from './colors.js'
import {
  parseJSONL, normalizeEvents, computeStats,
  groupByAgent, formatDuration, formatTimestamp,
  encodeTraceURL, decodeTraceURL
} from './trace.js'

// ── State ──────────────────────────────────────────────────
let state = {
  events: [],
  filtered: [],
  stats: null,
  activeTypes: new Set(),
  selectedEvent: null,
  filename: 'trace.jsonl',
  summaryMarkdown: null,
  playback: { playing: false, idx: 0, timer: null, speed: 1 },
  agentFilter: new Set(),
}

// ── DOM refs ───────────────────────────────────────────────
const $hero       = document.getElementById('hero')
const $viewer     = document.getElementById('trace-viewer')
const $dropZone   = document.getElementById('drop-zone')
const $fileInput  = document.getElementById('file-input')
const $btnDemo    = document.getElementById('btn-demo')
const $btnLang    = document.getElementById('btn-lang')
const $btnShare   = document.getElementById('btn-share')
const $btnExport  = document.getElementById('btn-export')
const $btnBack    = document.getElementById('btn-back')
const $btnReset   = document.getElementById('btn-reset-view')
const $typeFilters = document.getElementById('type-filters')
const $lanes      = document.getElementById('lanes')
const $legend     = document.getElementById('legend')
const $ruler      = document.getElementById('time-ruler')
const $filename   = document.getElementById('trace-filename')
const $stats      = document.getElementById('trace-stats')
const $toast      = document.getElementById('toast')
const $drawer     = document.getElementById('detail-drawer')
const $backdrop   = document.getElementById('drawer-backdrop')
const $summaryBar = document.getElementById('summary-bar')
const $summaryContent = document.getElementById('summary-content')

// ── Init ───────────────────────────────────────────────────
async function init() {
  setLang('en')
  setupDrop()
  setupButtons()
  ensureThemeDock()
  checkURLHash()
}

function ensureThemeDock() {
  if (document.getElementById('tb-theme-dock')) return
  const dock = document.createElement('div')
  dock.id = 'tb-theme-dock'
  dock.innerHTML = `
    <button id="tb-theme-toggle" class="tb-theme-toggle" title="Background">🎨</button>
    <div id="tb-theme-panel" class="tb-theme-panel" hidden>
      <div class="tb-theme-title">Background</div>
      <div class="tb-theme-presets">
        <button data-bg="aurora" class="tb-preset active">Aurora</button>
        <button data-bg="midnight" class="tb-preset">Midnight</button>
        <button data-bg="nebula" class="tb-preset">Nebula</button>
        <button data-bg="ember" class="tb-preset">Ember</button>
      </div>
      <label class="tb-theme-upload">Custom image / GIF
        <input id="tb-bg-upload" type="file" accept="image/*,.gif" hidden />
      </label>
      <input id="tb-bg-opacity" type="range" min="10" max="85" value="30" />
      <button id="tb-bg-clear" class="btn-ghost btn-sm">Clear custom</button>
    </div>
    <div id="tb-custom-bg" class="tb-custom-bg" aria-hidden="true"></div>
  `
  document.body.appendChild(dock)
  const preset = localStorage.getItem('tb_bg_preset') || 'aurora'
  document.documentElement.dataset.bg = preset
  dock.querySelectorAll('.tb-preset').forEach(b => b.classList.toggle('active', b.dataset.bg === preset))
  const op = localStorage.getItem('tb_bg_opacity') || '30'
  document.documentElement.style.setProperty('--tb-custom-opacity', String(Number(op)/100))
  const opEl = dock.querySelector('#tb-bg-opacity'); if (opEl) opEl.value = op
  const custom = localStorage.getItem('tb_bg_custom'); if (custom) applyTbCustom(custom)

  dock.querySelector('#tb-theme-toggle').addEventListener('click', e => {
    e.stopPropagation()
    const p = dock.querySelector('#tb-theme-panel')
    p.hidden = !p.hidden
  })
  dock.querySelectorAll('.tb-preset').forEach(btn => btn.addEventListener('click', () => {
    localStorage.setItem('tb_bg_preset', btn.dataset.bg)
    document.documentElement.dataset.bg = btn.dataset.bg
    dock.querySelectorAll('.tb-preset').forEach(b => b.classList.toggle('active', b === btn))
  }))
  dock.querySelector('#tb-bg-upload').addEventListener('change', e => {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader()
    r.onload = () => { try { localStorage.setItem('tb_bg_custom', r.result) } catch {} ; applyTbCustom(r.result) }
    r.readAsDataURL(f)
  })
  dock.querySelector('#tb-bg-opacity').addEventListener('input', e => {
    localStorage.setItem('tb_bg_opacity', e.target.value)
    document.documentElement.style.setProperty('--tb-custom-opacity', String(Number(e.target.value)/100))
  })
  dock.querySelector('#tb-bg-clear').addEventListener('click', () => {
    localStorage.removeItem('tb_bg_custom'); applyTbCustom(null)
  })
}

function applyTbCustom(url) {
  const layer = document.getElementById('tb-custom-bg')
  if (!layer) return
  if (url) { layer.style.backgroundImage = `url(${url})`; layer.classList.add('show') }
  else { layer.style.backgroundImage = ''; layer.classList.remove('show') }
}

// ── Drag & Drop ────────────────────────────────────────────
function setupDrop() {
  $dropZone.addEventListener('click', () => $fileInput.click())
  $dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $fileInput.click() })

  $dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    $dropZone.classList.add('drag-over')
  })
  $dropZone.addEventListener('dragleave', () => $dropZone.classList.remove('drag-over'))
  $dropZone.addEventListener('drop', e => {
    e.preventDefault()
    $dropZone.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  })

  $fileInput.addEventListener('change', () => {
    if ($fileInput.files[0]) loadFile($fileInput.files[0])
  })

  // Also allow drop on body
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop', e => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.jsonl') || file.name.endsWith('.json') || file.name.endsWith('.ndjson'))) {
      loadFile(file)
    }
  })
}

async function loadFile(file) {
  const text = await file.text()
  state.filename = file.name
  loadTraceText(text, file.name)
}

// ── Demo load ──────────────────────────────────────────────
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

// ── Core loader ────────────────────────────────────────────
function loadTraceText(text, filename, summary = null) {
  const raw = parseJSONL(text)
  if (!raw.length) {
    showToast('⚠️ No valid events found', 'warn')
    return
  }

  const events = normalizeEvents(raw)
  const stats  = computeStats(events)

  state.events    = events
  state.filtered  = events
  state.stats     = stats
  state.filename  = filename
  state.activeTypes = new Set()
  state.selectedEvent = null
  state.summaryMarkdown = summary
  stopPlayback()
  state.playback = { playing: false, idx: 0, timer: null, speed: state.playback?.speed || 1 }

  showViewer()
  renderAll()
  showToast(t('toast_loaded') + ` (${events.length} ${t('events')})`)
}

// ── Show / hide views ──────────────────────────────────────
function showViewer() {
  $hero.classList.remove('visible')
  $hero.classList.add('hidden')
  $viewer.classList.remove('hidden')
}

function showHero() {
  $viewer.classList.add('hidden')
  $hero.classList.remove('hidden')
  $hero.classList.add('visible')
  closeDrawer()
}

// ── Render all ─────────────────────────────────────────────
function renderAll() {
  updateToolbar()
  renderTypeFilters()
  renderSummary()
  ensurePlaybackBar()
  renderLanes()
  renderLegend()
  applyPlaybackHighlight()
}

function ensurePlaybackBar() {
  let bar = document.getElementById('playback-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'playback-bar'
    const host = document.getElementById('toolbar')
    host?.insertAdjacentElement('afterend', bar)
  }
  bar.innerHTML = `
    <button id="btn-play" class="btn-sm btn-ghost">${state.playback.playing ? '⏸ Pause' : '▶ Play'}</button>
    <button id="btn-step" class="btn-sm btn-ghost">⏭ Step</button>
    <button id="btn-replay" class="btn-sm btn-ghost">⟲ Restart</button>
    <label class="speed-label">Speed
      <select id="play-speed">
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
      </select>
    </label>
    <input id="play-scrub" type="range" min="0" max="${Math.max(state.filtered.length - 1, 0)}" value="${state.playback.idx}" />
    <span id="play-pos">${Math.min(state.playback.idx + 1, state.filtered.length)} / ${state.filtered.length}</span>
  `
  const speed = bar.querySelector('#play-speed')
  if (speed) speed.value = String(state.playback.speed)
  bar.querySelector('#btn-play')?.addEventListener('click', togglePlayback)
  bar.querySelector('#btn-step')?.addEventListener('click', () => { stopPlayback(); stepPlayback(1) })
  bar.querySelector('#btn-replay')?.addEventListener('click', () => { stopPlayback(); state.playback.idx = 0; applyPlaybackHighlight(true) })
  bar.querySelector('#play-speed')?.addEventListener('change', e => { state.playback.speed = Number(e.target.value) || 1 })
  bar.querySelector('#play-scrub')?.addEventListener('input', e => {
    stopPlayback()
    state.playback.idx = Number(e.target.value) || 0
    applyPlaybackHighlight(true)
  })
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
    const base = 700
    state.playback.timer = setTimeout(tick, base / (state.playback.speed || 1))
  }
  state.playback.timer = setTimeout(tick, 200)
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
  document.querySelectorAll('.event-block').forEach(b => {
    const idx = Number(b.dataset.idx)
    b.classList.toggle('is-current', ev && idx === ev._idx)
    b.classList.toggle('is-past', ev && idx < ev._idx)
  })
  const pos = document.getElementById('play-pos')
  if (pos) pos.textContent = `${Math.min(state.playback.idx + 1, state.filtered.length)} / ${state.filtered.length}`
  const scrub = document.getElementById('play-scrub')
  if (scrub) scrub.value = String(state.playback.idx)
  if (open && ev) {
    document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
    document.querySelector(`.event-block[data-idx="${ev._idx}"]`)?.classList.add('selected')
    openDrawer(ev)
  }
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
    chip.style.color = state.activeTypes.has(type) ? col.border : '#fff'
    chip.style.background = state.activeTypes.has(type) ? col.bg : col.bg
    chip.addEventListener('click', () => toggleTypeFilter(type))
    $typeFilters.appendChild(chip)
  }
}

function toggleTypeFilter(type) {
  if (state.activeTypes.has(type)) {
    state.activeTypes.delete(type)
  } else {
    state.activeTypes.add(type)
  }
  applyFilters()
}

function applyFilters() {
  if (state.activeTypes.size === 0) {
    state.filtered = state.events
  } else {
    state.filtered = state.events.filter(e => !state.activeTypes.has(e.type))
  }
  renderTypeFilters()
  renderLanes()
}

// ── Summary bar ────────────────────────────────────────────
function renderSummary() {
  if (!state.summaryMarkdown) {
    $summaryBar.classList.add('hidden')
    return
  }
  // Convert basic markdown to HTML (just headings, bold, links)
  const html = state.summaryMarkdown
    .replace(/^#+\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n{2,}/g, ' &nbsp;·&nbsp; ')
    .replace(/\n/g, ' ')
    .slice(0, 400) + '...'
  $summaryContent.innerHTML = html
  $summaryBar.classList.remove('hidden')
  document.getElementById('btn-close-summary').addEventListener('click', () => {
    $summaryBar.classList.add('hidden')
  }, { once: true })
}

// ── Swimlanes ──────────────────────────────────────────────
function renderLanes() {
  $lanes.innerHTML = ''
  $ruler.innerHTML = ''

  const events = state.filtered
  if (!events.length) {
    $lanes.innerHTML = `<p class="scroll-hint">${t('no_trace')}</p>`
    return
  }

  const groupMap = groupByAgent(events)
  const agents   = [...groupMap.keys()]

  // Compute timeline scale
  const containerW = $lanes.parentElement.clientWidth - 130 - 40
  const trackW = Math.max(containerW, 400)

  renderRuler(state.stats, trackW)

  for (const agent of agents) {
    const agentEvents = groupMap.get(agent)
    const lane = createLane(agent, agentEvents, trackW)
    $lanes.appendChild(lane)
  }
}

function renderRuler(stats, trackW) {
  const rulerOrigin = document.createElement('div')
  rulerOrigin.className = 'ruler-origin'
  $ruler.appendChild(rulerOrigin)

  const rulerTrack = document.createElement('div')
  rulerTrack.style.flex = '1'
  rulerTrack.style.position = 'relative'
  rulerTrack.style.height = '20px'

  // Add tick marks
  const ticks = 6
  for (let i = 0; i <= ticks; i++) {
    const pct = i / ticks
    const label = document.createElement('span')
    label.className = 'ruler-label'
    label.style.position = 'absolute'
    label.style.left = (pct * 100) + '%'
    label.style.transform = 'translateX(-50%)'
    const ms = stats.startMs + pct * stats.durationMs
    label.textContent = stats.durationMs
      ? formatTimestamp(new Date(ms).toISOString())
      : '+'  + (pct * stats.durationMs / 1000).toFixed(0) + 's'
    rulerTrack.appendChild(label)
  }
  $ruler.appendChild(rulerTrack)
}

function createLane(agent, events, trackW) {
  const col = getAgentColor(agent)
  const lane = document.createElement('div')
  lane.className = 'lane'

  const label = document.createElement('div')
  label.className = 'lane-label'
  label.textContent = col.label || agent
  label.style.color = col.bg

  const track = document.createElement('div')
  track.className = 'lane-track'
  track.style.width = trackW + 'px'

  // Render phase phase dividers
  const phases = [...new Set(events.filter(e => e.phase).map(e => e.phase))]
  for (const phase of phases) {
    const phaseEvents = events.filter(e => e.phase === phase)
    if (!phaseEvents.length) continue
    const startTs = phaseEvents.map(e => e.ts ? new Date(e.ts).getTime() : null).filter(Boolean)
    if (!startTs.length) continue
    const minTs = Math.min(...startTs)
    const pct = state.stats.durationMs
      ? (minTs - state.stats.startMs) / state.stats.durationMs
      : 0
    const div = document.createElement('div')
    div.className = 'phase-divider'
    div.style.left = (pct * trackW) + 'px'
    const lbl = document.createElement('span')
    lbl.className = 'phase-label'
    lbl.textContent = phase
    div.appendChild(lbl)
    track.appendChild(div)
  }

  // Render event blocks
  for (const ev of events) {
    const block = createEventBlock(ev, trackW, events)
    track.appendChild(block)
  }

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

  // Position + width from timestamp span to next event on lane
  let left = 4
  let width = Math.max(14, Math.min(72, (trackW / Math.max(state.events.length, 1)) * 1.1))
  if (ev.ts && state.stats.durationMs) {
    const tsMs = new Date(ev.ts).getTime()
    const ratio = (tsMs - state.stats.startMs) / state.stats.durationMs
    left = Math.max(4, Math.round(ratio * trackW))
    const next = agentEvents.find(e => e._idx > ev._idx && e.ts)
    if (next) {
      const nMs = new Date(next.ts).getTime()
      const wRatio = Math.max(0, (nMs - tsMs) / state.stats.durationMs)
      width = Math.max(16, Math.min(140, Math.round(wRatio * trackW * 0.92)))
    }
  }
  block.style.left = left + 'px'
  block.style.width = width + 'px'

  const lbl = document.createElement('span')
  lbl.className = 'event-block-label'
  lbl.textContent = ev.type === 'phase_start' || ev.type === 'phase_end'
    ? (ev.phase || ev.type)
    : ev.type
  block.appendChild(lbl)

  if (ev.message) {
    const msg = document.createElement('span')
    msg.className = 'event-block-msg'
    msg.textContent = String(ev.message).slice(0, 48)
    block.appendChild(msg)
  }

  block.title = `[${ev.type}] ${ev.message || ''}`

  block.addEventListener('click', (e) => {
    e.stopPropagation()
    document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
    block.classList.add('selected')
    openDrawer(ev)
  })

  return block
}

// ── Legend ─────────────────────────────────────────────────
function renderLegend() {
  $legend.innerHTML = ''
  const types = getAllTypeKeys(state.events)
  for (const type of types) {
    const col = getTypeColor(type)
    const item = document.createElement('div')
    item.className = 'legend-item'
    const dot = document.createElement('div')
    dot.className = 'legend-dot'
    dot.style.background = col.border
    const lbl = document.createElement('span')
    lbl.textContent = type
    item.appendChild(dot)
    item.appendChild(lbl)
    $legend.appendChild(item)
  }

  // Agent legend
  const agents = getAllAgentKeys(state.events)
  for (const agent of agents) {
    const col = getAgentColor(agent)
    const item = document.createElement('div')
    item.className = 'legend-item'
    const dot = document.createElement('div')
    dot.className = 'legend-dot'
    dot.style.background = col.bg
    dot.style.borderRadius = '50%'
    const lbl = document.createElement('span')
    lbl.textContent = col.label || agent
    item.appendChild(dot)
    item.appendChild(lbl)
    $legend.appendChild(item)
  }
}

// ── Drawer ─────────────────────────────────────────────────
function openDrawer(ev) {
  state.selectedEvent = ev
  const col = getTypeColor(ev.type)

  const badge = document.getElementById('drawer-event-type')
  badge.textContent = ev.type
  badge.style.background = col.bg
  badge.style.borderColor = col.border
  badge.style.color = col.border

  document.getElementById('drawer-agent').textContent = ev.agent || '—'
  document.getElementById('drawer-phase').textContent = ev.phase || '—'
  document.getElementById('drawer-time').textContent = formatTimestamp(ev.ts)

  const agentEvents = state.events.filter(e => e.agent === ev.agent && e.phase === ev.phase)
  const startTs = Math.min(...agentEvents.map(e => e.ts ? new Date(e.ts).getTime() : Infinity).filter(isFinite))
  const endTs   = Math.max(...agentEvents.map(e => e.ts ? new Date(e.ts).getTime() : -Infinity).filter(isFinite))
  const durMs   = isFinite(endTs - startTs) ? endTs - startTs : null
  const $durRow = document.getElementById('drawer-duration-row')
  if (durMs !== null && durMs > 0) {
    document.getElementById('drawer-duration').textContent = formatDuration(durMs)
    $durRow.classList.remove('hidden')
  } else {
    $durRow.classList.add('hidden')
  }

  document.getElementById('drawer-message').textContent = ev.message || '—'
  document.getElementById('drawer-raw').textContent = JSON.stringify(ev._raw, null, 2)

  $drawer.classList.remove('hidden')
  $drawer.classList.add('open')
  $backdrop.classList.remove('hidden')
  $backdrop.classList.add('open')
}

function closeDrawer() {
  $drawer.classList.remove('open')
  $backdrop.classList.remove('open')
  setTimeout(() => {
    $drawer.classList.add('hidden')
    $backdrop.classList.add('hidden')
  }, 260)
  document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
  state.selectedEvent = null
}

// ── Share ──────────────────────────────────────────────────
function shareTrace() {
  if (!state.events.length) return

  if (state.events.length > 50) {
    showToast(t('toast_share_small'))
    return
  }

  const encoded = encodeTraceURL(state.events)
  const url = location.origin + location.pathname + '#trace=' + encoded

  // Show popup
  const existing = document.querySelector('.share-popup')
  if (existing) existing.remove()

  const popup = document.createElement('div')
  popup.className = 'share-popup'
  popup.innerHTML = `
    <div class="share-popup-title">${t('share_title')}</div>
    <p style="font-size:11px;color:var(--text-dim)">${t('share_note')}</p>
    <input readonly value="${url}" id="share-url-input" />
    <button class="btn-primary" style="font-size:12px;padding:6px 16px" id="btn-copy-url">Copy</button>
  `
  document.body.appendChild(popup)

  document.getElementById('share-url-input').select()
  document.getElementById('btn-copy-url').addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      showToast(t('toast_copied'))
      popup.remove()
    })
  })

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', () => popup.remove(), { once: true })
  }, 100)
}

// ── Export snapshot ────────────────────────────────────────
function exportSnapshot() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Traceboard Snapshot — ${state.filename}</title>
<style>
body{font-family:monospace;background:#060d1a;color:#e2e8f0;padding:24px}
h1{color:#00e5c7;margin-bottom:8px}
.meta{color:#64748b;font-size:12px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:12px}
th{background:#112240;color:#94a3b8;padding:6px 10px;text-align:left;border:1px solid #1e3a5f}
td{padding:5px 10px;border:1px solid #1e3a5f;vertical-align:top}
.t-phase_start{color:#00e5c7}
.t-phase_end{color:#007a6e}
.t-agent_call{color:#a855f7}
.t-agent_result{color:#38bdf8}
.t-error{color:#f43f5e}
</style>
</head>
<body>
<h1>🌊 Traceboard Snapshot</h1>
<div class="meta">File: ${state.filename} · ${state.events.length} events · Generated: ${new Date().toISOString()}</div>
<table>
<thead><tr><th>Time</th><th>Type</th><th>Agent</th><th>Phase</th><th>Message</th></tr></thead>
<tbody>
${state.filtered.map(ev => `<tr>
  <td>${formatTimestamp(ev.ts)}</td>
  <td class="t-${ev.type}">${ev.type}</td>
  <td>${ev.agent}</td>
  <td>${ev.phase || ''}</td>
  <td>${ev.message || ''}</td>
</tr>`).join('')}
</tbody>
</table>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'traceboard-snapshot.html'
  a.click()
  URL.revokeObjectURL(url)
  showToast(t('toast_export'))
}

// ── URL hash share ─────────────────────────────────────────
function checkURLHash() {
  const hash = location.hash
  if (!hash.startsWith('#trace=')) return
  const encoded = hash.slice('#trace='.length)
  const raw = decodeTraceURL(encoded)
  if (raw && raw.length) {
    loadTraceText(raw.map(e => JSON.stringify(e)).join('\n'), 'shared-trace.jsonl')
  }
}

// ── Toast ──────────────────────────────────────────────────
let toastTimer
function showToast(msg, type = 'info') {
  $toast.textContent = msg
  $toast.classList.remove('hidden')
  $toast.style.borderColor = type === 'error' ? 'var(--rose)' : 'var(--teal)'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $toast.classList.add('hidden'), 3200)
}

// ── Button wiring ──────────────────────────────────────────
function setupButtons() {
  $btnDemo.addEventListener('click', loadDemo)
  $btnLang.addEventListener('click', () => {
    const next = currentLang === 'en' ? 'zh' : 'en'
    setLang(next)
    if (state.stats) updateToolbar()
  })
  $btnShare.addEventListener('click', shareTrace)
  $btnExport.addEventListener('click', exportSnapshot)
  $btnBack.addEventListener('click', showHero)
  $btnReset.addEventListener('click', () => {
    state.activeTypes.clear()
    applyFilters()
  })
  document.getElementById('btn-close-drawer').addEventListener('click', closeDrawer)
  $backdrop.addEventListener('click', closeDrawer)

  // Keyboard escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrawer()
  })

  // Re-render lanes on resize
  let resizeTimer
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { if (state.events.length) renderLanes() }, 200)
  })
}

// ── Start ──────────────────────────────────────────────────
init()
