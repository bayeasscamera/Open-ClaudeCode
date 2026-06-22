import { appendMemory } from './memory.js'
import type { ActResult } from './loopRunner.js'
import type { VerificationReport } from './verification.js'
import type { TaskItem } from './taskChecklist.js'

/**
 * ReAct-style "reason" layer for the OPC loop.
 *
 * The runner calls a `Reason` callback after each act (and after each verify)
 * to decide what to do next. A model-driven reasoner (LLM ReAct) plugs in
 * here; a heuristic reasoner is provided as the default.
 *
 * Why a separate layer:
 *   - The act layer is "what I did".
 *   - The verify layer is "what the world says happened".
 *   - The reason layer is "given both, what should I do next?".
 *
 * It is the only place where retry-vs-refine-vs-escalate is decided — which
 * makes it the natural seam for plugging an LLM without rewriting the runner.
 */

export interface ReasonContext {
  task: TaskItem
  attempt: number
  /** Outcome of the most recent act call. */
  actResult: ActResult
  /** Verification report from the most recent verify call (if any). */
  verifyReport?: VerificationReport
  /** Last few steps for short-term context (cap applied by the caller). */
  recentSteps: ReadonlyArray<{
    action: string
    attempt: number
    message?: string
  }>
}

export type ReasonDecisionKind =
  | 'continue'
  | 'retry'
  | 'refine'
  | 'ask-human'
  | 'escalate'

export interface ReasonDecision {
  kind: ReasonDecisionKind
  /** 0..1 — higher means the reasoner is confident in its decision. */
  confidence: number
  /**
   * Free-form rationale, persisted to memory. Used both for traceability and
   * as a strong signal for any downstream model-driven reasoner.
   */
  rationale: string
  /**
   * Optional refined task text. Only honored when kind === 'refine' — the
   * runner rewrites the task text in memory and retries.
   */
  refinedTaskText?: string
}

export type Reason = (ctx: ReasonContext) => Promise<ReasonDecision> | ReasonDecision

/**
 * Threshold below which we ask the human before retrying or escalating.
 * Anything ≥ this value is treated as a confident decision by the default
 * heuristic reasoner. Model-driven reasoners are free to ignore it.
 */
export const DEFAULT_ASK_HUMAN_THRESHOLD = 0.4

/**
 * Maximum retries below which the reasoner will not even consider
 * escalating (it prefers continue/retry/refine first).
 */
export const DEFAULT_REFINABLE_ATTEMPTS = 2

/**
 * Default heuristic reasoner.
 *
 * Signals and weights (kept intentionally simple so a model can override):
 *   - act-ok + verify-ok       → continue, confidence 0.95
 *   - act-ok + verify-fail     → refine (≤2 attempts) / ask-human (low conf)
 *   - act-fail (transient)     → retry, confidence based on attempt count
 *   - act-fail (deterministic) → escalate
 *   - verify ok but message looks suspicious → ask-human
 */
export function defaultReason(ctx: ReasonContext): ReasonDecision {
  const { actResult, verifyReport, attempt, recentSteps } = ctx

  // 1. Act failed.
  if (!actResult.ok) {
    const reason = actResult.reason ?? 'unknown'
    const transient = isTransientFailure(reason)
    if (!transient) {
      return {
        kind: 'escalate',
        confidence: 0.9,
        rationale: `Deterministic act failure (attempt ${attempt}): ${reason}`,
      }
    }
    const confidence = Math.max(0.2, 0.7 - attempt * 0.15)
    if (confidence < DEFAULT_ASK_HUMAN_THRESHOLD) {
      return {
        kind: 'ask-human',
        confidence,
        rationale: `Transient act failure kept recurring (attempt ${attempt}); need human input.`,
      }
    }
    return {
      kind: 'retry',
      confidence,
      rationale: `Transient act failure (attempt ${attempt}): ${reason}`,
    }
  }

  // 2. Act succeeded, verify ran.
  if (verifyReport) {
    if (verifyReport.allPassed) {
      return {
        kind: 'continue',
        confidence: 0.95,
        rationale: `Verify passed in ${verifyReport.totalDurationMs}ms.`,
      }
    }
    // Verify failed.
    const fails = verifyReport.results.filter(r => !r.passed)
    const detail = fails
      .map(r => r.detail ?? r.error ?? r.criterion.type)
      .join('; ')
    const confidence = Math.max(0.2, 0.6 - attempt * 0.15)

    if (attempt <= DEFAULT_REFINABLE_ATTEMPTS) {
      return {
        kind: 'refine',
        confidence,
        rationale: `Verify failed on attempt ${attempt}: ${detail}. Will refine task description and retry.`,
        refinedTaskText: ctx.task.text,
      }
    }
    if (confidence < DEFAULT_ASK_HUMAN_THRESHOLD) {
      return {
        kind: 'ask-human',
        confidence,
        rationale: `Verify kept failing (attempt ${attempt}): ${detail}. Asking for guidance.`,
      }
    }
    return {
      kind: 'retry',
      confidence,
      rationale: `Verify failed (attempt ${attempt}): ${detail}`,
    }
  }

  // 3. Act ok but verify skipped — sanity-check via recent steps.
  const lastReasoningFail = recentSteps.some(
    s => s.action === 'verify-fail' && s.attempt === attempt,
  )
  if (lastReasoningFail) {
    return {
      kind: 'ask-human',
      confidence: 0.3,
      rationale: 'Act succeeded but a recent verify failed; please confirm intent.',
    }
  }

  return {
    kind: 'continue',
    confidence: 0.8,
    rationale: 'Act ok, verify skipped — proceeding.',
  }
}

