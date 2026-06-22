/**
 * Tests for the context-budget estimator.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens,
  estimateMessageTokens,
  estimatePayloadTokens,
  estimateToolDefinitionTokens,
  estimateContext,
  shouldCompact,
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_TOOL_OVERHEAD_TOKENS,
} from '../contextBudget.js'

test('estimateTokens rounds up and returns 0 for empty input', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
  assert.equal(estimateTokens(undefined), 0)
  // 13 chars / 4 = 3.25 → 4
  assert.equal(estimateTokens('Hello, world!'), 4)
})

test('estimateTokens respects a custom charsPerToken ratio', () => {
  assert.equal(estimateTokens('Hello, world!', 2), 7) // 13/2 = 6.5 → 7
})

test('estimateTokens never returns a fraction', () => {
  const result = estimateTokens('a'.repeat(5))
  assert.ok(Number.isInteger(result))
})

test('estimatePayloadTokens inflates JSON by 1.15× plus overhead', () => {
  const baseline = estimatePayloadTokens({ foo: 'bar' })
  assert.ok(baseline > JSON.stringify({ foo: 'bar' }).length / DEFAULT_CHARS_PER_TOKEN)
})

test('estimatePayloadTokens handles circular refs gracefully', () => {
  const obj: Record<string, unknown> = {}
  obj.self = obj
  const result = estimatePayloadTokens(obj)
  assert.ok(result > 0)
})

test('estimatePayloadTokens returns 0 for undefined', () => {
  assert.equal(estimatePayloadTokens(undefined), 0)
})

test('estimateMessageTokens adds overhead and counts tool payloads', () => {
  const base = estimateMessageTokens({
    role: 'user',
    content: 'Hello, world!',
  })
  const withPayload = estimateMessageTokens({
    role: 'tool',
    name: 'run_command',
    content: '',
    toolPayload: { stdout: 'a'.repeat(400) },
  })
  assert.ok(withPayload > base)
})

test('estimateToolDefinitionTokens adds a fixed overhead per tool', () => {
  const a = estimateToolDefinitionTokens(
    { name: 'foo', description: '', inputSchema: {} },
    DEFAULT_TOOL_OVERHEAD_TOKENS,
  )
  const b = estimateToolDefinitionTokens(
    { name: 'foo', description: 'longer description here', inputSchema: { type: 'object' } },
    DEFAULT_TOOL_OVERHEAD_TOKENS,
  )
  assert.ok(b > a)
})

test('estimateContext returns a stable breakdown', () => {
  const estimate = estimateContext({
    system: 'You are a helpful assistant.',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there.' },
    ],
    tools: [
      { name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' } },
    ],
    config: { maxTokens: 1000 },
  })
  assert.ok(estimate.breakdown.systemTokens > 0)
  assert.ok(estimate.breakdown.messagesTokens > 0)
  assert.ok(estimate.breakdown.toolsTokens > 0)
  assert.ok(estimate.breakdown.reservedForOutput > 0)
  assert.equal(
    estimate.breakdown.total,
    estimate.breakdown.systemTokens +
      estimate.breakdown.messagesTokens +
      estimate.breakdown.toolsTokens +
      estimate.breakdown.reservedForOutput,
  )
  assert.equal(estimate.usagePercent, Math.min(999, Math.round((estimate.breakdown.total / 1000) * 100)))
})

test('estimateContext flips needsCompaction at the trigger threshold', () => {
  const small = estimateContext({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    config: { maxTokens: 100_000, triggerRatio: 0.5 },
  })
  assert.equal(small.needsCompaction, false)

  const huge = estimateContext({
    system: 'x'.repeat(500),
    messages: [{ role: 'user', content: 'y'.repeat(500) }],
    tools: [],
    config: { maxTokens: 50, triggerRatio: 0.5 },
  })
  assert.equal(huge.exceedsMax, true)
})

test('shouldCompact mirrors estimateContext.needsCompaction', () => {
  const estimate = estimateContext({
    messages: [{ role: 'user', content: 'a'.repeat(10_000) }],
    tools: [],
    config: { maxTokens: 1000, triggerRatio: 0.5 },
  })
  assert.equal(shouldCompact(estimate), estimate.needsCompaction)
})

test('estimateContext clamps invalid ratios and oversize inputs', () => {
  const estimate = estimateContext({
    messages: [{ role: 'user', content: '' }],
    tools: [],
    config: { maxTokens: -1, triggerRatio: 99, charsPerToken: 0 },
  })
  // Even with garbage config, totals must be finite and >= 0.
  assert.ok(Number.isFinite(estimate.breakdown.total))
  assert.ok(estimate.breakdown.total >= 0)
})
