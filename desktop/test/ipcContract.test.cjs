const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  PRELOAD_EVENT_METHODS,
  PRELOAD_INVOKE_METHODS,
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
