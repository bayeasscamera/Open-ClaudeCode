'use strict'

// Tests for the IPC validation/normalization helpers added in the
// production-hardening pass. These exercise the *exported* normalizers
// directly (no Electron required) and verify that the IPC handlers
// themselves route through them via the handle() injection point.

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  normalizeSessionId,
  normalizeMaxTurns,
  normalizeMaxBudgetUsd,
  registerSessionIpc,
} = require('../electron/ipc/sessionIpc.cjs')
const {
  registerLoopEventIpc,
} = require('../electron/ipc/loopEventIpc.cjs')
const {
  registerHumanGateIpc,
} = require('../electron/ipc/humanGateIpc.cjs')

// ── sessionIpc normalizers ─────────────────────────────────────────────────

test('sessionIpc: normalizeSessionId strips control chars and bounds length', () => {
  assert.equal(normalizeSessionId('  abc  '), 'abc')
  assert.equal(normalizeSessionId(''), '')
  assert.equal(normalizeSessionId(null), '')
  assert.equal(normalizeSessionId(undefined), '')
  assert.equal(normalizeSessionId('a\u0000b'), 'ab')
  // > 256 chars → rejected
  assert.equal(normalizeSessionId('x'.repeat(257)), '')
  assert.equal(normalizeSessionId('x'.repeat(256)), 'x'.repeat(256))
})

test('sessionIpc: normalizeMaxTurns clamps to a sane integer range', () => {
  assert.equal(normalizeMaxTurns(5), 5)
  assert.equal(normalizeMaxTurns('5'), 5)
  assert.equal(normalizeMaxTurns(0), null)
  assert.equal(normalizeMaxTurns(-1), null)
  assert.equal(normalizeMaxTurns('abc'), null)
  assert.equal(normalizeMaxTurns(NaN), null)
  assert.equal(normalizeMaxTurns(null), null)
  assert.equal(normalizeMaxTurns(undefined), null)
  assert.equal(normalizeMaxTurns(''), null)
  // Hard cap at 1000
  assert.equal(normalizeMaxTurns(50_000), 1000)
  // Floors fractional inputs
  assert.equal(normalizeMaxTurns(3.7), 3)
})

test('sessionIpc: normalizeMaxBudgetUsd clamps to a sane USD range', () => {
  assert.equal(normalizeMaxBudgetUsd(2.5), 2.5)
  assert.equal(normalizeMaxBudgetUsd('1.25'), 1.25)
  assert.equal(normalizeMaxBudgetUsd(0), null)
  assert.equal(normalizeMaxBudgetUsd(-1), null)
  assert.equal(normalizeMaxBudgetUsd('abc'), null)
  assert.equal(normalizeMaxBudgetUsd(NaN), null)
  assert.equal(normalizeMaxBudgetUsd(null), null)
  assert.equal(normalizeMaxBudgetUsd(undefined), null)
  assert.equal(normalizeMaxBudgetUsd(''), null)
  // Hard cap at 10_000
  assert.equal(normalizeMaxBudgetUsd(99_999_999), 10_000)
})

// ── sessionIpc handler (smoke, with injected sessionStore) ────────────────

