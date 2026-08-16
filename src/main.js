/**
 * Traceboard v0.4 — cinematic multi-agent trace player
 * Integrates trace-kit, lz-string sharing, redaction, Web Worker streaming,
 * IndexedDB library, aurora-ui design system, command palette, PWA.
 */
import { setLang, t, currentLang } from './i18n.js'
import { getAgentColor, getTypeColor, getAllTypeKeys, getAllAgentKeys } from './colors.js'
import {
  parseTrace, computeStats, redactTrace, hasSecrets,
  formatDuration, formatTimestamp, groupByAgent,
  encodeShareURL, decodeShareURL, decodeLegacyURL,
  MAX_SHARE_URL,
} from './trace.js'
import { CommandPalette, initAuroraUI, toast as auroraToast } from './vendor/aurora-ui/aurora-ui.js'
import {
  saveTrace, listTraces, loadTrace, pinTrace, deleteTrace, clearLibrary, libraryStats,
} from './library.js'

// ─── global state ─────────────────────────────────────────────────────────
let state = {
  events: [],
  filtered: [],
  stats: null,
  activeTypes: new Set(),
  selectedEvent: null,
  filename: 'trace.jsonl',
  summaryMarkdown: null,
  playback: { playing: false, idx: 0, timer: null, speed: 1 },
  traceFormat: null,
  traceWarnings: [],
  traceText: '',
  redactEnabled: true,
}

let palette = null

// ─── DOM shortcuts ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)

async function init() {
  setLang('en')

  // Aurora-UI theme
  initAuroraUI({ themeToggle: '[data-aurora-theme-toggle]' })

  setupDrop()
  setupButtons()
  ensureChrome()
  setupCommandPalette()
  checkURLHash()

  // Library: show landing bento if IndexedDB has traces
  try {
    const traces = await listTraces()
    if (traces.length) renderLibraryBento(traces)
  } catch { /* idb unavailable in some sandboxed frames */ }
}

