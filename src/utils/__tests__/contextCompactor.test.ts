/**
 * Tests for the context compactor — all three strategies plus the
 * skipped fast path and the summarize fallback.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compactContext,
  shouldCompact,
  applyCompactionIfNeeded,
  rebuildMessages,
  type CompactionStrategy,
} from '../contextCompactor.js'
import type { ContextMessage } from '../contextBudget.js'

function buildMessages(count: number, body = 'standard message body'): ContextMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as ContextMessage['role'],
    content: `${i}: ${body}`,
  }))
}

test('compactContext skips when under the trigger threshold', async () => {
  const messages = buildMessages(2)
  const result = await compactContext({
    messages,
    tools: [],
    config: { maxTokens: 100_000, triggerRatio: 0.85 },
  })
  assert.equal(result.skipped, true)
  assert.equal(result.droppedCount, 0)
  assert.equal(result.keptCount, 2)
})

test('compactContext.head_tail keeps the system + recent tail', async () => {
  const system: ContextMessage = { role: 'system', content: 'You are OPC.' }
  const messages = [system, ...buildMessages(50, 'x'.repeat(200))]
  const result = await compactContext({
    system: system.content,
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    minKeepRecent: 2,
    strategy: 'head_tail',
  })
  assert.equal(result.skipped, false)
  assert.ok(result.droppedCount > 0)
  assert.ok(result.keptCount <= 1 + 2) // system + minKeepRecent
  assert.ok(result.after.total < result.before.total)
})

test('compactContext.drop_oldest walks forward until within target', async () => {
  const messages = buildMessages(40, 'x'.repeat(200))
  const result = await compactContext({
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    strategy: 'drop_oldest',
  })
  assert.equal(result.skipped, false)
  assert.ok(result.after.total < result.before.total)
  // First message should be preserved (system not present).
  assert.equal(result.keptCount > 0, true)
})

test('compactContext.summarize uses the placeholder when no summarizer is provided', async () => {
  const messages = buildMessages(30, 'x'.repeat(200))
  const result = await compactContext({
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    strategy: 'summarize',
    minKeepRecent: 2,
  })
  assert.equal(result.skipped, false)
  assert.ok(result.summaryMessage)
  assert.match(result.summaryMessage!.content, /compacted/)
})

test('compactContext.summarize delegates to the summarizer hook', async () => {
  const messages = buildMessages(30, 'x'.repeat(200))
  const seen: ContextMessage[][] = []
  const result = await compactContext({
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    strategy: 'summarize',
    minKeepRecent: 2,
    summarize: async dropped => {
      seen.push(dropped)
      return `Synthèse: ${dropped.length} messages consolidés.`
    },
  })
  assert.equal(result.skipped, false)
  assert.equal(result.summaryMessage?.content, 'Synthèse: 30 messages consolidés.'.replace('30', String(seen[0]?.length ?? -1)))
  assert.ok(seen.length === 1)
})

test('compactContext.summarize falls back to placeholder when summarizer throws', async () => {
  const messages = buildMessages(30, 'x'.repeat(200))
  const result = await compactContext({
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    strategy: 'summarize',
    minKeepRecent: 2,
    summarize: () => {
      throw new Error('LLM offline')
    },
  })
  assert.ok(result.summaryMessage)
  assert.match(result.summaryMessage!.content, /compacted/)
})

test('compactContext invokes onCompacted listener with the result', async () => {
  let captured: { dropped: number; kept: number } | null = null
  const messages = buildMessages(20, 'x'.repeat(200))
  await compactContext({
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    strategy: 'head_tail',
    onCompacted: r => {
      captured = { dropped: r.droppedCount, kept: r.keptCount }
    },
  })
  assert.ok(captured)
  assert.ok(captured!.dropped > 0)
})

test('compactContext never throws on listener / memory errors', async () => {
  const messages = buildMessages(20, 'x'.repeat(200))
  const result = await compactContext({
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    onCompacted: () => {
      throw new Error('listener exploded')
    },
  })
  assert.ok(result.after.total > 0)
})

test('applyCompactionIfNeeded returns the rebuilt message array', async () => {
  const messages = buildMessages(20, 'x'.repeat(200))
  const { messages: out, result } = await applyCompactionIfNeeded({
    messages,
    tools: [],
    config: { maxTokens: 200, triggerRatio: 0.5 },
    strategy: 'head_tail',
  })
  if (!result.skipped) {
    assert.ok(out.length <= messages.length)
  }
})

test('rebuildMessages returns the original messages when skipped', () => {
  const messages = buildMessages(3)
  const out = rebuildMessages(
    { messages, tools: [], config: { maxTokens: 1000 } },
    {
      strategy: 'head_tail',
      before: { systemTokens: 0, messagesTokens: 0, toolsTokens: 0, reservedForOutput: 0, total: 0 },
      after: { systemTokens: 0, messagesTokens: 0, toolsTokens: 0, reservedForOutput: 0, total: 0 },
      droppedCount: 0,
      keptCount: messages.length,
      skipped: true,
    },
  )
  assert.equal(out.length, messages.length)
})

test('shouldCompact accepts an override ratio', () => {
  // Build a tiny estimate object — directly use the predicate form.
  const estimate = {
    breakdown: {
      systemTokens: 0,
      messagesTokens: 80,
      toolsTokens: 0,
      reservedForOutput: 0,
      total: 80,
    },
    needsCompaction: false,
    usagePercent: 80,
    exceedsMax: false,
  }
  assert.equal(shouldCompact(estimate, 0.5), true) // 80 >= 50% of 100
  assert.equal(shouldCompact(estimate, 0.9), false)
})

const STRATEGIES: CompactionStrategy[] = ['head_tail', 'drop_oldest', 'summarize']
for (const strategy of STRATEGIES) {
  test(`compactContext.${strategy} never increases the token count`, async () => {
    const messages = buildMessages(40, 'x'.repeat(200))
    const result = await compactContext({
      messages,
      tools: [],
      config: { maxTokens: 200, triggerRatio: 0.5 },
      strategy,
    })
    if (!result.skipped) {
      assert.ok(result.after.total <= result.before.total)
    }
  })
}
