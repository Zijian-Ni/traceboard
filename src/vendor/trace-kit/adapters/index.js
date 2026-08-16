import { looksLikeClaudeCode, fromClaudeCode } from './claude-code.js';
import { looksLikeOtel, fromOtelGenAI } from './otel-genai.js';
import { looksLikeAurora, fromAurora } from './aurora.js';

/**
 * Format sniffing. Order matters: the two specific formats are tested before
 * the permissive Aurora sniffer, which would otherwise swallow everything.
 */
export const ADAPTERS = [
  { format: 'claude-code', detect: looksLikeClaudeCode, parse: fromClaudeCode },
  { format: 'otel-genai', detect: looksLikeOtel, parse: fromOtelGenAI },
  { format: 'aurora', detect: looksLikeAurora, parse: fromAurora },
];

/** @returns {'aurora'|'claude-code'|'otel-genai'|'unknown'} */
export function detectFormat(lines) {
  for (const a of ADAPTERS) {
    try {
      if (a.detect(lines)) return a.format;
    } catch {
      /* a broken sniffer must never break detection */
    }
  }
  return 'unknown';
}

export function adapterFor(format) {
  return ADAPTERS.find((a) => a.format === format) ?? null;
}

export { looksLikeClaudeCode, fromClaudeCode, looksLikeOtel, fromOtelGenAI, looksLikeAurora, fromAurora };
