const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const { createPromptRefiner } = require('../electron/promptRefiner.cjs')

function createProviderConfigStore(profile = {}) {
  const currentProfile = {
    id: 'qwen/qwen3.5-122b-a10b',
    label: 'Qwen3.5-122b',
    model: 'qwen/qwen3.5-122b-a10b',
    providerName: 'MockProvider',
    apiKey: 'key',
    ...profile,
  }
  return {
    reload: () => ({ profiles: [currentProfile] }),
    profileForModel: model => (model === currentProfile.model || model === currentProfile.id ? currentProfile : null),
    providerName: item => item.providerName,
    upstreamApi: item => item.upstreamApi || 'openai',
    requestTimeout: () => 5000,
    maxTokens: (_item, requested) => requested || 4096,
    extraBody: item => item.extraBody || {},
    capabilities: item => item.capabilities || { temperature: true },
    withSystemPrefix: messages => messages,
  }
}

function createProviderClient({ statusCode = 200, payload = { choices: [{ message: { content: 'Prompt raffiné: Analyse ce dépôt avec un plan clair.' } }] } } = {}) {
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

test('prompt refiner rewrites a draft through the qwen provider without sending chat runtime payloads', async () => {
  const providerClient = createProviderClient()
  const refiner = createPromptRefiner({
    providerConfigStore: createProviderConfigStore(),
    providerClient,
  })

  const result = await refiner.refine({ prompt: 'analyse repo', model: 'qwen/qwen3.5-122b-a10b' })
  assert.equal(result.ok, true)
  assert.equal(result.model, 'qwen/qwen3.5-122b-a10b')
  assert.equal(result.text, 'Analyse ce dépôt avec un plan clair.')
  assert.equal(providerClient.requests.length, 1)
  assert.equal(providerClient.requests[0].stream, false)
  assert.equal(providerClient.requests[0].messages[0].role, 'system')
  assert.match(providerClient.requests[0].messages[1].content, /analyse repo/)
})

test('prompt refiner strips unsupported thinking controls from refinement requests', async () => {
  const providerClient = createProviderClient()
  const refiner = createPromptRefiner({
    providerConfigStore: createProviderConfigStore({
      extraBody: {
        thinking: { enabled: true },
        chat_template_kwargs: { enable_thinking: true, keep: 'ok' },
        include_reasoning: true,
      },
    }),
    providerClient,
  })

  const result = await refiner.refine({ prompt: 'ameliore ça' })
  assert.equal(result.ok, true)
  assert.equal(providerClient.requests[0].thinking, undefined)
  assert.equal(providerClient.requests[0].include_reasoning, undefined)
  assert.deepEqual(providerClient.requests[0].chat_template_kwargs, { keep: 'ok' })
})

test('prompt refiner honors an explicit configured refinement model', async () => {
  const providerClient = createProviderClient()
  const refiner = createPromptRefiner({
    providerConfigStore: createProviderConfigStore({
      id: 'custom/refiner',
      label: 'Custom Refiner',
      model: 'custom/refiner',
    }),
    providerClient,
  })

  const result = await refiner.refine({ prompt: 'clarifie ce prompt', model: 'custom/refiner' })
  assert.equal(result.ok, true)
  assert.equal(result.model, 'custom/refiner')
  assert.equal(providerClient.requests[0].model, 'custom/refiner')
})

test('prompt refiner reports provider errors with issue classification', async () => {
  const refiner = createPromptRefiner({
    providerConfigStore: createProviderConfigStore(),
    providerClient: createProviderClient({
      statusCode: 400,
      payload: { error: { message: 'Unsupported parameter: thinking' } },
    }),
  })

  const result = await refiner.refine({ prompt: 'test' })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.equal(result.error, 'Unsupported parameter: thinking')
  assert.equal(Boolean(result.issue), true)
})