// ─── Chrome (particles + theme dock) ──────────────────────────────────────
function ensureChrome() {
  if (!$('tb-fx')) {
    const c = document.createElement('canvas')
    c.id = 'tb-fx'
    c.className = 'tb-fx'
    document.body.prepend(c)
    bootParticles(c)
  }
  if (!$('tb-theme-dock')) {
    const dock = document.createElement('div')
    dock.id = 'tb-theme-dock'
    dock.innerHTML = `
      <button id="tb-theme-toggle" class="tb-theme-toggle" data-aurora-theme-toggle title="Toggle theme">🎨</button>
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
      r.onload = () => { try { localStorage.setItem('tb_bg_custom', r.result) } catch {}; applyCustom(r.result) }
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

// ─── Drop / file loading ───────────────────────────────────────────────────
function setupDrop() {
  const $dropZone = $('drop-zone')
  const $fileInput = $('file-input')
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

// TB-A1: Use Web Worker for large files (>500KB), direct parse for small files
async function loadFile(file) {
  if (file.size > 500 * 1024) {
    await loadFileWorker(file)
  } else {
    const text = await file.text()
    loadTraceText(text, file.name)
  }
}

function loadFileWorker(file) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./parse.worker.js', import.meta.url), { type: 'module' })
    let accumulated = []
    let firstPaint = false
    const startTime = Date.now()

    // Show progress bar
    showProgressBar()

    worker.onmessage = (e) => {
      const { kind, lines, total } = e.data
      if (kind === 'batch') {
        accumulated = accumulated.concat(lines)
        updateProgressBar(total, file.size)
        if (!firstPaint && accumulated.length >= 500) {
          firstPaint = true
          const trace = parseTrace(accumulated.map(l => JSON.stringify(l)).join('\n'), { source: file.name })
          state.traceText = accumulated.map(l => JSON.stringify(l)).join('\n')
          applyTrace(trace, file.name, null)
          const elapsed = Date.now() - startTime
          console.log(`[TB-A1] First paint: ${elapsed}ms, ${accumulated.length} events`)
        }
      } else if (kind === 'done') {
        hideProgressBar()
        const text = accumulated.map(l => JSON.stringify(l)).join('\n')
        state.traceText = text
        const trace = parseTrace(text, { source: file.name })
        applyTrace(trace, file.name, null)
        const elapsed = Date.now() - startTime
        console.log(`[TB-A1] Full parse done: ${elapsed}ms, ${total} events, file: ${(file.size/1e6).toFixed(1)}MB`)
        showToast(t('toast_loaded') + ` (${total} ${t('events')})`)
        worker.terminate()
        // auto-save to library
        autoSaveToLibrary(file.name, trace, text)
        resolve()
      } else if (kind === 'error') {
        hideProgressBar()
        showToast('❌ ' + e.data.message, 'error')
        worker.terminate()
        resolve()
      }
    }
    worker.postMessage({ file })
  })
}

function showProgressBar() {
  let bar = $('parse-progress')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'parse-progress'
    bar.className = 'parse-progress'
    bar.innerHTML = `<div class="parse-progress-inner" id="parse-progress-inner"></div>
      <span class="parse-progress-label" id="parse-progress-label">${t('progress_parsing', { n: 0 })}</span>`
    document.body.appendChild(bar)
  }
  bar.classList.remove('hidden')
}

function updateProgressBar(eventCount, fileSize) {
  const label = $('parse-progress-label')
  if (label) label.textContent = t('progress_parsing', { n: eventCount })
  // estimate progress from events
  const inner = $('parse-progress-inner')
  if (inner) inner.style.width = Math.min(90, (eventCount / (fileSize / 80)) * 100) + '%'
}

function hideProgressBar() {
  const bar = $('parse-progress')
  if (bar) {
    const inner = $('parse-progress-inner')
    if (inner) inner.style.width = '100%'
    setTimeout(() => bar.classList.add('hidden'), 400)
  }
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
  state.traceText = text
  const trace = parseTrace(text, { source: filename })
  applyTrace(trace, filename, summary)
  showToast(t('toast_loaded') + ` (${trace.events.length} ${t('events')})`)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && trace.events.length <= 40) {
    setTimeout(() => { if (!state.playback.playing) startPlayback() }, 500)
  }
  // auto-save to library
  autoSaveToLibrary(filename, trace, text)
}

function applyTrace(trace, filename, summary) {
  const events = trace.events
  state.events = events
  state.filtered = events
  state.stats = computeStats(events)
  state.filename = filename
  state.activeTypes = new Set()
  state.selectedEvent = null
  state.summaryMarkdown = summary
  state.traceFormat = trace.format
  state.traceWarnings = trace.warnings || []
  stopPlayback()
  state.playback = { playing: false, idx: 0, timer: null, speed: state.playback?.speed || 1 }
  showViewer()
  renderAll()
}

async function autoSaveToLibrary(name, trace, text) {
  try {
    const meta = {
      format: trace.format,
      count: trace.events.length,
      agents: trace.meta?.agentCount ?? [...new Set(trace.events.map(e => e.agent))].length,
      durationMs: computeStats(trace.events).durationMs,
      errors: trace.events.filter(e => e.type === 'error').length,
    }
    await saveTrace({ name, meta, events: trace.events, text })
  } catch { /* non-critical */ }
}

// ─── Hero / Viewer visibility ──────────────────────────────────────────────
function showViewer() {
  $('hero').classList.remove('visible'); $('hero').classList.add('hidden')
  $('trace-viewer').classList.remove('hidden')
  document.body.classList.add('viewer-on')
}
function showHero() {
  stopPlayback()
  $('trace-viewer').classList.add('hidden')
  $('hero').classList.remove('hidden'); $('hero').classList.add('visible')
  document.body.classList.remove('viewer-on')
  closeDrawer()
  // Refresh library bento
  listTraces().then(traces => renderLibraryBento(traces)).catch(() => {})
}

// ─── Library bento rendering ───────────────────────────────────────────────
function renderLibraryBento(traces) {
  let container = $('library-bento')
  if (!container) {
    container = document.createElement('section')
    container.id = 'library-bento'
    container.className = 'library-bento'
    $('hero')?.querySelector('.hero-inner')?.appendChild(container)
  }

  if (!traces.length) {
    container.innerHTML = `<h2 class="library-title">${t('library_title')}</h2>
      <p class="library-empty">${t('library_empty')}</p>`
    return
  }

  const fmt = (bytes) => bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`
  const formatLabel = { aurora: 'Aurora', 'claude-code': 'Claude Code', 'otel-genai': 'OTel', unknown: '?' }

  container.innerHTML = `
    <div class="library-header">
      <h2 class="library-title">${t('library_title')}</h2>
      <div class="library-actions">
        <button class="btn-ghost btn-sm" id="btn-library-clear">${t('library_clear')}</button>
      </div>
    </div>
    <p class="library-privacy">🔒 ${t('library_privacy')}</p>
    <div class="bento">
      ${traces.map(tr => `
        <div class="plug-card" data-trace-id="${tr.id}" tabindex="0" role="button"
             aria-label="Load trace ${tr.name}">
          <div class="plug-card-header">
            <span class="chip chip--format">${formatLabel[tr.meta?.format] || '?'}</span>
            ${tr.pinned ? '<span class="chip chip--pin">📌</span>' : ''}
          </div>
          <div class="plug-card-name">${escapeHtml(tr.name.split('/').pop())}</div>
          <div class="plug-card-readouts">
            <span class="readout">${tr.meta?.count ?? '?'} <small>events</small></span>
            <span class="readout">${tr.meta?.agents ?? '?'} <small>agents</small></span>
            ${tr.meta?.durationMs ? `<span class="readout">${formatDuration(tr.meta.durationMs)}</span>` : ''}
            ${tr.meta?.errors ? `<span class="readout readout--error">${tr.meta.errors} <small>errors</small></span>` : ''}
          </div>
          <div class="plug-card-meta">${fmt(tr.byteSize)} · ${new Date(tr.addedAt).toLocaleDateString()}</div>
          <div class="plug-card-actions">
            <button class="btn-ghost btn-xs btn-pin" data-id="${tr.id}" data-pinned="${tr.pinned}">
              ${tr.pinned ? t('library_unpin') : t('library_pin')}
            </button>
            <button class="btn-ghost btn-xs btn-delete" data-id="${tr.id}">🗑</button>
          </div>
        </div>`).join('')}
    </div>`

  // wire events
  container.querySelectorAll('.plug-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-pin') || e.target.closest('.btn-delete')) return
      const id = card.dataset.traceId
      try {
        const entry = await loadTrace(id)
        if (entry) loadTraceText(entry.text, entry.name)
      } catch (err) { showToast('❌ ' + err.message, 'error') }
    })
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') card.click() })
  })
  container.querySelectorAll('.btn-pin').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation()
      const pinned = btn.dataset.pinned !== 'true'
      await pinTrace(btn.dataset.id, pinned)
      const traces = await listTraces()
      renderLibraryBento(traces)
    }
  })
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation()
      await deleteTrace(btn.dataset.id)
      const traces = await listTraces()
      renderLibraryBento(traces)
    }
  })
  $('btn-library-clear')?.addEventListener('click', async () => {
    if (confirm('Clear all saved traces?')) {
      await clearLibrary()
      renderLibraryBento([])
    }
  })

  // Apply tilt via aurora-ui (already statically imported)
  attachTilt(container)
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// ─── Render all ────────────────────────────────────────────────────────────
function renderAll() {
  updateToolbar()
  renderFormatBadge()
  renderWarningsBar()
  renderTypeFilters()
  renderSummary()
  ensurePlaybackBar()
  renderLanes()
  renderLegend()
  applyPlaybackHighlight()
}

