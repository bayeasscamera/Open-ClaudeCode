import { createInterface } from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import { appendMemory } from './memory.js'

/**
 * Human-in-the-loop gate for the OPC loop.
 *
 * When the reasoner returns `ask-human`, the runner asks the gate to surface
 * a confirmation prompt. The gate decides how to ask:
 *   - terminal (CLI context)
 *   - Electron IPC (desktop context, via the humanGateIpc handler)
 *   - mocked / no-op (tests, scripted runs)
 *
 * Every gate MUST return a decision in bounded time. `timeout` is the
 * catch-all outcome that the runner treats as "skip this iteration, retry
 * with reduced confidence". This guarantees the loop never hangs on a
 * missing UI.
 */

export type HumanDecision = 'approved' | 'rejected' | 'timeout'

export interface HumanGateAsk {
  /** Stable id so the same question can be correlated in logs / IPC. */
  id: string
  /** One-sentence prompt shown to the user. */
  question: string
  /** Optional short context (rationale, file path, command output). */
  context?: string
  /** Buttons / options shown. Defaults to ["Approve", "Reject"]. */
  options?: string[]
  /** Maximum time to wait for a response. Default 60s. */
  timeoutMs?: number
}

export interface HumanGate {
  ask(payload: HumanGateAsk): Promise<HumanDecision>
}

/**
 * Safe default gate that never blocks: returns 'rejected' immediately.
 * Useful in tests, CI, or when the runner is being driven programmatically.
 */
export const noHumanGate: HumanGate = {
  async ask() {
    return 'rejected'
  },
}

/**
 * Terminal gate using node:readline. Works in CLI context (no Electron).
 * Auto-rejects after `timeoutMs` if no input is received.
 */
export function createCliHumanGate(opts: { defaultTimeoutMs?: number } = {}): HumanGate {
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 60_000
  return {
    async ask(payload) {
      const timeoutMs = payload.timeoutMs ?? defaultTimeoutMs
      const prompt = buildPrompt(payload)

      // No TTY available → treat as timeout immediately so the loop
      // never hangs on a piped CI run.
      if (!input.isTTY || !output.isTTY) {
        appendMemory('Human gate', `[${payload.id}] no TTY — timeout`)
        return 'timeout'
      }

      const rl = createInterface({ input, output })
      try {
        const answer = await Promise.race<string>([
          new Promise(resolve => {
            rl.question(prompt, response => {
              resolve(response.trim().toLowerCase())
            })
          }),
          new Promise<string>(resolve => {
            const t = setTimeout(() => resolve('__timeout__'), timeoutMs)
            // best-effort cleanup; Node keeps the timer in a registry anyway.
            t.unref?.()
          }),
        ])

        if (answer === '__timeout__') {
          appendMemory('Human gate', `[${payload.id}] timeout after ${timeoutMs}ms`)
          return 'timeout'
        }
        if (matches(answer, payload.options, ['y', 'yes', 'approve', 'approved', 'a', 'oui', 'o'])) {
          return 'approved'
        }
        return 'rejected'
      } finally {
        rl.close()
      }
    },
  }
}

/**
 * IPC gate. Delegates to an injected `invoke` function that talks to the
 * Electron main process via the `opc:human-gate:ask` channel. The CLI
 * runner passes its own invoke; the renderer passes `window.opc.invoke`.
 *
 * The injected function MUST:
 *   - resolve with `'approved' | 'rejected' | 'timeout'`
 *   - never reject (errors should resolve to `'timeout'`)
 */
export function createIpcHumanGate(opts: {
  invoke: (channel: string, payload: unknown) => Promise<HumanDecision>
  channel?: string
  defaultTimeoutMs?: number
}): HumanGate {
  const channel = opts.channel ?? 'opc:human-gate:ask'
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 60_000

  return {
    async ask(payload) {
      const timeoutMs = payload.timeoutMs ?? defaultTimeoutMs
      try {
        const decision = await opts.invoke(channel, { ...payload, timeoutMs })
        if (decision === 'approved' || decision === 'rejected' || decision === 'timeout') {
          appendMemory('Human gate', `[${payload.id}] decision=${decision}`)
          return decision
        }
        appendMemory(
          'Human gate',
          `[${payload.id}] unknown decision "${String(decision)}" — treating as timeout`,
        )
        return 'timeout'
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        appendMemory('Human gate', `[${payload.id}] IPC error: ${message} — timeout`)
        return 'timeout'
      }
    },
  }
}

/**
 * In-memory gate useful for tests and for scripting an automated run
 * (e.g. simulating the user pressing "Approve" for the first 2 prompts
 * then "Reject" for the rest).
 */
export interface ScriptedHumanGateOptions {
  /** Pre-canned answers in order. When exhausted, falls back to `defaultDecision`. */
  answers?: HumanDecision[]
  /** Returned when `answers` is exhausted. Default: 'timeout'. */
  defaultDecision?: HumanDecision
}

export function createScriptedHumanGate(
  opts: ScriptedHumanGateOptions = {},
): HumanGate {
  const answers = [...(opts.answers ?? [])]
  const defaultDecision: HumanDecision = opts.defaultDecision ?? 'timeout'
  return {
    async ask() {
      const next = answers.shift()
      return next ?? defaultDecision
    },
  }
}

function buildPrompt(payload: HumanGateAsk): string {
  const opts = payload.options ?? ['Approve', 'Reject']
  const head = `\n[hgate:${payload.id}] ${payload.question}`
  const ctx = payload.context ? `\n  context: ${payload.context}` : ''
  const buttons = opts.map((o, i) => `${i + 1}=${o}`).join(' / ')
  return `${head}${ctx}\n  ${buttons} (or y/n, default=n): `
}

function matches(answer: string, options?: string[], aliases: string[] = []): boolean {
  const haystack = [answer, ...(options ?? []).map(o => o.toLowerCase())].join('|')
  return aliases.some(a => haystack.includes(a))
}
