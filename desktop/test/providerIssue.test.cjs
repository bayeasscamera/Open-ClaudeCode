const assert = require('node:assert/strict')
const test = require('node:test')
const { classifyProviderIssue, isRateLimitedProviderIssue, providerIssueCode } = require('../electron/providerIssue.cjs')

test('provider issue classifier normalizes provider failures', () => {
  assert.equal(providerIssueCode('Missing API key'), 'needs_config')
  assert.equal(providerIssueCode('Unauthorized', 401), 'auth')
  assert.equal(providerIssueCode('quota exceeded'), 'rate_limited')
  assert.equal(providerIssueCode("Unsupported parameter(s): 'thinking'", 400), 'unsupported')
  assert.equal(providerIssueCode('ETIMEDOUT'), 'timeout')
  assert.equal(providerIssueCode('ECONNREFUSED'), 'network')
  assert.equal(providerIssueCode('Prompt is too long'), 'context_length')
  assert.equal(providerIssueCode('bad gateway', 502), 'server')
  assert.equal(providerIssueCode('bad request', 400), 'request')
})

test('provider issue classifier keeps public labels stable', () => {
  assert.deepEqual(classifyProviderIssue('quota exceeded'), {
    code: 'rate_limited',
    label: 'rate limit',
    detail: 'Quota ou limite provider atteint.',
  })
  assert.equal(isRateLimitedProviderIssue('too many requests'), true)
  assert.equal(isRateLimitedProviderIssue('timeout'), false)
})

test('provider issue classifier explains context length failures', () => {
  assert.deepEqual(classifyProviderIssue('maximum context length exceeded'), {
    code: 'context_length',
    label: 'contexte',
    detail: 'Prompt trop long pour la fenêtre du provider.',
  })
})