function updateToolbar() {
  const { count, agents, durationMs } = state.stats
  $('trace-filename').textContent = state.filename.split('/').pop()
  $('trace-stats').textContent = `${count} ${t('events')} · ${agents.length} ${t('agents')} · ${formatDuration(durationMs)}`
}

// TB-1: Format chip in header
function renderFormatBadge() {
  let badge = $('format-badge')
  if (!badge) {
    badge = document.createElement('span')
    badge.id = 'format-badge'
    badge.className = 'chip format-badge'
    $('trace-stats')?.insertAdjacentElement('afterend', badge)
  }
  const labels = {
    aurora: t('format_aurora'),
    'claude-code': t('format_claude_code'),
    'otel-genai': t('format_otel'),
    unknown: t('format_unknown'),
  }
  const label = labels[state.traceFormat] || state.traceFormat || '?'
  badge.textContent = label
  badge.className = `chip format-badge format-badge--${state.traceFormat || 'unknown'}`
}

// TB-1: Warnings bar
function renderWarningsBar() {
  let bar = $('warnings-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'warnings-bar'
    bar.className = 'notice notice--warn'
    $('toolbar')?.insertAdjacentElement('afterend', bar)
  }

  if (state.traceFormat === 'unknown') {
    bar.innerHTML = `<strong>${t('warnings_bar')}:</strong> ${t('unknown_format_msg')}
      <a href="https://github.com/Zijian-Ni/traceboard#supported-formats" target="_blank" rel="noopener">docs</a>`
    bar.classList.remove('hidden')
    return
  }

  if (!state.traceWarnings.length) {
    bar.classList.add('hidden')
    return
  }
  bar.innerHTML = `<strong>${t('warnings_bar')}:</strong> ${state.traceWarnings.map(escapeHtml).join(' · ')}`
  bar.classList.remove('hidden')
}

