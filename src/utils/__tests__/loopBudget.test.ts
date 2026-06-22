/**
 * Tests for the BudgetTracker — covers every breach kind, the priority
 * order, the sterile repeat detector, and the actionKey helper.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BudgetTracker, actionKey, DEFAULT_STERILE_THRESHOLD } from '../loopBudget.js'

test('BudgetTracker starts at zero across every counter', () => {
  const tracker = new BudgetTracker({})
  tracker.start()
  const snap = tracker.snapshot()
  assert.equal(snap.iterations, 0)
  assert.equal(snap.totalTokens, 0)
  assert.equal(snap.totalCostUsd, 0)
  assert.equal(snap.wallTimeMs, 0)
  assert.deepEqual(snap.sterileHits, {})
})

test('BudgetTracker accumulates usage and rounds cost to 2 decimals', () => {
  const tracker = new BudgetTracker({})
  tracker.start()
  tracker.recordUsage({
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 250,
    cacheWriteTokens: 100,
    costUsd: 0.1234567,
  })
  const snap = tracker.snapshot()
  assert.equal(snap.totalTokens, 1850)
  assert.equal(snap.totalCostUsd, 0.12)
})

test('BudgetTracker clamps negative usage to zero', () => {
  const tracker = new BudgetTracker({})
  tracker.start()
  tracker.recordUsage({ inputTokens: -100, costUsd: -1 })
  assert.equal(tracker.snapshot().totalTokens, 0)
  assert.equal(tracker.snapshot().totalCostUsd, 0)
})

test('BudgetTracker.start() is idempotent', () => {
  let now = 1000
  const tracker = new BudgetTracker({ now: () => now })
  tracker.start()
  now += 5000
  tracker.start() // should NOT reset the start time
  assert.equal(tracker.snapshot().wallTimeMs, 5000)
})

test('BudgetTracker.check() returns iterations breach first', () => {
  const tracker = new BudgetTracker({ maxIterations: 2, maxTokens: 0 })
  tracker.start()
  tracker.recordIteration()
  tracker.recordIteration()
  const breach = tracker.check()
  assert.ok(breach)
  assert.equal(breach?.kind, 'iterations')
})

test('BudgetTracker.check() returns tokens breach before cost', () => {
  const tracker = new BudgetTracker({ maxTokens: 100, maxCostUsd: 0 })
  tracker.start()
  tracker.recordUsage({ inputTokens: 200, costUsd: 1 })
  const breach = tracker.check()
  assert.equal(breach?.kind, 'tokens')
})

test('BudgetTracker.check() returns cost breach when tokens are under budget', () => {
  const tracker = new BudgetTracker({ maxCostUsd: 0.5 })
  tracker.start()
  tracker.recordUsage({ inputTokens: 1, costUsd: 1 })
  const breach = tracker.check()
  assert.equal(breach?.kind, 'cost')
})

test('BudgetTracker.check() returns wallTime breach when only wall time is exceeded', () => {
  let now = 1000
  const tracker = new BudgetTracker({ maxWallTimeMs: 100, now: () => now })
  tracker.start()
  now += 200
  const breach = tracker.check()
  assert.equal(breach?.kind, 'wallTime')
})

test('BudgetTracker.check() detects sterile loops above the default threshold', () => {
  const tracker = new BudgetTracker({ maxSterileRepeats: 3 })
  tracker.start()
  tracker.recordAction('run_command::["ls"]')
  tracker.recordAction('run_command::["ls"]')
  tracker.recordAction('run_command::["ls"]')
  const breach = tracker.check()
  assert.equal(breach?.kind, 'sterile')
  if (breach?.kind === 'sterile') {
    assert.match(breach.reason, /run_command/)
  }
})

test('BudgetTracker.check() respects custom sterile threshold', () => {
  const tracker = new BudgetTracker({ maxSterileRepeats: 5 })
  tracker.start()
  for (let i = 0; i < 4; i++) tracker.recordAction('a')
  assert.equal(tracker.check(), null)
  tracker.recordAction('a')
  assert.equal(tracker.check()?.kind, 'sterile')
})

test('BudgetTracker.check() returns null when under every limit', () => {
  const tracker = new BudgetTracker({
    maxIterations: 100,
    maxTokens: 10_000,
    maxCostUsd: 5,
    maxWallTimeMs: 60_000,
  })
  tracker.start()
  tracker.recordIteration()
  tracker.recordUsage({ inputTokens: 100, costUsd: 0.001 })
  assert.equal(tracker.check(), null)
  assert.equal(tracker.isExceeded(), false)
})

test('BudgetTracker.recordAction returns the new hit count', () => {
  const tracker = new BudgetTracker({})
  tracker.start()
  assert.equal(tracker.recordAction('x').hit, 1)
  assert.equal(tracker.recordAction('x').hit, 2)
})

test('actionKey normalizes whitespace and trims string values', () => {
  const a = actionKey('grep', { pattern: 'foo ' })
  const b = actionKey('grep', { pattern: '  foo' })
  const c = actionKey('grep', { pattern: 'foo' })
  assert.equal(a, b)
  assert.equal(b, c)
})

test('actionKey distinguishes different tool names', () => {
  const a = actionKey('grep', { pattern: 'foo' })
  const b = actionKey('read_file', { pattern: 'foo' })
  assert.notEqual(a, b)
})

test('actionKey handles unserializable args without throwing', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const key = actionKey('x', circular)
  assert.match(key, /^x::/)
})

test('BudgetTracker.snapshot() returns a frozen sterileHits map', () => {
  const tracker = new BudgetTracker({})
  tracker.start()
  tracker.recordAction('a')
  const snap = tracker.snapshot()
  assert.ok(Object.isFrozen(snap.sterileHits))
})

test('DEFAULT_STERILE_THRESHOLD is exported and reasonable', () => {
  assert.ok(DEFAULT_STERILE_THRESHOLD >= 2)
})
