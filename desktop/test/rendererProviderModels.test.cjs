const { assert, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

test('provider panel view model builds stable subtitles and sanitized copy payloads', () => {
  const { OPCProviderPanelViewModel } = loadRendererModules()
  const profile = {
    id: 'p1',
    label: 'Provider One',
    model: 'provider/model',
    providerName: 'Provider',
    baseUrl: '',
    apiKeySet: true,
    apiKeyPreview: 'secret',
    capabilities: { tools: false },
  }

  assert.equal(
    OPCProviderPanelViewModel.providerSubtitle(profile, 'provider/model'),
    'provider/model · Provider · agent · défaut',
  )
  assert.deepEqual(JSON.parse(JSON.stringify(OPCProviderPanelViewModel.providerCopyPayload(profile, { baseUrl: 'https://provider.test/v1' }))), {
    id: 'p1',
    label: 'Provider One',
    model: 'provider/model',
    providerName: 'Provider',
    baseUrl: 'https://provider.test/v1',
    upstreamApi: 'openai',
    transport: 'stream',
    timeoutMs: 300000,
    checkTimeoutMs: 60000,
    retries: 0,
    maxTokens: 4096,
    maxInputTokens: 0,
    contextWindowTokens: 0,
    noAuth: false,
    systemPrefix: '',
    extraBody: {},
    capabilities: { tools: false },
    apiKey: '',
  })
})

test('provider panel view model exposes provider auth and context budgets', () => {
  const { OPCProviderPanelViewModel } = loadRendererModules()
  const profile = {
    id: 'ollama',
    label: 'Ollama Small',
    model: 'gemma4:31b-cloud',
    providerName: 'Ollama',
    configured: false,
    contextWindowTokens: 8192,
    maxInputTokens: 6144,
    maxTokens: 2048,
    noAuth: false,
  }

  assert.equal(
    OPCProviderPanelViewModel.providerSubtitle(profile, ''),
    'gemma4:31b-cloud · Ollama · clé manquante · ctx 8192 · entrée 6144 · sortie 2048 · agent',
  )
  assert.deepEqual(JSON.parse(JSON.stringify(OPCProviderPanelViewModel.providerBudgetMeta(profile))), ['ctx 8192', 'entrée 6144', 'sortie 2048'])
  assert.equal(OPCProviderPanelViewModel.providerAuthLabel(profile), 'clé manquante')
  assert.deepEqual(JSON.parse(JSON.stringify(OPCProviderPanelViewModel.providerCopyPayload(profile))), {
    id: 'ollama',
    label: 'Ollama Small',
    model: 'gemma4:31b-cloud',
    providerName: 'Ollama',
    baseUrl: '',
    upstreamApi: 'openai',
    transport: 'stream',
    timeoutMs: 300000,
    checkTimeoutMs: 60000,
    retries: 0,
    maxTokens: 2048,
    maxInputTokens: 6144,
    contextWindowTokens: 8192,
    noAuth: false,
    systemPrefix: '',
    extraBody: {},
    capabilities: {},
  })
})

test('provider panel view model classifies provider groups without DOM', () => {
  const { OPCProviderPanelViewModel } = loadRendererModules()

  assert.equal(OPCProviderPanelViewModel.isSuggestionProfile({ upstreamApi: 'gitlab-code-suggestions' }), true)
  assert.equal(OPCProviderPanelViewModel.isSuggestionProfile({ upstreamApi: 'gitlab-code-suggestions', disabled: true }), false)
  assert.equal(OPCProviderPanelViewModel.isDisabledProfile({ quarantinedAt: 'now' }), true)
  assert.equal(OPCProviderPanelViewModel.profileHost({ baseUrl: 'https://api.example.test/v1' }), 'api.example.test')
  assert.equal(OPCProviderPanelViewModel.upstreamApiLabel('anthropic'), 'Anthropic')
})

test('provider panel view model builds delete model affordances', () => {
  const { OPCProviderPanelViewModel } = loadRendererModules()

  const profile = { label: 'Mistral Medium', model: 'mistralai/mistral-medium-3.5-128b' }

  assert.equal(OPCProviderPanelViewModel.deleteModelLabel(profile), 'Supprimer')
  assert.equal(
    OPCProviderPanelViewModel.deleteModelConfirmMessage(profile),
    'Supprimer le modèle "Mistral Medium" de OPC ?',
  )
})

test('provider editor model derives editable form state and payloads', () => {
  const { OPCProviderEditorModel } = loadRendererModules()

  const values = OPCProviderEditorModel.editorValuesForProfile({
    id: 'local',
    label: 'Local',
    model: 'local/model',
    apiKeySet: true,
    capabilities: { tools: false, toolChoice: true },
    extraBody: { top_p: 0.9 },
  }, {
    baseUrl: 'http://localhost:8317/v1',
    defaultModel: 'local/model',
  })

  assert.equal(values.title, 'Modifier Local')
  assert.equal(values.baseUrl, 'http://localhost:8317/v1')
  assert.equal(values.makeDefault, true)
  assert.equal(values.capabilities.tools, false)
  assert.equal(values.capabilities.toolChoice, true)
  assert.match(values.extraBodyText, /top_p/)

  const payload = OPCProviderEditorModel.buildProviderEditorPayload({
    id: 'local',
    model: 'local/model',
    noAuth: true,
    makeDefault: true,
    capabilities: { tools: false },
  }, item => ({ ...item, normalized: true }))

  assert.equal(payload.normalized, true)
  assert.equal(payload.noAuth, true)
  assert.equal(payload.makeDefault, true)
  assert.deepEqual(payload.capabilities, { tools: false })
})
