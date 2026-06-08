const assert = require('node:assert/strict')
const test = require('node:test')
const {
  compactEvent,
  extractRunResult,
  textFromCliEvent,
} = require('../electron/cliEventParser.cjs')

test('cli event parser extracts visible text from CLI event shapes', () => {
  assert.equal(textFromCliEvent({ type: 'result', result: 'done' }), 'done')
  assert.equal(
    textFromCliEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
    'hello',
  )
  assert.equal(textFromCliEvent({ type: 'stdout', text: 'raw' }), 'raw')
  assert.equal(textFromCliEvent({ type: 'system' }), '')
})

test('cli event parser keeps the last structured run result', () => {
  const stdout = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'draft' }] } }),
    JSON.stringify({ type: 'result', result: 'final' }),
  ].join('\n')

  assert.equal(extractRunResult(stdout), 'final')
})

test('cli event parser compacts system init events before renderer forwarding', () => {
  const event = compactEvent({
    type: 'system',
    subtype: 'init',
    cwd: '/repo',
    session_id: 'session-1',
    model: 'mock/model',
    permissionMode: 'bypassPermissions',
    tools: ['Read'],
    large: 'ignored',
  })

  assert.equal(JSON.stringify(event), JSON.stringify({
    type: 'system',
    subtype: 'init',
    cwd: '/repo',
    session_id: 'session-1',
    model: 'mock/model',
    permissionMode: 'bypassPermissions',
    tools: ['Read'],
  }))
})
