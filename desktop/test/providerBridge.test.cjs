const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const { EventEmitter } = require('node:events')
const { createProviderBridge } = require('../electron/providerBridge.cjs')
const { createNvidiaClient } = require('../electron/nvidiaClient.cjs')

function createProviderConfig(overrides = {}) {
  const profile = {
    id: 'mock',
    label: 'Mock Model',
    model: 'mock/model',
    apiKey: 'test-key',
    ...overrides.profile,
  }
  return {
    load: () => ({ baseUrl: 'https://example.invalid/v1', defaultModel: profile.model, profiles: [profile] }),
    profiles: () => [{ id: profile.id, label: profile.label, model: profile.model }],
    profileForModel: () => profile,
    name: item => item.label || item.model,
    providerName: item => item.providerName || item.provider || 'NVIDIA',
    baseUrl: item => item.baseUrl || 'https://example.invalid/v1',
    shouldUseBufferedUpstream: item => item.stream === false,
    upstreamApi: item => item.upstreamApi || 'openai',
    retryCount: () => overrides.retryCount ?? 0,
    retryDelay: () => overrides.retryDelay ?? 1,
    requestTimeout: () => overrides.requestTimeout ?? 200000,
    maxTokens: (_item, requested) => requested || 4096,
    extraBody: () => ({}),
    withSystemPrefix: messages => messages,
    errorMessage: error => error?.message || String(error || 'erreur provider'),
    failureText: (item, error, statusCode = 0) => {
      const status = statusCode ? `HTTP ${statusCode}: ` : ''
      return `${item.label} (${item.model}) ne répond pas via NVIDIA: ${status}${error?.message || error}. Aucun autre modèle n'a été utilisé.`
    },
    isRetryableFailure: (_error, statusCode = 0) => statusCode >= 500,
  }
}

function createRetryThenSuccessClient({ buffered = false } = {}) {
  let calls = 0
  const bodies = []

  return {
    calls: () => calls,
    bodies: () => bodies,
    request: (_profile, body, onResponse) => {
      calls += 1
      bodies.push(body)
      const upstream = new PassThrough()
      upstream.statusCode = calls === 1 ? 502 : 200
      process.nextTick(() => {
        onResponse(upstream)
        if (upstream.statusCode >= 400) {
          upstream.end(JSON.stringify({ error: { message: 'temporary upstream failure' } }))
          return
        }
        if (!buffered && body.stream) {
          upstream.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\n`)
          upstream.end('data: [DONE]\n\n')
          return
        }
        upstream.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))
      })
      return { destroy: () => upstream.destroy() }
    },
    sendProviderError: (upstream, res) => {
      let raw = ''
      upstream.on('data', chunk => {
        raw += String(chunk)
      })
      upstream.on('end', () => {
        res.writeHead(upstream.statusCode || 502, { 'Content-Type': 'application/json' })
        res.end(raw)
      })
    },
  }
}

function createMockNvidiaClient() {
  function respond(body, onResponse) {
    const upstream = new PassThrough()
    upstream.statusCode = body.messages?.some(message => String(message.content || '').includes('upstream-fail')) ? 502 : 200
    process.nextTick(() => {
      onResponse(upstream)
      if (upstream.statusCode >= 400) {
        upstream.end(JSON.stringify({ error: { message: 'mock upstream failure' } }))
        return
      }
      if (body.stream) {
        upstream.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\n`)
        upstream.end('data: [DONE]\n\n')
        return
      }
      upstream.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))
    })
    return { destroy: () => upstream.destroy() }
  }

  return {
    request: (_profile, body, onResponse, _onError) => respond(body, onResponse),
    sendProviderError: (upstream, res) => {
      let raw = ''
      upstream.on('data', chunk => {
        raw += String(chunk)
      })
      upstream.on('end', () => {
        res.writeHead(upstream.statusCode || 502, { 'Content-Type': 'application/json' })
        res.end(raw)
      })
    },
  }
}

async function withBridge(fn, config = createProviderConfig(), nvidiaClient = createMockNvidiaClient()) {
  const events = []
  const bridge = createProviderBridge({
    providerConfig: config,
    nvidiaClient,
    log: message => events.push(message),
    sendStatus: event => events.push(event),
    waitStatusIntervalMs: 50,
  })
  const current = await bridge.start()
  try {
    return await fn({
      url: `http://127.0.0.1:${current.port}`,
      events,
      headers: { Authorization: `Bearer ${current.authToken}` },
    })
  } finally {
    bridge.close()
  }
}

test('provider bridge exposes configured models', async () => {
  await withBridge(async ({ url, headers }) => {
    const response = await fetch(`${url}/v1/models`, { headers })
    assert.equal(response.status, 200)
    const json = await response.json()
    assert.deepEqual(json.data, [{ id: 'mock/model', object: 'model' }])
  })
})

