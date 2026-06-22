const assert = require('node:assert/strict')
const test = require('node:test')
const { createSendChannel } = require('../electron/sendChannel.cjs')

// ── M1 (Sprint 4) — send() guards against destroyed webContents ────────────

/**
 * Minimal BrowserWindow mock: exposes only what send() inspects.
 * - `isDestroyed()` mirrors the window lifecycle.
 * - `webContents` exposes `isDestroyed()` and `send(channel, payload)`.
 */
function makeWindow({ windowDestroyed = false, contentsDestroyed = false, throwOnSend = null } = {}) {
  const sent = []
  const send = (channel, payload) => {
    if (throwOnSend) throw throwOnSend
    sent.push({ channel, payload })
  }
  return {
    isDestroyed: () => windowDestroyed,
    webContents: {
      isDestroyed: () => contentsDestroyed,
      send,
      _sent: sent,
    },
  }
}

test('createSendChannel requires a getMainWindow function', () => {
  assert.throws(() => createSendChannel({}), /getMainWindow/)
  assert.throws(() => createSendChannel({ getMainWindow: 'not-a-fn' }), /getMainWindow/)
})

test('send is a no-op when no window is available', () => {
  const send = createSendChannel({ getMainWindow: () => null })
  // Must not throw.
  send('opc:event', { hello: 'world' })
})

test('send is a no-op when the window is destroyed', () => {
  const win = makeWindow({ windowDestroyed: true })
  const send = createSendChannel({ getMainWindow: () => win })
  send('opc:event', { hello: 'world' })
  assert.equal(win.webContents._sent.length, 0, 'webContents.send should not be called')
})

test('send is a no-op when webContents is missing', () => {
  const win = { isDestroyed: () => false, webContents: null }
  const send = createSendChannel({ getMainWindow: () => win })
  send('opc:event', { hello: 'world' })
})

test('send is a no-op when webContents is destroyed (renderer torn down)', () => {
  const win = makeWindow({ contentsDestroyed: true })
  const send = createSendChannel({ getMainWindow: () => win })
  send('opc:event', { hello: 'world' })
  assert.equal(win.webContents._sent.length, 0, 'send on destroyed webContents must not throw')
})

test('send forwards channel and payload to webContents when alive', () => {
  const win = makeWindow()
  const send = createSendChannel({ getMainWindow: () => win })
  send('opc:event', { type: 'tick', n: 1 })
  send('opc:event', { type: 'tick', n: 2 })
  assert.equal(win.webContents._sent.length, 2)
  assert.deepEqual(win.webContents._sent[0], { channel: 'opc:event', payload: { type: 'tick', n: 1 } })
  assert.deepEqual(win.webContents._sent[1], { channel: 'opc:event', payload: { type: 'tick', n: 2 } })
})

test('send swallows synchronous throws from webContents.send()', () => {
  const win = makeWindow({ throwOnSend: new Error('webContents gone') })
  const logCalls = []
  const send = createSendChannel({
    getMainWindow: () => win,
    log: (line) => logCalls.push(line),
  })
  // Must not throw.
  send('opc:event', { hello: 'world' })
  assert.equal(logCalls.length, 1, 'log should be called once for the swallowed error')
  assert.match(logCalls[0], /opc:event/)
  assert.match(logCalls[0], /webContents gone/)
})

test('send swallows throws even when log itself is missing or throws', () => {
  const win = makeWindow({ throwOnSend: new Error('boom') })
  // No log provided.
  const sendNoLog = createSendChannel({ getMainWindow: () => win })
  assert.doesNotThrow(() => sendNoLog('opc:event', { ok: true }))

  // Throwing log must not break the no-op contract.
  const sendBadLog = createSendChannel({
    getMainWindow: () => win,
    log: () => { throw new Error('log also failed') },
  })
  assert.doesNotThrow(() => sendBadLog('opc:event', { ok: true }))
})

test('send uses the latest getMainWindow() result on every call', () => {
  // Simulates the main.cjs lifecycle: window is null, then created, then
  // destroyed. The accessor is invoked lazily on each call.
  let current = null
  const send = createSendChannel({ getMainWindow: () => current })

  // Pre-creation: no-op.
  send('opc:event', { phase: 'pre' })

  // Window created: message is delivered.
  const win = makeWindow()
  current = win
  send('opc:event', { phase: 'alive' })
  assert.equal(win.webContents._sent.length, 1)
  assert.equal(win.webContents._sent[0].payload.phase, 'alive')

  // Renderer torn down: subsequent calls are silent.
  current = makeWindow({ contentsDestroyed: true })
  send('opc:event', { phase: 'dead' })
  // The new window is independent — its send list is empty.
  assert.equal(current.webContents._sent.length, 0)
})
