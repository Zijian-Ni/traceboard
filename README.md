# 🌊 Traceboard

> **The VLC player for agent traces.** Any format, drag it in, it plays. The URL is the share mechanism. Never needs a backend.

<!-- GIF PLACEHOLDER: replace this line with your screen recording -->
![Traceboard demo GIF](docs/demo.gif)

[![CI](https://github.com/Zijian-Ni/traceboard/actions/workflows/test.yml/badge.svg)](https://github.com/Zijian-Ni/traceboard/actions/workflows/test.yml)
[![Live Demo](https://img.shields.io/badge/demo-live-teal.svg)](https://zijian-ni.github.io/traceboard/)
[![MIT License](https://img.shields.io/badge/license-MIT-teal.svg)](LICENSE)
[![Zero Backend](https://img.shields.io/badge/backend-none-success.svg)]()
[![Zero Telemetry](https://img.shields.io/badge/telemetry-zero-violet.svg)]()

**Part of the [Aurora Evidence Suite](https://github.com/Zijian-Ni/aurora-evidence-suite)** — local-first evidence tools for AI agents.

---

## 30-second Quickstart

```bash
git clone https://github.com/Zijian-Ni/traceboard
cd traceboard
npm install
npm run dev          # → http://localhost:5173
```

Drag in any `.jsonl` trace, or click **Load Live Demo** to replay a real 3-agent Aurora Orchestra run.

**Drop a Claude Code session file directly:**
```
~/.claude/projects/<project>/<session-id>.jsonl
```
Traceboard auto-detects the format and renders it as a swimlane timeline.

---

## Supported Formats

| Format | Auto-detected from | Typical source |
|---|---|---|
| **Claude Code** ✨ | `uuid`/`parentUuid` + `type: user\|assistant\|system\|summary` | `~/.claude/projects/<project>/<session>.jsonl` |
| **OTel GenAI** | `resourceSpans` / `spanId`+`traceId` | LangChain, CrewAI, AutoGen, Datadog, Honeycomb, Grafana |
| **Aurora** | `type` + `ts`/`agent` fields | Aurora Orchestra, OpenClaw `trace-emit` (OpenClaw = a self-hosted LLM gateway), custom scripts |
| **Unknown** | — | Parsed with a permissive fallback + a visible notice. Never a white screen. |

Format detection is automatic. A format chip in the header shows which adapter was used.

---

## Features

| | |
|---|---|
| 🏊 **Swimlanes by agent** | Every agent gets its own row with dashed connector lines. |
| 🏷️ **Event type filters** | Toggle `phase_start`, `agent_call`, `error`, etc. |
| ▶️ **Cinematic playback** | Step through events or let it play automatically. |
| 🔍 **Detail drawer** | Click any event → full raw JSON + phase duration. |
| 🔗 **Compressed sharing** | lz-string `#t2=` URL (5–10× smaller than base64). MAX 8 000 chars. Legacy `#trace=` links still open. |
| 🛡️ **Redaction (default ON)** | Strips API keys, tokens, home paths, emails before sharing. Shows "Redacted N items". |
| 📤 **Export HTML snapshot** | Self-contained dark HTML table, email-able or committable. |
| ⚡ **Streaming parse** | Web Worker streams JSONL in 500-line batches — 100 MB file, first paint under 1 s. |
| 📚 **Trace Library** | IndexedDB stores recent traces as a `.bento` card grid. Browser-local only. |
| 📱 **PWA / offline** | Installable. Works fully offline once cached. |
| ⌘K **Command palette** | Jump to event, switch agent filter, export, toggle redaction. |
| 🌐 **Bilingual CN/EN** | All UI strings in `src/i18n.js`. |
| 🎨 **Dark / light / auto theme** | Persisted to `localStorage`. |

---

## Architecture

```
traceboard/
├── index.html               # Single-page app shell + PWA manifest link
├── src/
│   ├── main.js              # App logic (TB-1–TB-3, TB-A1, TB-A3, ⌘K)
│   ├── style.css            # Aurora dark theme
│   ├── i18n.js              # EN/中文 strings
│   ├── trace.js             # Delegates to trace-kit; lz-string encode/decode
│   ├── colors.js            # Agent + event type palette
│   ├── parse.worker.js      # TB-A1: streaming JSONL Web Worker
│   ├── library.js           # TB-A3: IndexedDB trace library
│   └── vendor/
│       ├── trace-kit/       # @aurora-suite/trace-kit (vendored, zero-dep)
│       └── aurora-ui/       # Aurora UI design system (vendored)
├── public/
│   ├── demo/                # Sample traces (aurora, claude-code, otel-genai, secrets)
│   ├── manifest.webmanifest # PWA manifest
│   └── sw.js                # Service worker (offline support)
├── test/
│   ├── share-url.test.js    # Round-trip, redaction, format detection tests
│   └── worker-perf.mjs      # TB-A1 synthetic 100 MB benchmark
└── .github/workflows/test.yml
```

Everything runs in-browser. No fetch to any server after initial page load
(except `./demo/` for the bundled demo). No API keys. No telemetry.

---

## Sharing & Redaction

The **Share** button opens a popup with:
- **Redact secrets & paths** checkbox (default ON) — calls `redactTrace()` from trace-kit before encoding.
- After sharing, a toast shows "Redacted N items".
- If redaction is OFF and secrets are detected, a red warning chip appears next to the Share button.
- The share URL uses lz-string compression (`#t2=` prefix), typically 5–10× smaller than the old base64 format.
- URLs over 8 000 chars show a dialog: **Export HTML snapshot** or **Share only filtered events**.
- Legacy `#trace=` base64 URLs from v0.3 still open correctly.

---

## PWA / Offline

```bash
# Build and deploy
npm run build

# Install from browser
# Chrome/Edge: address bar → install icon
# iOS Safari: Share → Add to Home Screen
```

Once installed, Traceboard works fully offline — static assets and demo traces are pre-cached by the service worker. Your trace library (IndexedDB) is browser-local; nothing is synced anywhere.

---

## Running tests

```bash
npm test                  # node --test — 17 tests, no external framework
node test/worker-perf.mjs # TB-A1 benchmark: 100 MB JSONL, first paint <1s
```

---

## Deploy to GitHub Pages

```bash
npm run build
# Push dist/ to gh-pages branch, or set GitHub Pages source to /dist
```

---

## 中文说明

**Traceboard** 是 Aurora Evidence Suite 的"前台门面"：把你的 AI Agent 运行轨迹变成可分享的泳道时间线。

**主要特性：**
- 拖入 `.jsonl` 文件即可自动识别格式（Claude Code / OTel GenAI / Aurora）
- 可拖入 Claude Code 会话文件：`~/.claude/projects/<项目>/<会话ID>.jsonl`
- ⌘K 命令面板：跳转事件、按 Agent 过滤、切换脱敏
- 分享链接默认开启脱敏（自动去除 API 密钥、路径、邮件等）
- IndexedDB 本地轨迹库，100% 离线，不上传任何数据
- 支持 PWA 安装，断网可用
- 中英文双语界面

**快速开始：**
```bash
git clone https://github.com/Zijian-Ni/traceboard
cd traceboard && npm install && npm run dev
```

---

## License

MIT © 2026 Zijian Ni
