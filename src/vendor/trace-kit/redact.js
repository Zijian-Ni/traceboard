/**
 * Redaction — call before ANY trace leaves the machine (share link, export,
 * evidence pack, skill draft).
 *
 * Ordering matters: the more specific patterns run first so that a JWT is not
 * partially eaten by the generic auth-header rule.
 */

/** @type {[RegExp, string][]} */
const PATTERNS = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[REDACTED_JWT]'],
  [/\bsk-[A-Za-z0-9\-_]{16,}/g, '[REDACTED_API_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED_GH_TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED_SLACK_TOKEN]'],
  [/\bAIza[0-9A-Za-z\-_]{30,}/g, '[REDACTED_GOOGLE_KEY]'],
  [/\b\d{6,10}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED_TELEGRAM_TOKEN]'],
  [/(?:Bearer|Authorization:)\s+\S+/gi, '[REDACTED_AUTH]'],
  [/\b(?:password|passwd|secret|api[_-]?key|token)\b\s*[=:]\s*["']?[^\s"',;]{6,}/gi, '[REDACTED_SECRET]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/[A-Za-z]:\\Users\\[^\\\s"']+/g, '[REDACTED_HOME]'],
  [/\/(?:Users|home)\/[^\s"'/\\]+/g, '/[REDACTED_HOME]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[REDACTED_IP]'],
];

/** Localhost / loopback should stay readable — they leak nothing. */
const IP_ALLOW = /^(?:127\.0\.0\.1|0\.0\.0\.0|255\.255\.255\.\d+|localhost)/;

/**
 * @param {string} text
 * @returns {{ text: string, hits: number }}
 */
export function redact(text) {
  if (text == null) return { text: '', hits: 0 };
  let out = String(text);
  let hits = 0;
  for (const [re, sub] of PATTERNS) {
    out = out.replace(re, (m) => {
      if (sub === '[REDACTED_IP]' && IP_ALLOW.test(m)) return m;
      hits++;
      return sub;
    });
  }
  return { text: out, hits };
}

/** Does this text look like it contains something we should not publish? */
export function hasSecrets(text) {
  return redact(text).hits > 0;
}

/**
 * Redact a single event, including its `raw` payload.
 * @param {import('./schema.js').AuroraEvent} e
 */
export function redactEvent(e) {
  let hits = 0;
  const r = (s) => {
    if (s == null) return s;
    const out = redact(s);
    hits += out.hits;
    return out.text;
  };
  let raw = e.raw;
  if (raw !== undefined) {
    try {
      const out = redact(JSON.stringify(raw));
      hits += out.hits;
      raw = JSON.parse(out.text);
    } catch {
      raw = '[REDACTED_UNSERIALIZABLE]';
    }
  }
  return {
    event: { ...e, message: r(e.message), name: r(e.name), raw },
    hits,
  };
}

/**
 * Redact a whole trace. Returns the new trace plus a total hit count so the UI
 * can honestly say "redacted N items" instead of a vague reassurance.
 * @param {import('./schema.js').AuroraTrace} trace
 */
export function redactTrace(trace) {
  let hits = 0;
  const events = trace.events.map((e) => {
    const r = redactEvent(e);
    hits += r.hits;
    return r.event;
  });
  return { trace: { ...trace, events }, hits };
}