/**
 * Heuristic: classify an act failure as transient (worth retrying) vs.
 * deterministic (likely to fail again unchanged). The keywords are tuned for
 * common node/npm/git failure modes; callers may supply a custom classifier
 * via `createReasoner({ isTransient })`.
 */
const TRANSIENT_PATTERNS = [
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /temporar(y|y unavailable)/i,
  /network/i,
  /timeout/i,
  /rate[- ]limit/i,
  /\b5\d\d\b/, // 5xx HTTP
  /try again/i,
]

const DETERMINISTIC_PATTERNS = [
  /ENOENT/i,
  /EACCES/i,
  /EPERM/i,
  /syntax error/i,
  /unexpected token/i,
  /cannot find module/i,
  /TypeError/i,
  /ReferenceError/i,
  /SyntaxError/i,
  /does not exist/i,
]

export function isTransientFailure(reason: string): boolean {
  if (DETERMINISTIC_PATTERNS.some(p => p.test(reason))) return false
  if (TRANSIENT_PATTERNS.some(p => p.test(reason))) return true
  // Unknown — treat as transient (worth a retry).
  return true
}

export interface CreateReasonerOptions {
  /** Override the transient classifier. */
  isTransient?: (reason: string) => boolean
  /** Override the underlying reason function (typically wraps an LLM). */
  reason?: Reason
  /** Below this confidence, ask the human before continuing. */
  askHumanThreshold?: number
}

/**
 * Wrap a model-driven `reason` so it benefits from the same heuristic
 * fallback as `defaultReason`. The wrapper:
 *   1. Calls the model-driven reasoner first.
 *   2. If it returns ask-human but confidence is high enough, returns the
 *      model's answer anyway (no needless interruption).
 *   3. If the model errors or returns invalid shape, falls back to
 *      `defaultReason` so the loop never hangs.
 */
export function createReasoner(opts: CreateReasonerOptions = {}): Reason {
  const inner = opts.reason
  const askHumanThreshold = opts.askHumanThreshold ?? DEFAULT_ASK_HUMAN_THRESHOLD
  const isTransient = opts.isTransient ?? isTransientFailure

  return async (ctx): Promise<ReasonDecision> => {
    // Heuristic-only path (no model): pure classification.
    if (!inner) {
      return defaultReason(ctx)
    }

    let modelDecision: ReasonDecision
    try {
      const out = await inner(ctx)
      if (!isValidDecision(out)) {
        throw new Error('Model reasoner returned invalid decision')
      }
      modelDecision = out
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      appendMemory('Loop reasoner', `Model reasoner error: ${message} — falling back`)
      return defaultReason(ctx)
    }

    // ask-human with high confidence is contradictory; trust the model only
    // when its confidence is below the threshold.
    if (
      modelDecision.kind === 'ask-human' &&
      modelDecision.confidence >= askHumanThreshold
    ) {
      return {
        ...modelDecision,
        kind: 'continue',
        rationale: `${modelDecision.rationale} (auto-continued: confidence ≥ threshold)`,
      }
    }

    return modelDecision
  }
}

function isValidDecision(d: unknown): d is ReasonDecision {
  if (!d || typeof d !== 'object') return false
  const o = d as Record<string, unknown>
  const validKinds: ReasonDecisionKind[] = [
    'continue',
    'retry',
    'refine',
    'ask-human',
    'escalate',
  ]
  if (!validKinds.includes(o.kind as ReasonDecisionKind)) return false
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence)) return false
  if (typeof o.rationale !== 'string') return false
  if (
    o.refinedTaskText !== undefined &&
    typeof o.refinedTaskText !== 'string'
  ) {
    return false
  }
  return true
}