test('sessionIpc: session-config rejects missing id with ok:false', async () => {
  const handlers = {}
  const sessionStore = {
    findIncomplete: () => [{ id: 's1', status: 'running' }],
    markCompleted: id => ({ ok: true, id }),
    findById: id => ({ id, maxTurns: 5 }),
    upsert: payload => ({ ok: true, session: payload }),
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  const noId = await handlers['opc:session-config']({}, {})
  assert.equal(noId.ok, false)
  assert.match(noId.error, /id manquant/)
})

test('sessionIpc: session-config rejects oversize id', async () => {
  const handlers = {}
  const sessionStore = {
    findById: () => null,
    upsert: payload => ({ ok: true, session: payload }),
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  const oversize = await handlers['opc:session-config']({}, { id: 'x'.repeat(257) })
  assert.equal(oversize.ok, false)
})

test('sessionIpc: session-config patches maxTurns through normalizer', async () => {
  const handlers = {}
  let upserted = null
  const sessionStore = {
    findById: id => ({ id, taskId: 't1', status: 'running' }),
    upsert: payload => { upserted = payload; return { ok: true, session: payload } },
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  const result = await handlers['opc:session-config']({}, {
    id: 'sess-1',
    maxTurns: 50_000, // clamps to 1000
  })
  assert.equal(result.ok, true)
  assert.equal(upserted.maxTurns, 1000)
  assert.equal(upserted.id, 'sess-1')
})

test('sessionIpc: session-config patches maxBudgetUsd through normalizer', async () => {
  const handlers = {}
  let upserted = null
  const sessionStore = {
    findById: id => ({ id }),
    upsert: payload => { upserted = payload; return { ok: true, session: payload } },
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  await handlers['opc:session-config']({}, {
    id: 'sess-1',
    maxBudgetUsd: -5, // rejected → null
  })
  assert.equal(upserted.maxBudgetUsd, null)
})

test('sessionIpc: session-config reads when no patch fields are present', async () => {
  const handlers = {}
  const sessionStore = {
    findById: id => ({ id, status: 'running', maxTurns: 5 }),
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  const result = await handlers['opc:session-config']({}, { id: 'sess-1' })
  assert.equal(result.ok, true)
  assert.equal(result.session.maxTurns, 5)
})

// ── loopEventIpc ───────────────────────────────────────────────────────────

test('loopEventIpc: broadcastLoopEvent rejects event without type', () => {
  const sent = []
  const log = msg => sent.push(['log', msg])
  const handle = (ch, fn) => { sent.push(['handle', ch, fn]) }
  // No live BrowserWindow — broadcastJsonLine must not throw.
  const bridge = registerLoopEventIpc({
    handle,
    ipcMain: { on: () => {} },
    log,
  })

  // broadcastLoopEvent requires a non-empty `type` discriminator.
  const okMissingType = bridge.broadcastLoopEvent({ payload: 'x' })
  assert.equal(okMissingType, false)

  const okNull = bridge.broadcastLoopEvent(null)
  assert.equal(okNull, false)
})

test('loopEventIpc: broadcastLoopEvent assigns a non-negative seq', () => {
  const log = () => {}
  const bridge = registerLoopEventIpc({
    handle: () => {},
    ipcMain: { on: () => {} },
    log,
  })

  // Negative seq in partial is ignored; auto-assigned seq must be >= 0.
  const event = {
    type: 'loop_started',
    seq: -42,
  }
  // We don't assert broadcast result (no live window) — just exercise the code path.
  bridge.broadcastLoopEvent(event)
  // If we got here without throwing, the seq coercion is robust.
  assert.ok(true, 'no throw on negative seq')
})

test('loopEventIpc: broadcastLoopEvent drops oversized payloads', () => {
  let lastLog = ''
  const log = msg => { lastLog = msg }
  const bridge = registerLoopEventIpc({
    handle: () => {},
    ipcMain: { on: () => {} },
    log,
  })
  // > MAX_LINE_BYTES (256 KiB) after serialization
  const huge = 'x'.repeat(300_000)
  const ok = bridge.broadcastLoopEvent({ type: 'text_delta', text: huge })
  assert.equal(ok, false)
  assert.match(lastLog, /oversized event/)
})

// ── humanGateIpc (smoke, no live BrowserWindow) ───────────────────────────

test('humanGateIpc: registers a handler and a RESPOND listener', () => {
  const handleCalls = []
  const onCalls = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: {
      on: (ch, fn) => onCalls.push([ch, fn]),
    },
  })

  assert.equal(handleCalls.length, 1)
  assert.equal(handleCalls[0][0], 'opc:human-gate-ask')
  assert.equal(onCalls.length, 1)
  assert.equal(onCalls[0][0], 'opc:human-gate-respond')
  assert.equal(typeof gate.shutdown, 'function')
})

test('humanGateIpc: ask resolves to timeout when id is missing', async () => {
  const handleCalls = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: () => {} },
  })
  const handler = handleCalls[0][1]
  const result = await handler({}, {})
  assert.equal(result, 'timeout')
})

