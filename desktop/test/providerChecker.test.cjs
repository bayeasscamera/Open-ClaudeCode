const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const { createProviderChecker } = require('../electron/providerChecker.cjs')

function createProviderConfigStore(profile = {}) {
  const currentProfile = {
    model: 'mock/model',
    providerName: 'MockProvider',
    apiKey: 'key',
    ...profile,
  }
  return {
    reload: () => ({}),
    profileForModel: model => (model === currentProfile.model ? currentProfile : null),
    providerName: item => item.providerName,
    upstreamApi: item => item.upstreamApi || 'openai',
    shouldUseStreamingProviderCheck: item => Boolean(item.streamingCheck),
    requestTimeout: () => 5000,
    maxTokens: (_item, requested) => requested || 4096,
    extraBody: () => ({}),
  }
}

function createProviderClient({ statusCode = 200, payload = { choices: [{ message: { content: 'OK' } }] } } = {}) {
  const requests = []
  return {
    requests,
    request: (_profile, body, onResponse) => {
      requests.push(body)
      const upstream = new PassThrough()
      upstream.statusCode = statusCode
      process.nextTick(() => {
        onResponse(upstream)
        upstream.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
      })
      return { destroy: () => upstream.destroy() }
    },
  }
}

test('provider checker returns semantic success for exact OK response', async () => {
  const providerClient = createProviderClient()
  const checker = createProviderChecker({
    providerConfigStore: createProviderConfigStore(),
    providerClient,
  })

  const result = await checker.check('mock/model')
  assert.equal(result.ok, true)
  assert.equal(result.semanticOk, true)
  assert.equal(result.provider, 'MockProvider')
  assert.equal(providerClient.requests[0].max_tokens, 64)
})

test('provider checker supports Anthropic streaming provider profiles', async () => {
  const providerClient = createProviderClient({
    payload: [
      'event: message_start',
      `data: ${JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' }, index: 0 })}`,
      '',
      'event: message_stop',
      `data: ${JSON.stringify({ type: 'message_stop' })}`,
      '',
    ].join('\n'),
  })
  const checker = createProviderChecker({
    providerConfigStore: createProviderConfigStore({ upstreamApi: 'anthropic' }),
    providerClient,
  })

  const result = await checker.check('mock/model')
  assert.equal(result.ok, true)
  assert.equal(result.semanticOk, true)
  assert.equal(providerClient.requests[0].stream, true)
  assert.deepEqual(providerClient.requests[0].messages[0].content, [{ type: 'text', text: 'Réponds exactement OK.' }])
})

test('provider checker supports GitLab Code Suggestions profiles', async () => {
  const providerClient = createProviderClient({
    payload: { choices: [{ text: 'def print_ok():\\n    print("OK")' }] },
  })
  const checker = createProviderChecker({
    providerConfigStore: createProviderConfigStore({ upstreamApi: 'gitlab-code-suggestions' }),
    providerClient,
  })

  const result = await checker.check('mock/model')
  assert.equal(result.ok, true)
  assert.equal(result.semanticOk, false)
  assert.equal(providerClient.requests[0].current_file.file_name, 'opc_check.py')
  assert.equal(providerClient.requests[0].stream, false)
  assert.match(result.text, /print/)
})

test('provider checker supports OpenAI-compatible providers that require streaming checks', async () => {
  const providerClient = createProviderClient({
    payload: [
      'event: message_start',
      `data: ${JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })}`,
      '',
      'event: content_block_start',
      `data: ${JSON.stringify({ type: 'content_block_start', content_block: { type: 'thinking', thinking: '' }, index: 0 })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Analyse' }, index: 0 })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' }, index: 1 })}`,
      '',
      'event: message_stop',
      `data: ${JSON.stringify({ type: 'message_stop' })}`,
      '',
    ].join('\n'),
  })
  const checker = createProviderChecker({
    providerConfigStore: createProviderConfigStore({ streamingCheck: true }),
    providerClient,
  })

  const result = await checker.check('mock/model')
  assert.equal(result.ok, true)
  assert.equal(result.semanticOk, true)
  assert.equal(providerClient.requests[0].stream, true)
  assert.equal(providerClient.requests[0].max_tokens, 256)
})

test('provider checker reports missing or unauthenticated profiles', async () => {
  const providerClient = createProviderClient()
  const checker = createProviderChecker({
    providerConfigStore: createProviderConfigStore({ apiKey: '' }),
    providerClient,
  })

  assert.equal((await checker.check('missing/model')).error, 'Aucun profil provider trouvé.')
  const missingAuth = await checker.check('mock/model')
  assert.equal(missingAuth.error, 'Provider non configuré.')
  assert.equal(missingAuth.issue.code, 'needs_config')
})

test('provider checker classifies upstream HTTP errors', async () => {
  const checker = createProviderChecker({
    providerConfigStore: createProviderConfigStore(),
    providerClient: createProviderClient({
      statusCode: 502,
      payload: { error: { message: 'read ETIMEDOUT' } },
    }),
  })

  const result = await checker.check('mock/model')
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 502)
  assert.equal(result.error, 'read ETIMEDOUT')
  assert.equal(Boolean(result.issue), true)
  assert.equal(result.issue.code, 'timeout')
})

test('provider checker classifies unsupported parameter errors', async () => {
  const checker = createProviderChecker({
    providerConfigStore: createProviderConfigStore(),
    providerClient: createProviderClient({
      statusCode: 400,
      payload: { error: { message: "Validation: Unsupported parameter(s): 'thinking'" } },
    }),
  })

  const result = await checker.check('mock/model')
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.equal(result.issue.code, 'unsupported')
})
