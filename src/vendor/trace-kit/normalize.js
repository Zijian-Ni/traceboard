import { isEventType, trunc } from './schema.js';

/**
 * Tolerant normalisation: accept the many field aliases that agent frameworks
 * emit in the wild, fill gaps, and never throw on a weird line.
 */

const TS_KEYS = ['ts', 'timestamp', 'time', 'datetime', '@timestamp', 'created_at'];
const TYPE_KEYS = ['type', 'event_type', 'event', 'kind'];
const AGENT_KEYS = ['agent', 'agent_id', 'agentName', 'agent_name', 'actor', 'lane', 'role', 'source'];
const PHASE_KEYS = ['phase', 'stage', 'step', 'task'];
const NAME_KEYS = ['name', 'tool', 'tool_name', 'toolName', 'model', 'function', 'title'];
const MSG_KEYS = ['message', 'msg', 'content', 'text', 'summary', 'output', 'detail'];
const DUR_KEYS = ['durationMs', 'duration_ms', 'duration', 'elapsedMs', 'latency_ms', 'latencyMs'];

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

/** Map common non-standard type strings onto the Aurora vocabulary. */
const TYPE_ALIASES = new Map(Object.entries({
  start: 'phase_start',
  begin: 'phase_start',
  phase_begin: 'phase_start',
  end: 'phase_end',
  finish: 'phase_end',
  complete: 'phase_end',
  phase_complete: 'phase_end',
  tool: 'tool_call',
  tool_use: 'tool_call',
  function_call: 'tool_call',
  tool_output: 'tool_result',
  function_result: 'tool_result',
  llm: 'llm_call',
  completion: 'llm_call',
  chat: 'llm_call',
  model_call: 'llm_call',
  agent: 'agent_call',
  agent_start: 'agent_call',
  agent_end: 'agent_result',
  response: 'agent_result',
  result: 'agent_result',
  fail: 'error',
  failure: 'error',
  exception: 'error',
  warn: 'note',
  warning: 'note',
  info: 'note',
  log: 'note',
  message: 'note',
}));

export function coerceType(v) {
  if (isEventType(v)) return v;
  const key = String(v ?? '').toLowerCase().trim();
  return TYPE_ALIASES.get(key) ?? 'note';
}

function coerceTs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Heuristic: nanoseconds > microseconds > milliseconds > seconds
    const ms = v > 1e17 ? v / 1e6 : v > 1e14 ? v / 1e3 : v > 1e11 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(v);
  if (/^\d+$/.test(s)) return coerceTs(Number(s));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function coerceStatus(obj, type) {
  const raw = obj?.status ?? obj?.state ?? obj?.result_status;
  if (typeof raw === 'string') {
    const s = raw.toLowerCase();
    if (/(err|fail|reject|abort)/.test(s)) return 'error';
    if (/(ok|success|done|complete|pass)/.test(s)) return 'ok';
  }
  if (obj?.is_error === true || obj?.isError === true || obj?.error) return 'error';
  if (typeof obj?.exit_code === 'number') return obj.exit_code === 0 ? 'ok' : 'error';
  if (typeof obj?.exitCode === 'number') return obj.exitCode === 0 ? 'ok' : 'error';
  if (type === 'error') return 'error';
  return undefined;
}

function coerceMessage(v) {
  if (v == null) return undefined;
  if (typeof v === 'string') return trunc(v.replace(/\s+/g, ' ').trim(), 400);
  if (Array.isArray(v)) {
    return trunc(v.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).filter(Boolean).join(' '), 400);
  }
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return trunc(v.text, 400);
    try { return trunc(JSON.stringify(v), 300); } catch { return undefined; }
  }
  return trunc(String(v), 400);
}

/**
 * Normalise one arbitrary object into an AuroraEvent.
 * @returns {import('./schema.js').AuroraEvent}
 */
export function normalizeEvent(obj, index = 0) {
  const src = obj && typeof obj === 'object' ? obj : { message: String(obj ?? '') };
  const type = coerceType(pick(src, TYPE_KEYS));
  const dur = pick(src, DUR_KEYS);
  const ev = {
    ts: coerceTs(pick(src, TS_KEYS)) ?? '',
    type,
    agent: String(pick(src, AGENT_KEYS) ?? 'default').trim() || 'default',
    raw: src,
  };
  const phase = pick(src, PHASE_KEYS);
  if (phase != null) ev.phase = String(phase);
  const name = pick(src, NAME_KEYS);
  if (name != null) ev.name = String(name);
  const message = coerceMessage(pick(src, MSG_KEYS));
  if (message) ev.message = message;
  const status = coerceStatus(src, type);
  if (status) ev.status = status;
  if (dur != null && Number.isFinite(Number(dur))) ev.durationMs = Number(dur);
  ev._idx = index;
  return ev;
}

/**
 * Fill missing timestamps by interpolating a synthetic monotonic clock, so
 * downstream players never divide by zero. Mutates + returns the array.
 */
export function fillTimestamps(events) {
  if (!events.length) return events;
  const known = events.map((e, i) => (e.ts ? { i, t: Date.parse(e.ts) } : null)).filter((x) => x && !Number.isNaN(x.t));
  if (!known.length) {
    const base = Date.UTC(2026, 0, 1);
    events.forEach((e, i) => { e.ts = new Date(base + i * 1000).toISOString(); e._synthetic = true; });
    return events;
  }
  // Before first known
  const first = known[0];
  for (let i = 0; i < first.i; i++) {
    events[i].ts = new Date(first.t - (first.i - i)).toISOString();
    events[i]._synthetic = true;
  }
  // Between / after
  for (let k = 0; k < known.length; k++) {
    const cur = known[k];
    const next = known[k + 1];
    if (!next) {
      for (let i = cur.i + 1; i < events.length; i++) {
        events[i].ts = new Date(cur.t + (i - cur.i)).toISOString();
        events[i]._synthetic = true;
      }
      break;
    }
    const gap = next.t - cur.t;
    const steps = next.i - cur.i;
    for (let i = cur.i + 1; i < next.i; i++) {
      events[i].ts = new Date(cur.t + (gap * (i - cur.i)) / steps).toISOString();
      events[i]._synthetic = true;
    }
  }
  return events;
}

/** Build the trace meta block. */
export function buildMeta(events, source) {
  const agents = new Set(events.map((e) => e.agent));
  const times = events.map((e) => Date.parse(e.ts)).filter((t) => !Number.isNaN(t));
  return {
    source,
    agentCount: agents.size,
    start: times.length ? new Date(Math.min(...times)).toISOString() : undefined,
    end: times.length ? new Date(Math.max(...times)).toISOString() : undefined,
  };
}