function renderTypeFilters() {
  const $typeFilters = $('type-filters')
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
  state.playback.idx = Math.min(state.playback.idx, Math.max(0, state.filtered.length - 1))
  renderTypeFilters()
  ensurePlaybackBar()
  renderLanes()
  applyPlaybackHighlight()
}

function renderSummary() {
  const $summaryBar = $('summary-bar')
  const $summaryContent = $('summary-content')
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

// ─── Playback ──────────────────────────────────────────────────────────────
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
  const head = $('playhead')
  if (head && ev && state.stats?.durationMs && ev.ts) {
    const ratio = (new Date(ev.ts).getTime() - state.stats.startMs) / state.stats.durationMs
    head.style.left = `calc(130px + ${Math.max(0, Math.min(1, ratio)) * 100}% * 1)`
  }
  document.querySelectorAll('.event-block').forEach(b => {
    const idx = Number(b.dataset.idx)
    b.classList.toggle('is-current', !!(ev && idx === ev._idx))
    b.classList.toggle('is-past', !!(ev && idx <= ev._idx))
    b.classList.toggle('is-future', !!(ev && idx > ev._idx))
  })
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
      // .aurora-ring marks the selected event (the ONE ring rule)
      document.querySelectorAll('.aurora-ring').forEach(b => b.classList.remove('aurora-ring'))
      block?.classList.add('selected', 'aurora-ring')
      openDrawer(ev)
      block?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }
  updateScrubFill()
}

// ─── Swimlane rendering ────────────────────────────────────────────────────
function renderLanes() {
  const $lanes = $('lanes')
  const $ruler = $('time-ruler')
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

  let stage = $('lane-stage')
  if (!stage) {
    stage = document.createElement('div')
    stage.id = 'lane-stage'
    $lanes.parentElement.insertBefore(stage, $lanes)
  }
  stage.innerHTML = `<div id="playhead" class="playhead"><i></i></div>`
  if ($lanes.parentElement !== stage) stage.appendChild($lanes)

  renderRuler(state.stats, trackW)

  for (const agent of agents) {
    const agentEvents = groupMap.get(agent)
    $lanes.appendChild(createLane(agent, agentEvents, trackW))
  }
}

function renderRuler(stats, trackW) {
  const $ruler = $('time-ruler')
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
    // The ONE ring: remove from all, add to this
    document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
    document.querySelectorAll('.aurora-ring').forEach(b => b.classList.remove('aurora-ring'))
    block.classList.add('selected', 'aurora-ring')
    applyPlaybackHighlight(false)
    openDrawer(ev)
    ensurePlaybackBar()
  })
  return block
}