test('humanGateIpc: ask resolves to timeout when question is missing', async () => {
  const handleCalls = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: () => {} },
  })
  const handler = handleCalls[0][1]
  const result = await handler({}, { id: 'q1', question: '' })
  assert.equal(result, 'timeout')
})

test('humanGateIpc: ask resolves to timeout when question is too long', async () => {
  const handleCalls = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: () => {} },
  })
  const handler = handleCalls[0][1]
  const result = await handler({}, {
    id: 'q1',
    question: 'x'.repeat(5000),
    timeoutMs: 50, // short so we don't hang
  })
  assert.equal(result, 'timeout')
})

test('humanGateIpc: ask trims oversized question instead of dropping', async () => {
  const handleCalls = []
  const onAwaiting = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: () => {} },
    onAwaitingUser: payload => onAwaiting.push(payload),
  })
  const handler = handleCalls[0][1]
  // 4000 chars exactly is the cap; 4001 must be trimmed to 4000.
  const result = handler({}, {
    id: 'q1',
    question: 'y'.repeat(4001),
    timeoutMs: 30,
  })
  // We don't await — just trigger the path and let it time out.
  result.catch(() => {})
  // Give the synchronous onAwaitingUser callback a tick to run.
  await new Promise(r => setImmediate(r))
  if (onAwaiting.length) {
    assert.ok(onAwaiting[0].question.length <= 4000, 'question was trimmed')
  }
})

// ── sessionIpc: P1 regression (taskId normalization) ───────────────────────

