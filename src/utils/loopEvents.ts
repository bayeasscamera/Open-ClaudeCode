/**
 * Typed event stream for the OPC loop.
 *
 * The loop-engineering spec mandates an `AsyncIterable<LoopEvent>` rather
 * than a single final result — this is what makes the loop *streamable* to
 * a UI (text deltas, tool cards, stop button) and *interruptible* (the
 * consumer just stops pulling from the iterable).
 *
 * Existing code uses an `onStep(step: LoopStep)` callback. This module
 * adds the higher-level event vocabulary required by the spec without
 * disturbing the existing runner — consumers that want fine-grained events
 * can wire `LoopEventEmitter` alongside `onStep` (see `attachEmitter`).
 */

import type { LoopStep, LoopStepAction } from './loopRunner.js'
import type { BudgetBreach } from './loopBudget.js'
import type { StopReason } from './loopStop.js'

export interface LoopEventBase {
  /** Monotonically increasing id within a run. */
  seq: number
  /** Event timestamp (ISO 8601). */
  ts: string
}

export type LoopEvent =
  | (LoopEventBase & {
      type: 'loop_started'
      config: { maxIterations?: number }
    })
  | (LoopEventBase & {
      type: 'assistant_text_delta'
      delta: string
    })
  | (LoopEventBase & {
      type: 'tool_call_started'
      tool: string
      args: unknown
    })
  | (LoopEventBase & {
      type: 'tool_call_result'
      tool: string
      result: { ok: boolean; detail?: string; durationMs: number }
    })
  | (LoopEventBase & {
      type: 'iteration_completed'
      iteration: number
      durationMs: number
    })
  | (LoopEventBase & {
      type: 'awaiting_user'
      question: string
      timeoutMs?: number
    })
  | (LoopEventBase & {
      type: 'human_decided'
      decision: 'approved' | 'rejected' | 'timeout'
    })
  | (LoopEventBase & {
      type: 'budget_breached'
      breach: BudgetBreach
    })
  | (LoopEventBase & {
      type: 'loop_finished'
      stop: StopReason
      iterations: number
    })
  | (LoopEventBase & {
      type: 'loop_error'
      message: string
      cause?: unknown
    })

/**
 * Structural payload accepted by `LoopEventEmitter.emit`. Callers pass an
 * object literal with a known `type` discriminator and the variant-specific
 * fields. The emitter validates the type at runtime and rejects unknown
 * variants with a TypeError so a typo in a producer does not silently
 * propagate through the event bus.
 */
export interface LoopEventPayload {
  type: LoopEvent['type']
  [k: string]: unknown
}

/**
 * The set of event types accepted by the spec-level event vocabulary.
 * Exported so serializers (JSONL, SSE, …) can validate without importing
 * the full LoopEvent union, which keeps the dependency graph narrow.
 */
export const KNOWN_LOOP_EVENT_TYPES: ReadonlySet<LoopEvent['type']> = new Set<LoopEvent['type']>([
  'loop_started',
  'assistant_text_delta',
  'tool_call_started',
  'tool_call_result',
  'iteration_completed',
  'awaiting_user',
  'human_decided',
  'budget_breached',
  'loop_finished',
  'loop_error',
])

/**
 * Cheap emitter with synchronous fan-out. Backed by a list of listeners so
 * a future SSE / WebSocket sink can register without rewriting the runner.
 */
export class LoopEventEmitter {
  private listeners: Array<(e: LoopEvent) => void> = []
  private counter = 0

  on(listener: (e: LoopEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  emit(event: LoopEventPayload): LoopEvent {
    if (!KNOWN_LOOP_EVENT_TYPES.has(event.type)) {
      throw new TypeError(`Unknown LoopEvent type: ${String(event.type)}`)
    }
    this.counter += 1
    const full = { ...event, seq: this.counter, ts: new Date().toISOString() } as LoopEvent
    for (const l of this.listeners) {
      try {
        l(full)
      } catch {
        /* listeners must never break the loop */
      }
    }
    return full
  }

  listenerCount(): number {
    return this.listeners.length
  }
}

/**
 * Convert an emitter into an AsyncIterable. The iterable ends when
 * `loop_finished` or `loop_error` is emitted. Consumers can therefore
 * `break` the loop or stop pulling to cancel.
 */
export async function* toAsyncIterable(
  emitter: LoopEventEmitter,
): AsyncGenerator<LoopEvent, void, void> {
  const queue: LoopEvent[] = []
  let resolveNext: ((v: LoopEvent | null) => void) | null = null

  const unsubscribe = emitter.on(e => {
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r(e)
      return
    }
    queue.push(e)
  })

  try {
    while (true) {
      if (queue.length > 0) {
        const next = queue.shift() as LoopEvent
        yield next
        if (next.type === 'loop_finished' || next.type === 'loop_error') return
        continue
      }
      const value = await new Promise<LoopEvent | null>(resolve => {
        resolveNext = resolve
      })
      if (value === null) return
      yield value
      if (value.type === 'loop_finished' || value.type === 'loop_error') return
    }
  } finally {
    unsubscribe()
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r(null)
    }
  }
}

/**
 * Map a LoopStep from the existing runner to one or more spec-level events.
 * Returns null when the step is purely a runner-internal transition that
 * the spec event vocabulary does not surface (e.g. the `start` marker).
 */
export function stepToEvents(step: LoopStep): LoopEvent['type'][] {
  const map: Partial<Record<LoopStepAction, LoopEvent['type']>> = {
    'act-ok': 'tool_call_result',
    'act-fail': 'tool_call_result',
    'verify-ok': 'iteration_completed',
    'verify-fail': 'iteration_completed',
    'retry': 'iteration_completed',
    'escalate': 'iteration_completed',
    'done': 'loop_finished',
    'human-approved': 'human_decided',
    'human-rejected': 'human_decided',
    'human-timeout': 'human_decided',
  }
  const t = map[step.action]
  return t ? [t] : []
}