function renderLegend() {
  const $legend = $('legend')
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

// ─── Drawer ────────────────────────────────────────────────────────────────
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
  $('drawer-raw').textContent = JSON.stringify(ev.raw ?? ev, null, 2)
  const $drawer = $('detail-drawer')
  const $backdrop = $('drawer-backdrop')
  $drawer.classList.remove('hidden'); $drawer.classList.add('open')
  $backdrop.classList.remove('hidden'); $backdrop.classList.add('open')
}

function closeDrawer() {
  const $drawer = $('detail-drawer')
  const $backdrop = $('drawer-backdrop')
  $drawer.classList.remove('open'); $backdrop.classList.remove('open')
  setTimeout(() => { $drawer.classList.add('hidden'); $backdrop.classList.add('hidden') }, 260)
  document.querySelectorAll('.event-block.selected').forEach(b => b.classList.remove('selected'))
  document.querySelectorAll('.aurora-ring').forEach(b => b.classList.remove('aurora-ring'))
  state.selectedEvent = null
}

// ─── TB-2: Share with lz-string ────────────────────────────────────────────
function shareTrace() {
  if (!state.events.length) return

  // Determine events to share
  const eventsToShare = state.filtered.length ? state.filtered : state.events

  // TB-3: Apply redaction if enabled
  let shareEvents = eventsToShare
  let redactedCount = 0
  if (state.redactEnabled) {
    const fakeTrace = { format: state.traceFormat, events: eventsToShare, warnings: [], meta: {} }
    const { trace: redacted, hits } = redactTrace(fakeTrace)
    shareEvents = redacted.events
    redactedCount = hits
  } else {
    // TB-3: warn if secrets detected
    const rawText = eventsToShare.map(e => JSON.stringify(e.raw ?? e)).join('\n')
    if (hasSecrets(rawText)) {
      ensureSecretsWarning(true)
    }
  }

  const encoded = encodeShareURL(shareEvents)
  const url = location.origin + location.pathname + '#t2=' + encoded

  if (url.length > MAX_SHARE_URL) {
    showURLTooLongDialog(url)
    return
  }

  showSharePopup(url, redactedCount)
}

function showSharePopup(url, redactedCount) {
  document.querySelector('.share-popup')?.remove()
  const popup = document.createElement('div')
  popup.className = 'share-popup card'
  popup.innerHTML = `
    <div class="share-popup-title">${t('share_title')}</div>
    <p class="notice-text">${t('share_note')}</p>
    <label class="share-redact-row">
      <input type="checkbox" id="share-redact-toggle" ${state.redactEnabled ? 'checked' : ''}/>
      ${t('redact_label')}
    </label>
    ${redactedCount > 0 ? `<div class="chip chip--ok share-redact-count">${t('redacted_count', { n: redactedCount })}</div>` : ''}
    <input readonly value="${url}" id="share-url-input" class="share-url-input"/>
    <button class="btn-primary" id="btn-copy-url">Copy</button>`
  document.body.appendChild(popup)
  $('share-url-input').select()
  $('btn-copy-url').onclick = () => navigator.clipboard.writeText(url).then(() => { showToast(t('toast_copied')); popup.remove() })
  $('share-redact-toggle').onchange = (e) => {
    state.redactEnabled = e.target.checked
    popup.remove()
    shareTrace()
  }
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 100)
}

