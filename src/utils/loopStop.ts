import { BudgetTracker, type BudgetBreach } from './loopBudget.js'

/**
 * Central stop-condition evaluator.
 *
 * Per the loop-engineering spec, every guard rail should be evaluated at
 * every iteration. This module is the single seam that decides whether the
 * loop continues or escalates, so the runner does not duplicate the logic.
 *
 * Stop reasons are tagged so the runner / UI can branch on them:
 *   - 'done'        : the loop completed its objective (no more work)
 *   - 'abort'       : user / system cancelled (AbortSignal fired)
 *   - 'budget'      : a BudgetBreach was raised by BudgetTracker
 *   - 'fatal'       : an unrecoverable tool / runtime error
 *   - 'continue'    : no stop condition triggered yet
 */

export type StopReason =
  | { kind: 'continue' }
  | { kind: 'done'; message?: string }
  | { kind: 'abort'; reason: string }
  | { kind: 'budget'; breach: BudgetBreach }
  | { kind: 'fatal'; error: string; cause?: unknown }

export interface StopInputs {
  budget?: BudgetTracker
  signal?: AbortSignal
  /** Pass true when there is nothing left to do (no tasks, all done). */
  workRemaining?: boolean
  /** Pass an Error / message when an unrecoverable failure occurred. */
  fatal?: { error: string; cause?: unknown }
}

export function evaluateStop(inputs: StopInputs): StopReason {
  // 1. User / system cancellation always wins.
  if (inputs.signal?.aborted) {
    const reason =
      inputs.signal.reason instanceof Error
        ? inputs.signal.reason.message
        : inputs.signal.reason
          ? String(inputs.signal.reason)
          : 'Aborted by signal'
    return { kind: 'abort', reason }
  }

  // 2. Fatal error from a critical tool / runtime layer.
  if (inputs.fatal) {
    return { kind: 'fatal', error: inputs.fatal.error, cause: inputs.fatal.cause }
  }

  // 3. Budget breach.
  if (inputs.budget) {
    const breach = inputs.budget.check()
    if (breach) return { kind: 'budget', breach }
  }

  // 4. No more work.
  if (inputs.workRemaining === false) {
    return { kind: 'done' }
  }

  return { kind: 'continue' }
}

/**
 * Predicate form for the hot path inside the runner's while loop.
 */
export function shouldStop(inputs: StopInputs): boolean {
  return evaluateStop(inputs).kind !== 'continue'
}
