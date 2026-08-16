# Contributing to Traceboard

Thanks for helping! Traceboard is the "front door" of the Aurora Evidence Suite —
the VLC player for agent traces. Any format, drag it in, it plays.

## Running locally

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173
npm test          # node --test test/*.test.js
npm run build     # production build → dist/
```

## The most welcome contributions

### New trace format adapters
Traceboard delegates parsing to the vendored `trace-kit` library (`src/vendor/trace-kit/`). To add a new format:

1. Add an adapter to `src/vendor/trace-kit/adapters/<name>.js` exporting `looksLike<Name>(lines)` and `from<Name>(lines, warn)`.
2. Register it in `src/vendor/trace-kit/adapters/index.js` (specific sniffers go **before** the permissive Aurora sniffer).
3. Drop a fixture in `public/demo/<name>.jsonl` (≥5 events, at least one malformed line).
4. Add a test in `test/share-url.test.js` asserting format detection round-trips cleanly.

### New redaction patterns
Add to `PATTERNS` in `src/vendor/trace-kit/redact.js` — include a test proving the secret is caught and an innocent-looking similar string is **not** caught.

### UI improvements
Read the aurora-ui aesthetic laws in `src/vendor/aurora-ui/aurora-ui.css` before touching styles. Hard rules:
- No hard-coded hex outside CSS variable definitions. All colours are tokens.
- `.aurora-ring` appears **exactly once** on screen at a time (the currently-selected event block).
- Every animation respects `prefers-reduced-motion`.

## Non-negotiables

| Rule | Reason |
|---|---|
| Zero telemetry | Brand rule — "zero telemetry" is on the label |
| No backend, no API keys | Local-first; works offline as a PWA |
| CN/EN bilingual | All new UI strings go in both `en` and `zh` in `src/i18n.js` |
| MIT license | Must stay MIT; do not add dependencies with incompatible licenses |
| Never a white screen | Unknown formats must show a friendly error, not an uncaught exception |

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/): `feat:` `fix:` `docs:` `refactor:` `test:` `chore:`.

Put the task ID in the commit body when implementing a roadmap item:

```
feat(share): lz-string compressed URL sharing

Task: TB-2
```

Multiple focused commits are better than one giant "refactor everything" commit.

## Testing guidelines

- Tests live in `test/` and use `node --test` (no external test framework needed).
- Every new feature should have at least one round-trip test.
- Redaction tests should assert both that a secret **is** caught and that a clean string **is not**.
- CI runs on Node 20 and 22 via `.github/workflows/test.yml`.

## Good first issues

Look for the `good first issue` label. Adding a new format adapter or a redaction pattern are classic good-first-issue candidates — self-contained, well-tested, high value.

## Questions

Open an issue or drop a note in the discussions tab. This is a solo-maintained project right now, so response times vary, but PRs with passing tests get reviewed quickly.
