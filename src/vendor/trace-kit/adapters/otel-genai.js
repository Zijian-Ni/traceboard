import { trunc } from '../schema.js';

/**
 * OpenTelemetry GenAI semantic-convention adapter.
 *
 * The GenAI semconv is still pre-1.0 (v1.42.0, 2026-06-12): attribute keys can
 * still move. Everything version-sensitive is therefore isolated in ATTR below,
 * so a spec bump is a one-line change instead of a grep across the codebase.
 */
export const ATTR = {
  agentName: 'gen_ai.agent.name',
  agentId: 'gen_ai.agent.id',
  toolName: 'gen_ai.tool.name',
  toolCallId: 'gen_ai.tool.call.id',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  system: 'gen_ai.system',
  provider: 'gen_ai.provider.name',
  operation: 'gen_ai.operation.name',
  usageIn: 'gen_ai.usage.input_tokens',
  usageOut: 'gen_ai.usage.output_tokens',
  serviceName: 'service.name',
};

/** Span-name prefix → Aurora event type. Order matters (first match wins). */
const OP_MAP = [
  ['invoke_agent', 'agent_call'],
  ['create_agent', 'note'],
  ['execute_tool', 'tool_call'],
  ['embeddings', 'llm_call'],
  ['text_completion', 'llm_call'],
  ['generate_content', 'llm_call'],
  ['chat', 'llm_call'],
];

function attrValue(v) {
  if (v == null) return undefined;
  if (typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(attrValue);
  return undefined;
}

/** Accept both OTLP-JSON keyValue arrays and plain {k:v} maps. */
function flattenAttrs(attrs) {
  const out = {};
  if (!attrs) return out;
  if (Array.isArray(attrs)) {
    for (const kv of attrs) {
      if (kv && typeof kv === 'object' && 'key' in kv) out[kv.key] = attrValue(kv.value);
    }
  } else if (typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) out[k] = attrValue(v);
  }
  return out;
}

/**
 * OTLP encodes nanosecond clocks as strings precisely because they exceed
 * Number.MAX_SAFE_INTEGER. Doing the arithmetic in float64 introduces drift
 * (a 1750ms span measured as 1750.000128ms), so all nano maths goes through
 * BigInt and only the final millisecond value becomes a Number.
 */
const toBigNano = (n) => {
  if (n == null) return null;
  try {
    if (typeof n === 'bigint') return n;
    const s = String(n).trim();
    if (!/^\d+$/.test(s)) {
      const num = Number(s);
      return Number.isFinite(num) ? BigInt(Math.round(num)) : null;
    }
    return BigInt(s);
  } catch {
    return null;
  }
};

const NANO_PER_MS = 1_000_000n;

const nanoToIso = (n) => {
  const big = toBigNano(n);
  if (big == null) return '';
  const ms = Number(big / NANO_PER_MS);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

/** Exact elapsed milliseconds between two nanosecond clocks. */
const nanoDurationMs = (startNano, endNano) => {
  const a = toBigNano(startNano);
  const b = toBigNano(endNano);
  if (a == null || b == null || b < a) return undefined;
  const deltaNano = b - a;
  // Keep microsecond fidelity without float drift: divide by 1000 in BigInt,
  // then scale down once in float.
  return Number(deltaNano / 1000n) / 1000;
};

export function looksLikeOtel(lines) {
  const sample = lines.slice(0, 40).filter((l) => l && typeof l === 'object');
  if (!sample.length) return false;
  return sample.some(
    (l) =>
      'resourceSpans' in l ||
      'scopeSpans' in l ||
      ('spanId' in l && 'traceId' in l) ||
      ('span_id' in l && 'trace_id' in l),
  );
}

/** Pull a flat list of spans out of any of the OTLP shapes we accept. */
export function collectSpans(lines) {
  const spans = [];
  const push = (span, resourceAttrs) => spans.push({ span, resourceAttrs });
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    if (Array.isArray(l.resourceSpans)) {
      for (const rs of l.resourceSpans) {
        const rAttrs = flattenAttrs(rs.resource?.attributes);
        for (const ss of rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? []) {
          for (const sp of ss.spans ?? []) push(sp, rAttrs);
        }
      }
    } else if (Array.isArray(l.scopeSpans)) {
      const rAttrs = flattenAttrs(l.resource?.attributes);
      for (const ss of l.scopeSpans) for (const sp of ss.spans ?? []) push(sp, rAttrs);
    } else if (l.spanId || l.span_id) {
      push(l, flattenAttrs(l.resource?.attributes));
    }
  }
  return spans;
}

function typeForSpan(name, attrs) {
  const op = String(attrs[ATTR.operation] ?? name ?? '').toLowerCase();
  for (const [prefix, type] of OP_MAP) if (op.includes(prefix)) return type;
  if (attrs[ATTR.toolName]) return 'tool_call';
  if (attrs[ATTR.requestModel] || attrs[ATTR.responseModel]) return 'llm_call';
  if (attrs[ATTR.agentName]) return 'agent_call';
  return 'note';
}

/**
 * @param {any[]} lines
 * @param {(m:string)=>void} warn
 * @returns {import('../schema.js').AuroraEvent[]}
 */
export function fromOtelGenAI(lines, warn = () => {}) {
  const out = [];
  let malformed = 0;
  for (const { span, resourceAttrs } of collectSpans(lines)) {
    try {
      const attrs = { ...resourceAttrs, ...flattenAttrs(span.attributes) };
      const name = span.name ?? '';
      const type = typeForSpan(name, attrs);
      const startNano = span.startTimeUnixNano ?? span.start_time_unix_nano;
      const endNano = span.endTimeUnixNano ?? span.end_time_unix_nano;
      const start = nanoToIso(startNano);
      const durationMs = nanoDurationMs(startNano, endNano);

      const statusCode = span.status?.code ?? span.status?.Code;
      const isError = statusCode === 2 || statusCode === 'STATUS_CODE_ERROR';

      const agent =
        attrs[ATTR.agentName] ?? attrs[ATTR.agentId] ?? attrs[ATTR.serviceName] ?? attrs[ATTR.system] ?? 'default';

      const label = attrs[ATTR.toolName] ?? attrs[ATTR.responseModel] ?? attrs[ATTR.requestModel] ?? name;

      const tokens =
        attrs[ATTR.usageIn] != null || attrs[ATTR.usageOut] != null
          ? ` · in ${attrs[ATTR.usageIn] ?? '?'} / out ${attrs[ATTR.usageOut] ?? '?'} tok`
          : '';

      out.push({
        ts: start,
        type: isError ? 'error' : type,
        agent: String(agent),
        name: label ? String(label) : undefined,
        message: trunc(`${name}${tokens}${span.status?.message ? ` — ${span.status.message}` : ''}`),
        status: isError ? 'error' : 'ok',
        durationMs,
        raw: span,
      });

      // Span events (e.g. gen_ai.content.prompt) become notes so nothing is lost.
      for (const ev of span.events ?? []) {
        out.push({
          ts: nanoToIso(ev.timeUnixNano ?? ev.time_unix_nano) || start,
          type: 'note',
          agent: String(agent),
          name: ev.name,
          message: trunc(ev.name),
          raw: ev,
        });
      }
    } catch {
      malformed++;
    }
  }
  if (malformed) warn(`skipped ${malformed} malformed OTel span(s)`);
  return out;
}
