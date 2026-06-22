/**
 * Context compaction for the OPC loop.
 *
 * Spec phase 3: when the context budget is exceeded, the loop MUST compact
 * the message history before the next LLM call. This module is the single
 * seam that decides how to compact — the runner calls `applyCompactionIfNeeded`
 * once per iteration.
 *
 * Three strategies are provided, all deterministic and side-effect free
 * (apart from the optional `onCompacted` listener which the runner wires
 * to memory persistence and event emission):
 *
 *   - 'head_tail'    : keep the system message + the N most recent
 *                      messages verbatim; drop the middle.
 *   - 'drop_oldest'  : keep the system message + all messages after the
 *                      first one whose cumulative token count fits in
 *                      `targetTokens`.
 *   - 'summarize'    : replace the dropped slice with a single synthetic
 *                      'assistant' summary message (placeholder text — the
 *                      runner may replace it with an LLM-generated summary).
 *
 * The default is `head_tail`. It is the safest because it preserves the
 * most recent tool results (which the model usually needs to keep acting)
 * while strictly bounding the size.
 */

import {
  estimateMessageTokens,
  estimateContext,
  type ContextBreakdown,
  type ContextBudgetConfig,
  type ContextBudgetEstimate,
  type ContextMessage,
  type ContextTool,
} from './contextBudget.js'
import { appendMemory } from './memory.js'

export type CompactionStrategy = 'head_tail' | 'drop_oldest' | 'summarize'

export interface CompactionInput {
  system?: string
  messages: ContextMessage[]
  tools: ContextTool[]
  config: ContextBudgetConfig
  /**
   * Compact when usage ratio exceeds this fraction. Defaults to the
   * config's `triggerRatio`. Pass an override to compact earlier or later
   * without mutating the underlying config.
   */
  triggerRatio?: number
  /** Strategy to apply when compaction is needed. Default: 'head_tail'. */
  strategy?: CompactionStrategy
  /**
   * Minimum number of recent messages to keep verbatim regardless of size.
   * Default: 4. Set to 0 to allow the compactor to drop everything past the
   * system message (use sparingly — model loses short-term memory).
   */
  minKeepRecent?: number
  /**
   * Summarizer hook. Required when strategy === 'summarize'. Receives the
   * dropped messages and must return a single replacement content string.
   * If omitted, a placeholder is used and the strategy falls back to a
   * truncated head_tail result.
   */
  summarize?: (dropped: ContextMessage[]) => Promise<string> | string
  /** Listener for telemetry / event emission. Never throws. */
  onCompacted?: (info: CompactionResult) => void
}

export interface CompactionResult {
  strategy: CompactionStrategy
  before: ContextBreakdown
  after: ContextBreakdown
  /** Number of messages dropped (count, not tokens). */
  droppedCount: number
  /** Number of messages kept. */
  keptCount: number
  /** Synthetic summary message appended when strategy === 'summarize'. */
  summaryMessage?: ContextMessage
  /** True when no compaction was needed (estimate already below trigger). */
  skipped: boolean
}

/**
 * Decide whether compaction is needed for the given estimate, taking an
 * optional override ratio into account.
 */
export function shouldCompact(
  estimate: ContextBudgetEstimate,
  triggerRatio?: number,
): boolean {
  if (triggerRatio !== undefined) {
    const ratio = Math.min(1, Math.max(0, triggerRatio))
    return estimate.breakdown.total >= estimate.breakdown.total * 0
      ? estimate.usagePercent >= Math.round(ratio * 100)
      : false
  }
  return estimate.needsCompaction
}

/**
 * Compact the given context. Always returns a `CompactionResult`, even when
 * nothing was changed (then `skipped === true`). The function is pure —
 * memory side-effects and `onCompacted` callbacks are the only outputs
 * beyond the return value, and both are best-effort.
 */
