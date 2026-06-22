/**
 * JSON Lines serialization for the OPC loop event stream.
 *
 * Spec phase 5: the loop emits a stream of `LoopEvent` objects. To make
 * that stream consumable by a child process (the OPC CLI runner spawning
 * a sub-process that talks JSON Lines over stdout), by an HTTP SSE sink,
 * or by the Electron main process piping events to the renderer, we
 * need a deterministic, line-oriented encoding.
 *
 * Format:
 *   - one JSON object per line
 *   - line terminator: `\n`
 *   - inner newlines in string values are escaped by JSON.stringify
 *   - unknown event types are rejected at serialize time (fail loud)
 *
 * This module is pure: no I/O, no Node-specific API beyond JSON. It can
 * be reused in the browser and in tests.
 */

import {
  KNOWN_LOOP_EVENT_TYPES,
  type LoopEvent,
} from './loopEvents.js'

export interface SerializedLoopEvent {
  /** Always true — distinguishes from malformed / unknown payloads. */
  ok: true
  /** The event object with `seq` and `ts` already filled in by the emitter. */
  event: LoopEvent
  /** The JSONL line (already terminated by `\n`). */
  line: string
}

export interface SerializationError {
  ok: false
  reason: string
}

export type SerializationResult = SerializedLoopEvent | SerializationError

/**
 * Serialize a single event to a JSONL line (with trailing newline).
 * Returns `{ ok: false, reason }` for unknown types or circular payloads.
 */
export function toJsonLine(event: unknown): SerializationResult {
  if (!event || typeof event !== 'object') {
    return { ok: false, reason: 'event is not an object' }
  }
  const type = (event as { type?: unknown }).type
  if (typeof type !== 'string' || !KNOWN_LOOP_EVENT_TYPES.has(type as LoopEvent['type'])) {
    return { ok: false, reason: `unknown event type: ${String(type)}` }
  }
  let line: string
  try {
    line = JSON.stringify(event)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `JSON.stringify failed: ${message}` }
  }
  return { ok: true, event: event as LoopEvent, line: line + '\n' }
}

/**
 * Convenience: returns just the line string, or throws on error.
 * Useful in hot paths where the caller has already validated the event.
 */
export function toJsonLineOrThrow(event: LoopEvent): string {
  const result = toJsonLine(event)
  if (result.ok === false) {
    throw new Error(result.reason)
  }
  return result.line
}

/**
 * Parse a single JSONL line back into a `LoopEvent`. Returns `null` on
 * malformed input or unknown event types — callers should treat null as
 * "skip this line" rather than throwing, so a corrupted stream cannot
 * tear down the whole consumer.
 */
export function parseJsonLine(line: string): LoopEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const type = (parsed as { type?: unknown }).type
  if (typeof type !== 'string' || !KNOWN_LOOP_EVENT_TYPES.has(type as LoopEvent['type'])) {
    return null
  }
  return parsed as LoopEvent
}

/**
 * Parse a multi-line JSONL stream (e.g. the entire stdout of a child
 * process). Empty lines are skipped; malformed lines produce null entries
 * in the result so the caller can count them.
 */
export function parseJsonLines(stream: string): {
  events: LoopEvent[]
  errors: number
} {
  const events: LoopEvent[] = []
  let errors = 0
  for (const raw of stream.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const ev = parseJsonLine(raw)
    if (ev) events.push(ev)
    else errors += 1
  }
  return { events, errors }
}

/**
 * Wrap a `LoopEventEmitter` so every emitted event is forwarded to a
 * user-supplied write function as a JSONL line. Returns an unsubscribe
 * function. Listener exceptions are swallowed — the emitter already does
 * that internally, and this wrapper adds nothing that could break the
 * loop.
 */
export function attachJsonlSink(
  emitter: { on: (l: (e: LoopEvent) => void) => () => void },
  writeLine: (line: string) => void,
): () => void {
  return emitter.on(event => {
    const result = toJsonLine(event)
    if (!result.ok) return
    try {
      writeLine(result.line)
    } catch {
      /* sink errors must never break the loop */
    }
  })
}
