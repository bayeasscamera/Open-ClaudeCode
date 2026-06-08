const assert = require('node:assert/strict')
const test = require('node:test')
const { sandboxSwitchDecision } = require('../electron/electronSandboxPolicy.cjs')

test('electron sandbox policy allows no-sandbox only outside packaged builds', () => {
  assert.deepEqual(sandboxSwitchDecision({ disableSandboxEnv: '0', isPackaged: false }), {
    appendNoSandbox: false,
    warning: '',
  })
  assert.deepEqual(sandboxSwitchDecision({ disableSandboxEnv: '1', isPackaged: false }), {
    appendNoSandbox: true,
    warning: '',
  })
  assert.deepEqual(sandboxSwitchDecision({ disableSandboxEnv: '1', isPackaged: true }), {
    appendNoSandbox: false,
    warning: 'OPC_DISABLE_ELECTRON_SANDBOX ignored for packaged builds.',
  })
})