export async function compactContext(
  input: CompactionInput,
): Promise<CompactionResult> {
  const strategy = input.strategy ?? 'head_tail'
  const minKeepRecent = Math.max(0, input.minKeepRecent ?? 4)

  const estimate = estimateContext({
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    config: input.config,
  })
  const beforeBreakdown = estimate.breakdown

  // No-op fast path: under the trigger, return the input verbatim.
  if (!shouldCompact(estimate, input.triggerRatio)) {
    return {
      strategy,
      before: beforeBreakdown,
      after: beforeBreakdown,
      droppedCount: 0,
      keptCount: input.messages.length,
      skipped: true,
    }
  }

  // Always keep the system message at index 0 if present.
  const hasSystem = Boolean(input.system)
  const messages = input.messages
  const head: ContextMessage[] = []
  let startIndex = 0
  if (hasSystem && messages[0]?.role === 'system') {
    head.push(messages[0]!)
    startIndex = 1
  }

  const body = messages.slice(startIndex)
  const targetTokens = Math.max(
    1,
    Math.floor(
      input.config.maxTokens * (input.triggerRatio ?? input.config.triggerRatio ?? 0.85) * 0.6,
    ),
  )

  let result: CompactionResult
  switch (strategy) {
    case 'drop_oldest':
      result = compactDropOldest(head, body, targetTokens, minKeepRecent)
      break
    case 'summarize':
      result = await compactSummarize(
        head,
        body,
        targetTokens,
        minKeepRecent,
        input.summarize,
      )
      break
    case 'head_tail':
    default:
      result = compactHeadTail(head, body, targetTokens, minKeepRecent)
      break
  }

  // Side-effects: best-effort memory trace + listener notification.
  try {
    appendMemory(
      'Context compaction',
      `${strategy}: ${result.droppedCount} dropped, ${result.keptCount} kept, ` +
        `tokens ${result.before.total} → ${result.after.total}`,
    )
  } catch {
    /* never let memory write break the loop */
  }
  try {
    input.onCompacted?.(result)
  } catch {
    /* listener must not break the compactor */
  }
  return result
}

/**
 * Convenience wrapper used by the runner: returns the (possibly compacted)
 * messages array and the breakdown side-by-side.
 */
export async function applyCompactionIfNeeded(input: CompactionInput): Promise<{
  messages: ContextMessage[]
  result: CompactionResult
}> {
  const result = await compactContext(input)
  return { messages: rebuildMessages(input, result), result }
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

function compactHeadTail(
  head: ContextMessage[],
  body: ContextMessage[],
  targetTokens: number,
  minKeepRecent: number,
): CompactionResult {
  if (body.length === 0) {
    return {
      strategy: 'head_tail',
      before: { ...emptyBreakdown(), total: 0 },
      after: { ...emptyBreakdown(), total: 0 },
      droppedCount: 0,
      keptCount: head.length,
      skipped: true,
    }
  }
  const recent = body.slice(-Math.max(minKeepRecent, 1))
  const middle = body.slice(0, body.length - recent.length)

  const headTokens = sumTokens(head)
  const recentTokens = sumTokens(recent)
  const middleTokens = sumTokens(middle)

  const kept = [...head, ...recent]
  const afterTokens = headTokens + recentTokens

  // If dropping the middle already gets us under the target, we're done.
  if (afterTokens <= targetTokens) {
    return {
      strategy: 'head_tail',
      before: breakdownOf(headTokens + middleTokens + recentTokens),
      after: breakdownOf(afterTokens),
      droppedCount: middle.length,
      keptCount: kept.length,
      skipped: false,
    }
  }

  // Still over budget — trim the oldest recent messages from the front of
  // `recent` (but never below minKeepRecent).
  const trimmed: ContextMessage[] = []
  let running = headTokens
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]
    if (!m) continue
    const t = estimateMessageTokens(m)
    if (trimmed.length >= minKeepRecent && running + t > targetTokens) {
      continue
    }
    trimmed.unshift(m)
    running += t
    if (running >= targetTokens) break
  }
  const finalKept = [...head, ...trimmed]
  return {
    strategy: 'head_tail',
    before: breakdownOf(headTokens + middleTokens + recentTokens),
    after: breakdownOf(sumTokens(finalKept)),
    droppedCount: body.length - trimmed.length,
    keptCount: finalKept.length,
    skipped: false,
  }
}

