/**
 * Tests for the LoopEvent emitter — listener fan-out, type validation,
 * the AsyncIterable bridge, and the step→event mapper.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LoopEventEmitter, toAsyncIterable, stepToEvents } from '../loopEvents.js'
import type { LoopStep } from '../loopRunner.js'

function step(action: LoopStep['action'], message?: string): LoopStep {
  return {
    iteration: 1,
    taskIndex: 0,
    taskText: 'sample',
    action,
    attempt: 1,
    durationMs: 0,
    message,
  }
}

test('emit stamps seq + ts and broadcasts to every listener', () => {
  const emitter = new LoopEventEmitter()
  const received: unknown[] = []
  emitter.on(e => received.push(e))
  emitter.emit({ type: 'loop_started', config: {} })
  emitter.emit({ type: 'assistant_text_delta', delta: 'hi' })
  assert.equal(received.length, 2)
  const first = received[0] as { seq: number; ts: string; type: string }
  assert.equal(first.type, 'loop_started')
  assert.equal(first.seq, 1)
  assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal((received[1] as { seq: number }).seq, 2)
})

test('emit rejects unknown event types', () => {
  const emitter = new LoopEventEmitter()
  assert.throws(
    () => emitter.emit({ type: 'unknown' as never }),
    /Unknown LoopEvent type/,
  )
})

test('listener exceptions do not break other listeners or the emitter', () => {
  const emitter = new LoopEventEmitter()
  const reached: string[] = []
  emitter.on(() => {
    throw new Error('boom')
  })
  emitter.on(() => {
    reached.push('b')
  })
  emitter.emit({ type: 'loop_started', config: {} })
  assert.deepEqual(reached, ['b'])
})

test('on() returns an unsubscribe function', () => {
  const emitter = new LoopEventEmitter()
  let count = 0
  const off = emitter.on(() => {
    count += 1
  })
  emitter.emit({ type: 'loop_started', config: {} })
  off()
  emitter.emit({ type: 'loop_started', config: {} })
  assert.equal(count, 1)
})

test('toAsyncIterable ends on loop_finished and loop_error', async () => {
  const emitter = new LoopEventEmitter()
  const events: string[] = []
  const run = (async () => {
    for await (const e of toAsyncIterable(emitter)) events.push(e.type)
  })()
  emitter.emit({ type: 'loop_started', config: {} })
  emitter.emit({ type: 'assistant_text_delta', delta: 'hi' })
  emitter.emit({ type: 'loop_finished', stop: { kind: 'continue' }, iterations: 1 })
  await run
  assert.deepEqual(events, ['loop_started', 'assistant_text_delta', 'loop_finished'])
})

test('toAsyncIterable ends on loop_error', async () => {
  const emitter = new LoopEventEmitter()
  const events: string[] = []
  const run = (async () => {
    for await (const e of toAsyncIterable(emitter)) events.push(e.type)
  })()
  emitter.emit({ type: 'loop_started', config: {} })
  emitter.emit({ type: 'loop_error', message: 'crashed' })
  await run
  assert.deepEqual(events, ['loop_started', 'loop_error'])
})

test('toAsyncIterable can be aborted by breaking the loop', async () => {
  const emitter = new LoopEventEmitter()
  const events: string[] = []
  const run = (async () => {
    for await (const e of toAsyncIterable(emitter)) {
      events.push(e.type)
      if (e.type === 'assistant_text_delta') break
    }
  })()
  emitter.emit({ type: 'loop_started', config: {} })
  emitter.emit({ type: 'assistant_text_delta', delta: 'x' })
  emitter.emit({ type: 'loop_finished', stop: { kind: 'continue' }, iterations: 1 })
  await run
  assert.deepEqual(events, ['loop_started', 'assistant_text_delta'])
})

test('stepToEvents maps act-ok/fail to tool_call_result', () => {
  assert.deepEqual(stepToEvents(step('act-ok')), ['tool_call_result'])
  assert.deepEqual(stepToEvents(step('act-fail')), ['tool_call_result'])
})

test('stepToEvents maps human-* decisions to human_decided', () => {
  assert.deepEqual(stepToEvents(step('human-approved')), ['human_decided'])
  assert.deepEqual(stepToEvents(step('human-rejected')), ['human_decided'])
  assert.deepEqual(stepToEvents(step('human-timeout')), ['human_decided'])
})

test('stepToEvents returns the done action as loop_finished', () => {
  assert.deepEqual(stepToEvents(step('done')), ['loop_finished'])
})

test('stepToEvents ignores runner-internal transitions', () => {
  assert.deepEqual(stepToEvents(step('start')), [])
  assert.deepEqual(stepToEvents(step('reason')), [])
  assert.deepEqual(stepToEvents(step('ask-human')), [])
})
