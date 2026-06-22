/**
 * Tests for the JSON Lines serializer used by the Electron bridge.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toJsonLine,
  toJsonLineOrThrow,
  parseJsonLine,
  parseJsonLines,
  attachJsonlSink,
} from '../loopEventJsonl.js'
import { LoopEventEmitter } from '../loopEvents.js'

test('toJsonLine produces a trailing-newline JSON string', () => {
  const result = toJsonLine({ type: 'loop_started', seq: 1, ts: '2026-01-01T00:00:00Z', config: {} })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.match(result.line, /\n$/)
    const parsed = JSON.parse(result.line)
    assert.equal(parsed.type, 'loop_started')
  }
})

test('toJsonLine rejects unknown event types', () => {
  const result = toJsonLine({ type: 'foo' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /unknown event type/)
})

test('toJsonLine rejects non-objects', () => {
  assert.equal(toJsonLine(null).ok, false)
  assert.equal(toJsonLine('string').ok, false)
  assert.equal(toJsonLine(42).ok, false)
})

test('toJsonLine rejects unserializable payloads', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const result = toJsonLine({ type: 'loop_started', config: circular })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /JSON\.stringify failed/)
})

test('toJsonLineOrThrow returns the line or throws', () => {
  assert.throws(() => toJsonLineOrThrow({ type: 'unknown' } as never), /unknown event type/)
  const line = toJsonLineOrThrow({
    type: 'iteration_completed',
    seq: 2,
    ts: '2026-01-01T00:00:00Z',
    iteration: 1,
    durationMs: 100,
  })
  assert.match(line, /iteration_completed/)
})

test('parseJsonLine round-trips a valid event', () => {
  const original = {
    type: 'human_decided',
    seq: 7,
    ts: '2026-06-22T17:00:00Z',
    decision: 'approved',
  } as const
  const result = toJsonLine(original)
  assert.equal(result.ok, true)
  if (result.ok) {
    const parsed = parseJsonLine(result.line)
    assert.deepEqual(parsed, original)
  }
})

test('parseJsonLine returns null on garbage input', () => {
  assert.equal(parseJsonLine(''), null)
  assert.equal(parseJsonLine('not json'), null)
  assert.equal(parseJsonLine('{"type": "unknown"}'), null)
  assert.equal(parseJsonLine('{"seq": 1, "ts": "x"}'), null)
})

test('parseJsonLines handles multi-line streams', () => {
  const stream = [
    '{"type":"loop_started","seq":1,"ts":"x","config":{}}',
    '',
    'garbage',
    '{"type":"assistant_text_delta","seq":2,"ts":"x","delta":"hi"}',
  ].join('\n')
  const { events, errors } = parseJsonLines(stream)
  assert.equal(events.length, 2)
  // Empty lines are skipped silently; only the malformed JSON counts as an
  // error. This matches the principle of "blank lines are not data".
  assert.equal(errors, 1)
})

test('attachJsonlSink forwards every emitted event', () => {
  const emitter = new LoopEventEmitter()
  const lines: string[] = []
  attachJsonlSink(emitter, line => lines.push(line))
  emitter.emit({ type: 'loop_started', config: {} })
  emitter.emit({ type: 'assistant_text_delta', delta: 'hi' })
  assert.equal(lines.length, 2)
  assert.match(lines[0]!, /"type":"loop_started"/)
})

test('attachJsonlSink swallows sink errors', () => {
  const emitter = new LoopEventEmitter()
  const reached: string[] = []
  attachJsonlSink(emitter, () => {
    throw new Error('disk full')
  })
  emitter.on(() => reached.push('b'))
  emitter.emit({ type: 'loop_started', config: {} })
  assert.deepEqual(reached, ['b'])
})

test('attachJsonlSink unsubscribe detaches the listener', () => {
  const emitter = new LoopEventEmitter()
  const lines: string[] = []
  const off = attachJsonlSink(emitter, line => lines.push(line))
  emitter.emit({ type: 'loop_started', config: {} })
  off()
  emitter.emit({ type: 'loop_started', config: {} })
  assert.equal(lines.length, 1)
})