test('provider bridge returns the same instance for parallel starts', async () => {
  const bridge = createProviderBridge({
    providerConfig: createProviderConfig(),
    nvidiaClient: createMockNvidiaClient(),
    log: () => {},
    sendStatus: () => {},
  })

  const [first, second] = await Promise.all([bridge.start(), bridge.start()])
  try {
    assert.equal(first.port, second.port)
    assert.equal(first.authToken, second.authToken)
  } finally {
    bridge.close()
  }
})

test('provider bridge rejects unauthenticated local calls', async () => {
  await withBridge(async ({ url }) => {
    const response = await fetch(`${url}/v1/models`)
    assert.equal(response.status, 401)
    const json = await response.json()
    assert.equal(json.error.message, 'Unauthorized provider bridge request.')
  })
})

test('provider bridge converts non-stream OpenAI response to Anthropic message', async () => {
  await withBridge(async ({ url, headers }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock/model',
        max_tokens: 64,
        stream: false,
        messages: [{ role: 'user', content: 'Réponds OK' }],
      }),
    })
    assert.equal(response.status, 200)
    const json = await response.json()
    assert.equal(json.role, 'assistant')
    assert.equal(json.content[0].text, 'OK')
  })
})

test('provider bridge streams Anthropic SSE without using the real provider', async () => {
  await withBridge(async ({ url, headers }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock/model',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Réponds OK' }],
      }),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /event: message_start/)
    assert.match(text, /"text":"OK"/)
    assert.match(text, /event: message_stop/)
  })
})

test('provider bridge passes Anthropic upstream SSE through directly', async () => {
  const config = createProviderConfig({
    profile: {
      model: 'qwen3.6-plus-free',
      upstreamApi: 'anthropic',
      providerName: 'OpenCode',
    },
  })
  const client = {
    request: (_profile, body, onResponse) => {
      assert.equal(body.model, 'qwen3.6-plus-free')
      assert.equal(body.stream, true)
      assert.equal(body.messages[0].content, 'Réponds OK')
      const upstream = new PassThrough()
      upstream.statusCode = 200
      process.nextTick(() => {
        onResponse(upstream)
        upstream.write('event: message_start\\n')
        upstream.write(`data: ${JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })}\\n\\n`)
        upstream.write('event: content_block_delta\\n')
        upstream.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' }, index: 0 })}\\n\\n`)
        upstream.write('event: message_stop\\n')
        upstream.write(`data: ${JSON.stringify({ type: 'message_stop' })}\\n\\n`)
        upstream.end()
      })
      return { destroy: () => upstream.destroy() }
    },
    sendProviderError: createMockNvidiaClient().sendProviderError,
  }

  await withBridge(async ({ url, headers }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-plus-free',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Réponds OK' }],
      }),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /event: message_start/)
    assert.match(text, /"text":"OK"/)
    assert.match(text, /event: message_stop/)
  }, config, client)
})

test('provider bridge adapts GitLab Code Suggestions response to Anthropic streaming', async () => {
  const config = createProviderConfig({
    profile: {
      model: 'gitlab/code-suggestions',
      upstreamApi: 'gitlab-code-suggestions',
      providerName: 'GitLab',
      stream: false,
    },
  })
  const client = {
    request: (_profile, body, onResponse) => {
      assert.equal(body.stream, false)
      assert.equal(body.current_file.file_name, 'opc_request.py')
      assert.match(body.user_instruction, /Réponds OK/)
      const upstream = new PassThrough()
      upstream.statusCode = 200
      process.nextTick(() => {
        onResponse(upstream)
        upstream.end(JSON.stringify({ choices: [{ text: 'def ok():\\n    print("OK")' }] }))
      })
      return { destroy: () => upstream.destroy() }
    },
    sendProviderError: createMockNvidiaClient().sendProviderError,
  }

  await withBridge(async ({ url, headers }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gitlab/code-suggestions',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Réponds OK' }],
      }),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /event: message_start/)
    assert.match(text, /print/)
    assert.match(text, /event: message_stop/)
  }, config, client)
})

test('provider bridge adapts Anthropic-shaped SSE from OpenAI-compatible providers', async () => {
  const config = createProviderConfig({
    profile: {
      model: 'qwen3.6-plus-free',
      providerName: 'OpenCode',
      baseUrl: 'https://opencode.ai/zen/v1',
    },
  })
  const client = {
    request: (_profile, body, onResponse) => {
      assert.equal(body.model, 'qwen3.6-plus-free')
      assert.equal(body.stream, true)
      const upstream = new PassThrough()
      upstream.statusCode = 200
      process.nextTick(() => {
        onResponse(upstream)
        upstream.write('event: message_start\n')
        upstream.write(`data: ${JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })}\n\n`)
        upstream.write('event: content_block_start\n')
        upstream.write(`data: ${JSON.stringify({ type: 'content_block_start', content_block: { type: 'thinking', thinking: '' }, index: 0 })}\n\n`)
        upstream.write('event: content_block_delta\n')
        upstream.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Analyse privee' }, index: 0 })}\n\n`)
        upstream.write('event: content_block_delta\n')
        upstream.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' }, index: 1 })}\n\n`)
        upstream.write('event: message_stop\n')
        upstream.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
        upstream.end()
      })
      return { destroy: () => upstream.destroy() }
    },
    sendProviderError: createMockNvidiaClient().sendProviderError,
  }

  await withBridge(async ({ url, headers }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-plus-free',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Réponds OK' }],
      }),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /"text":"OK"/)
    assert.doesNotMatch(text, /Analyse privee/)
    assert.match(text, /event: message_stop/)
  }, config, client)
})

