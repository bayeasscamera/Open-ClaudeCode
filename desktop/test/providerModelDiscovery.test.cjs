const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const { createProviderConfigStore } = require('../electron/providerConfig.cjs')
const { createProviderModelDiscovery, extractModels, modelListUrl } = require('../electron/providerModelDiscovery.cjs')

function fakeHttpModule({ statusCode = 200, payload = { data: [] }, capture = [] } = {}) {
  return {
    request: (url, options, onResponse) => {
      capture.push({ url: url.toString(), options })
      const req = new EventEmitter()
      req.setTimeout = () => {}
      req.destroy = error => req.emit('error', error)
      req.end = () => {
        process.nextTick(() => {
          const res = new PassThrough()
          res.statusCode = statusCode
          onResponse(res)
          res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
        })
      }
      return req
    },
  }
}

test('provider model discovery extracts OpenAI-compatible model lists', () => {
  assert.deepEqual(extractModels({
    object: 'list',
    data: [
      { id: 'openprovider/poolside/laguna-m.1:free', owned_by: 'openprovider' },
      { id: 'openprovider/poolside/laguna-m.1:free' },
      'z-ai/glm-5.1',
    ],
  }).map(model => model.id), [
    'openprovider/poolside/laguna-m.1:free',
    'z-ai/glm-5.1',
  ])
})

test('provider model discovery resolves /models from a /v1 base URL', () => {
  const store = createProviderConfigStore({ configPath: () => path.join(os.tmpdir(), 'missing-opc-providers.json') })
  const url = modelListUrl(store, { baseUrl: 'https://openprovider.mimika.in/v1' })
  assert.equal(url.toString(), 'https://openprovider.mimika.in/v1/models')
})

test('provider model discovery imports discovered models from an existing profile', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-provider-discovery-'))
  const configPath = path.join(dir, 'providers.json')
  const store = createProviderConfigStore({ configPath: () => configPath })
  store.upsertProfile({
    label: 'OpenProvider Seed',
    model: 'openprovider/seed',
    providerName: 'OpenProvider',
    baseUrl: 'https://openprovider.mimika.in/v1',
    apiKey: 'secret-openprovider-token',
    capabilities: { tools: false, refine: true, thinking: true },
  })
  const capture = []
  const discovery = createProviderModelDiscovery({
    providerConfigStore: store,
    httpsModule: fakeHttpModule({
      capture,
      payload: {
        data: [
          { id: 'openprovider/poolside/laguna-m.1:free' },
          { id: 'openprovider/qwen/qwen3.6-plus:free' },
        ],
      },
    }),
  })

  const result = await discovery.discoverAndImport({ model: 'openprovider/seed' })
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  assert.equal(capture[0].url, 'https://openprovider.mimika.in/v1/models')
  assert.equal(capture[0].options.headers.Authorization, 'Bearer secret-openprovider-token')
  assert.equal(raw.profiles.find(profile => profile.model === 'openprovider/seed').apiKey, 'secret-openprovider-token')
  assert.equal(raw.profiles.some(profile => profile.model === 'openprovider/poolside/laguna-m.1:free'), true)
  const discoveredRaw = raw.profiles.find(profile => profile.model === 'openprovider/qwen/qwen3.6-plus:free')
  assert.equal(discoveredRaw.providerName, 'OpenProvider')
  assert.equal(discoveredRaw.authProfileId, 'openprovider/seed')
  assert.equal(discoveredRaw.apiKey, undefined)
  assert.equal(discoveredRaw.apiKeySecret, undefined)
  assert.equal(store.profileForModel('openprovider/qwen/qwen3.6-plus:free').apiKey, 'secret-openprovider-token')
  assert.equal(store.exportConfig().profiles.find(profile => profile.model === 'openprovider/qwen/qwen3.6-plus:free').apiKey, undefined)
})