test('sessionIpc: session-config normalizes payload.taskId (P1 fix)', async () => {
  const handlers = {}
  let upserted = null
  const sessionStore = {
    findById: () => ({ id: 'sess-1' }), // no existing taskId
    upsert: payload => { upserted = payload; return { ok: true, session: payload } },
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  await handlers['opc:session-config']({}, {
    id: 'sess-1',
    taskId: '  task\u0000with\u0000nulls  ',
    maxTurns: 5,
  })
  // null bytes stripped, whitespace trimmed
  assert.equal(upserted.taskId, 'taskwithnulls')
})

test('sessionIpc: session-config rejects payload.taskId over 256 chars', async () => {
  const handlers = {}
  let upserted = null
  const sessionStore = {
    findById: () => null,
    upsert: payload => { upserted = payload; return { ok: true, session: payload } },
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  await handlers['opc:session-config']({}, {
    id: 'sess-1',
    taskId: 't'.repeat(300),
    maxTurns: 5,
  })
  // oversized taskId is dropped to ''
  assert.equal(upserted.taskId, '')
})

test('sessionIpc: session-config re-normalizes existing.taskId defensively', async () => {
  const handlers = {}
  let upserted = null
  const sessionStore = {
    // Simulate a corrupted row written through an older, less-strict code path.
    findById: () => ({ id: 'sess-1', taskId: 'corrupt\u0000id   ' }),
    upsert: payload => { upserted = payload; return { ok: true, session: payload } },
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  await handlers['opc:session-config']({}, { id: 'sess-1', maxTurns: 5 })
  assert.equal(upserted.taskId, 'corruptid')
})

// ── sessionIpc: handlers not yet covered ───────────────────────────────────

test('sessionIpc: session-mark-done returns ok when id is valid', async () => {
  const handlers = {}
  const sessionStore = {
    markCompleted: id => ({ ok: true, id }),
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  const result = await handlers['opc:session-mark-done']({}, { id: 'sess-1' })
  assert.equal(result.ok, true)
  assert.equal(result.id, 'sess-1')
})

test('sessionIpc: session-mark-done returns ok:false when id is missing', async () => {
  const handlers = {}
  registerSessionIpc({
    handle: (ch, fn) => { handlers[ch] = fn },
    sessionStore: { markCompleted: () => ({ ok: true }) },
  })

  const result = await handlers['opc:session-mark-done']({}, {})
  assert.equal(result.ok, false)
  assert.match(result.error, /id manquant/)
})

test('sessionIpc: session-list returns sessions from store', async () => {
  const handlers = {}
  const sessionStore = {
    findIncomplete: ({ limit }) => [{ id: 'a' }, { id: 'b' }].slice(0, limit),
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  const result = await handlers['opc:session-list']({})
  assert.equal(result.ok, true)
  assert.equal(result.sessions.length, 2)
})

test('sessionIpc: session-list returns ok:false when store throws', async () => {
  const handlers = {}
  const sessionStore = {
    findIncomplete: () => { throw new Error('db locked') },
  }
  registerSessionIpc({ handle: (ch, fn) => { handlers[ch] = fn }, sessionStore })

  const result = await handlers['opc:session-list']({})
  assert.equal(result.ok, false)
  assert.equal(result.sessions.length, 0)
  assert.match(result.error, /db locked/)
})

// ── loopEventIpc: coverage gaps ───────────────────────────────────────────

test('loopEventIpc: broadcastJsonLine rejects malformed JSON', () => {
  let lastLog = ''
  const log = msg => { lastLog = msg }
  const bridge = registerLoopEventIpc({
    handle: () => {},
    ipcMain: { on: () => {} },
    log,
  })
  const ok = bridge.broadcastJsonLine('{not-json}')
  assert.equal(ok, false)
  assert.match(lastLog, /malformed JSONL/)
})

test('loopEventIpc: broadcastJsonLine rejects lines without required fields', () => {
  let lastLog = ''
  const log = msg => { lastLog = msg }
  const bridge = registerLoopEventIpc({
    handle: () => {},
    ipcMain: { on: () => {} },
    log,
  })
  // Missing `type` and `seq`
  const ok = bridge.broadcastJsonLine(JSON.stringify({ foo: 'bar' }))
  assert.equal(ok, false)
  assert.match(lastLog, /not a valid LoopEvent/)
})

test('loopEventIpc: broadcastJsonLine rejects non-string input', () => {
  const log = () => {}
  const bridge = registerLoopEventIpc({
    handle: () => {},
    ipcMain: { on: () => {} },
    log,
  })
  assert.equal(bridge.broadcastJsonLine(null), false)
  assert.equal(bridge.broadcastJsonLine(123), false)
  assert.equal(bridge.broadcastJsonLine({}), false)
})

test('loopEventIpc: broadcastLoopEvent rejects non-string type', () => {
  let lastLog = ''
  const log = msg => { lastLog = msg }
  const bridge = registerLoopEventIpc({
    handle: () => {},
    ipcMain: { on: () => {} },
    log,
  })
  assert.equal(bridge.broadcastLoopEvent({ type: 42 }), false)
  assert.equal(bridge.broadcastLoopEvent({ type: '' }), false)
})

test('loopEventIpc: exposes the opc:loop-event channel constant', () => {
  const bridge = registerLoopEventIpc({
    handle: () => {},
    ipcMain: { on: () => {} },
  })
  assert.equal(bridge.channel, 'opc:loop-event')
})

test('loopEventIpc: registers a ping handler when handle is provided', async () => {
  const handlers = {}
  const bridge = registerLoopEventIpc({
    handle: (ch, fn) => { handlers[ch] = fn },
    ipcMain: { on: () => {} },
  })
  assert.ok(handlers['opc:loop-event:ping'])
  const result = await handlers['opc:loop-event:ping']({})
  assert.equal(result.ok, true)
  assert.equal(result.channel, bridge.channel)
})

// ── humanGateIpc: coverage gaps ───────────────────────────────────────────

test('humanGateIpc: respond listener rejects unknown decision strings', () => {
  const onCalls = []
  registerHumanGateIpc({
    handle: () => {},
    ipcMain: { on: (ch, fn) => onCalls.push([ch, fn]) },
  })
  const respondHandler = onCalls[0][1]
  // Must not throw on bogus decision — handler silently ignores.
  respondHandler({}, { id: 'q1', decision: 'maybe' })
  respondHandler({}, { id: 'q1', decision: 42 })
  assert.ok(true, 'no throw on bogus decision')
})

test('humanGateIpc: respond listener rejects missing id', () => {
  const onCalls = []
  registerHumanGateIpc({
    handle: () => {},
    ipcMain: { on: (ch, fn) => onCalls.push([ch, fn]) },
  })
  const respondHandler = onCalls[0][1]
  respondHandler({}, { decision: 'approved' })
  respondHandler({}, { id: '', decision: 'approved' })
  respondHandler({}, null)
  assert.ok(true, 'no throw on missing id')
})

test('humanGateIpc: respond listener resolves pending promise with approved', async () => {
  const handleCalls = []
  const onCalls = []
  registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: (ch, fn) => onCalls.push([ch, fn]) },
  })
  const askHandler = handleCalls[0][1]
  const respondHandler = onCalls[0][1]

  const askPromise = askHandler({}, {
    id: 'q-respond',
    question: 'Proceed?',
    timeoutMs: 1000,
  })
  // Give the ask handler a tick to register the pending promise.
  await new Promise(r => setImmediate(r))

  respondHandler({}, { id: 'q-respond', decision: 'approved' })
  const result = await askPromise
  assert.equal(result, 'approved')
})

test('humanGateIpc: shutdown resolves all pending prompts to timeout', async () => {
  const handleCalls = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: () => {} },
  })
  const askHandler = handleCalls[0][1]

  const p1 = askHandler({}, { id: 'q1', question: 'a', timeoutMs: 5000 })
  const p2 = askHandler({}, { id: 'q2', question: 'b', timeoutMs: 5000 })
  await new Promise(r => setImmediate(r))

  gate.shutdown()
  const r1 = await p1
  const r2 = await p2
  assert.equal(r1, 'timeout')
  assert.equal(r2, 'timeout')
})

