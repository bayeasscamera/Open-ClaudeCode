/**
 * loopEventIpc.cjs
 *
 * IPC bridge for the spec-level LoopEvent stream (phase 5).
 *
 * The OPC loop emits `LoopEvent` objects on a Node-side emitter. When the
 * loop is hosted by the desktop CLI runner, the renderer needs to receive
 * those events so the UI can render text deltas, tool cards, and the
 * awaiting_user / human_decided lifecycle.
 *
 * Flow:
 *   1. The CLI runner (or any Node-side producer) calls
 *      `writeJsonLine(line)` whenever a `LoopEvent` is serialized.
 *   2. This handler forwards the parsed event to all live renderer windows
 *      via the `opc:loop-event` channel.
 *   3. Malformed lines are dropped with a single best-effort log entry so a
 *      corrupt producer cannot tear down the whole IPC bridge.
 *
 * The handler is fail-safe: any unexpected error in forwarding is swallowed.
 */

const LOOP_EVENT_CHANNEL = 'opc:loop-event'
const MAX_LINE_BYTES = 256 * 1024

function isValidLoopEvent(value) {
  if (!value || typeof value !== 'object') return false
  if (typeof value.type !== 'string') return false
  if (typeof value.seq !== 'number') return false
  if (typeof value.ts !== 'string') return false
  // Allow any other fields — the renderer trusts the producer.
  return true
}

function registerLoopEventIpc({ handle, ipcMain, log = () => {} } = {}) {
  if (!ipcMain) {
    throw new Error('registerLoopEventIpc: ipcMain is required')
  }

  // Local seq counter — kept closure-private so the renderer can dedupe
  // when the same event is delivered twice (e.g. after a renderer reload).
  let seqCounter = 0

  /**
   * Forward a single JSONL line (without trailing newline) to every live
   * renderer window. Returns true when the line was broadcast, false when
   * it was malformed (and therefore dropped).
   *
   * Exposed for the CLI runner via the closure returned below; do NOT
   * register it as an IPC handler — that would let any renderer forge
   * loop events.
   */
  function broadcastJsonLine(line) {
    if (typeof line !== 'string') return false
    const trimmed = line.replace(/\r?\n$/, '')
    if (!trimmed) return false
    if (trimmed.length > MAX_LINE_BYTES) {
      log(`loopEventIpc: dropped line over ${MAX_LINE_BYTES} bytes`)
      return false
    }
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      log(`loopEventIpc: dropped malformed JSONL: ${err && err.message ? err.message : err}`)
      return false
    }
    if (!isValidLoopEvent(parsed)) {
      log('loopEventIpc: dropped line (not a valid LoopEvent)')
      return false
    }
    try {
      const { BrowserWindow } = require('electron')
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(LOOP_EVENT_CHANNEL, parsed)
        }
      }
    } catch (err) {
      log(`loopEventIpc: broadcast failed: ${err && err.message ? err.message : err}`)
      return false
    }
    return true
  }

  // Optional explicit no-op handler so consumers can verify the channel
  // is registered (mirrors the humanGateIpc pattern). Renderer subscribes
  // via `onLoopEvent`, never invokes.
  if (typeof handle === 'function') {
    try {
      handle('opc:loop-event:ping', async () => ({ ok: true, channel: LOOP_EVENT_CHANNEL }))
    } catch {
      /* channel already registered — ignore */
    }
  }

  /**
   * Build a LoopEvent payload (filling seq + ts), serialize it to JSONL,
   * and broadcast. `partial` must include a `type` discriminator from the
   * LoopEvent vocabulary ('loop_started', 'awaiting_user', 'human_decided',
   * …); any extra fields are forwarded as-is. The bridge never lies about
   * the type: it accepts any string the caller supplies but the renderer
   * filters by the known set.
   * Returns true when the event was broadcast, false when rejected.
   */
  function broadcastLoopEvent(partial) {
    if (!partial || typeof partial !== 'object') return false
    if (typeof partial.type !== 'string' || !partial.type) return false
    // seq must be a non-negative integer when supplied; otherwise auto-assign.
    let seq
    if (Number.isFinite(partial.seq) && Number(partial.seq) >= 0) {
      seq = Math.floor(Number(partial.seq))
    } else {
      seq = ++seqCounter
    }
    const ts = typeof partial.ts === 'string' ? partial.ts : new Date().toISOString()
    const event = { ...partial, seq, ts }
    let line
    try {
      line = JSON.stringify(event) + '\n'
    } catch (err) {
      log(`loopEventIpc: serialize failed: ${err && err.message ? err.message : err}`)
      return false
    }
    // Fail fast: drop pathological payloads before broadcasting.
    if (line.length > MAX_LINE_BYTES) {
      log(`loopEventIpc: dropped oversized event (${line.length} bytes)`)
      return false
    }
    return broadcastJsonLine(line)
  }

  return {
    broadcastJsonLine,
    broadcastLoopEvent,
    channel: LOOP_EVENT_CHANNEL,
  }
}

module.exports = {
  LOOP_EVENT_CHANNEL,
  registerLoopEventIpc,
}
