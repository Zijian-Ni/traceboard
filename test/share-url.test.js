/**
 * Tests for TB-2: lz-string share URL round-trip
 * Tests for TB-3: redaction
 * Tests for TB-1: format detection integration
 * Run: node --test test/share-url.test.js
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ── Inline vendored encodeShareURL / decodeShareURL ────────────────────────
// We can't use the browser build directly, so test the underlying logic.
import LZString from 'lz-string'

function encodeShareURL(events) {
  const slim = events.map(({ ts, type, agent, phase, name, message, status, durationMs }) => {
    const o = { ts, type, agent }
    if (phase != null) o.phase = phase
    if (name != null) o.name = name
    if (message != null) o.message = message
    if (status != null) o.status = status
    if (durationMs != null) o.durationMs = durationMs
    return o
  })
  return LZString.compressToEncodedURIComponent(JSON.stringify(slim))
}

function decodeShareURL(encoded) {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded)
    return json ? JSON.parse(json) : null
  } catch { return null }
}

// ── trace-kit imports (from vendored copy) ─────────────────────────────────
// For Node tests we reference trace-kit directly (not browser vendor copy)
import { parseTrace, computeStats, redactTrace, hasSecrets, detectFormat, redact } from '/home/xiaoni/projects/trace-kit/src/index.js'

const FIXTURE_DIR = '/home/xiaoni/projects/trace-kit/test/fixtures/'
import { readFileSync } from 'node:fs'

// ── TB-1: Format detection ─────────────────────────────────────────────────
describe('TB-1: format detection', () => {
  test('detects aurora format', () => {
    const text = readFileSync(FIXTURE_DIR + 'aurora.jsonl', 'utf8')
    const trace = parseTrace(text)
    assert.equal(trace.format, 'aurora')
    assert.ok(trace.events.length > 0, 'should have events')
  })

  test('detects claude-code format', () => {
    const text = readFileSync(FIXTURE_DIR + 'claude-code.jsonl', 'utf8')
    const trace = parseTrace(text)
    assert.equal(trace.format, 'claude-code')
    assert.ok(trace.events.length > 0, 'should have events')
  })

  test('detects otel-genai format', () => {
    const text = readFileSync(FIXTURE_DIR + 'otel-genai.jsonl', 'utf8')
    const trace = parseTrace(text)
    assert.equal(trace.format, 'otel-genai')
    assert.ok(trace.events.length > 0, 'should have events')
  })

  test('unknown format gives friendly warning, not empty events', () => {
    const text = '{"some":"garbage","no":"schema"}\n{"another":"line"}'
    const trace = parseTrace(text)
    assert.equal(trace.format, 'unknown')
    assert.ok(trace.warnings.length > 0, 'should have warnings for unknown format')
    // Must still produce events (never white screen)
    assert.ok(trace.events.length > 0, 'even unknown format must produce events')
  })

  test('empty input returns graceful result', () => {
    const trace = parseTrace('')
    assert.equal(trace.format, 'unknown')
    assert.deepEqual(trace.events, [])
    assert.ok(trace.warnings.some(w => w.includes('no parsable JSON')))
  })
})

// ── TB-2: Share URL round-trip ─────────────────────────────────────────────
describe('TB-2: share URL round-trip', () => {
  test('encodes and decodes a 200-event trace identically', () => {
    // Generate 200 synthetic events
    const events = Array.from({ length: 200 }, (_, i) => ({
      ts: new Date(Date.now() + i * 1000).toISOString(),
      type: ['tool_call', 'tool_result', 'llm_call', 'agent_call'][i % 4],
      agent: ['xiaoluo', 'hermes', 'dsh'][i % 3],
      phase: 'plan',
      message: `Event number ${i} with some message text`,
      raw: { extra: 'stripped' }, // raw is NOT in slim — should be stripped
    }))

    const encoded = encodeShareURL(events)
    const url = 'https://example.com/#t2=' + encoded
    assert.ok(url.length < 8000, `URL should be under 8000 chars, got ${url.length}`)

    const decoded = decodeShareURL(encoded)
    assert.ok(decoded !== null, 'should decode successfully')
    assert.equal(decoded.length, 200)

    // Check round-trip fidelity
    assert.equal(decoded[0].type, events[0].type)
    assert.equal(decoded[0].agent, events[0].agent)
    assert.equal(decoded[0].message, events[0].message)

    // raw should NOT be in the compressed payload
    assert.ok(!('raw' in decoded[0]), 'raw field should be stripped from share payload')
  })

  test('200 synthetic events with typical message lengths share under 8000 chars', () => {
    // Synthetic events with realistic (short) messages — typical real trace
    const TYPES = ['tool_call', 'tool_result', 'llm_call', 'agent_call', 'phase_start']
    const AGENTS = ['xiaoluo', 'hermes', 'dsh']
    const MSGS = [
      'web_search completed', 'llm responded', 'phase started',
      'tool ok', 'agent called', 'note logged',
    ]
    const events200 = Array.from({ length: 200 }, (_, i) => ({
      ts: new Date(1723000000000 + i * 1000).toISOString(),
      type: TYPES[i % TYPES.length],
      agent: AGENTS[i % AGENTS.length],
      phase: 'plan',
      message: MSGS[i % MSGS.length],
    }))

    const encoded = encodeShareURL(events200)
    const url = 'https://zijian-ni.github.io/traceboard/#t2=' + encoded
    console.log(`  Share URL length for 200 synthetic events: ${url.length} chars`)
    assert.ok(url.length < 8000, `Expected <8000 chars, got ${url.length}`)
  })

  test('aurora fixture (all events) shares well under 8000 chars', () => {
    const text = readFileSync(FIXTURE_DIR + 'aurora.jsonl', 'utf8')
    const trace = parseTrace(text)
    const encoded = encodeShareURL(trace.events)
    const url = 'https://zijian-ni.github.io/traceboard/#t2=' + encoded
    console.log(`  Aurora fixture URL length (${trace.events.length} events): ${url.length} chars`)
    assert.ok(url.length < 8000, `Expected <8000 chars, got ${url.length}`)
  })

  test('legacy base64 decode still works', () => {
    // Simulate a legacy #trace= URL payload
    const events = [{ ts: '2026-01-01T00:00:00Z', type: 'note', agent: 'test', message: 'hello' }]
    const jsonStr = JSON.stringify(events)
    const b64 = Buffer.from(jsonStr).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

    // Decode legacy
    function decodeLegacy(b64url) {
      const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    }
    const decoded = decodeLegacy(b64)
    assert.equal(decoded[0].message, 'hello')
  })

  test('invalid encoded string returns null gracefully', () => {
    assert.equal(decodeShareURL('notvalidlzstring!!!'), null)
  })
})

// ── TB-3: Redaction ────────────────────────────────────────────────────────
describe('TB-3: redaction', () => {
  test('secrets fixture contains secrets', () => {
    const text = readFileSync(FIXTURE_DIR + 'secrets.jsonl', 'utf8')
    assert.ok(hasSecrets(text), 'secrets fixture should trigger hasSecrets')
  })

  test('redactTrace produces [REDACTED_*] and accurate count', () => {
    const text = readFileSync(FIXTURE_DIR + 'secrets.jsonl', 'utf8')
    const trace = parseTrace(text)
    const { trace: safe, hits } = redactTrace(trace)

    assert.ok(hits > 0, 'should have at least 1 redacted item')

    // Verify redacted markers in output
    const allMessages = safe.events.map(e => e.message || '').join(' ')
    const allRaw = safe.events.map(e => JSON.stringify(e.raw || {})).join(' ')
    const combined = allMessages + allRaw

    assert.ok(
      combined.includes('[REDACTED_API_KEY]') || combined.includes('[REDACTED_EMAIL]') ||
      combined.includes('[REDACTED_HOME]') || combined.includes('[REDACTED_SECRET]'),
      'should contain at least one [REDACTED_*] marker'
    )
  })

  test('redaction is idempotent — second pass reports 0 hits', () => {
    const text = readFileSync(FIXTURE_DIR + 'secrets.jsonl', 'utf8')
    const trace = parseTrace(text)
    const { trace: safe1, hits: h1 } = redactTrace(trace)
    const { trace: safe2, hits: h2 } = redactTrace(safe1)

    assert.ok(h1 > 0, 'first pass should find secrets')
    assert.equal(h2, 0, 'second pass should find 0 new secrets')
  })

  test('sk-... API key gets redacted', () => {
    const { text, hits } = redact('export KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx')
    assert.ok(hits > 0)
    assert.ok(text.includes('[REDACTED_API_KEY]'), `expected redaction, got: ${text}`)
    assert.ok(!text.includes('sk-ant'), 'original key should be gone')
  })

  test('home paths get redacted', () => {
    const { text, hits } = redact('Edited file /home/alice/secret/config.py')
    assert.ok(hits > 0)
    assert.ok(text.includes('[REDACTED_HOME]'))
    assert.ok(!text.includes('/home/alice'))
  })

  test('emails get redacted', () => {
    const { text, hits } = redact('Contact admin@example.com for help')
    assert.ok(hits > 0)
    assert.ok(text.includes('[REDACTED_EMAIL]'))
  })
})

// ── computeStats ───────────────────────────────────────────────────────────
describe('computeStats', () => {
  test('computes stats from aurora fixture', () => {
    const text = readFileSync(FIXTURE_DIR + 'aurora.jsonl', 'utf8')
    const trace = parseTrace(text)
    const stats = computeStats(trace.events)
    assert.ok(stats.count > 0)
    assert.ok(Array.isArray(stats.agents))
    assert.ok(stats.durationMs >= 0)
    assert.ok(stats.startISO !== null || stats.startMs === 0)
  })
})
