import { normalizeEvent } from '../normalize.js';

/**
 * Native Aurora JSONL (produced by Aurora Orchestra, the OpenClaw trace-emit
 * plugin, and anything that already speaks our schema). Kept permissive so old
 * Orchestra artifacts written before the schema froze still load.
 */
export function looksLikeAurora(lines) {
  const sample = lines.slice(0, 40).filter((l) => l && typeof l === 'object');
  if (!sample.length) return false;
  const scored = sample.filter((l) => {
    const hasType = 'type' in l || 'event_type' in l;
    const hasWhen = 'ts' in l || 'timestamp' in l || 'time' in l;
    const hasWho = 'agent' in l || 'agent_id' in l || 'phase' in l || 'stage' in l;
    return hasType && (hasWhen || hasWho);
  });
  return scored.length >= Math.max(1, Math.floor(sample.length * 0.5));
}

export function fromAurora(lines, warn = () => {}) {
  const out = [];
  let malformed = 0;
  lines.forEach((l, i) => {
    try {
      out.push(normalizeEvent(l, i));
    } catch {
      malformed++;
    }
  });
  if (malformed) warn(`skipped ${malformed} malformed line(s)`);
  return out;
}
