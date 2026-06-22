/**
 * Tests for `evaluateStop` and `shouldStop`.
 *
 * Run with: `npm run test:loop` (uses node:test + tsx).
 *
 * The tests cover the four stop reasons plus the priority order
 * (abort > fatal > budget > no-work > continue).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BudgetTracker } from '../loopBudget.js'
import { evaluateStop, shouldStop } from '../loopStop.js'

test('evaluateStop returns continue by default', () => {
  const stop = evaluateStop({})
  assert.equal(stop.kind, 'continue')
})

test('evaluateStop abort beats every other condition', () => {
  const controller = new AbortController()
  controller.abort(new Error('user-cancel'))
  const budget = new BudgetTracker({ maxTokens: 0 }) // would breach
  const stop = evaluateStop({
    signal: controller.signal,
    budget,
    workRemaining: false, // would be 'done'
    fatal: { error: 'boom' }, // would be 'fatal'
  })
  assert.equal(stop.kind, 'abort')
  if (stop.kind === 'abort') {
    assert.equal(stop.reason, 'user-cancel')
  }
})

test('evaluateStop fatal beats budget and no-work', () => {
  const budget = new BudgetTracker({ maxTokens: 0 })
  const stop = evaluateStop({
    fatal: { error: 'tool crashed', cause: new Error('boom') },
    budget,
    workRemaining: false,
  })
  assert.equal(stop.kind, 'fatal')
  if (stop.kind === 'fatal') {
    assert.equal(stop.error, 'tool crashed')
    assert.ok(stop.cause instanceof Error)
  }
})

test('evaluateStop returns budget when the tracker breaches', () => {
  let now = 1000
  const tracker = new BudgetTracker({ maxTokens: 10, now: () => now })
  tracker.start()
  tracker.recordUsage({ inputTokens: 50 })
  const stop = evaluateStop({ budget: tracker })
  assert.equal(stop.kind, 'budget')
  if (stop.kind === 'budget') {
    assert.equal(stop.breach.kind, 'tokens')
    assert.equal(stop.breach.snapshot.totalTokens, 50)
  }
})

test('evaluateStop returns done when workRemaining is false', () => {
  const stop = evaluateStop({ workRemaining: false })
  assert.equal(stop.kind, 'done')
})

test('evaluateStop ignores an undefined AbortSignal', () => {
  const stop = evaluateStop({ signal: undefined })
  assert.equal(stop.kind, 'continue')
})

test('shouldStop is the predicate form of evaluateStop', () => {
  assert.equal(shouldStop({}), false)
  assert.equal(shouldStop({ workRemaining: false }), true)
})

test('evaluateStop accepts a string AbortSignal reason', () => {
  const controller = new AbortController()
  controller.abort('manual')
  const stop = evaluateStop({ signal: controller.signal })
  assert.equal(stop.kind, 'abort')
  if (stop.kind === 'abort') {
    assert.equal(stop.reason, 'manual')
  }
})
