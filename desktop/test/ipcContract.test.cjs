const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  PRELOAD_EVENT_METHODS,
  PRELOAD_INVOKE_METHODS,
  validateIpcContract,
} = require('../electron/ipcContract.cjs')

test('ipc contract keeps invoke channels and preload methods in sync', () => {
  assert.equal(IPC_INVOKE_CHANNELS.length, new Set(IPC_INVOKE_CHANNELS).size)
  assert.equal(IPC_EVENT_CHANNELS.length, new Set(IPC_EVENT_CHANNELS).size)
  assert.deepEqual(Object.values(PRELOAD_INVOKE_METHODS).sort(), IPC_INVOKE_CHANNELS.slice().sort())
  assert.deepEqual(Object.values(PRELOAD_EVENT_METHODS).sort(), IPC_EVENT_CHANNELS.slice().sort())
  assert.equal(PRELOAD_INVOKE_METHODS.run, 'opc:run')
  assert.equal(PRELOAD_INVOKE_METHODS.saveState, 'opc:save-state')
  assert.equal(PRELOAD_EVENT_METHODS.onRuntime, 'opc:runtime')
})

test('preload uses the shared ipc contract manifest', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
  assert.match(preloadSource, /PRELOAD_INVOKE_METHODS/)
  assert.match(preloadSource, /PRELOAD_EVENT_METHODS/)
  assert.doesNotMatch(preloadSource, /require\(['"]\.\/ipcContract\.cjs['"]\)/)
})

// ── validateIpcContract (P34 — defense against tampered CLI args) ──────────

test('ipc contract: validateIpcContract accepts the canonical contract', () => {
  const validated = validateIpcContract({
    invokeMethods: { ...PRELOAD_INVOKE_METHODS },
    eventMethods: { ...PRELOAD_EVENT_METHODS },
  })
  assert.equal(validated.invokeMethods.run, 'opc:run')
  assert.equal(validated.eventMethods.onEvent, 'opc:event')
  // Defensive copy: mutating the input must not leak into the output.
  validated.invokeMethods.run = 'opc:tainted'
  assert.equal(PRELOAD_INVOKE_METHODS.run, 'opc:run')
})

test('ipc contract: validateIpcContract rejects an invoke channel outside the whitelist', () => {
  assert.throws(
    () => validateIpcContract({
      invokeMethods: { run: 'opc:run', rogue: 'opc:custom-evil-channel' },
      eventMethods: { onEvent: 'opc:event' },
    }),
    /canonical whitelist/,
  )
})

test('ipc contract: validateIpcContract rejects an event channel outside the whitelist', () => {
  assert.throws(
    () => validateIpcContract({
      invokeMethods: { run: 'opc:run' },
      eventMethods: { onEvil: 'opc:custom-evil-event' },
    }),
    /canonical whitelist/,
  )
})

test('ipc contract: validateIpcContract rejects non-object inputs', () => {
  assert.throws(() => validateIpcContract(null), /not an object/)
  assert.throws(() => validateIpcContract('contract'), /not an object/)
  assert.throws(() => validateIpcContract([]), /not an object/)
})

test('ipc contract: validateIpcContract rejects missing invokeMethods/eventMethods', () => {
  assert.throws(() => validateIpcContract({ eventMethods: {} }), /invokeMethods/)
  assert.throws(() => validateIpcContract({ invokeMethods: {} }), /eventMethods/)
})

test('ipc contract: validateIpcContract rejects non-string channel values', () => {
  assert.throws(
    () => validateIpcContract({
      invokeMethods: { run: 42 },
      eventMethods: {},
    }),
    /invoke method entry/,
  )
})

test('ipc contract: validateIpcContract rejects empty method keys (key collision bait)', () => {
  // An empty method key paired with a valid channel would otherwise pass the
  // channel check and expose an unnamed IPC method to the renderer.
  assert.throws(
    () => validateIpcContract({
      invokeMethods: { '': 'opc:run' },
      eventMethods: { onEvent: 'opc:event' },
    }),
    /invoke method entry/,
  )
})

