const assert = require('node:assert/strict')
const test = require('node:test')

const { sanitizedElectronEnv } = require('../scripts/electronEnv.cjs')

test('electron launcher environment removes ELECTRON_RUN_AS_NODE', () => {
  const previous = process.env.ELECTRON_RUN_AS_NODE
  process.env.ELECTRON_RUN_AS_NODE = '1'
  try {
    const env = sanitizedElectronEnv({ OPC_E2E_SMOKE: '1' })
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(env.OPC_E2E_SMOKE, '1')
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE
    else process.env.ELECTRON_RUN_AS_NODE = previous
  }
})