function showURLTooLongDialog(longUrl) {
  document.querySelector('.share-too-long')?.remove()
  const dialog = document.createElement('div')
  dialog.className = 'share-too-long card'
  dialog.innerHTML = `
    <div class="share-popup-title">⚠️ ${t('share_url_too_long')}</div>
    <div class="dialog-actions">
      <button class="btn-primary" id="btn-export-snapshot">${t('share_export_snapshot')}</button>
      <button class="btn-ghost" id="btn-share-filtered">${t('share_filtered_only')}</button>
    </div>`
  document.body.appendChild(dialog)
  $('btn-export-snapshot').onclick = () => { dialog.remove(); exportSnapshot() }
  $('btn-share-filtered').onclick = () => {
    dialog.remove()
    // share only first 200 events
    const limited = (state.filtered.length ? state.filtered : state.events).slice(0, 200)
    const encoded = encodeShareURL(limited)
    const url = location.origin + location.pathname + '#t2=' + encoded
    showSharePopup(url, 0)
  }
  setTimeout(() => document.addEventListener('click', () => dialog.remove(), { once: true }), 100)
}

// TB-3: Secrets warning chip
function ensureSecretsWarning(show) {
  let chip = $('secrets-warning-chip')
  if (!chip) {
    chip = document.createElement('span')
    chip.id = 'secrets-warning-chip'
    chip.className = 'chip chip--danger secrets-warning'
    $('btn-share')?.insertAdjacentElement('afterend', chip)
  }
  if (show) {
    chip.textContent = t('redact_warning')
    chip.classList.remove('hidden')
  } else {
    chip.classList.add('hidden')
  }
}

