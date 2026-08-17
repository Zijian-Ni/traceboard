// Color palettes for agents and event types

export const AGENT_COLORS = {
  xiaoluo:  { bg: '#00e5c7', text: '#003d36', label: '小落 / xiaoluo' },
  hermes:   { bg: '#a855f7', text: '#2d0060', label: 'Hermes' },
  dsh:      { bg: '#f59e0b', text: '#3d2600', label: 'DSH' },
  openclaw: { bg: '#00e5c7', text: '#003d36', label: 'OpenClaw' },
}

export const TYPE_COLORS = {
  phase_start:  { bg: '#00e5c7aa', border: '#00e5c7', label: 'phase_start' },
  phase_end:    { bg: '#007a6e88', border: '#007a6e',  label: 'phase_end' },
  agent_call:   { bg: '#a855f7aa', border: '#a855f7', label: 'agent_call' },
  agent_result: { bg: '#38bdf8aa', border: '#38bdf8', label: 'agent_result' },
  error:        { bg: '#f43f5eaa', border: '#f43f5e', label: 'error' },
}

export function getAgentColor(agent) {
  const key = (agent || '').toLowerCase()
  return AGENT_COLORS[key] || { bg: '#38bdf8', text: '#002040', label: agent || 'unknown' }
}

export function getTypeColor(type) {
  const key = (type || '').toLowerCase()
  return TYPE_COLORS[key] || { bg: '#64748b88', border: '#64748b', label: type || 'unknown' }
}

export function agentLabelColor(agent) {
  return getAgentColor(agent).bg
}

/**
 * Pick readable text for a coloured chip.
 *
 * Chips used to hardcode white, which fails WCAG AA on the brighter palette
 * entries -- white on the active teal measures 3.25:1 against the 4.5:1 floor
 * for small text. The type colours also carry alpha, so the real background is
 * the chip colour composited over the dark surface; ignoring that made the
 * measured contrast worse than it looked in the source.
 */
export function readableTextOn(bg, surface = '#0d1628') {
  const { r, g, b, a } = parseColor(bg)
  const s = parseColor(surface)
  // Composite over the surface so alpha is accounted for.
  const cr = r * a + s.r * (1 - a)
  const cg = g * a + s.g * (1 - a)
  const cb = b * a + s.b * (1 - a)
  const lum = relativeLuminance(cr, cg, cb)

  // Pick whichever of ink/white actually contrasts more, rather than guessing a
  // luminance cutoff: chip colours carry alpha, so the composited result is
  // often mid-bright and a hardcoded threshold picks wrong in both directions.
  const withWhite = contrastRatio(lum, WHITE_LUM)
  const withInk = contrastRatio(lum, INK_LUM)
  return withInk > withWhite ? INK : '#ffffff'
}

const INK = '#08131f'
const WHITE_LUM = 1
const INK_LUM = relativeLuminanceHex(INK)

function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

function relativeLuminanceHex(hex) {
  const { r, g, b } = parseColor(hex)
  return relativeLuminance(r, g, b)
}

function parseColor(hex) {
  const h = String(hex).replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
    a: full.length >= 8 ? (parseInt(full.slice(6, 8), 16) || 0) / 255 : 1,
  }
}

function relativeLuminance(r, g, b) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function getAllTypeKeys(events) {
  return [...new Set(events.map(e => e.type || 'unknown'))]
}

export function getAllAgentKeys(events) {
  return [...new Set(events.map(e => e.agent || 'unknown'))]
}
