const assert = require('node:assert/strict')
const test = require('node:test')
const { installProviderBridgeCspInterceptor } = require('../electron/cspInterceptor.cjs')

test('provider bridge CSP interceptor uses Electron defaultSession webRequest', () => {
  const calls = []
  const logs = []
  const electronSession = {
    defaultSession: {
      webRequest: {
        onHeadersReceived: handler => calls.push(handler),
      },
    },
  }

  const result = installProviderBridgeCspInterceptor({
    electronSession,
    providerBridge: { port: 49201 },
    log: message => logs.push(message),
  })

  assert.deepEqual(result, { installed: true, changed: true })
  assert.equal(calls.length, 1)
  assert.match(logs[0], /49201/)

  let callbackPayload = null
  calls[0]({
    responseHeaders: {
      'content-security-policy': ["default-src 'self'; connect-src http://127.0.0.1:*"],
    },
  }, payload => {
    callbackPayload = payload
  })

  assert.deepEqual(callbackPayload.responseHeaders['content-security-policy'], [
    "default-src 'self'; connect-src http://127.0.0.1:49201",
  ])
})

test('provider bridge CSP interceptor is best-effort when webRequest is unavailable', () => {
  const logs = []
  const result = installProviderBridgeCspInterceptor({
    electronSession: {},
    providerBridge: { port: 49201 },
    log: message => logs.push(message),
  })

  assert.deepEqual(result, { installed: false, changed: false, reason: 'web-request-unavailable' })
  assert.match(logs[0], /webRequest unavailable/)
})
