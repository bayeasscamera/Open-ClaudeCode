const assert = require('node:assert/strict')
const test = require('node:test')
const {
  IPC_CONTRACT_ARGUMENT,
  createMainWindow,
  isSafeExternalUrl,
  preloadIpcContractArgument,
} = require('../electron/windowManager.cjs')

test('window manager only opens safe external URLs', () => {
  assert.equal(isSafeExternalUrl('https://example.com/docs'), true)
  assert.equal(isSafeExternalUrl('http://127.0.0.1:3000'), true)
  assert.equal(isSafeExternalUrl('http://localhost:3000'), true)
  assert.equal(isSafeExternalUrl('http://example.com/insecure'), false)
  assert.equal(isSafeExternalUrl('file:///tmp/secret.txt'), false)
})

test('window manager denies all renderer-created windows after optional external open', () => {
  const opened = []
  let handler = null
  class BrowserWindow {
    constructor(options) {
      this.options = options
      this.webContents = {
        setWindowOpenHandler: callback => {
          handler = callback
        },
      }
    }

    loadFile(file) {
      this.loadedFile = file
    }
  }

  createMainWindow({
    BrowserWindow,
    shell: { openExternal: url => opened.push(url) },
    preloadPath: '/tmp/preload.cjs',
    rendererPath: '/tmp/index.html',
  })

  assert.equal(handler({ url: 'https://example.com' }).action, 'deny')
  assert.equal(handler({ url: 'http://example.com' }).action, 'deny')
  assert.deepEqual(opened, ['https://example.com'])
})

test('window manager passes ipc contract to sandboxed preload', () => {
  const contract = {
    PRELOAD_INVOKE_METHODS: { health: 'opc:health' },
    PRELOAD_EVENT_METHODS: { onEvent: 'opc:event' },
  }
  const arg = preloadIpcContractArgument(contract)
  assert.match(arg, new RegExp(`^${IPC_CONTRACT_ARGUMENT}`))
  const payload = JSON.parse(decodeURIComponent(arg.slice(IPC_CONTRACT_ARGUMENT.length)))
  assert.deepEqual(payload, {
    invokeMethods: { health: 'opc:health' },
    eventMethods: { onEvent: 'opc:event' },
  })

  let createdOptions = null
  class BrowserWindow {
    constructor(options) {
      createdOptions = options
      this.webContents = { setWindowOpenHandler: () => {} }
    }

    loadFile() {}
  }

  createMainWindow({
    BrowserWindow,
    shell: { openExternal: () => {} },
    preloadPath: '/tmp/preload.cjs',
    rendererPath: '/tmp/index.html',
    preloadContract: contract,
  })

  assert.equal(createdOptions.webPreferences.sandbox, true)
  assert.deepEqual(createdOptions.webPreferences.additionalArguments, [arg])
})
