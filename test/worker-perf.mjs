/**
 * TB-A1: Synthetic large-file streaming parse benchmark.
 *
 * Generates a 100MB JSONL file, then simulates what the Web Worker would do
 * (streaming line-by-line parse in batches of 500), measuring:
 *   - File generation time
 *   - Parse time to first batch (≈ first-paint proxy)
 *   - Total parse time
 *   - Events parsed
 *
 * Run: node test/worker-perf.mjs
 */

import { createWriteStream, statSync, unlinkSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TARGET_MB = 100
const BATCH_SIZE = 500
const OUT_FILE = join(tmpdir(), 'tb-large-trace.jsonl')

const TYPES = ['tool_call', 'tool_result', 'llm_call', 'agent_call', 'phase_start', 'phase_end', 'note', 'error']
const AGENTS = ['xiaoluo', 'hermes', 'dsh', 'phoenix', 'sentinel']
const MESSAGES = [
  'web_search completed successfully with 12 results',
  'LLM responded with 512 tokens in 2.4s',
  'Phase plan started — drafting lane prompts',
  'Tool bash executed: npm run test',
  'Agent hermes called with context',
  'Error: connection timeout after 30s',
  'Evidence pack written to /tmp/evidence.jsonl',
  'Redacting 3 secrets from payload',
]

// ── Step 1: Generate the file ──────────────────────────────────────────────
console.log(`\n🔧 Generating ${TARGET_MB}MB synthetic JSONL file…`)
const genStart = Date.now()

const ws = createWriteStream(OUT_FILE)
let bytesWritten = 0
const targetBytes = TARGET_MB * 1024 * 1024

let lineIdx = 0
while (bytesWritten < targetBytes) {
  const event = {
    ts: new Date(1723000000000 + lineIdx * 500).toISOString(),
    type: TYPES[lineIdx % TYPES.length],
    agent: AGENTS[lineIdx % AGENTS.length],
    phase: lineIdx % 3 === 0 ? 'plan' : lineIdx % 3 === 1 ? 'execute' : 'synthesize',
    message: MESSAGES[lineIdx % MESSAGES.length],
    durationMs: Math.floor(Math.random() * 5000),
  }
  const line = JSON.stringify(event) + '\n'
  ws.write(line)
  bytesWritten += line.length
  lineIdx++
}

await new Promise((res, rej) => { ws.end(); ws.on('finish', res); ws.on('error', rej) })
const genMs = Date.now() - genStart
const actualMB = statSync(OUT_FILE).size / (1024 * 1024)
console.log(`✅ Generated ${actualMB.toFixed(1)}MB in ${genMs}ms (${lineIdx.toLocaleString()} events)`)

// ── Step 2: Simulate streaming parse (what the worker does) ───────────────
console.log(`\n🔄 Simulating Web Worker streaming parse (batch size: ${BATCH_SIZE})…`)
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const parseStart = Date.now()
let parsedTotal = 0
let batchCount = 0
let firstBatchMs = null
let currentBatch = []

const rl = createInterface({ input: createReadStream(OUT_FILE), crlfDelay: Infinity })

for await (const line of rl) {
  const trimmed = line.trim()
  if (!trimmed) continue
  try {
    const obj = JSON.parse(trimmed)
    currentBatch.push(obj)
    parsedTotal++

    if (currentBatch.length >= BATCH_SIZE) {
      batchCount++
      if (!firstBatchMs) {
        firstBatchMs = Date.now() - parseStart
        console.log(`  ⚡ First batch (${BATCH_SIZE} events): ${firstBatchMs}ms (first-paint proxy)`)
      }
      currentBatch = []
    }
  } catch { /* skip bad lines */ }
}

// flush remainder
if (currentBatch.length) batchCount++

const totalParseMs = Date.now() - parseStart
const throughputMBps = (actualMB / (totalParseMs / 1000)).toFixed(1)

console.log(`✅ Streaming parse complete:`)
console.log(`   Events parsed:    ${parsedTotal.toLocaleString()}`)
console.log(`   Batches emitted:  ${batchCount.toLocaleString()}`)
console.log(`   First-paint proxy: ${firstBatchMs}ms`)
console.log(`   Total parse time: ${totalParseMs}ms`)
console.log(`   Throughput:       ${throughputMBps} MB/s`)

// ── Step 3: Cleanup ────────────────────────────────────────────────────────
unlinkSync(OUT_FILE)
console.log(`\n🧹 Cleaned up temp file`)

// ── Step 4: Assertions ─────────────────────────────────────────────────────
const PASS = { ok: true, fail: false }
const results = {
  'First paint under 1s': firstBatchMs < 1000,
  'Parsed all events': parsedTotal === lineIdx,
  'Throughput >50 MB/s': parseFloat(throughputMBps) > 50,
}

console.log('\n📊 TB-A1 Results:')
let allPassed = true
for (const [label, passed] of Object.entries(results)) {
  const icon = passed ? '✅' : '❌'
  console.log(`  ${icon} ${label}`)
  if (!passed) allPassed = false
}

if (!allPassed) {
  console.log('\n❌ Some benchmarks failed')
  process.exit(1)
} else {
  console.log('\n✅ All TB-A1 benchmarks passed')
}
