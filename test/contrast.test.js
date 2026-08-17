/**
 * Contrast of text drawn on coloured chips and badges.
 *
 * These colours are applied inline from JS, so no stylesheet review catches
 * them and a Lighthouse run only sees whichever chips happen to be on screen.
 * The palette shipped white text on every chip, which measured 3.25:1 on the
 * active teal and 2.02:1 on the drawer's event badge -- both under the 4.5:1
 * WCAG AA floor for small text.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AGENT_COLORS, TYPE_COLORS, getTypeColor, readableTextOn } from '../src/colors.js'

/** The dark surface chips sit on. Must match --bg-surface in style.css. */
const SURFACE = '#0d1628'
const AA_NORMAL = 4.5

function parse(hex) {
  const h = String(hex).replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return {
    r: parseInt(f.slice(0, 2), 16) || 0,
    g: parseInt(f.slice(2, 4), 16) || 0,
    b: parseInt(f.slice(4, 6), 16) || 0,
    a: f.length >= 8 ? (parseInt(f.slice(6, 8), 16) || 0) / 255 : 1,
  }
}

function luminance(r, g, b) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** Contrast of `fg` on `bg`, compositing bg over the page surface first. */
function ratio(fg, bg, surface = SURFACE) {
  const B = parse(bg)
  const S = parse(surface)
  const composited = luminance(
    B.r * B.a + S.r * (1 - B.a),
    B.g * B.a + S.g * (1 - B.a),
    B.b * B.a + S.b * (1 - B.a)
  )
  const F = parse(fg)
  const text = luminance(F.r, F.g, F.b)
  const hi = Math.max(text, composited)
  const lo = Math.min(text, composited)
  return (hi + 0.05) / (lo + 0.05)
}

describe('chip and badge text meets WCAG AA', () => {
  const backgrounds = [
    ...Object.entries(TYPE_COLORS).map(([k, v]) => [`type:${k}`, v.bg]),
    ...Object.entries(AGENT_COLORS).map(([k, v]) => [`agent:${k}`, v.bg]),
    ['type:unknown', getTypeColor('something-new').bg],
  ]

  for (const [name, bg] of backgrounds) {
    it(`${name} gets readable text`, () => {
      const fg = readableTextOn(bg)
      const r = ratio(fg, bg)
      assert.ok(
        r >= AA_NORMAL,
        `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${AA_NORMAL}:1`
      )
    })
  }

  it('does not simply always return white', () => {
    // The bug being guarded against was a hardcoded '#fff'. If every colour
    // still resolves to white, this file would pass while proving nothing.
    const picks = new Set(backgrounds.map(([, bg]) => readableTextOn(bg)))
    assert.ok(picks.size > 1, `expected both dark and light text to be used, got ${[...picks].join(', ')}`)
  })

  it('picks dark text on a bright background and white on a dark one', () => {
    assert.equal(readableTextOn('#ffffff'), '#08131f')
    assert.equal(readableTextOn('#000000'), '#ffffff')
  })

  it('accounts for alpha rather than reading the raw colour', () => {
    // A saturated teal at 67% alpha over the dark surface is much dimmer than
    // the same teal at full strength; ignoring alpha picked the wrong text.
    const solid = readableTextOn('#00e5c7ff')
    const faded = readableTextOn('#00e5c711')
    assert.notEqual(solid, faded, 'alpha must change the decision')
    assert.ok(ratio(faded, '#00e5c711') >= AA_NORMAL)
  })

  it('survives malformed input instead of throwing', () => {
    for (const bad of ['', 'nonsense', '#12', null, undefined]) {
      assert.doesNotThrow(() => readableTextOn(bad))
    }
  })
})

describe('the dim text token is legible', () => {
  it('--text-dim passes AA on the toolbar surface', () => {
    // #4a6080 measured 2.81:1 here and failed the audit; #6b83a3 is 4.65:1.
    const r = ratio('#6b83a3', SURFACE)
    assert.ok(r >= AA_NORMAL, `--text-dim is ${r.toFixed(2)}:1, needs ${AA_NORMAL}:1`)
  })
})
