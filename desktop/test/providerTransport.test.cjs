const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const {
  anthropicMessagesUrl,
  chatCompletionsUrl,
  gitLabCodeSuggestionsUrl,
  providerRequestUrl,
  providerErrorMessage,
  requestHeaders,
  sendProviderError,
} = require('../electron/providerTransport.cjs')

test('provider transport builds chat completions URL and auth headers', () => {
  const providerConfig = { baseUrl: profile => profile.baseUrl }
  const profile = {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
  }
  const body = { stream: true }
  const payload = JSON.stringify(body)

  assert.equal(String(chatCompletionsUrl(providerConfig, profile)), 'https://api.example.test/v1/chat/completions')
  const headers = requestHeaders(profile, body, payload)
  assert.equal(headers.Accept, 'text/event-stream')
  assert.equal(headers.Authorization, 'Bearer secret')
})

test('provider transport builds GitLab Code Suggestions URL and token headers', () => {
  const providerConfig = {
    baseUrl: profile => profile.baseUrl,
    upstreamApi: () => 'gitlab-code-suggestions',
  }
  const profile = {
    baseUrl: 'https://gitlab.com/api/v4',
    apiKey: 'secret',
    upstreamApi: 'gitlab-code-suggestions',
  }
  const body = { stream: false }
  const payload = JSON.stringify(body)

  assert.equal(String(gitLabCodeSuggestionsUrl(providerConfig, profile)), 'https://gitlab.com/api/v4/code_suggestions/completions')
  assert.equal(String(providerRequestUrl(providerConfig, profile)), 'https://gitlab.com/api/v4/code_suggestions/completions')
  const headers = requestHeaders(profile, body, payload)
  assert.equal(headers.Accept, 'application/json')
  assert.equal(headers.Authorization, 'Bearer secret')
  assert.equal(headers['PRIVATE-TOKEN'], 'secret')
})

test('provider transport builds Anthropic messages URL and version header', () => {
  const providerConfig = {
    baseUrl: profile => profile.baseUrl,
    upstreamApi: () => 'anthropic',
  }
  const profile = {
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret',
    upstreamApi: 'anthropic',
  }
  const body = { stream: true }
  const payload = JSON.stringify(body)

  assert.equal(String(anthropicMessagesUrl(providerConfig, profile)), 'https://api.example.test/v1/messages')
  assert.equal(String(providerRequestUrl(providerConfig, profile)), 'https://api.example.test/v1/messages')
  const headers = requestHeaders(profile, body, payload)
  assert.equal(headers.Accept, 'text/event-stream')
  assert.equal(headers['anthropic-version'], '2023-06-01')
  assert.equal(headers.Authorization, 'Bearer secret')
})

test('provider transport omits auth and normalizes upstream errors', () => {
  const headers = requestHeaders({ apiKey: 'secret', auth: false }, { stream: false }, '{}')
  assert.equal(Object.hasOwn(headers, 'Authorization'), false)
  assert.equal(providerErrorMessage(JSON.stringify({ error: 'quota exceeded' }), 429), 'quota exceeded')
  assert.equal(providerErrorMessage('', 502), 'Provider request failed with HTTP 502.')
})

test('provider transport sends normalized JSON provider errors', async () => {
  const upstream = new PassThrough()
  upstream.statusCode = 403
  let responseBody = ''
  const res = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(value) {
      responseBody = value
      this.ended = true
    },
  }

  sendProviderError(upstream, res)
  upstream.end(JSON.stringify({ error: { message: 'subscription required' } }))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(res.status, 403)
  assert.equal(JSON.parse(responseBody).error.message, 'subscription required')
})
