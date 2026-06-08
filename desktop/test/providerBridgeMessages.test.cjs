const assert = require('node:assert/strict')
const test = require('node:test')
const {
  anthropicTextMessagePayload,
  buildAnthropicRequest,
  buildGitLabCodeSuggestionsRequest,
  buildOpenAIRequest,
  gitLabCodeSuggestionsText,
} = require('../electron/providerBridgeMessages.cjs')
const { createProviderReasoningStore } = require('../electron/providerReasoningStore.cjs')

function providerConfig() {
  return {
    capabilities: () => ({ tools: true, toolChoice: true, temperature: true }),
    extraBody: () => ({ top_p: 0.9 }),
    maxTokens: (_profile, requested) => requested || 4096,
    withSystemPrefix: messages => [{ role: 'system', content: 'OPC prefix' }, ...messages],
  }
}

test('provider bridge messages builds OpenAI-compatible requests', () => {
  const request = buildOpenAIRequest({
    max_tokens: 128,
    temperature: 0.2,
    stream: true,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Réponds OK' }] }],
    tools: [{
      name: 'read_file',
      description: 'Lire un fichier',
      input_schema: { type: 'object', properties: { path: { type: 'string' } } },
    }],
    tool_choice: { type: 'tool', name: 'read_file' },
  }, { model: 'mock/model' }, providerConfig())

  assert.equal(request.model, 'mock/model')
  assert.equal(request.max_tokens, 128)
  assert.equal(request.stream, true)
  assert.equal(request.top_p, 0.9)
  assert.deepEqual(request.messages, [
    { role: 'system', content: 'OPC prefix' },
    { role: 'user', content: 'Réponds OK' },
  ])
  assert.equal(request.tools[0].function.name, 'read_file')
  assert.deepEqual(request.tool_choice, { type: 'function', function: { name: 'read_file' } })
})

test('provider bridge messages keeps Anthropic tool results before the next user text', () => {
  const request = buildOpenAIRequest({
    max_tokens: 128,
    stream: true,
    messages: [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call_read',
          name: 'Read',
          input: { file_path: 'README.md' },
        }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_read', content: 'README content' },
          { type: 'text', text: 'Continue l’analyse.' },
        ],
      },
    ],
  }, { model: 'mock/model' }, providerConfig())

  assert.deepEqual(request.messages.slice(1), [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_read',
        type: 'function',
        function: {
          name: 'Read',
          arguments: JSON.stringify({ file_path: 'README.md' }),
        },
      }],
    },
    { role: 'tool', tool_call_id: 'call_read', content: 'README content' },
    { role: 'user', content: 'Continue l’analyse.' },
  ])
})

test('provider bridge messages converts orphan tool results to user transcript text', () => {
  const request = buildOpenAIRequest({
    max_tokens: 128,
    stream: true,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Analyse ce projet.' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_missing', content: 'sortie shell' }] },
    ],
  }, { model: 'mock/model' }, providerConfig())

  assert.deepEqual(request.messages.slice(1), [
    { role: 'user', content: 'Analyse ce projet.' },
    { role: 'user', content: '[Résultat outil call_missing]\nsortie shell' },
  ])
})

test('provider bridge messages can flatten tool history for providers that reject tool result roles', () => {
  const request = buildOpenAIRequest({
    max_tokens: 128,
    stream: true,
    messages: [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call_read',
          name: 'Read',
          input: { file_path: 'README.md' },
        }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_read', content: 'README content' },
          { type: 'text', text: 'Continue.' },
        ],
      },
    ],
    tools: [{
      name: 'Read',
      description: 'Read file',
      input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
    }],
  }, { model: 'mistralai/mistral-nemotron' }, {
    ...providerConfig(),
    capabilities: () => ({ tools: true, toolChoice: true, temperature: true, toolResultRole: false }),
  })

  assert.equal(request.messages.some(message => message.role === 'tool'), false)
  assert.equal(request.messages.some(message => Array.isArray(message.tool_calls)), false)
  assert.match(request.messages[1].content, /Appel outil demandé/)
  assert.match(request.messages[2].content, /Résultat outil call_read/)
  assert.equal(request.tools[0].function.name, 'Read')
})