test('provider bridge retries retryable streaming failures on the selected model', async () => {
  const config = createProviderConfig({ retryCount: 1, retryDelay: 1 })
  const client = createRetryThenSuccessClient()
  await withBridge(async ({ url, headers, events }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock/model',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Réponds OK' }],
      }),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /"text":"OK"/)
    assert.equal(client.calls(), 2)
    assert.equal(events.some(event => event?.retryDelayMs === 1 && /Nouvel essai/.test(event.message)), true)
  }, config, client)
})

test('provider bridge retries retryable buffered failures on the selected model', async () => {
  const config = createProviderConfig({ retryCount: 1, retryDelay: 1, profile: { stream: false } })
  const client = createRetryThenSuccessClient({ buffered: true })
  await withBridge(async ({ url, headers, events }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock/model',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Réponds OK' }],
      }),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /"text":"OK"/)
    assert.equal(client.calls(), 2)
    assert.equal(client.bodies()[1].stream, false)
    assert.equal(events.some(event => event?.retryDelayMs === 1 && /Nouvel essai/.test(event.message)), true)
  }, config, client)
})

test('provider bridge surfaces upstream errors', async () => {
  await withBridge(async ({ url, headers }) => {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock/model',
        max_tokens: 64,
        stream: false,
        messages: [{ role: 'user', content: 'upstream-fail' }],
      }),
    })
    assert.equal(response.status, 502)
    const json = await response.json()
    assert.equal(json.error.message, 'mock upstream failure')
  })
})

test('provider bridge normalizes upstream string errors', async () => {
  const config = createProviderConfig()
  const realClient = createNvidiaClient({ providerConfig: config })
  const client = {
    request: (_profile, _body, onResponse) => {
      const upstream = new PassThrough()
      upstream.statusCode = 403
      process.nextTick(() => {
        onResponse(upstream)
        upstream.end(JSON.stringify({ error: 'subscription required' }))
      })
      return { destroy: () => upstream.destroy() }
    },
    sendProviderError: realClient.sendProviderError,
  }

  await withBridge(
    async ({ url, headers }) => {
      const response = await fetch(`${url}/v1/messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock/model',
          max_tokens: 64,
          stream: false,
          messages: [{ role: 'user', content: 'upstream-fail' }],
        }),
      })
      assert.equal(response.status, 403)
      const json = await response.json()
      assert.equal(json.error.message, 'subscription required')
    },
    config,
    client,
  )
})

test('provider client supports profile-specific OpenAI-compatible base URLs', () => {
  const requested = []
  const fakeRequest = new EventEmitter()
  fakeRequest.write = chunk => {
    fakeRequest.body = String(chunk)
  }
  fakeRequest.end = () => {}
  fakeRequest.setTimeout = () => {}
  fakeRequest.destroy = () => {}

  const client = createNvidiaClient({
    providerConfig: {
      baseUrl: profile => profile.baseUrl,
      providerName: profile => profile.providerName,
      requestTimeout: () => 200000,
    },
    httpsModule: {
      request: (url, options, onResponse) => {
        requested.push({ url: String(url), options, onResponse })
        return fakeRequest
      },
    },
  })

  client.request(
    {
      providerName: 'Cloudflare',
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1',
      apiKey: 'token',
    },
    { model: '@cf/moonshotai/kimi-k2.6', messages: [], stream: false },
    () => {},
    () => {},
  )

  assert.equal(requested[0].url, 'https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1/chat/completions')
  assert.equal(requested[0].options.headers.Authorization, 'Bearer token')
})

test('provider client can omit Authorization for local providers', () => {
  const requested = []
  const fakeRequest = new EventEmitter()
  fakeRequest.write = () => {}
  fakeRequest.end = () => {}
  fakeRequest.setTimeout = () => {}
  fakeRequest.destroy = () => {}

  const client = createNvidiaClient({
    providerConfig: {
      baseUrl: profile => profile.baseUrl,
      providerName: profile => profile.providerName,
      requestTimeout: () => 200000,
    },
    httpsModule: {
      request: () => {
        throw new Error('https should not be used for local http provider')
      },
    },
    httpModule: {
      request: (url, options) => {
        requested.push({ url: String(url), options })
        return fakeRequest
      },
    },
  })

  client.request(
    {
      providerName: 'Local',
      baseUrl: 'http://localhost:8317/v1',
      auth: false,
      noAuth: true,
    },
    { model: 'gpt-5.4-mini', messages: [], stream: false },
    () => {},
    () => {},
  )

  assert.equal(requested[0].url, 'http://localhost:8317/v1/chat/completions')
  assert.equal(Object.hasOwn(requested[0].options.headers, 'Authorization'), false)
})
