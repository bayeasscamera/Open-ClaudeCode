/**
 * humanGateIpc.cjs
 *
 * IPC bridge for the OPC loop's human-in-the-loop gate.
 *
 * Flow:
 *   1. CLI/runner calls `opc:human-gate-ask` via ipcRenderer.invoke().
 *   2. Main process stores a pending promise keyed by `id`, then forwards
 *      the prompt to the renderer (`opc:human-gate-prompt`).
 *   3. The renderer shows a confirmation banner; user clicks Approve/Reject.
 *   4. Renderer sends back `opc:human-gate-respond` with `{ id, decision }`.
 *   5. Main resolves the pending promise.
 *
 * If the user does not respond within `timeoutMs`, the pending promise
 * resolves to `'timeout'` so the loop can continue.
 *
 * The handler is fail-safe: any unexpected error resolves the pending
 * promise to `'timeout'`. The loop never hangs because of a UI glitch.
 */

const PROMPT_CHANNEL = 'opc:human-gate-prompt'
const RESPOND_CHANNEL = 'opc:human-gate-respond'
const ASK_CHANNEL = 'opc:human-gate-ask'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 10 * 60_000
const MAX_QUEUE = 16
const MAX_QUESTION_CHARS = 4_000
const MAX_CONTEXT_CHARS = 8_000
const MAX_OPTION_CHARS = 80
const MAX_PROMPT_ID_CHARS = 256

function clampTimeout(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, MAX_TIMEOUT_MS)
}

function isValidDecision(value) {
  return value === 'approved' || value === 'rejected' || value === 'timeout'
}

function normalizeId(value) {
  const id = String(value || '').replace(/\u0000/g, '').trim()
  if (!id || id.length > MAX_PROMPT_ID_CHARS) return ''
  return id
}

function normalizeQuestion(value) {
  const q = String(value || '').replace(/\u0000/g, '').trim()
  if (!q) return ''
  return q.slice(0, MAX_QUESTION_CHARS)
}

function normalizeContext(value) {
  if (value == null) return ''
  const c = String(value).replace(/\u0000/g, '')
  return c.length > MAX_CONTEXT_CHARS ? `${c.slice(0, MAX_CONTEXT_CHARS)}…` : c
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return ['Approve', 'Reject']
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.replace(/\u0000/g, '').trim()
    if (!trimmed) continue
    out.push(trimmed.slice(0, MAX_OPTION_CHARS))
    if (out.length >= 4) break
  }
  return out.length ? out : ['Approve', 'Reject']
}

function registerHumanGateIpc({ handle, ipcMain, onAwaitingUser, onHumanDecided }) {
  // Pending prompts awaiting a renderer response. Keyed by request id.
  const pending = new Map()
  // Timeouts per request, so we can clear them on early response.
  const timers = new Map()

  function cleanup(id) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    pending.delete(id)
  }

  // Renderer responds to a pending prompt.
  ipcMain.on(RESPOND_CHANNEL, (_event, payload) => {
    if (!payload || typeof payload !== 'object') return
    const id = normalizeId(payload.id)
    const decision = String(payload.decision || '').trim()
    if (!id || !isValidDecision(decision)) return
    const resolve = pending.get(id)
    if (!resolve) return
    cleanup(id)
    safeNotify(onHumanDecided, { id, decision })
    resolve(decision)
  })

  handle(ASK_CHANNEL, async (_event, payload) => {
    if (pending.size >= MAX_QUEUE) {
      return 'timeout'
    }
    const id = normalizeId(payload?.id)
    if (!id) return 'timeout'

    const question = normalizeQuestion(payload?.question)
    const context = normalizeContext(payload?.context)
    const options = normalizeOptions(payload?.options)
    const timeoutMs = clampTimeout(payload?.timeoutMs, DEFAULT_TIMEOUT_MS)

    if (!question) return 'timeout'

    // Notify any listener (typically loopEventIpc.broadcastJsonLine) that
    // the loop is now waiting on a human — so the renderer can render the
    // prompt and other consumers can react.
    safeNotify(onAwaitingUser, { id, question, context, timeoutMs })

    return await new Promise(resolve => {
      pending.set(id, resolve)
      const timer = setTimeout(() => {
        if (!pending.has(id)) return
        cleanup(id)
        safeNotify(onHumanDecided, { id, decision: 'timeout' })
        resolve('timeout')
      }, timeoutMs)
      timers.set(id, timer)

      // Best-effort broadcast to all windows. If the renderer is not loaded
      // (e.g. the app is running headless), the prompt is still queued —
      // and the timeout will eventually resolve the request.
      try {
        const { BrowserWindow } = require('electron')
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(PROMPT_CHANNEL, {
              id,
              question,
              context,
              options,
              timeoutMs,
            })
          }
        }
      } catch {
        // No electron / no renderer: caller will time out.
      }
    })
  })

  function shutdown() {
    for (const id of [...pending.keys()]) {
      const resolve = pending.get(id)
      cleanup(id)
      if (resolve) resolve('timeout')
    }
  }

  return { shutdown }
}

function safeNotify(fn, payload) {
  if (typeof fn !== 'function') return
  try {
    fn(payload)
  } catch {
    /* listener errors must never break the IPC handler */
  }
}

module.exports = { registerHumanGateIpc, ASK_CHANNEL, RESPOND_CHANNEL, PROMPT_CHANNEL }
