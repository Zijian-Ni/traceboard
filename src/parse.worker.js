/**
 * TB-A1: Streaming parse worker.
 * Reads a File via streaming, parses JSONL incrementally,
 * posts batches of lines to the main thread.
 */

const BATCH_SIZE = 500

self.onmessage = async (e) => {
  const { file } = e.data
  if (!file) return

  const decoder = new TextDecoder()
  let leftover = ''
  let total = 0
  let batch = []

  try {
    const stream = file.stream()
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const text = leftover + chunk
      const lines = text.split('\n')
      // last may be incomplete — keep as leftover
      leftover = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          batch.push(obj)
          total++
          if (batch.length >= BATCH_SIZE) {
            self.postMessage({ kind: 'batch', lines: batch, total })
            batch = []
          }
        } catch {
          // skip bad lines
        }
      }
    }

    // flush leftover
    if (leftover.trim()) {
      try {
        batch.push(JSON.parse(leftover.trim()))
        total++
      } catch { /* ignore */ }
    }

    if (batch.length) {
      self.postMessage({ kind: 'batch', lines: batch, total })
    }
    self.postMessage({ kind: 'done', total })
  } catch (err) {
    self.postMessage({ kind: 'error', message: err.message })
  }
}