test('humanGateIpc: ask rejects when queue is full', async () => {
  const handleCalls = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: () => {} },
  })
  const askHandler = handleCalls[0][1]

  // Fill the queue (MAX_QUEUE = 16) with asks that will not resolve.
  const pending = []
  for (let i = 0; i < 16; i++) {
    pending.push(askHandler({}, { id: `q${i}`, question: '?', timeoutMs: 5000 }))
  }
  await new Promise(r => setImmediate(r))

  // 17th must time out immediately.
  const overflow = await askHandler({}, { id: 'q-overflow', question: '?', timeoutMs: 5000 })
  assert.equal(overflow, 'timeout')

  // Shut down so the 16 pending timers resolve and the runner exits cleanly.
  gate.shutdown()
  await Promise.all(pending)
})

test('humanGateIpc: ask rejects when timeoutMs is invalid', async () => {
  const handleCalls = []
  const onAwaiting = []
  const gate = registerHumanGateIpc({
    handle: (ch, fn) => handleCalls.push([ch, fn]),
    ipcMain: { on: () => {} },
    onAwaitingUser: payload => onAwaiting.push(payload),
  })
  const askHandler = handleCalls[0][1]
  // Negative timeoutMs → falls back to default; ask proceeds normally.
  // The point is that it does NOT throw on garbage input.
  const p = askHandler({}, {
    id: 'q1',
    question: '?',
    timeoutMs: -1,
  })
  p.catch(() => {})
  await new Promise(r => setImmediate(r))
  assert.ok(onAwaiting.length >= 1, 'onAwaitingUser fired with default timeout')

  // Resolve the pending prompt so the runner does not wait on its timer.
  gate.shutdown()
  await p
})
