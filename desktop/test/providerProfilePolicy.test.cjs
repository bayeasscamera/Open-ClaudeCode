const assert = require('node:assert/strict')
const test = require('node:test')
const policy = require('../electron/providerProfilePolicy.cjs')

test('provider profile policy normalizes config and selects stable fallback profile', () => {
  const config = policy.normalizeProviderConfig({
    defaultModel: 'model/default',
    profiles: [
      { id: 'fast', model: 'model/fast' },
      { id: 'default', model: 'model/default' },
    ],
  })

  assert.equal(config.baseUrl, policy.DEFAULT_BASE_URL)
  assert.equal(policy.profileForModel(config, 'fast').model, 'model/fast')
  assert.equal(policy.profileForModel(config, 'missing').model, 'model/default')
})

test('provider profile policy ships only NVIDIA and Ollama default providers', () => {
  const config = policy.normalizeProviderConfig()
  const providerNames = new Set(config.profiles.map(profile => policy.providerName(profile)))
  const models = config.profiles.map(profile => profile.model)

  assert.deepEqual(Array.from(providerNames).sort(), ['NVIDIA', 'Ollama'])
  assert.equal(models.includes(policy.DEFAULT_FAST_MODEL), true)
  assert.equal(models.includes(policy.DEFAULT_OLLAMA_MODEL), true)
  assert.equal(policy.profileForModel(config, policy.DEFAULT_OLLAMA_MODEL).noAuth, true)
  assert.equal(policy.profileForModel(config, policy.DEFAULT_OLLAMA_MODEL).baseUrl, policy.OLLAMA_BASE_URL)
})

test('provider profile policy rewrites legacy OpenRouter host', () => {
  const profile = {
    model: 'baidu/cobuddy:free',
    baseUrl: 'https://api.openrouter.ai/api/v1/',
  }

  assert.equal(policy.normalizeBaseUrl(profile.baseUrl), 'https://openrouter.ai/api/v1')
  assert.equal(policy.baseUrl(profile, {}), 'https://openrouter.ai/api/v1')
})

test('provider profile policy never selects code suggestions as an agent default', () => {
  const config = policy.normalizeProviderConfig({
    defaultModel: 'gitlab/code-suggestions',
    profiles: [
      {
        id: 'gitlab',
        label: 'GitLab Code Suggestions',
        model: 'gitlab/code-suggestions',
        upstreamApi: 'gitlab-code-suggestions',
      },
      { id: 'agent', model: 'agent/model' },
    ],
  })

  assert.equal(config.defaultModel, 'agent/model')
  assert.equal(policy.defaultModelForProfiles('gitlab/code-suggestions', config.profiles), 'agent/model')
  assert.equal(policy.isAgentRunnable(config.profiles[0]), false)
  assert.equal(policy.isAgentRunnable(config.profiles[1]), true)
})

test('provider profile policy computes timeout retry and token limits', () => {
  assert.equal(policy.retryCount({ retries: 1 }), 1)
  assert.equal(policy.retryCount({ stream: false }), 0)
  assert.equal(policy.requestTimeout({ timeoutMs: 42 }), 5000)
  assert.equal(policy.requestTimeout({ timeoutMs: 120000 }), 120000)
  assert.equal(policy.requestTimeout({ transport: 'buffered' }), 300000)
  assert.equal(policy.providerCheckTimeout({}), 60000)
  assert.equal(policy.providerCheckTimeout({ checkTimeoutMs: 10000 }), 10000)
  assert.equal(policy.providerCheckTimeout({ checkTimeoutMs: 1000 }), 5000)
  assert.equal(policy.providerCheckTimeout({ checkTimeoutMs: 900000, timeoutMs: 300000 }), 300000)
  assert.equal(policy.maxTokens({ maxTokens: 32 }, 64), 32)
  assert.equal(policy.maxTokens({ maxTokens: 32 }), 32)
  assert.equal(policy.maxTokens({ providerName: 'Ollama', maxTokens: 16000 }), 2048)
  assert.equal(policy.contextWindowTokens({ providerName: 'Ollama' }), 8192)
  assert.equal(policy.maxInputTokens({ providerName: 'Ollama', maxInputTokens: 4096 }, 2048), 4096)
  assert.equal(policy.maxInputTokens({ providerName: 'Ollama' }, 2048), 6144)
  assert.equal(policy.upstreamApi({ upstreamApi: 'anthropic' }), 'anthropic')
  assert.equal(policy.upstreamApi({ upstreamApi: 'gitlab' }), 'gitlab-code-suggestions')
  assert.equal(policy.upstreamApi({ upstreamApi: 'unknown' }), 'openai')
  assert.equal(policy.shouldUseStreamingProviderCheck({ baseUrl: 'https://opencode.ai/zen/v1' }), true)
  assert.equal(policy.shouldUseStreamingProviderCheck({ baseUrl: 'https://opencode.ai/zen/v1', transport: 'buffered' }), false)
  assert.equal(policy.shouldUseStreamingProviderCheck({ baseUrl: 'https://api.example.test/v1' }), false)
  assert.equal(policy.isRetryableFailure(new Error('timeout'), 0), true)
  assert.equal(policy.isRetryableFailure(new Error('server unavailable'), 503), true)
  assert.equal(policy.isRetryableFailure(new Error('Rate limit exceeded. Please try again later.'), 429), false)
  assert.equal(policy.isRetryableFailure(new Error('quota exceeded'), 0), false)
})

