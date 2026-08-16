import { trunc } from '../schema.js';

/**
 * Claude Code transcript adapter.
 *
 * Official docs state this is an INTERNAL format that changes between versions,
 * so every access here is defensive: unknown block types are skipped silently,
 * missing fields degrade instead of throwing, and one bad line never kills a
 * whole session file.
 *
 * Path shape (for docs): ~/.claude/projects/<munged-path>/<session-id>.jsonl
 * Sub-agents:            <session-id>/subagents/agent-<id>.jsonl
 */

const KNOWN_TOP_TYPES = ['user', 'assistant', 'system', 'summary', 'progress', 'result'];

export function looksLikeClaudeCode(lines) {
  const sample = lines.slice(0, 40).filter((l) => l && typeof l === 'object');
  if (!sample.length) return false;
  const hits = sample.filter(
    (l) => ('uuid' in l || 'parentUuid' in l || 'sessionId' in l) && KNOWN_TOP_TYPES.includes(l.type),
  );
  return hits.length >= Math.max(1, Math.floor(sample.length * 0.2));
}

const flattenContent = (c) => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).filter(Boolean).join(' ');
  if (c && typeof c === 'object') return c.text ?? '';
  return '';
};

function summarizeToolInput(name, input) {
  if (!input) return name;
  try {
    if ((name === 'Bash' || name === 'bash') && input.command) return `$ ${trunc(String(input.command), 160)}`;
    if (input.file_path) return `${name}: ${input.file_path}`;
    if (input.path) return `${name}: ${input.path}`;
    if (input.pattern) return `${name}: /${input.pattern}/`;
    if (input.url) return `${name}: ${input.url}`;
    if (input.prompt) return `${name}: ${trunc(String(input.prompt), 120)}`;
    return `${name}(${trunc(JSON.stringify(input), 120)})`;
  } catch {
    return name;
  }
}

/**
 * @param {any[]} lines
 * @param {(m:string)=>void} warn
 * @returns {import('../schema.js').AuroraEvent[]}
 */
export function fromClaudeCode(lines, warn = () => {}) {
  const out = [];
  let malformed = 0;
  // Track sub-agent (Task tool) lanes so parallel work shows as separate lanes.
  const sidechainAgents = new Map();

  for (const l of lines) {
    try {
      if (!l || typeof l !== 'object') continue;
      const ts = l.timestamp ?? l.ts ?? '';
      const isSidechain = l.isSidechain === true;
      const laneFor = (base) => {
        if (!isSidechain) return base;
        const key = l.parentUuid ?? l.sessionId ?? 'sub';
        if (!sidechainAgents.has(key)) sidechainAgents.set(key, `subagent-${sidechainAgents.size + 1}`);
        return sidechainAgents.get(key);
      };

      if (l.type === 'user' || l.type === 'assistant') {
        const content = l.message?.content;
        const blocks = Array.isArray(content)
          ? content
          : typeof content === 'string'
            ? [{ type: 'text', text: content }]
            : [];

        const model = l.message?.model;
        const usage = l.message?.usage;
        if (l.type === 'assistant' && model) {
          out.push({
            ts,
            type: 'llm_call',
            agent: laneFor('claude'),
            name: model,
            message: usage
              ? `${model} · in ${usage.input_tokens ?? '?'} / out ${usage.output_tokens ?? '?'} tokens`
              : model,
            raw: l,
          });
        }

        for (const b of blocks) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'text' && String(b.text ?? '').trim()) {
            out.push({
              ts,
              type: l.type === 'user' ? 'agent_call' : 'agent_result',
              agent: l.type === 'user' ? laneFor('user') : laneFor('claude'),
              message: trunc(b.text),
              raw: l,
            });
          } else if (b.type === 'tool_use') {
            out.push({
              ts,
              type: 'tool_call',
              agent: laneFor('claude'),
              name: b.name,
              message: summarizeToolInput(b.name, b.input),
              raw: l,
            });
          } else if (b.type === 'tool_result') {
            out.push({
              ts,
              type: 'tool_result',
              agent: laneFor('claude'),
              status: b.is_error ? 'error' : 'ok',
              message: trunc(flattenContent(b.content)),
              raw: l,
            });
          }
          // thinking / image / unknown blocks: silently skipped by design
        }
      } else if (l.type === 'system') {
        out.push({
          ts,
          type: l.level === 'error' || l.isError ? 'error' : 'note',
          agent: 'system',
          message: trunc(l.content ?? l.summary ?? l.subtype ?? 'system'),
          raw: l,
        });
      } else if (l.type === 'summary') {
        out.push({ ts, type: 'note', agent: 'system', message: trunc(l.summary ?? 'summary'), raw: l });
      } else if (l.type === 'result') {
        out.push({
          ts,
          type: 'phase_end',
          agent: 'claude',
          name: 'session',
          status: l.is_error || l.subtype === 'error' ? 'error' : 'ok',
          message: trunc(l.result ?? l.subtype ?? 'result'),
          durationMs: Number.isFinite(l.duration_ms) ? l.duration_ms : undefined,
          raw: l,
        });
      }
      // unknown top-level types (progress, snapshots, future additions): skipped
    } catch {
      malformed++;
    }
  }
  if (malformed) warn(`skipped ${malformed} malformed Claude Code line(s)`);
  return out;
}
