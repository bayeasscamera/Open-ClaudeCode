const { assert, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

test('renderer settings controller normalizes patches and counts runtime state', () => {
  const { OPCSettingsController, OPCSettingsHelpers, OPCSettingsProviderPanel } = loadRendererModules()
  assert.equal(OPCSettingsHelpers.normalizeSettingsPatch, OPCSettingsController.normalizeSettingsPatch)
  assert.equal(typeof OPCSettingsProviderPanel.createSettingsProviderPanel, 'function')

  const patch = OPCSettingsController.normalizeSettingsPatch({
    cwd: "'/tmp/opc\u0000'",
    model: ' mock/model ',
    refineModel: ' custom/refiner ',
    permissionMode: 'unsafe',
    memoryEnabled: 1,
    thinkEnabled: 1,
    providerAutoRouterEnabled: 1,
    providerAutoRouterThreshold: '1',
    advancedPermissionStrictMode: 1,
    compactMode: 1,
    inspectorOpen: 0,
    textSize: 'large',
  }, {})

  assert.equal(patch.cwd, '/tmp/opc')
  assert.equal(patch.model, 'mock/model')
  assert.equal(patch.refineModel, 'custom/refiner')
  assert.equal(patch.permissionMode, 'acceptEdits')
  assert.equal(patch.memoryEnabled, true)
  assert.equal(patch.thinkEnabled, false)
  assert.equal(patch.providerAutoRouterEnabled, true)
  assert.equal(patch.providerAutoRouterThreshold, 1)
  assert.equal(patch.advancedPermissionStrictMode, true)
  assert.equal(patch.compactMode, true)
  assert.equal(patch.inspectorOpen, false)
  assert.equal(patch.textSize, 'large')

  const fallbackPatch = OPCSettingsController.normalizeSettingsPatch({ textSize: 'huge' }, { textSize: 'medium' })
  assert.equal(fallbackPatch.textSize, 'medium')

  const counts = OPCSettingsController.settingsCounts({
    chats: [{ id: 'a' }, { id: 'b' }],
    projects: [{ id: 'p' }],
    providerProfiles: [
      { model: 'ok', baseUrl: 'http://localhost:8317/v1', capabilities: { refine: true } },
      { model: 'bad', baseUrl: 'https://api.example.test/v1', capabilities: { refine: false } },
    ],
    providerChecks: {
      ok: { ok: true },
      bad: { ok: false, status: 'rate_limited' },
    },
  })

  assert.equal(counts.chats, 2)
  assert.equal(counts.projects, 1)
  assert.equal(counts.providers, 2)
  assert.equal(counts.agentProviders, 2)
  assert.equal(counts.refineProviders, 1)
  assert.equal(counts.localProviders, 1)
  assert.equal(counts.okProviders, 1)
  assert.equal(counts.errorProviders, 1)
  assert.equal(counts.rateLimitedProviders, 1)
})

test('renderer settings controller summarizes active project runtime', () => {
  const { OPCSettingsController } = loadRendererModules()
  const project = {
    id: 'p1',
    name: 'Research',
    description: 'recherche approfondie',
    runtime: {
      cwd: '/repo',
      model: 'mistral',
      permissionMode: 'bypassPermissions',
      memoryEnabled: true,
    },
    files: [{ id: 'f1' }],
    memory: 'Contexte durable.',
    instructions: 'Lire avant agir.',
  }
  const summary = OPCSettingsController.activeProjectSummary({ chats: [{ projectId: 'p1' }] }, {
    activeProject: () => project,
    chatCount: () => 1,
  })

  assert.equal(summary.name, 'Research')
  assert.equal(summary.chats, 1)
  assert.equal(summary.files, 1)
  assert.equal(summary.fileStats.total, 1)
  assert.equal(summary.memoryChars > 0, true)
  assert.equal(summary.instructionsChars > 0, true)
  assert.equal(summary.runtimeOverrides, 4)
  assert.equal(summary.runtime.some(item => item.includes('/repo')), true)
  assert.equal(summary.runtime.some(item => item.includes('Tout autoriser')), true)
})

test('renderer settings controller normalizes provider editor payloads', () => {
  const { OPCSettingsController } = loadRendererModules()
  const payload = OPCSettingsController.normalizeProviderEditorPayload({
    label: ' Local ',
    model: ' local/model ',
    providerName: ' Local Provider ',
    baseUrl: 'http://localhost:8317/v1',
    upstreamApi: 'gitlab',
    transport: 'buffered',
    timeoutMs: '300000',
    checkTimeoutMs: '15000',
    retries: '2',
    maxTokens: '8192',
    extraBody: '{"temperature":0}',
    noAuth: true,
    makeDefault: true,
    capabilities: {
      agent: true,
      system: true,
      streaming: false,
      tools: false,
      toolChoice: true,
      temperature: false,
      thinking: true,
      refine: false,
      reasoningPassThrough: true,
      reasoningExclude: false,
    },
  })

  assert.equal(payload.label, 'Local')
  assert.equal(payload.model, 'local/model')
  assert.equal(payload.providerName, 'Local Provider')
  assert.equal(payload.upstreamApi, 'gitlab-code-suggestions')
  assert.equal(payload.transport, 'buffered')
  assert.equal(payload.timeoutMs, 300000)
  assert.equal(payload.checkTimeoutMs, 15000)
  assert.equal(payload.retries, 2)
  assert.equal(payload.maxTokens, 8192)
  assert.equal(payload.extraBody.temperature, 0)
  assert.equal(payload.noAuth, true)
  assert.equal(payload.makeDefault, true)
  assert.equal(payload.capabilities.agent, true)
  assert.equal(payload.capabilities.streaming, false)
  assert.equal(payload.capabilities.tools, false)
  assert.equal(payload.capabilities.toolChoice, true)
  assert.equal(payload.capabilities.thinking, false)
  assert.equal(payload.capabilities.refine, false)
  assert.equal(payload.capabilities.reasoningPassThrough, true)
})

test('renderer settings search is accent-insensitive and token-based', () => {
  const { OPCSettingsController } = loadRendererModules()

  assert.equal(OPCSettingsController.normalizeSettingsSearch('  Mémoire   Durable  '), 'memoire durable')
  assert.deepEqual(Array.from(OPCSettingsController.settingsSearchTokens('provider timeout')), ['provider', 'timeout'])
  assert.equal(OPCSettingsController.settingsSearchMatches('Providers et modèles avec timeout', 'modele timeout'), true)
  assert.equal(OPCSettingsController.settingsSearchMatches('Projet actif et mémoire', 'provider'), false)
})
