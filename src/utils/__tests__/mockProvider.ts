/**
 * Deterministic mock provider for OPC loop tests.
 *
 * The mock implements the same `Reason` contract as `loopReasoner.ts` so
 * the loop can be driven through scripted decisions without any network or
 * LLM. Use `scriptedReasoner(script)` to build a function that consumes
 * a queue of decisions and falls back to `defaultDecision` when the queue
 * is exhausted.
 *
 * Why a dedicated provider:
 *   - tests must be deterministic (no flakiness from real LLMs)
 *   - tests must exercise the runner end-to-end, not just unit-level pieces
 *   - the script format mirrors what a model-driven reasoner would output
 *     so swapping in a real provider is a one-line change.
 */
import type { Reason, ReasonContext, ReasonDecision, ReasonDecisionKind } from '../loopReasoner.js'

export type ReasonScriptEntry =
  | ReasonDecisionKind
  | ReasonDecision

/**
 * Resolve an entry into a full ReasonDecision, filling confidence +
 * rationale from sensible defaults if the entry is a plain kind.
 */
function normalize(entry: ReasonScriptEntry, attempt: number): ReasonDecision {
  if (typeof entry === 'string') {
    switch (entry) {
      case 'continue':
        return { kind: 'continue', confidence: 0.9, rationale: 'mock: continue' }
      case 'retry':
        return {
          kind: 'retry',
          confidence: 0.5,
          rationale: `mock: retry attempt ${attempt}`,
        }
      case 'refine':
        return {
          kind: 'refine',
          confidence: 0.5,
          rationale: 'mock: refine',
          refinedTaskText: '',
        }
      case 'ask-human':
        return {
          kind: 'ask-human',
          confidence: 0.2,
          rationale: 'mock: ask-human',
        }
      case 'escalate':
        return {
          kind: 'escalate',
          confidence: 0.95,
          rationale: 'mock: escalate',
        }
    }
  }
  return entry
}

/**
 * Build a `Reason` from a script. The script is consumed in order on every
 * reasoner call; when exhausted, the `defaultDecision` (or a sane fallback)
 * is returned. Useful for exercising specific decision paths:
 *
 *   scriptedReasoner(['continue', 'retry', 'escalate'])
 */
export function scriptedReasoner(
  script: ReasonScriptEntry[],
  defaultDecision: ReasonDecision = { kind: 'continue', confidence: 0.9, rationale: 'mock default' },
): Reason {
  const queue = script.slice()
  return (ctx: ReasonContext): ReasonDecision => {
    const next = queue.shift()
    return next ? normalize(next, ctx.attempt) : defaultDecision
  }
}

/**
 * Reasoner that always escalates — useful for "what does the loop do on a
 * fatal reasoner call?" tests.
 */
export const alwaysEscalateReasoner: Reason = () => ({
  kind: 'escalate',
  confidence: 0.99,
  rationale: 'mock: always-escalate',
})

/**
 * Reasoner that asks the human on the first call, then continues — useful
 * for testing the human gate path without scripting.
 *
 * Exposed as a factory (NOT a singleton) so each test gets a fresh
 * `asked` flag. A shared singleton would leak the asked-once state across
 * tests, silently skipping the human-gate branch on the second caller.
 */
export function makeAskOnceReasoner(): Reason {
  let asked = false
  return () => {
    if (!asked) {
      asked = true
      return {
        kind: 'ask-human',
        confidence: 0.1,
        rationale: 'mock: ask-human once',
      }
    }
    return { kind: 'continue', confidence: 0.9, rationale: 'mock: continue' }
  }
}

/**
 * Back-compat alias. Tests that import the singleton form must call
 * `makeAskOnceReasoner()` instead to get a fresh reasoner per test —
 * sharing the module-level instance leaks the `asked` flag across tests.
 */
export const askOnceReasoner: Reason = makeAskOnceReasoner()

import type { VerificationReport } from '../verification.js'
import type { Act, ActResult } from '../loopRunner.js'
import type { TaskItem } from '../taskChecklist.js'

/**
 * Always-OK act — useful when the test only exercises the runner plumbing.
 *
 * Accepts (and ignores) the task argument so the helper is structurally
 * assignable to the `Act` signature: `(task: TaskItem) => Promise<ActResult>`.
 */
export const okAct: Act = async (_task: TaskItem): Promise<ActResult> => ({
  ok: true,
  reason: 'mock-ok',
})

/**
 * Build a deterministic-fail Act that always returns the given reason.
 * Curried so call sites read naturally: `act: failAct('TypeError: ...')`.
 */
export const failAct = (reason = 'mock-fail'): Act =>
  async (_task: TaskItem): Promise<ActResult> => ({
    ok: false,
    reason,
  })

/**
 * Build an Act that fails N times then succeeds.
 */
export function flakyAct(failures: number, failReason = 'mock-flaky'): Act {
  let count = 0
  return async (_task: TaskItem): Promise<ActResult> => {
    count += 1
    if (count <= failures) return { ok: false, reason: failReason }
    return { ok: true, reason: `mock-ok-after-${failures}` }
  }
}

/**
 * A passing VerificationReport with no results. Returns a Promise to match
 * the runner's `Verify` signature. The `startedAt` / `finishedAt` fields
 * are filled in so the report is structurally valid.
 */
export async function okVerify(): Promise<VerificationReport> {
  const now = new Date().toISOString()
  return {
    allPassed: true,
    results: [],
    totalDurationMs: 0,
    startedAt: now,
    finishedAt: now,
  }
}
