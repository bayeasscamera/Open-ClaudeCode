const assert = require('node:assert/strict')
const test = require('node:test')
const { createProviderRequestState } = require('../electron/providerRequestState.cjs')

function providerConfig({ retryCount = 0, retryDelay = 1, retryable = true } = {}) {
  return {
    retryCount: () => retryCount,
    retryDelay: () => retryDelay,
    isRetryableFailure: () => retryable,
    failureText: (_profile, error, statusCode = 0) => `failed ${statusCode || ''} ${error?.message || error}`.trim(),
  }
}

function response() {
  return {
    headersSent: false,
    statusCode: 0,
    body: '',
    writeHead(code) {
      this.statusCode = code
      this.headersSent = true
    },
    end(body) {
      this.body = body
    },
  }
}

function collectStatus(target) {
  return (message, details = {}) => target.push({ message, ...details })
}

test('provider request state retries retryable failures before failing', async () => {
  const statuses = []
  const state = createProviderRequestState({
    profile: { model: 'mock/model' },
    providerConfig: providerConfig({ retryCount: 1, retryDelay: 1 }),
    providerStatus: collectStatus(statuses),
    waitStatusIntervalMs: 0,
    waitMessage: () => 'waiting',
  })
  const res = response()
  let attempts = 0
  function startAttempt() {
    attempts += 1
  }

  state.beginAttempt(() => 'attempt 1')
  assert.equal(state.scheduleRetry({
    error: new Error('temporary'),
    res,
    startAttempt,
    message: ({ attempt, maxRetries }) => `retry ${attempt}/${maxRetries}`,
  }), true)
  await new Promise(resolve => setTimeout(resolve, 5))

  assert.equal(attempts, 1)
  assert.equal(statuses.some(item => item.retryDelayMs === 1), true)
  assert.equal(state.snapshot().phase, 'retry_wait')
})

test('provider request state writes a normalized failure response', () => {
  const statuses = []
  const state = createProviderRequestState({
    profile: { model: 'mock/model' },
    providerConfig: providerConfig({ retryCount: 0, retryable: false }),
    providerStatus: collectStatus(statuses),
    waitStatusIntervalMs: 0,
    waitMessage: () => 'waiting',
  })
  const res = response()
  state.beginAttempt(() => 'attempt 1')
  state.failResponse(res, new Error('blocked'), 403)

  assert.equal(res.statusCode, 403)
  assert.match(res.body, /failed 403 blocked/)
  assert.equal(state.snapshot().phase, 'error')
  assert.equal(statuses.at(-1).statusCode, 403)
})

test('provider request state cancels active request and upstream on close', () => {
  const state = createProviderRequestState({
    profile: { model: 'mock/model' },
    providerConfig: providerConfig(),
    providerStatus: () => {},
    waitStatusIntervalMs: 0,
    waitMessage: () => 'waiting',
  })
  const destroyed = []
  state.setActiveRequest({ destroy: () => destroyed.push('request') })
  state.setActiveUpstream({ destroy: () => destroyed.push('upstream') })
  state.close()

  assert.deepEqual(destroyed, ['request', 'upstream'])
  assert.equal(state.snapshot().phase, 'closed')
})