// ─── Export snapshot ───────────────────────────────────────────────────────
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
    <td style="border:1px solid #1e3a5f;padding:5px 8px">${String(ev.message||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>
  </tr>`).join('')}
  </table>`
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'traceboard-snapshot.html'; a.click()
  showToast(t('toast_export'))
}

// ─── URL hash handling (TB-2 + legacy) ────────────────────────────────────
function checkURLHash() {
  const hash = location.hash
  if (hash.startsWith('#t2=')) {
    const raw = decodeShareURL(hash.slice('#t2='.length))
    if (raw?.length) {
      const synth = raw.map(e => JSON.stringify(e)).join('\n')
      loadTraceText(synth, 'shared-trace.jsonl')
    }
    return
  }
  // legacy base64
  if (hash.startsWith('#trace=')) {
    const raw = decodeLegacyURL(hash.slice('#trace='.length))
    if (raw?.length) loadTraceText(raw.map(e => JSON.stringify(e)).join('\n'), 'shared-trace.jsonl')
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────
let toastTimer
function showToast(msg, type = 'info') {
  const $toast = $('toast')
  $toast.textContent = msg
  $toast.classList.remove('hidden')
  $toast.style.borderColor = type === 'error' ? 'var(--status-danger, var(--rose))' : 'var(--aurora-teal-400, var(--teal))'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $toast.classList.add('hidden'), 3200)
}

// ─── TB-3: Redaction toggle (also in share popup) ─────────────────────────
function renderRedactToggle() {
  let row = $('redact-toggle-row')
  if (!row) {
    row = document.createElement('label')
    row.id = 'redact-toggle-row'
    row.className = 'redact-toggle-row'
    row.innerHTML = `<input type="checkbox" id="redact-toggle" ${state.redactEnabled ? 'checked' : ''}/>
      <span>${t('redact_label')}</span>`
    // Insert near share button
    const header = document.querySelector('.header-right')
    header?.insertBefore(row, $('btn-share'))
    $('redact-toggle').onchange = (e) => {
      state.redactEnabled = e.target.checked
      if (!e.target.checked) {
        const rawText = state.events.map(ev => JSON.stringify(ev.raw ?? ev)).join('\n')
        ensureSecretsWarning(hasSecrets(rawText))
      } else {
        ensureSecretsWarning(false)
      }
    }
  }
}

// ─── Command palette (⌘K) ────────────────────────────────────────────────
function setupCommandPalette() {
  palette = new CommandPalette([], { placeholder: t('palette_placeholder') })
  palette.mount()

  // Register commands
  const cmds = [
    {
      id: 'load-demo',
      group: 'File',
      label: t('cmd_load_demo'),
      run: () => loadDemo(),
    },
    {
      id: 'export',
      group: 'File',
      label: t('cmd_export'),
      when: () => state.events.length > 0,
      run: () => exportSnapshot(),
    },
    {
      id: 'share',
      group: 'File',
      label: t('cmd_share'),
      when: () => state.events.length > 0,
      run: () => shareTrace(),
    },
    {
      id: 'toggle-redact',
      group: 'Settings',
      label: t('cmd_toggle_redact'),
      hint: () => state.redactEnabled ? 'ON' : 'OFF',
      run: () => {
        state.redactEnabled = !state.redactEnabled
        const toggle = $('redact-toggle')
        if (toggle) toggle.checked = state.redactEnabled
        showToast(`Redaction: ${state.redactEnabled ? 'ON' : 'OFF'}`)
      },
    },
    {
      id: 'theme',
      group: 'Settings',
      label: t('cmd_theme'),
      run: () => document.querySelector('[data-aurora-theme-toggle]')?.click(),
    },
    {
      id: 'clear-filters',
      group: 'View',
      label: t('cmd_clear_filters'),
      when: () => state.activeTypes.size > 0,
      run: () => { state.activeTypes.clear(); applyFilters() },
    },
    {
      id: 'library',
      group: 'File',
      label: t('cmd_library'),
      run: () => { showHero() },
    },
  ]

  // Dynamic: jump to event
  cmds.push({
    id: 'jump-event',
    group: 'Navigate',
    label: t('cmd_jump_event'),
    when: () => state.events.length > 0,
    run: () => {
      // Open a mini event picker (reuse palette with event commands)
      const eventCmds = state.filtered.slice(0, 100).map((ev, i) => ({
        id: `ev-${i}`,
        group: ev.agent,
        label: `#${ev._idx} [${ev.type}] ${ev.message?.slice(0, 50) || ''}`,
        run: () => {
          state.playback.idx = i
          applyPlaybackHighlight(true)
          ensurePlaybackBar()
        }
      }))
      // Temporarily replace commands
      const saved = palette.commands
      palette.commands = eventCmds
      palette.open()
      // Restore on close
      const origClose = palette.close.bind(palette)
      palette.close = () => { origClose(); palette.commands = saved; palette.close = origClose }
    }
  })

  // Dynamic: filter by agent
  cmds.push({
    id: 'filter-agent',
    group: 'Navigate',
    label: t('cmd_filter_agent'),
    when: () => state.events.length > 0,
    run: () => {
      const agents = getAllAgentKeys(state.events)
      const agentCmds = agents.map(agent => ({
        id: `agent-${agent}`,
        group: 'Agent',
        label: agent,
        run: () => {
          state.events = state.events.filter(e => e.agent === agent)
          state.filtered = state.events
          renderAll()
        }
      }))
      const saved = palette.commands
      palette.commands = agentCmds
      palette.open()
      const origClose = palette.close.bind(palette)
      palette.close = () => { origClose(); palette.commands = saved; palette.close = origClose }
    }
  })

  for (const cmd of cmds) palette.register(cmd)
}

// ─── Buttons ───────────────────────────────────────────────────────────────
function setupButtons() {
  $('btn-demo').onclick = loadDemo
  $('btn-lang').onclick = () => { setLang(currentLang === 'en' ? 'zh' : 'en'); if (state.stats) updateToolbar() }
  $('btn-share').onclick = shareTrace
  $('btn-export').onclick = exportSnapshot
  $('btn-back').onclick = showHero
  $('btn-reset-view').onclick = () => { state.activeTypes.clear(); applyFilters() }
  $('btn-close-drawer').onclick = closeDrawer
  $('drawer-backdrop').onclick = closeDrawer

  // Redact toggle in header
  renderRedactToggle()

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrawer()
    if (!state.events.length) return
    if (e.key === ' ' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault(); togglePlayback(); ensurePlaybackBar()
    }
    if (e.key === 'ArrowRight' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      stopPlayback(); stepPlayback(1)
    }
    if (e.key === 'ArrowLeft' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      stopPlayback(); stepPlayback(-1)
    }
  })
  let resizeTimer
  addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { if (state.events.length) renderLanes() }, 200)
  })
}

init()