test('provider profile policy strips OpenAI-compatible thinking controls by default', () => {
  assert.deepEqual(policy.extraBody({ model: 'deepseek-v4-flash-free' }), {
    include_reasoning: false,
    reasoning: { exclude: true },
  })
  assert.deepEqual(policy.extraBody({
    model: 'kimi-k2.6',
    extraBody: { top_p: 0.9, thinking: { budget_tokens: 0 }, chat_template_kwargs: { temperature: 0.1 } },
  }), {
    top_p: 0.9,
    chat_template_kwargs: { temperature: 0.1 },
  })
  assert.deepEqual(policy.extraBody({
    model: 'qwen/qwen3.5-122b-a10b',
    extraBody: {
      top_p: 0.9,
      thinking: { type: 'disabled' },
      chat_template_kwargs: { enable_thinking: false, temperature: 0.1 },
    },
  }), {
    top_p: 0.9,
    chat_template_kwargs: { temperature: 0.1 },
  })
  assert.deepEqual(policy.extraBody({ model: 'qwen', upstreamApi: 'anthropic' }), {})
  assert.deepEqual(policy.extraBody({ model: 'gitlab/code-suggestions', upstreamApi: 'gitlab-code-suggestions', extraBody: { intent: 'generation' } }), { intent: 'generation' })
  assert.deepEqual(policy.extraBody({
    model: 'custom',
    disableThinking: false,
    extraBody: { thinking: { type: 'enabled' }, chat_template_kwargs: { enable_thinking: true, keep: 'ok' } },
  }), {
    chat_template_kwargs: { keep: 'ok' },
  })
  assert.deepEqual(policy.extraBody({
    model: 'deepseek-v4-flash-free',
    baseUrl: 'https://opencode.ai/zen/v1',
    extraBody: {
      top_p: 0.9,
      thinking: { type: 'disabled' },
      chat_template_kwargs: { enable_thinking: false },
      include_reasoning: false,
      reasoning: { exclude: true },
    },
  }), { top_p: 0.9 })
})