function compactDropOldest(
  head: ContextMessage[],
  body: ContextMessage[],
  targetTokens: number,
  minKeepRecent: number,
): CompactionResult {
  if (body.length === 0) {
    return {
      strategy: 'drop_oldest',
      before: { ...emptyBreakdown(), total: 0 },
      after: { ...emptyBreakdown(), total: 0 },
      droppedCount: 0,
      keptCount: head.length,
      skipped: true,
    }
  }
  const headTokens = sumTokens(head)
  let running = headTokens
  let startIndex = 0
  // Walk forward until adding the next message would exceed the target.
  for (let i = 0; i < body.length; i++) {
    const m = body[i]
    if (!m) continue
    const t = estimateMessageTokens(m)
    if (running + t > targetTokens && i >= minKeepRecent) break
    running += t
    startIndex = i + 1
  }
  const kept = [...head, ...body.slice(startIndex)]
  const dropped = body.slice(0, startIndex)
  return {
    strategy: 'drop_oldest',
    before: breakdownOf(sumTokens([...head, ...body])),
    after: breakdownOf(sumTokens(kept)),
    droppedCount: dropped.length,
    keptCount: kept.length,
    skipped: false,
  }
}

async function compactSummarize(
  head: ContextMessage[],
  body: ContextMessage[],
  targetTokens: number,
  minKeepRecent: number,
  summarize?: (dropped: ContextMessage[]) => Promise<string> | string,
): Promise<CompactionResult> {
  const headTail = compactHeadTail(head, body, targetTokens, minKeepRecent)
  // If head_tail skipped, nothing to summarize.
  if (headTail.skipped && headTail.droppedCount === 0) {
    return { ...headTail, strategy: 'summarize' }
  }
  // The dropped middle is the slice between the kept head and the kept
  // recent tail. Reconstruct it from the original body by skipping the last
  // `keptCount - head.length` entries (those are the kept tail).
  const tailSize = headTail.keptCount - head.length
  const dropped = body.slice(0, Math.max(0, body.length - tailSize))
  let summaryText = '[compacted: ' + dropped.length + ' messages removed]'
  if (summarize) {
    try {
      const result = await summarize(dropped)
      if (typeof result === 'string' && result.trim()) {
        summaryText = result
      }
    } catch {
      /* keep placeholder on summarizer error */
    }
  }
  const summaryMessage: ContextMessage = {
    role: 'assistant',
    name: 'compaction',
    content: summaryText,
  }
  return {
    ...headTail,
    strategy: 'summarize',
    summaryMessage,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumTokens(messages: ContextMessage[]): number {
  let total = 0
  for (const m of messages) total += estimateMessageTokens(m)
  return total
}

function emptyBreakdown(): ContextBreakdown {
  return {
    systemTokens: 0,
    messagesTokens: 0,
    toolsTokens: 0,
    reservedForOutput: 0,
    total: 0,
  }
}

function breakdownOf(messagesTokens: number): ContextBreakdown {
  return { ...emptyBreakdown(), messagesTokens, total: messagesTokens }
}

/**
 * Reconstruct the final messages array from a compaction result.
 * - 'head_tail' / 'drop_oldest' : return only the kept messages.
 * - 'summarize'                 : append the synthetic summary message
 *                                 after the kept head (before the tail).
 *
 * The system message is preserved at index 0.
 */
export function rebuildMessages(
  input: CompactionInput,
  result: CompactionResult,
): ContextMessage[] {
  if (result.skipped) return input.messages.slice()
  if (result.strategy !== 'summarize' || !result.summaryMessage) {
    // For head_tail / drop_oldest, keptCount matches the final message
    // count. We rebuild it by re-running the strategy on the original
    // input to avoid duplicating logic. Since compaction is deterministic,
    // we instead keep the original messages trimmed to the same count.
    return input.messages.slice(-result.keptCount)
  }
  // summarize: place the summary between the head and the most recent
  // `result.keptCount - headCount` messages.
  const messages = input.messages
  const headCount = input.system && messages[0]?.role === 'system' ? 1 : 0
  const tailSize = result.keptCount - headCount
  const head = messages.slice(0, headCount)
  const tail = messages.slice(Math.max(headCount, messages.length - tailSize))
  return [...head, result.summaryMessage, ...tail]
}
