import { detectFormat, adapterFor } from './adapters/index.js';
import { fromAurora } from './adapters/aurora.js';
import { fillTimestamps, buildMeta, normalizeEvent, coerceType } from './normalize.js';
import { redact, redactEvent, redactTrace, hasSecrets } from './redact.js';
import {
  EVENT_TYPES,
  isEventType,
  trunc,
  AURORA_EVENT_JSON_SCHEMA,
  AURORA_TRACE_JSON_SCHEMA,
} from './schema.js';

export const VERSION = '0.1.0';

/**
 * Parse raw JSONL / OTLP-JSON text into an AuroraTrace.
 *
 * Never throws on malformed input: bad lines become warnings, and an
 * unrecognised format still produces a best-effort trace so the UI can show
 * *something* plus a clear notice, rather than a white screen.
 *
 * @param {string} text
 * @param {{ source?: string, format?: string }} [opts]
 * @returns {import('./schema.js').AuroraTrace}
 */
export function parseTrace(text, opts = {}) {
  const warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };

  const lines = parseLines(String(text ?? ''), warn);
  if (!lines.length) {
    return { format: 'unknown', events: [], warnings: warnings.concat('no parsable JSON found'), meta: { agentCount: 0, source: opts.source } };
  }

  let format = opts.format && opts.format !== 'auto' ? opts.format : detectFormat(lines);
  let adapter = adapterFor(format);
  if (!adapter) {
    warn(`unrecognised trace format — parsed with the permissive fallback. See https://github.com/Zijian-Ni/trace-kit#supported-formats`);
    format = 'unknown';
  }

  let events = adapter ? adapter.parse(lines, warn) : fromAurora(lines, warn);

  // Adapters emit partial events; normalise everything through one path so the
  // schema guarantees hold no matter which adapter ran.
  events = events.map((e, i) => ({
    ...normalizeEvent(e.raw ?? e, i),
    ...stripUndefined(e),
    _idx: i,
  }));

  const synthetic = events.filter((e) => !e.ts).length;
  if (synthetic) warn(`${synthetic} event(s) had no timestamp — order-based clock synthesised`);
  fillTimestamps(events);

  return { format, events, warnings, meta: buildMeta(events, opts.source) };
}

function stripUndefined(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/** Split text into JSON objects: JSONL first, then whole-document JSON. */
export function parseLines(text, warn = () => {}) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const out = [];
  let bad = 0;
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s || s === '[' || s === ']' || s === ',') continue;
    try {
      out.push(JSON.parse(s.replace(/,$/, '')));
    } catch {
      bad++;
    }
  }
  // A pretty-printed JSON document (OTLP export, JSON array) fails line-by-line.
  if (out.length <= 1 && bad > 0) {
    try {
      const doc = JSON.parse(trimmed);
      return Array.isArray(doc) ? doc : [doc];
    } catch {
      /* fall through */
    }
  }
  // A JSON array printed on one line parses cleanly as a single value; unwrap it
  // so callers always receive a flat list of event objects.
  if (out.length === 1 && Array.isArray(out[0])) return out[0];

  if (bad) warn(`skipped ${bad} unparsable line(s)`);
  return out;
}

/** Convenience: parse and redact in one call (for share/export paths). */
export function parseTraceRedacted(text, opts = {}) {
  const trace = parseTrace(text, opts);
  const { trace: safe, hits } = redactTrace(trace);
  return { ...safe, redactedCount: hits };
}

/** Serialise an AuroraTrace back to Aurora JSONL. */
export function toJSONL(trace) {
  return trace.events
    .map((e) => JSON.stringify({
      ts: e.ts, type: e.type, agent: e.agent, phase: e.phase,
      name: e.name, message: e.message, status: e.status, durationMs: e.durationMs,
    }))
    .join('\n');
}

/** Basic stats used by every consumer's header bar. */
export function computeStats(events) {
  const times = events.map((e) => Date.parse(e.ts)).filter((t) => !Number.isNaN(t));
  const startMs = times.length ? Math.min(...times) : 0;
  const endMs = times.length ? Math.max(...times) : 0;
  return {
    count: events.length,
    agents: [...new Set(events.map((e) => e.agent))],
    types: [...new Set(events.map((e) => e.type))],
    errors: events.filter((e) => e.type === 'error' || e.status === 'error').length,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    startISO: startMs ? new Date(startMs).toISOString() : null,
  };
}

export {
  detectFormat,
  adapterFor,
  normalizeEvent,
  coerceType,
  fillTimestamps,
  buildMeta,
  redact,
  redactEvent,
  redactTrace,
  hasSecrets,
  EVENT_TYPES,
  isEventType,
  trunc,
  AURORA_EVENT_JSON_SCHEMA,
  AURORA_TRACE_JSON_SCHEMA,
};