test('provider bridge messages applies model capabilities and reasoning passthrough', () => {
  const reasoningStore = createProviderReasoningStore()
  const profile = { model: 'deepseek-v4-flash-free' }
  reasoningStore.record(profile, {
    toolCallIds: ['call_1'],
    reasoningContent: 'analyse privée précédente',
  })

  const request = buildOpenAIRequest({
    max_tokens: 128,
    temperature: 0.2,
    stream: true,
    messages: [{
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'call_1',
        name: 'Bash',
        input: { command: 'ls' },
      }],
    }],
    tools: [{
      name: 'Bash',
      description: 'Shell',
      input_schema: { type: 'object', properties: { command: { type: 'string' } } },
    }],
    tool_choice: { type: 'auto' },
  }, profile, {
    capabilities: () => ({
      tools: false,
      toolChoice: false,
      temperature: false,
      reasoningPassThrough: true,
    }),
    extraBody: () => ({}),
    maxTokens: (_item, requested) => requested || 4096,
    withSystemPrefix: messages => messages,
  }, { reasoningStore })

  assert.equal(request.temperature, undefined)
  assert.equal(request.tools, undefined)
  assert.equal(request.tool_choice, undefined)
  assert.equal(request.messages[0].tool_calls, undefined)
  assert.equal(request.messages[0].reasoning_content, 'analyse privée précédente')
})

test('provider bridge messages trims stale OpenAI history to provider input budget', () => {
  const oldContext = 'ancien contexte '.repeat(900)
  const latestPrompt = 'Dernière demande à préserver'
  const request = buildOpenAIRequest({
    max_tokens: 256,
    stream: true,
    messages: [
      { role: 'user', content: [{ type: 'text', text: oldContext }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ancienne réponse'.repeat(300) }] },
      { role: 'user', content: [{ type: 'text', text: latestPrompt }] },
    ],
  }, { model: 'gemma4:31b-cloud' }, {
    ...providerConfig(),
    maxInputTokens: () => 180,
  })

  const serialized = JSON.stringify(request.messages)
  assert.doesNotMatch(serialized, /ancien contexte/)
  assert.match(serialized, /contexte précédent tronqué/)
  assert.match(serialized, new RegExp(latestPrompt))
})

test('provider bridge messages builds Anthropic requests with profile system prefix', () => {
  const request = buildAnthropicRequest({
    max_tokens: 64,
    stream: true,
    system: [{ type: 'text', text: 'User system' }],
    messages: [{ role: 'user', content: 'OK' }],
  }, {
    model: 'anthropic/model',
    systemPrefix: 'OPC runtime guardrail',
  }, providerConfig(), { forceStream: false })

  assert.equal(request.model, 'anthropic/model')
  assert.equal(request.max_tokens, 64)
  assert.equal(request.stream, false)
  assert.equal(request.top_p, 0.9)
  assert.deepEqual(request.system, [
    { type: 'text', text: 'OPC runtime guardrail' },
    { type: 'text', text: 'User system' },
  ])
})

test('provider bridge messages builds GitLab Code Suggestions requests', () => {
  const request = buildGitLabCodeSuggestionsRequest({
    system: 'Règles OPC',
    messages: [
      { role: 'assistant', content: 'Contexte précédent' },
      { role: 'user', content: [{ type: 'text', text: 'Écris une fonction OK' }] },
    ],
  }, {
    model: 'gitlab/code-suggestions',
    projectPath: 'zolosene1/test',
  }, {
    extraBody: () => ({
      intent: 'generation',
      file_name: 'test.py',
      language_identifier: 'python',
    }),
  })

  assert.equal(request.intent, 'generation')
  assert.equal(request.stream, false)
  assert.equal(request.project_path, 'zolosene1/test')
  assert.equal(request.user_instruction, 'Écris une fonction OK')
  assert.deepEqual(request.current_file, {
    file_name: 'test.py',
    content_above_cursor: 'Règles OPC\n\nassistant:\nContexte précédent\n\nuser:\nÉcris une fonction OK',
    content_below_cursor: '',
  })
  assert.equal(request.language_identifier, 'python')
  assert.equal(gitLabCodeSuggestionsText({ choices: [{ text: 'def ok(): pass' }] }), 'def ok(): pass')
})

test('provider bridge messages creates Anthropic text response payloads', () => {
  const payload = anthropicTextMessagePayload('OK', 'mock/model')
  assert.equal(payload.type, 'message')
  assert.equal(payload.role, 'assistant')
  assert.equal(payload.model, 'mock/model')
  assert.deepEqual(payload.content, [{ type: 'text', text: 'OK' }])
  assert.equal(payload.stop_reason, 'end_turn')
})
