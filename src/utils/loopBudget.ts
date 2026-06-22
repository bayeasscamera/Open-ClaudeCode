import { appendMemory } from './memory.js'

/**
 * Loop budget tracker.
 *
 * The spec calls budgets "the most important" guard rail alongside stop
 * conditions. A budget breach escalates the loop with a precise reason so
 * the caller can decide whether to retry, back off, or surface to the user.
 *
 * Five budget kinds are tracked simultaneously:
 *   - iterations  : hard cap on act/verify cycles (delegated to the runner)
 *   - tokens      : cumulative input + output (cache-aware)
 *   - costUsd     : cumulative spend, computed by the provider layer
 *   - wallTimeMs  : wall-clock elapsed since start
 *   - sterileHits : same (tool, args) key repeated N times → loop is stuck
 *
 * The tracker is intentionally side-effect free except for one
 * `appendMemory` call on breach so the cause lands in the long-term log.
 */

export interface LoopBudget {
  /** Hard cap on iterations. Mirrored by `LoopConfig.maxIterations` for clarity. */
  maxIterations?: number
  /** Cumulative input + output + cache tokens across all LLM calls. */
  maxTokens?: number
  /** Cumulative cost in USD across all LLM calls. */
  maxCostUsd?: number
  /** Wall-clock elapsed time in ms from `start()` to `check()`. */
  maxWallTimeMs?: number
  /**
   * Maximum repeats of the same `recordAction(key)` key. When exceeded, the
   * loop is considered sterile and is escalated. Default: 5.
   */
  maxSterileRepeats?: number
  /** Inject for deterministic tests. */
  now?: () => number
}

export interface UsageDelta {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Pre-computed by the provider layer (modelCost + cache pricing). */
  costUsd?: number
}

export interface BudgetSnapshot {
  iterations: number
  totalTokens: number
  totalCostUsd: number
  wallTimeMs: number
  /** Current repeat count per action key. Only keys with hit >= 1 are listed. */
  sterileHits: Readonly<Record<string, number>>
}

export type BudgetBreachKind =
  | 'iterations'
  | 'tokens'
  | 'cost'
  | 'wallTime'
  | 'sterile'

export interface BudgetBreach {
  kind: BudgetBreachKind
  reason: string
  snapshot: BudgetSnapshot
}

export const DEFAULT_STERILE_THRESHOLD = 5

/**
 * Mutable tracker. Cheap to construct — one per loop run.
 *
 * Usage:
 *   const tracker = new BudgetTracker({ maxTokens: 200_000, maxCostUsd: 5 })
 *   tracker.start()
 *   tracker.recordUsage({ inputTokens: 1000, costUsd: 0.003 })
 *   const breach = tracker.check()
 *   if (breach) return escalate(breach)
 */
export class BudgetTracker {
  readonly budget: Required<Pick<LoopBudget, 'maxSterileRepeats'>> & LoopBudget
  private readonly now: () => number
  private startedAt = 0
  private iters = 0
  private tokens = 0
  private cost = 0
  private readonly hits = new Map<string, number>()

  constructor(budget: LoopBudget = {}) {
    this.budget = {
      maxSterileRepeats: budget.maxSterileRepeats ?? DEFAULT_STERILE_THRESHOLD,
      ...budget,
    }
    this.now = budget.now ?? Date.now
  }

  /** Mark the loop start time. Idempotent — repeated calls keep the first start. */
  start(): void {
    if (this.startedAt === 0) this.startedAt = this.now()
  }

  /** Increment iteration counter (call once per act+verify cycle). */
  recordIteration(): void {
    this.iters += 1
  }

  /** Accumulate token usage + cost. Negative values are clamped to 0. */
  recordUsage(delta: UsageDelta): BudgetSnapshot {
    const add = (n: number | undefined): number =>
      Math.max(0, n ?? 0)
    this.tokens +=
      add(delta.inputTokens) +
      add(delta.outputTokens) +
      add(delta.cacheReadTokens) +
      add(delta.cacheWriteTokens)
    this.cost += add(delta.costUsd)
    return this.snapshot()
  }

  /**
   * Record an action (typically a tool call) under a stable key. The key
   * shape is up to the caller; the loop runner uses `${tool}:${hash(args)}`.
   * Returns the new hit count for that key.
   */
  recordAction(key: string): { hit: number } {
    const next = (this.hits.get(key) ?? 0) + 1
    this.hits.set(key, next)
    return { hit: next }
  }

  snapshot(): BudgetSnapshot {
    return {
      iterations: this.iters,
      totalTokens: this.tokens,
      totalCostUsd: round2(this.cost),
      wallTimeMs: this.startedAt === 0 ? 0 : this.now() - this.startedAt,
      sterileHits: Object.freeze({ ...Object.fromEntries(this.hits) }),
    }
  }

  /**
   * Evaluate every budget. Returns the FIRST breach (priority order:
   * iterations → tokens → cost → wallTime → sterile) or null. The
   * priority is fixed so callers can rely on a deterministic escalation
   * reason for a given snapshot.
   */
  check(): BudgetBreach | null {
    const snap = this.snapshot()
    const b = this.budget

    if (b.maxIterations !== undefined && snap.iterations >= b.maxIterations) {
      return breach('iterations', `Iterations ${snap.iterations} ≥ ${b.maxIterations}`, snap)
    }
    if (b.maxTokens !== undefined && snap.totalTokens >= b.maxTokens) {
      return breach('tokens', `Tokens ${snap.totalTokens} ≥ ${b.maxTokens}`, snap)
    }
    if (b.maxCostUsd !== undefined && snap.totalCostUsd >= b.maxCostUsd) {
      return breach('cost', `Cost $${snap.totalCostUsd.toFixed(2)} ≥ $${b.maxCostUsd}`, snap)
    }
    if (b.maxWallTimeMs !== undefined && snap.wallTimeMs >= b.maxWallTimeMs) {
      return breach(
        'wallTime',
        `Wall time ${snap.wallTimeMs}ms ≥ ${b.maxWallTimeMs}ms`,
        snap,
      )
    }
    if (b.maxSterileRepeats !== undefined) {
      for (const [key, hit] of this.hits) {
        if (hit >= b.maxSterileRepeats) {
          return breach(
            'sterile',
            `Action "${key}" repeated ${hit} times (≥ ${b.maxSterileRepeats})`,
            snap,
          )
        }
      }
    }
    return null
  }

  /** True iff any budget has been breached. */
  isExceeded(): boolean {
    return this.check() !== null
  }
}

function breach(
  kind: BudgetBreachKind,
  reason: string,
  snapshot: BudgetSnapshot,
): BudgetBreach {
  // Best-effort trace; never throws.
  try {
    appendMemory('Loop budget breach', `${kind}: ${reason}`)
  } catch {
    /* swallow — memory write must not crash the loop */
  }
  return { kind, reason, snapshot }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Build a stable action key for sterile-loop detection.
 * Normalizes whitespace and trims long values so trivial reformatting
 * (e.g. trailing newline) does not bypass detection.
 */
export function actionKey(tool: string, args: unknown): string {
  let repr: string
  try {
    repr = JSON.stringify(args, (_k, v) => (typeof v === 'string' ? v.trim() : v))
  } catch {
    repr = '[unserializable]'
  }
  return `${tool}::${repr}`
}
