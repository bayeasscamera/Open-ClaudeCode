const assert = require('node:assert/strict')
const test = require('node:test')
const { installApplicationLifecycle } = require('../electron/appLifecycle.cjs')

function createAppHarness({ activeRun = false, platform = 'darwin' } = {}) {
  const calls = []
  const handlers = {}
  let childClose = null
  const app = {
    whenReady: () => Promise.resolve(),
    on: (event, handler) => {
      handlers[event] = handler
    },
    quit: () => calls.push(['quit']),
  }
  const cliRunner = {
    hasActiveRun: () => activeRun,
    activeChild: () => (activeRun ? { once: (_event, callback) => { childClose = callback } } : null),
    stop: () => calls.push(['stop']),
  }
  installApplicationLifecycle({
    app,
    BrowserWindow: { getAllWindows: () => [] },
    createWindow: () => calls.push(['createWindow']),
    startProviderBridge: async () => calls.push(['startProviderBridge']),
    closeProviderBridge: () => calls.push(['closeProviderBridge']),
    cliRunner,
    installApplicationMenu: () => calls.push(['installApplicationMenu']),
    log: message => calls.push(['log', message]),
    platform,
    setTimeoutFn: callback => calls.push(['timer', callback]),
  })
  return { calls, handlers, childClose: () => childClose }
}

test('application lifecycle installs menu, starts provider bridge and creates window on ready', async () => {
  const { calls, handlers } = createAppHarness()
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(calls.slice(0, 3).map(([name]) => name), ['installApplicationMenu', 'startProviderBridge', 'createWindow'])
  handlers.activate()
  assert.equal(calls.filter(([name]) => name === 'createWindow').length, 2)
})

test('application lifecycle stops active CLI run before quitting', () => {
  const { calls, handlers, childClose } = createAppHarness({ activeRun: true })
  let prevented = false
  handlers['before-quit']({ preventDefault: () => { prevented = true } })

  assert.equal(prevented, true)
  assert.equal(calls.some(([name]) => name === 'stop'), true)
  assert.equal(calls.some(([name]) => name === 'timer'), true)

  childClose()()
  assert.equal(calls.some(([name]) => name === 'closeProviderBridge'), true)
  assert.equal(calls.some(([name]) => name === 'quit'), true)
})

test('application lifecycle closes bridge on normal quit and quits non-mac windows', () => {
  const { calls, handlers } = createAppHarness({ activeRun: false, platform: 'linux' })
  handlers['before-quit']({ preventDefault: () => {} })
  handlers['window-all-closed']()

  assert.equal(calls.some(([name]) => name === 'closeProviderBridge'), true)
  assert.equal(calls.some(([name]) => name === 'quit'), true)
})