test('provider profile policy exposes a capability matrix per model', () => {
  const deepseek = policy.capabilities({
    model: 'deepseek-v4-flash-free',
    baseUrl: 'https://opencode.ai/zen/v1',
  })
  assert.equal(deepseek.thinking, false)
  assert.equal(deepseek.reasoningPassThrough, true)
  assert.equal(deepseek.reasoningExclude, false)

  const openRouterDeepseek = policy.capabilities({
    model: 'deepseek/deepseek-v4-flash:free',
    baseUrl: 'https://openrouter.ai/api/v1',
  })
  assert.equal(openRouterDeepseek.reasoningPassThrough, true)
  assert.equal(openRouterDeepseek.reasoningExclude, true)

  const textOnly = policy.capabilities({
    model: 'legacy/text',
    capabilities: { tools: false, toolChoice: true, temperature: false },
  })
  assert.equal(textOnly.tools, false)
  assert.equal(textOnly.toolChoice, false)
  assert.equal(textOnly.temperature, false)

  const gitlab = policy.capabilities({
    model: 'gitlab/code-suggestions',
    upstreamApi: 'gitlab-code-suggestions',
    capabilities: { agent: true, tools: true, thinking: true, refine: true },
  })
  assert.equal(gitlab.agent, false)
  assert.equal(gitlab.system, false)
  assert.equal(gitlab.streaming, false)
  assert.equal(gitlab.tools, false)
  assert.equal(gitlab.toolChoice, false)
  assert.equal(gitlab.temperature, false)
  assert.equal(gitlab.thinking, false)
  assert.equal(gitlab.refine, false)
  assert.equal(policy.capabilityWarnings({ model: 'gitlab/code-suggestions', upstreamApi: 'gitlab-code-suggestions' }).includes('suggestions code uniquement'), true)

  const mistralNemotron = policy.capabilities({
    model: 'mistralai/mistral-nemotron',
    providerName: 'NVIDIA',
    upstreamApi: 'openai',
  })
  assert.equal(mistralNemotron.tools, true)
  assert.equal(mistralNemotron.toolResultRole, false)
  assert.equal(mistralNemotron.thinking, false)

  const explicitThinking = policy.capabilities({
    model: 'custom-thinking',
    disableThinking: false,
    capabilities: { thinking: true },
  })
  assert.equal(explicitThinking.thinking, false)
})

test('provider profile policy prefixes system messages and summarizes profiles', () => {
  const messages = policy.withSystemPrefix([{ role: 'user', content: 'hello' }], { systemPrefix: 'prefix' })
  assert.equal(JSON.stringify(messages), JSON.stringify([
    { role: 'system', content: 'prefix' },
    { role: 'user', content: 'hello' },
  ]))

  const summary = policy.profileSummary({
    id: 'local',
    label: 'Local',
    model: 'gpt',
    provider: 'Local',
    baseUrl: 'http://localhost:8317/v1',
    auth: false,
    transport: 'buffered',
  }, { baseUrl: policy.DEFAULT_BASE_URL })
  assert.equal(summary.providerName, 'Local')
  assert.equal(summary.upstreamApi, 'openai')
  assert.equal(summary.transport, 'buffered')
  assert.equal(summary.capabilities.streaming, false)
  assert.equal(summary.configured, true)

  const gitlabSummary = policy.profileSummary({
    id: 'gitlab',
    label: 'GitLab Code Suggestions',
    model: 'gitlab/code-suggestions',
    upstreamApi: 'gitlab-code-suggestions',
    apiKey: 'token',
  }, { baseUrl: policy.DEFAULT_BASE_URL })
  assert.equal(gitlabSummary.agentRunnable, false)
  assert.equal(gitlabSummary.usage, 'code-suggestions')
  assert.equal(gitlabSummary.capabilities.refine, false)
  assert.equal(gitlabSummary.capabilityWarnings.includes('raffinage indisponible'), true)

  const pausedSummary = policy.profileSummary({
    id: 'paused',
    label: 'Paused Provider',
    model: 'paused/model',
    provider: 'Provider',
    baseUrl: 'https://example.test/v1',
    apiKey: 'token',
    disabled: true,
    disabledReason: 'timeout',
  }, { baseUrl: policy.DEFAULT_BASE_URL })
  assert.equal(pausedSummary.agentRunnable, false)
  assert.equal(pausedSummary.usage, 'disabled')
  assert.equal(pausedSummary.disabled, true)
  assert.match(pausedSummary.disabledReason, /timeout/)
  assert.equal(pausedSummary.capabilityWarnings.includes('provider en pause'), true)
})

test('provider profile policy produces stable revisions without leaking secrets', () => {
  const base = {
    id: 'openprovider',
    label: 'OpenProvider',
    model: 'openprovider/model',
    providerName: 'OpenProvider',
    baseUrl: 'https://openprovider.test/v1',
    apiKey: 'secret-one',
    capabilities: { tools: true, thinking: true },
  }

  const first = policy.profileRevision(base)
  const sameSecretChange = policy.profileRevision({ ...base, apiKey: 'secret-two' })
  const changedEndpoint = policy.profileRevision({ ...base, baseUrl: 'https://other.test/v1' })

  assert.equal(first, sameSecretChange)
  assert.notEqual(first, changedEndpoint)
})
