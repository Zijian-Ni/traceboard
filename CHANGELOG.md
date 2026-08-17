# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- TB-A2 canvas swimlanes: traces of 4 000 events or more now render on a canvas
  with bucketed level-of-detail instead of one DOM node per event. Drag to pan,
  scroll to zoom, click to open the detail drawer, hover for a tooltip. A
  12 000-event trace renders in about 150 ms.
- `src/canvas-lanes.js` (lane index, bucketing, viewport maths) and
  `src/canvas-view.js` (renderer, hit-testing, pointer and wheel handling).
- 26 unit tests covering renderer selection, bucketing, level-of-detail,
  viewport clamping and hit-testing, including a 200 000-event stats pass that
  would blow the call stack if written with `Math.min(...events)`.

### Notes

- Smaller traces keep the accessible DOM renderer; nothing changes below the
  threshold.
- The "one aurora-ring per screen" rule is preserved: in canvas mode the ring is
  a single positioned element, because there are no DOM event blocks to carry it.

## [0.4.0] — 2026-08-16

### Added

- trace-kit adoption: Claude Code, OpenTelemetry GenAI and Aurora JSONL all load by drag-and-drop, with a format chip and a warnings bar.
- lz-string compressed sharing on `#t2=`, with the legacy base64 links still supported.
- Redaction toggle, default on, reporting how many items were removed.
- Streaming Web Worker parse, IndexedDB trace library and PWA offline support.
- ⌘K command palette.

### Fixed

- `#t2=` now accepts JSONL as well as JSON arrays. Aurora Orchestra's *Open in Traceboard* button sends JSONL, so the deep link that closes the loop across the whole suite silently decoded to null.
- The test file inlined its own copies of the share functions instead of importing them, so it could only ever prove the copy worked — which is exactly why the bug above was invisible.

_18 tests._
