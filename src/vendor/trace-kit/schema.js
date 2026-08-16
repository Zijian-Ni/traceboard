/**
 * Aurora standard trace event — the common language of the Aurora Evidence Suite.
 *
 * Design rule: keep the field set deliberately small. Anything format-specific
 * lives in `raw`, which is never discarded so detail drawers can show the truth.
 *
 * @typedef {'phase_start'|'phase_end'|'agent_call'|'agent_result'|'tool_call'|'tool_result'|'llm_call'|'error'|'note'} AuroraEventType
 *
 * @typedef {Object} AuroraEvent
 * @property {string}  ts           ISO-8601. Synthesised in order when missing.
 * @property {AuroraEventType} type
 * @property {string}  agent        Swimlane name. Defaults to 'default'.
 * @property {string} [phase]
 * @property {string} [name]        Tool name / model name / phase name.
 * @property {string} [message]     Human-readable one-line summary.
 * @property {'ok'|'error'} [status]
 * @property {number} [durationMs]
 * @property {unknown} raw          Original line. Never dropped.
 *
 * @typedef {Object} AuroraTrace
 * @property {'aurora'|'claude-code'|'otel-genai'|'unknown'} format
 * @property {AuroraEvent[]} events
 * @property {string[]} warnings    Degradation notices; UI shows a yellow bar.
 * @property {{source?:string, agentCount:number, start?:string, end?:string}} meta
 */

export const EVENT_TYPES = /** @type {const} */ ([
  'phase_start',
  'phase_end',
  'agent_call',
  'agent_result',
  'tool_call',
  'tool_result',
  'llm_call',
  'error',
  'note',
]);

const TYPE_SET = new Set(EVENT_TYPES);

export function isEventType(v) {
  return typeof v === 'string' && TYPE_SET.has(v);
}

/** JSON Schema export so other tools (and CI) can validate traces. */
export const AURORA_EVENT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://zijian-ni.github.io/trace-kit/aurora-event.schema.json',
  title: 'AuroraEvent',
  type: 'object',
  required: ['ts', 'type', 'agent', 'raw'],
  properties: {
    ts: { type: 'string', description: 'ISO-8601 timestamp' },
    type: { enum: [...EVENT_TYPES] },
    agent: { type: 'string', minLength: 1 },
    phase: { type: 'string' },
    name: { type: 'string' },
    message: { type: 'string' },
    status: { enum: ['ok', 'error'] },
    durationMs: { type: 'number', minimum: 0 },
    raw: {},
  },
  additionalProperties: true,
};

export const AURORA_TRACE_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://zijian-ni.github.io/trace-kit/aurora-trace.schema.json',
  title: 'AuroraTrace',
  type: 'object',
  required: ['format', 'events', 'warnings', 'meta'],
  properties: {
    format: { enum: ['aurora', 'claude-code', 'otel-genai', 'unknown'] },
    events: { type: 'array', items: AURORA_EVENT_JSON_SCHEMA },
    warnings: { type: 'array', items: { type: 'string' } },
    meta: {
      type: 'object',
      required: ['agentCount'],
      properties: {
        source: { type: 'string' },
        agentCount: { type: 'integer', minimum: 0 },
        start: { type: 'string' },
        end: { type: 'string' },
      },
    },
  },
};

/** Truncate long text for one-line summaries. */
export function trunc(s, n = 200) {
  if (s == null) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}
