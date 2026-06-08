const assert = require('node:assert/strict')
const test = require('node:test')
const { assertAppNotRunning } = require('../scripts/installApplications.cjs')

test('install script refuses to replace OPC while the installed app is running', () => {
  assert.doesNotThrow(() => assertAppNotRunning({ pids: [] }))
  assert.throws(
    () => assertAppNotRunning({ pids: ['12345', '67890'] }),
    /OPC est en cours d'exécution.*12345, 67890/,
  )
})
