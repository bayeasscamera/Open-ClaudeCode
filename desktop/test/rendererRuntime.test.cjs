const { assert, createStorage, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

test('renderer run controller computes session progress states', () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const serviceController = OPCServiceController.createServiceController({
    state: store.state,
    store,
    taskManager: OPCTaskManager,
    opc: {},
  })
  const controller = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController,
    chatController,
    opc: { run: async () => {}, stop: async () => false },
  })

  const queued = controller.sessionProgress({ status: 'queued', diagnostics: { queuedAt: Date.now() - 1000 } })
  assert.equal(queued.value, 8)
  assert.equal(queued.tone, 'pending')

  const running = controller.sessionProgress({
    status: 'running',
    tools: [{ name: 'Bash' }, { name: 'Edit' }],
    diagnostics: { startedAt: Date.now() - 2500, firstTextAt: Date.now() - 2000, toolCount: 2, eventCount: 120 },
  })
  assert.equal(running.tone, 'running')
  assert.equal(running.value > 44, true)
  assert.match(running.label, /2 outils/)

  const done = controller.sessionProgress({ status: 'done', diagnostics: { startedAt: Date.now() - 1000, durationMs: 1000 } })
  assert.equal(done.value, 100)
  assert.equal(done.tone, 'done')
})

test('renderer task manager tracks long-running server command metadata', () => {
  const { OPCTaskManager } = loadRendererModules()
  const tasks = []
  const assistant = {
    id: 'assistant-1',
    cwd: '/repo',
    tools: [{ id: 'tool-1', name: 'Bash', command: 'pnpm tools-dev run web' }],
  }
  const chat = { id: 'chat-1' }

  const [task] = OPCTaskManager.syncFromAssistant(tasks, assistant, chat)
  assert.equal(tasks.length, 1)
  assert.equal(task.command, 'pnpm tools-dev run web')
  assert.equal(task.services.length >= 2, true)
  assert.equal(task.services.some(service => service.port === 7456), true)
  assert.equal(task.services.some(service => service.port === 18000), true)

  OPCTaskManager.updateRelated(tasks, assistant, 'PID 4321\nLocal: http://localhost:18000\nlog /tmp/open-design.log\nready')
  assert.equal(task.pid, '4321')
  assert.equal(task.url, 'http://localhost:18000')
  assert.equal(task.logPath, '/tmp/open-design.log')
  assert.equal(task.status, 'running')
  assert.match(task.serviceSummary, /web/)
})

test('renderer task manager reuses a tracked long task for the same command and cwd', () => {
  const { OPCTaskManager } = loadRendererModules()
  const tasks = [
    {
      id: 'task-1',
      command: 'pnpm tools-dev start',
      cwd: '/repo',
      status: 'ready',
      startedAt: Date.now() - 1000,
      updatedAt: Date.now(),
      url: 'http://127.0.0.1:18000',
      services: [{ name: 'web', port: 18000, url: 'http://127.0.0.1:18000', ready: true }],
    },
  ]

  const reused = OPCTaskManager.findReusableTask(tasks, 'pnpm tools-dev start', '/repo')
  assert.equal(reused.id, 'task-1')

  const ensured = OPCTaskManager.ensureTask(tasks, {
    assistantId: 'assistant-2',
    chatId: 'chat-2',
    command: 'pnpm tools-dev start',
    cwd: '/repo',
  })
  assert.equal(ensured.id, 'task-1')
  assert.equal(tasks.length, 1)
})

test('renderer task manager applies probe results and marks services ready', () => {
  const { OPCTaskManager } = loadRendererModules()
  const tasks = [
    {
      id: 'task-1',
      command: 'pnpm tools-dev start',
      cwd: '/repo',
      status: 'observed',
      startedAt: Date.now() - 2000,
      updatedAt: Date.now(),
      services: [{ name: 'web', port: 18000, url: 'http://127.0.0.1:18000' }],
    },
  ]

  OPCTaskManager.applyProbeResult(tasks, {
    id: 'task-1',
    checkedAt: Date.now(),
    ready: true,
    services: [{ name: 'web', port: 18000, url: 'http://127.0.0.1:18000', ready: true, status: 'ready' }],
  })

  assert.equal(tasks[0].status, 'ready')
  assert.equal(tasks[0].services[0].ready, true)
  assert.match(tasks[0].serviceSummary, /pret/)
})

test('renderer provider health normalizes classified results', () => {
  const { OPCProviderHealth } = loadRendererModules()
  const check = OPCProviderHealth.resultFromCheck('model/a', {
    ok: false,
    error: 'quota exceeded',
    issue: { code: 'rate_limited', label: 'rate limit', detail: 'Quota atteint.' },
  })

  assert.equal(check.status, 'rate_limited')
  assert.equal(OPCProviderHealth.statusCategory(check), 'rate_limited')
  assert.match(OPCProviderHealth.statusLabel(check), /pause/)
  assert.match(OPCProviderHealth.title(check), /Quota atteint/)
  assert.equal(OPCProviderHealth.cooldownRemainingMs(check) > 0, true)

  const unsupported = OPCProviderHealth.resultFromCheck('model/b', {
    ok: false,
    statusCode: 400,
    error: "Unsupported parameter(s): 'thinking'",
  })
  assert.equal(OPCProviderHealth.statusCategory(unsupported), 'unsupported')
  assert.match(OPCProviderHealth.actionHint(unsupported), /Désactive/)
})

test('renderer provider health builds audit summaries', () => {
  const { OPCProviderHealth } = loadRendererModules()
  const checks = {
    ok: { model: 'ok', ok: true, latencyMs: 20 },
    limited: OPCProviderHealth.resultFromCheck('limited', {
      ok: false,
      statusCode: 429,
      error: 'Rate limit exceeded',
    }),
    unsupported: OPCProviderHealth.resultFromCheck('unsupported', {
      ok: false,
      statusCode: 400,
      error: "Unsupported parameter(s): 'thinking'",
    }),
  }
  const summary = OPCProviderHealth.auditSummary([
    { model: 'ok' },
    { model: 'limited' },
    { model: 'unsupported' },
    { model: 'pending' },
  ], checks)

  assert.equal(summary.total, 4)
  assert.equal(summary.ready, 1)
  assert.equal(summary.buckets.rate_limited, 1)
  assert.equal(summary.buckets.unsupported, 1)
  assert.equal(summary.buckets.pending, 1)
})

test('renderer provider health marks checks stale after profile revision changes', () => {
  const { OPCProviderHealth } = loadRendererModules()
  const check = OPCProviderHealth.resultFromCheck('model/a', {
    ok: true,
    latencyMs: 10,
    profileRevision: 'old-revision',
  })

  const current = OPCProviderHealth.checkForProfile({ model: 'model/a', revision: 'new-revision' }, { 'model/a': check })

  assert.equal(current.ok, false)
  assert.equal(current.status, 'stale')
  assert.equal(OPCProviderHealth.statusCategory(current), 'stale')
  assert.match(OPCProviderHealth.actionHint(current), /Reteste/)
})

test('renderer state store redacts secrets in persisted browser state', () => {
  const storage = createStorage()
  const { OPCState } = loadRendererModules({ window: { localStorage: storage } })
  const store = OPCState.createStateStore(storage)
  store.load()
  store.activeChat().messages.push({
    id: 'user-secret',
    role: 'user',
    content: 'access_token=glpat-secretSECRET1234567890',
    status: 'done',
  })

  store.save()
  const raw = storage.getItem('opc.desktop.state')

  assert.equal(raw.includes('glpat-secret'), false)
  assert.match(raw, /\[REDACTED\]/)
})

test('renderer provider preflight blocks active provider cooldowns', () => {
  const { OPCState, OPCProviderHealth, OPCProviderController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings.model = 'quota/model'
  store.state.providerProfiles = [{
    id: 'quota',
    label: 'Quota Model',
    model: 'quota/model',
    agentRunnable: true,
    capabilities: { thinking: false, refine: true, streaming: true, tools: true },
  }]
  store.state.providerChecks = {
    'quota/model': OPCProviderHealth.resultFromCheck('quota/model', {
      ok: false,
      error: 'Rate limit exceeded. Please try again later.',
      statusCode: 429,
      issue: { code: 'quota', label: 'quota', detail: 'Quota atteint.' },
    }),
  }
  const controller = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {},
  })

  const preflight = controller.preflightForModel('quota/model')

  assert.equal(preflight.ok, false)
  assert.match(preflight.error, /pause provider/)
})

test('renderer provider preflight blocks static config and fresh fatal provider checks', () => {
  const { OPCState, OPCProviderHealth, OPCProviderController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings.model = 'broken/model'
  store.state.providerProfiles = [{
    id: 'broken',
    label: 'Broken Model',
    model: 'broken/model',
    baseUrl: 'https://provider.test/v1',
    configured: false,
    agentRunnable: true,
    capabilities: { thinking: false, refine: true, streaming: true, tools: true },
  }]
  const controller = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {},
  })

  const configPreflight = controller.preflightForModel('broken/model')
  assert.equal(configPreflight.ok, false)
  assert.match(configPreflight.error, /mal configuré/)

  store.state.providerProfiles[0].configured = true
  store.state.providerChecks = {
    'broken/model': OPCProviderHealth.resultFromCheck('broken/model', {
      ok: false,
      statusCode: 400,
      error: "Unsupported parameter(s): 'thinking'",
    }),
  }
  const fatalPreflight = controller.preflightForModel('broken/model')
  assert.equal(fatalPreflight.ok, false)
  assert.match(fatalPreflight.error, /dernier test provider/)

  store.state.providerProfiles[0].revision = 'new-revision'
  store.state.providerChecks['broken/model'].profileRevision = 'old-revision'
  const configChangedPreflight = controller.preflightForModel('broken/model')
  assert.equal(configChangedPreflight.ok, true)

  store.state.providerChecks['broken/model'].checkedAt = Date.now() - (11 * 60 * 1000)
  const stalePreflight = controller.preflightForModel('broken/model')
  assert.equal(stalePreflight.ok, true)
})

test('renderer provider doctor summarizes blockers actions and fallback', () => {
  const { OPCState, OPCProviderHealth, OPCProviderController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings.model = 'small/model'
  store.state.providerProfiles = [
    {
      id: 'small',
      label: 'Small Model',
      model: 'small/model',
      baseUrl: 'https://provider.test/v1',
      configured: true,
      usage: 'agent',
      capabilities: { thinking: false, refine: true, streaming: true, tools: false },
      maxInputTokens: 2000,
    },
    {
      id: 'fallback',
      label: 'Fallback Model',
      model: 'fallback/model',
      baseUrl: 'https://provider.test/v1',
      configured: true,
      usage: 'agent',
      capabilities: { thinking: false, refine: true, streaming: true, tools: true },
      maxInputTokens: 64000,
    },
  ]
  store.state.providerChecks = {
    'small/model': OPCProviderHealth.resultFromCheck('small/model', {
      ok: false,
      statusCode: 400,
      error: 'Prompt is too long',
      issue: { code: 'context_length', label: 'contexte trop long', detail: 'Prompt trop long.' },
    }),
  }
  const controller = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {},
  })

  const summary = controller.providerDoctorSummary({
    model: 'small/model',
    requirements: { requireTools: true, minInputTokens: 32000 },
  })

  assert.equal(summary.status, 'error')
  assert.equal(summary.fallback.model, 'fallback/model')
  assert.equal(summary.issues.some(item => item.code === 'tools_missing'), true)
  assert.equal(summary.issues.some(item => item.code === 'context_insufficient'), true)
  assert.equal(summary.issues.some(item => item.code === 'fallback_available'), true)
  assert.equal(summary.actions.some(item => item.id === 'switch-provider' && item.model === 'fallback/model'), true)
  assert.equal(summary.actions.some(item => item.id === 'compact-context'), true)
  assert.equal(summary.contextPolicy.fallbackRecommended, true)
})

test('renderer chat controller owns session deletion and active assistant lookup', () => {
  const { OPCState, OPCChatController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  const firstChat = store.activeChat()
  const assistant = {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    status: 'running',
    diagnostics: { taskId: 'task-1' },
  }
  firstChat.messages.push(assistant)
  store.state.activeAssistantId = assistant.id
  const controller = OPCChatController.createChatController({
    state: store.state,
    store,
    confirm: () => true,
  })

  assert.equal(controller.assistantByTaskId('task-1').id, assistant.id)
  assert.equal(controller.chatForAssistant(assistant).id, firstChat.id)
  controller.createChat()
  assert.notEqual(store.activeChat().id, firstChat.id)
  assert.equal(controller.activeAssistant().id, assistant.id)
  store.state.running = true
  assert.equal(controller.renameChat(firstChat.id, 'Titre bloqué'), false)
  assert.equal(controller.toggleChatPinned(firstChat.id, true), false)
  assert.equal(controller.deleteChat(firstChat.id), false)
  store.state.running = false
  assert.equal(controller.renameChat(firstChat.id, 'Titre final'), true)
  assert.equal(firstChat.title, 'Titre final')
  assert.equal(controller.toggleChatPinned(firstChat.id, true), true)
  assert.equal(Boolean(firstChat.pinnedAt), true)
  assert.equal(controller.deleteChat(firstChat.id), true)
})

test('renderer provider controller refreshes health and selected model checks', async () => {
  const { OPCState, OPCProviderHealth, OPCProviderController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings.cwd = ''
  store.state.settings.model = 'gitlab/code-suggestions'
  const calls = []
  const controller = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {
      health: async () => ({
        ok: true,
        version: '2.1.88',
        projectRoot: '/repo',
        memory: { enabled: true },
        provider: {
          configError: 'Configuration provider illisible: bad json',
          defaultModel: 'mock/model',
          profiles: [
            { id: 'gitlab', label: 'GitLab Code Suggestions', model: 'gitlab/code-suggestions', agentRunnable: false },
            { id: 'paused', label: 'Paused Model', model: 'paused/model', agentRunnable: true, disabled: true, disabledReason: 'timeout' },
            { id: 'mock', label: 'Mock Model', model: 'mock/model', agentRunnable: true },
          ],
        },
      }),
      checkProvider: async payload => {
        calls.push(payload)
        return { ok: true, latencyMs: 12 }
      },
    },
  })

  await controller.refreshHealth()
  assert.equal(store.state.healthOk, true)
  assert.match(store.state.providerConfigError, /bad json/)
  assert.equal(store.state.settings.cwd, '/repo')
  assert.equal(store.state.settings.model, 'mock/model')
  assert.equal(controller.modelLabel('mock/model'), 'Mock Model')
  assert.equal(controller.modelLabel('gitlab/code-suggestions'), 'GitLab Code Suggestions')
  assert.deepEqual(controller.agentProfiles().map(profile => profile.model), ['mock/model'])
  assert.deepEqual(controller.suggestionProfiles().map(profile => profile.model), ['gitlab/code-suggestions'])
  assert.deepEqual(controller.disabledProfiles().map(profile => profile.model), ['paused/model'])
  assert.equal(controller.profileUsage({ agentRunnable: false }), 'code-suggestions')
  assert.equal(controller.profileUsage({ disabled: true, agentRunnable: true }), 'disabled')
  assert.equal(controller.capabilityLabel('mock/model'), 'agent + outils')
  assert.equal(controller.capabilityLabel('gitlab/code-suggestions'), 'chat seulement')
  assert.equal(controller.preflightForModel('gitlab/code-suggestions').ok, false)
  assert.match(controller.preflightForModel('gitlab/code-suggestions').error, /session agent CLI/)
  assert.equal(controller.preflightForModel('paused/model').ok, false)
  assert.match(controller.preflightForModel('paused/model').error, /pause/)
  store.state.providerProfiles.push({
    id: 'chat-only',
    label: 'Chat Only',
    model: 'chat-only/model',
    agentRunnable: true,
    capabilities: { tools: false, streaming: true, refine: true },
  })
  assert.equal(controller.preflightForModel('chat-only/model').ok, true)
  assert.equal(controller.preflightForModel('chat-only/model', { requireTools: true }).ok, false)
  assert.match(controller.preflightForModel('chat-only/model', { requireTools: true }).error, /outils CLI sont désactivés/)

  await controller.checkSelectedProvider()
  assert.equal(JSON.stringify(calls), JSON.stringify([{ model: 'mock/model' }]))
  assert.equal(controller.selectedProviderCheck().ok, true)
  const history = controller.providerHistory()
  assert.equal(history.length, 1)
  assert.equal(history[0].model, 'mock/model')
  assert.equal(history[0].label, 'Mock Model')
  assert.equal(history[0].category, 'ok')
  assert.equal(history[0].latencyMs, 12)
})

test('renderer completion guard relaunches action prompts that end without tools', () => {
  const { OPCCompletionGuard } = loadRendererModules()
  const decision = OPCCompletionGuard.evaluateCompletion({
    assistant: {
      content: "I'll apply the changes now. First, let me read the current file.",
      tools: [],
      diagnostics: { toolCount: 0 },
    },
    payload: { code: 0, reason: 'result' },
    activeTask: { payload: { actionPrompt: true } },
  })

  assert.equal(decision.shouldContinue, true)
  assert.equal(decision.reason, 'promised-action-without-tool')
})

test('renderer completion guard requires runtime tool evidence even when assistant says done', () => {
  const { OPCCompletionGuard } = loadRendererModules()
  const decision = OPCCompletionGuard.evaluateCompletion({
    assistant: {
      content: 'Terminé, les modifications sont appliquées.',
      tools: [],
      diagnostics: { toolCount: 0 },
    },
    payload: { code: 0, reason: 'result' },
    activeTask: {
      payload: {
        agentRuntimeProfile: {
          autoContinue: { requiresToolEvidence: true },
          requirements: { requireTools: true },
        },
      },
    },
  })

  assert.equal(decision.shouldContinue, true)
  assert.equal(decision.reason, 'step-execute-missing-tools')
  assert.equal(decision.phase, 'execute')
})

test('renderer completion guard requires runtime verification evidence after mutating tools', () => {
  const { OPCCompletionGuard } = loadRendererModules()
  const decision = OPCCompletionGuard.evaluateCompletion({
    assistant: {
      content: 'Modification terminée.',
      tools: [{ name: 'Edit', detail: 'Modification de fichier' }],
      diagnostics: { toolCount: 1 },
    },
    payload: { code: 0, reason: 'result', result: 'Modification terminée.' },
    activeTask: {
      payload: {
        displayPrompt: 'corrige le bug provider',
        agentRuntimeProfile: {
          autoContinue: { requiresVerificationEvidence: true },
          requirements: { requiresVerification: true },
        },
      },
    },
  })

  assert.equal(decision.shouldContinue, true)
  assert.equal(decision.reason, 'step-verify-missing-evidence')
  assert.equal(decision.phase, 'verify')
})

test('renderer completion guard relaunches French continuation promises without tools', () => {
  const { OPCCompletionGuard } = loadRendererModules()
  const samples = [
    "L'erreur indique que la limite de tokens de l'API a été atteinte. Je réduis la quantité de contexte envoyé en reprenant immédiatement l'action sur le fichier src/electron/libs/util.ts.",
    "Je continue l'application de la tâche P4 sur le fichier src/electron/libs/util.ts. L'objectif est de rendre la génération du titre non bloquante pour le processus principal.",
  ]

  for (const content of samples) {
    const decision = OPCCompletionGuard.evaluateCompletion({
      assistant: {
        content,
        tools: [],
        diagnostics: { toolCount: 0 },
      },
      payload: { code: 0, reason: 'result' },
      activeTask: { payload: { autoContinue: true } },
    })

    assert.equal(decision.shouldContinue, true)
    assert.equal(decision.reason, 'promised-action-without-tool')
  }
})

test('renderer run controller blocks action prompts on providers without tools', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCProviderController,
    OPCProviderHealth,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'chat-only/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
  }
  store.state.providerProfiles = [{
    id: 'chat-only',
    label: 'Chat Only',
    model: 'chat-only/model',
    agentRunnable: true,
    configured: true,
    capabilities: { tools: false, streaming: true, refine: true },
  }]
  let prompt = 'applique les modifications à lib.rs'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const providerController = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {},
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    providerController,
    projectController: {},
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()

  assert.equal(runPayloads.length, 0)
  const assistant = store.activeChat().messages.at(-1)
  assert.equal(assistant.status, 'error')
  assert.match(assistant.content, /outils CLI sont désactivés/)
  assert.equal(store.state.runtimeAudit.at(-1).kind, 'preflight')
  assert.equal(store.state.runtimeAudit.at(-1).status, 'error')
})

test('renderer provider controller audits providers and respects cooldowns', async () => {
  const { OPCState, OPCProviderHealth, OPCProviderController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings.model = 'quota/model'
  store.state.providerProfiles = [
    { id: 'quota', label: 'Quota Model', model: 'quota/model', agentRunnable: true },
    { id: 'ok', label: 'OK Model', model: 'ok/model', agentRunnable: true },
  ]
  store.state.providerChecks = {
    'quota/model': OPCProviderHealth.resultFromCheck('quota/model', {
      ok: false,
      statusCode: 429,
      error: 'Rate limit exceeded',
    }),
  }
  const calls = []
  const controller = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {
      checkProvider: async payload => {
        calls.push(payload.model)
        return { ok: true, latencyMs: 9 }
      },
    },
  })

  await controller.checkAllProviders()

  assert.deepEqual(calls, ['ok/model'])
  assert.equal(store.state.providerAudit.status, 'done')
  assert.equal(controller.providerAuditSummary().buckets.rate_limited, 1)
  assert.equal(controller.providerAuditSummary().ready, 1)
})

test('renderer provider controller repairs then retests only changed or failing providers', async () => {
  const { OPCState, OPCProviderHealth, OPCProviderController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings.model = 'quota/model'
  store.state.providerProfiles = [
    { id: 'quota', label: 'Quota Model', model: 'quota/model', agentRunnable: true },
    { id: 'ok', label: 'OK Model', model: 'ok/model', agentRunnable: true },
    { id: 'pending', label: 'Pending Model', model: 'pending/model', agentRunnable: true },
  ]
  store.state.providerChecks = {
    'quota/model': OPCProviderHealth.resultFromCheck('quota/model', {
      ok: false,
      statusCode: 429,
      error: 'Rate limit exceeded',
    }),
    'ok/model': { model: 'ok/model', ok: true, latencyMs: 12 },
  }
  const calls = []
  const controller = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {
      repairProviderConfig: async () => ({
        ok: true,
        repair: {
          repaired: true,
          count: 1,
          changes: [{ scope: 'profile', model: 'quota/model', field: 'baseUrl', message: 'Base URL canonisée.' }],
        },
        config: { profiles: [] },
      }),
      health: async () => ({
        ok: true,
        provider: {
          profiles: store.state.providerProfiles,
          defaultModel: 'quota/model',
        },
        projectRoot: '/repo',
      }),
      checkProvider: async payload => {
        calls.push(payload.model)
        return { ok: true, latencyMs: 9 }
      },
    },
  })

  const result = await controller.repairAndCheckProblemProviders({ force: true })

  assert.deepEqual(calls, ['quota/model'])
  assert.deepEqual(result.checkedModels, ['quota/model'])
  assert.equal(store.state.providerAudit.scope, 'problem')
  assert.equal(store.state.providerAudit.total, 1)
})

test('renderer run controller applies provider capability preflight before CLI payload', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCProviderHealth,
    OPCTaskManager,
    OPCChatController,
    OPCProviderController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'default',
    memoryEnabled: true,
    thinkEnabled: true,
  }
  store.state.providerProfiles = [{
    id: 'mock',
    label: 'Mock',
    model: 'mock/model',
    agentRunnable: true,
    capabilities: { thinking: false, refine: true, streaming: false, tools: true },
    capabilityWarnings: ['Think non supporté', 'streaming indisponible'],
  }]
  let prompt = 'analyse le repo'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const providerController = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: { health: async () => ({ ok: true }) },
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    providerController,
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()

  assert.equal(store.state.settings.thinkEnabled, false)
  assert.equal(runPayloads.length, 1)
  assert.equal(runPayloads[0].thinkEnabled, false)
  assert.equal(runPayloads[0].effort, '')
  assert.equal(runPayloads[0].providerCapabilityWarnings.includes('Think non supporté'), true)
  assert.match(runPayloads[0].prompt, /Mode Think OPC: inactif/)
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'preflight' &&
    entry.status === 'warning' &&
    /Think désactivé/.test(entry.detail)
  ), true)
})

test('renderer run controller refreshes stale provider snapshot before config preflight failure', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCProviderHealth,
    OPCTaskManager,
    OPCChatController,
    OPCProviderController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'llm7/GLM-4.6V-Flash',
    permissionMode: 'default',
    memoryEnabled: true,
    thinkEnabled: false,
  }
  store.state.providerProfiles = [{
    id: 'openprovider-glm',
    label: 'OpenProvider GLM 4.6V Flash',
    model: 'llm7/GLM-4.6V-Flash',
    configured: false,
    agentRunnable: true,
    capabilities: { thinking: false, refine: true, streaming: true, tools: true },
  }]
  let prompt = 'analyse le repo'
  let healthCalls = 0
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const providerController = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {
      health: async () => {
        healthCalls += 1
        return {
          ok: true,
          version: 'test',
          provider: {
            defaultModel: 'llm7/GLM-4.6V-Flash',
            profiles: [{
              id: 'openprovider-glm',
              label: 'OpenProvider GLM 4.6V Flash',
              model: 'llm7/GLM-4.6V-Flash',
              configured: true,
              agentRunnable: true,
              capabilities: { thinking: false, refine: true, streaming: true, tools: true },
            }],
          },
          memory: { enabled: true },
          projectRoot: '/repo',
        }
      },
    },
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    providerController,
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()

  assert.equal(healthCalls, 1)
  assert.equal(store.state.providerProfiles[0].configured, true)
  assert.equal(runPayloads.length, 1)
  assert.equal(runPayloads[0].model, 'llm7/GLM-4.6V-Flash')
  assert.equal(chatController.activeChat().messages.some(message => /mal configuré/.test(message.content || '')), false)
})

test('renderer service controller probes tracked services and stops by pid', async () => {
  const { OPCState, OPCTaskManager, OPCServiceController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.longTasks = [
    {
      id: 'task-1',
      command: 'pnpm tools-dev start',
      status: 'observed',
      pid: '1234',
      services: [{ name: 'web', port: 18000, url: 'http://127.0.0.1:18000' }],
    },
  ]
  const killed = []
  const controller = OPCServiceController.createServiceController({
    state: store.state,
    store,
    taskManager: OPCTaskManager,
    opc: {
      probeServices: async () => [
        {
          id: 'task-1',
          ready: true,
          services: [{ name: 'web', port: 18000, url: 'http://127.0.0.1:18000', ready: true }],
        },
      ],
      killPid: async payload => {
        killed.push(payload)
        return { ok: true }
      },
    },
  })

  assert.equal(controller.hasLiveLongTasks(), true)
  await controller.probeLongTasks(true)
  assert.equal(store.state.longTasks[0].status, 'ready')
  await controller.stopTrackedTask('task-1')
  assert.equal(JSON.stringify(killed), JSON.stringify([{
    pid: '1234',
    taskId: 'task-1',
    command: 'pnpm tools-dev start',
    cwd: '',
  }]))
  assert.equal(store.state.longTasks[0].status, 'stopped')
})

test('renderer run runtime state tracks snapshots and bounded audit', () => {
  const { OPCRunRuntimeState } = loadRendererModules()
  const state = {
    settings: { permissionMode: 'bypassPermissions' },
    runtimeAudit: [],
    companionJobs: [],
  }
  let running = null
  let inspectorChanges = 0
  const runtime = OPCRunRuntimeState.createRunRuntimeState({
    state,
    store: { makeId: prefix => `${prefix}-${state.runtimeAudit.length}` },
    getQueueLength: () => 2,
    onRunningChange: value => { running = value },
    onInspectorChange: () => { inspectorChanges += 1 },
    maxRuntimeAudit: 1,
  })

  runtime.setRuntime('running', { activeTaskId: 'task-1' })
  assert.equal(state.runtime.running, true)
  assert.equal(state.runtime.queueLength, 2)
  assert.equal(state.runtime.activeTaskId, 'task-1')

  runtime.setRunning(true)
  assert.equal(running, true)

  runtime.addRuntimeAudit('decision', { label: 'ok' })
  runtime.addRuntimeAudit('run-end', { label: 'done' })
  assert.equal(state.runtimeAudit.length, 1)
  assert.equal(state.runtimeAudit[0].kind, 'run-end')
  runtime.upsertCompanionJob('task-1', { title: 'Audit', status: 'running', summary: 'Bash actif' })
  runtime.upsertCompanionJob('task-1', { status: 'done', result: 'OK' })
  assert.equal(state.companionJobs.length, 1)
  assert.equal(state.companionJobs[0].status, 'done')
  assert.equal(state.companionJobs[0].summary, 'Bash actif')
  assert.equal(inspectorChanges, 4)
})

test('renderer runtime state mirrors execution phases into agent task ledger', () => {
  const { OPCRunRuntimeState } = loadRendererModules()
  const state = {
    settings: { permissionMode: 'acceptEdits' },
    runtimeAudit: [],
    companionJobs: [],
    agentTaskLedger: [],
  }
  let inspectorChanges = 0
  const runtime = OPCRunRuntimeState.createRunRuntimeState({
    state,
    store: { makeId: prefix => `${prefix}-${state.runtimeAudit.length}` },
    getQueueLength: () => 0,
    onInspectorChange: () => { inspectorChanges += 1 },
  })

  runtime.enqueueAgentTask({
    taskId: 'task-ledger-1',
    assistantId: 'assistant-1',
    chatId: 'chat-1',
    prompt: 'Implémenter le ledger',
    model: 'mock/model',
    cwd: '/repo/opc',
  })
  runtime.markAgentTaskRunning('task-ledger-1', { detail: 'Transmission au CLI' })
  runtime.recordAgentTaskTool('task-ledger-1', { tool: 'Bash', detail: 'npm test' })
  runtime.markAgentTaskDone('task-ledger-1', { verification: 'node --test', detail: 'tests OK' })

  assert.equal(state.agentTaskLedger.length, 1)
  assert.equal(state.agentTaskLedger[0].status, 'verified')
  assert.equal(state.agentTaskLedger[0].verification, 'node --test')
  assert.equal(JSON.stringify(state.agentTaskLedger[0].events.map(event => event.kind)), JSON.stringify(['queued', 'running', 'tool', 'verified']))
  assert.equal(state.agentWorkers.length, 1)
  assert.equal(state.agentWorkers[0].status, 'verified')
  assert.equal(state.agentWorkers[0].verification, 'node --test')
  assert.equal(inspectorChanges, 4)
})

test('renderer runtime state exposes targeted agent worker actions', () => {
  const { OPCRunRuntimeState, OPCAgentToolPlanner, OPCAgentTaskStepEngine } = loadRendererModules()
  const state = {
    settings: { permissionMode: 'acceptEdits' },
    runtimeAudit: [],
    companionJobs: [],
    agentTaskLedger: [],
    agentWorkers: [],
    taskCheckpoints: [],
  }
  const runtime = OPCRunRuntimeState.createRunRuntimeState({
    state,
    store: { makeId: prefix => `${prefix}-${state.runtimeAudit.length}` },
  })
  const toolPlan = OPCAgentToolPlanner.planForTask({
    prompt: 'corrige le worker visible puis teste',
    requirements: {
      category: 'code-change',
      requireTools: true,
      requiresFilesystemWrite: true,
      requiresVerification: true,
    },
  })

  runtime.enqueueAgentTask({
    taskId: 'task-worker-action',
    assistantId: 'assistant-worker-action',
    chatId: 'chat-worker-action',
    prompt: 'corrige le worker visible puis teste',
    model: 'mock/model',
    cwd: '/repo/opc',
    stepPlan: OPCAgentTaskStepEngine.createStepPlan({ toolPlan }),
  })
  runtime.markAgentTaskRunning('task-worker-action')
  runtime.recordAgentTaskTool('task-worker-action', { tool: 'Read', detail: 'Read inspectorView.js' })
  runtime.recordAgentTaskTool('task-worker-action', { tool: 'Edit', detail: 'patch failed', status: 'failed' })
  runtime.recordTaskCheckpoint('task-worker-action', {
    assistantId: 'assistant-worker-action',
    chatId: 'chat-worker-action',
    phase: 'correct',
    status: 'blocked',
    command: 'node --test desktop/test/rendererRunTaskModels.test.cjs',
    nextAction: 'reprendre depuis le worker',
  }, {
    phase: 'correct',
    status: 'blocked',
    tool: 'Edit',
    detail: 'patch failed',
  })

  const resume = runtime.resumeAgentWorker('task-worker-action')
  assert.match(resume.prompt, /Worker OPC: task-worker-action/)
  assert.match(resume.prompt, /patch failed/)
  assert.match(resume.prompt, /test minimal/i)
  const verify = runtime.verifyAgentWorker('task-worker-action')
  assert.match(verify.prompt, /vérification fraîche/i)
  assert.match(verify.prompt, /corrige le worker visible/)
  const interrupted = runtime.interruptAgentWorker('task-worker-action', { detail: 'Interruption ciblée' })
  assert.equal(interrupted.status, 'interrupted')
  assert.equal(state.agentWorkers[0].status, 'interrupted')
  assert.equal(state.agentTaskLedger[0].status, 'interrupted')
})

test('renderer run audit classifies command permission decisions', () => {
  const { OPCRunAudit } = loadRendererModules()

  const allowed = OPCRunAudit.commandDecisionAudit({
    permissionMode: 'bypassPermissions',
    taskId: 'task-1',
    assistantId: 'assistant-1',
    commandIntent: { command: 'pnpm tools-dev start', source: 'prompt', trusted: true },
    skipPermissions: true,
    permissionDecision: { reason: 'commande preautorisee' },
  })
  assert.equal(allowed.status, 'ok')
  assert.equal(allowed.command, 'pnpm tools-dev start')
  assert.equal(allowed.label, 'Tout autoriser demande')
  assert.equal(allowed.detail, 'commande preautorisee')

  const blocked = OPCRunAudit.commandDecisionAudit({
    permissionMode: 'bypassPermissions',
    commandIntent: { command: 'pnpm tools-dev start', source: 'prompt' },
    permissionDecision: { requestedBypass: true, workspaceTrusted: false, reason: 'workspace non approuve' },
  })
  assert.equal(blocked.status, 'warning')
  assert.equal(blocked.label, 'Workspace non approuve')
  assert.equal(blocked.detail, 'workspace non approuve')
})

test('renderer run request planner centralizes cwd, command and permission decisions', () => {
  const {
    OPCState,
    OPCConversation,
    OPCTaskManager,
    OPCProjectController,
    OPCRunRequestPlanner,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/Users/bayeasssene/Documents/ProjetsGithub/OPC',
    model: 'mock/model',
    permissionMode: 'bypassPermissions',
    memoryEnabled: true,
    thinkEnabled: false,
  }
  store.state.providerProfiles = [
    { model: 'mock/model', label: 'Mock Agent', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 12000 },
  ]
  const chat = store.activeChat()
  const project = store.createProject({ name: 'OPC', runtime: { cwd: '/Users/bayeasssene/Documents/ProjetsGithub/OPC' } })
  chat.projectId = project.id
  const projectController = OPCProjectController.createProjectController({ state: store.state, store })
  const planner = OPCRunRequestPlanner.createRunRequestPlanner({
    state: store.state,
    store,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    projectController,
  })

  const plan = planner.plan({
    chat,
    prompt: 'analyse /Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal',
  })

  assert.equal(plan.effectiveCwd, '/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal')
  assert.equal(plan.permissions.requestedBypass, true)
  assert.equal(plan.permissions.skipPermissions, false)
  assert.equal(plan.permissions.workspaceTrusted, false)
  assert.equal(plan.permissions.trustedWorkspaceRoot, '/Users/bayeasssene/Documents/ProjetsGithub/OPC')
  assert.equal(plan.permissions.reason, 'workspace non approuve')
  assert.equal(plan.projectRuntimeContext.runtime.cwd, '/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal')
  assert.equal(plan.agentRuntimeProfile.requirements.requireTools, true)
  assert.equal(plan.agentRuntimeProfile.diagnostics.selectedModel, 'mock/model')
  assert.match(plan.cliPrompt, /PROFIL RUNTIME AGENTIQUE OPC/)
  assert.match(plan.cliPrompt, /CIBLE EXPLICITE UTILISATEUR/)

  const insidePlan = planner.plan({
    chat,
    prompt: 'analyse /Users/bayeasssene/Documents/ProjetsGithub/OPC/packages/app',
  })
  assert.equal(insidePlan.effectiveCwd, '/Users/bayeasssene/Documents/ProjetsGithub/OPC/packages/app')
  assert.equal(insidePlan.permissions.workspaceTrusted, true)
  assert.equal(insidePlan.permissions.skipPermissions, true)
})

test('renderer run request planner applies advanced permissions without sandbox', () => {
  const {
    OPCState,
    OPCConversation,
    OPCTaskManager,
    OPCRunRequestPlanner,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'bypassPermissions',
    memoryEnabled: true,
    thinkEnabled: false,
  }
  const chat = store.activeChat()
  const planner = OPCRunRequestPlanner.createRunRequestPlanner({
    state: store.state,
    store,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    projectController: {},
  })

  const plan = planner.plan({
    chat,
    prompt: 'exécute rm -rf /tmp/nope',
  })

  assert.equal(plan.permissions.skipPermissions, false)
  assert.equal(plan.permissions.advanced.risk, 'critical')
  assert.equal(plan.permissions.advanced.categories.includes('delete'), true)
  assert.equal(plan.permissions.advanced.categories.includes('outside_workspace'), true)
  assert.equal(plan.allowedTools.includes('Bash(rm -rf /tmp/nope)'), false)
  assert.equal(plan.permissions.reason, 'permission avancee: action critique controlee')
})

test('renderer run controller blocks critical actions in strict advanced permission mode', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'bypassPermissions',
    advancedPermissionStrictMode: true,
    memoryEnabled: true,
  }
  let prompt = 'exécute rm -rf /tmp/nope'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const serviceController = OPCServiceController.createServiceController({
    state: store.state,
    store,
    taskManager: OPCTaskManager,
    opc: {},
  })
  const controller = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController,
    chatController,
    projectController: {},
    providerController: { preflightForModel: () => ({ ok: true, thinkEnabled: false }) },
    opc: { run: async payload => runPayloads.push(payload), stop: async () => false },
    getPrompt: () => prompt,
    setPrompt: value => { prompt = value },
  })

  await controller.sendPrompt()

  assert.equal(runPayloads.length, 0)
  const assistant = store.activeChat().messages.at(-1)
  assert.equal(assistant.status, 'error')
  assert.match(assistant.content, /Action critique bloquée/)
  assert.equal(store.state.runtimeAudit.some(entry => entry.kind === 'permission-blocked' && entry.status === 'error'), true)
})

test('renderer run controller queues prompts, streams events, and ends runs', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCProjectController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
  }
  let prompt = 'EXÉCUTE pnpm tools-dev run web'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const project = store.createProject({ name: 'Builds', memory: 'Tester les ports.', instructions: 'Donner le PID.' })
  store.addProjectFiles(project.id, [{
    name: 'runtime.md',
    path: '/repo/runtime.md',
    summary: 'Plan de ports et daemon.',
    searchIndex: 'ports daemon tools dev',
    indexedAt: '2026-05-14T00:00:00.000Z',
  }, {
    name: 'SKILL.md',
    path: '/repo/platform/skills/runtime-supervisor/SKILL.md',
    preview: '---\nname: runtime-supervisor\ndescription: Inspecte les processus longs. Use when a runtime blocks.\n---\n## Purpose\nSuperviser les serveurs.',
    indexedAt: '2026-05-14T00:00:00.000Z',
  }])
  const projectController = OPCProjectController.createProjectController({ state: store.state, store })
  const serviceController = OPCServiceController.createServiceController({
    state: store.state,
    store,
    taskManager: OPCTaskManager,
    opc: {},
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController,
    chatController,
    projectController,
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  assert.equal(prompt, '')
  assert.equal(runPayloads.length, 1)
  assert.equal(runPayloads[0].cwd, '/repo')
  assert.equal(runPayloads[0].projectId, project.id)
  assert.equal(runPayloads[0].projectRuntimeContext.totalFiles, 2)
  assert.equal(runPayloads[0].projectRuntimeContext.attachedFiles[0].path, '/repo/runtime.md')
  assert.equal(runPayloads[0].projectRuntimeContext.competenceProfile.skillCount, 1)
  assert.equal(runPayloads[0].commandIntent.command, 'pnpm tools-dev run web')
  assert.equal(runPayloads[0].commandIntent.source, 'prompt')
  assert.equal(runPayloads[0].commandIntent.skipPermissions, true)
  assert.equal(runPayloads[0].permissionDecision.skipPermissions, true)
  assert.equal(runPayloads[0].permissionDecision.workspaceTrusted, true)
  assert.equal(runPayloads[0].trustedWorkspaceRoot, '/repo')
  assert.equal(runPayloads[0].workspaceTrusted, true)
  assert.equal(runPayloads[0].permissionDecision.reason, 'commande preautorisee')
  assert.match(runPayloads[0].prompt, /PROJET OPC ACTIF/)
  assert.match(runPayloads[0].prompt, /COMPETENCES OPC INJECTEES/)
  assert.match(runPayloads[0].prompt, /Tester les ports/)
  assert.equal(runPayloads[0].skipPermissions, true)
  assert.equal(store.state.running, true)
  const assistant = store.activeAssistant()
  assert.equal(store.state.companionJobs[0].taskId, assistant.diagnostics.taskId)
  assert.equal(store.state.companionJobs[0].status, 'running')
  assert.equal(store.state.companionJobs[0].title, 'EXÉCUTE pnpm tools-dev run web')
  assert.equal(store.state.agentTaskLedger[0].id, assistant.diagnostics.taskId)
  assert.equal(store.state.agentTaskLedger[0].status, 'running')
  assert.equal(store.state.agentTaskLedger[0].command, 'pnpm tools-dev run web')
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'decision' &&
    entry.command === 'pnpm tools-dev run web' &&
    entry.skipPermissions === true &&
    entry.status === 'ok'
  ), true)
  assert.equal(assistant.status, 'running')
  assert.equal(assistant.projectRuntimeContext.projectName, 'Builds')
  assert.equal(runController.runtimeSnapshot().phase, 'running')
  assert.equal(runController.runtimeSnapshot().activeAssistantId, assistant.id)

  runController.onRunStart({
    taskId: assistant.diagnostics.taskId,
    pid: 4321,
    cwd: '/repo',
    model: 'mock/model',
    command: 'opc',
    skipPermissions: true,
    permissionMode: 'acceptEdits',
    commandIntent: runPayloads[0].commandIntent,
  })
  assert.equal(runController.runtimeSnapshot().activePid, 4321)
  assert.equal(store.state.companionJobs[0].pid, 4321)
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'run-started' &&
    entry.command === 'pnpm tools-dev run web' &&
    entry.skipPermissions === true
  ), true)
  runController.onRuntime({
    taskId: assistant.diagnostics.taskId,
    pid: 4321,
    phase: 'tool',
    phaseLabel: 'Outil actif',
    status: 'running',
    statusText: 'Bash: pnpm test',
    toolCount: 1,
    eventCount: 8,
    currentTool: { name: 'Bash', detail: 'Bash: pnpm test' },
    recentEvents: [{ type: 'tool', label: 'Bash', detail: 'Bash: pnpm test', at: Date.now() }],
  })
  assert.equal(assistant.focus, 'Bash: pnpm test')
  assert.equal(assistant.diagnostics.runtimePhase, 'tool')
  assert.equal(assistant.runtimeSteps.length, 1)
  assert.match(runController.sessionProgress(assistant).label, /pnpm test/)
  assert.equal(store.state.companionJobs[0].phase, 'tool')
  assert.equal(store.state.companionJobs[0].summary, 'Bash: pnpm test')
  assert.equal(store.state.agentTaskLedger[0].events.some(event => event.kind === 'tool' && /pnpm test/.test(event.detail)), true)
  runController.onCliEvent({ taskId: assistant.diagnostics.taskId, type: 'stream_event', event: { type: 'content_block_delta', delta: { text: 'OK, je vérifie le serveur.' } } })
  assert.equal(assistant.content, '')
  assert.match(assistant.focus, /Vérification|Analyse|serveur/i)
  runController.onCliEvent({ taskId: assistant.diagnostics.taskId, type: 'result', result: 'Serveur vérifié.', is_error: false })
  assert.equal(assistant.content, 'Serveur vérifié.')
  runController.onRunEnd({ taskId: assistant.diagnostics.taskId, code: 0, durationMs: 1000 })
  assert.equal(assistant.status, 'done')
  assert.equal(store.state.companionJobs[0].status, 'done')
  assert.match(store.state.companionJobs[0].result, /Serveur vérifié/)
  assert.equal(store.state.running, false)
  assert.equal(runController.runtimeSnapshot().phase, 'idle')
  assert.equal(runController.runtimeSnapshot().queueLength, 0)
  assert.equal(store.state.runtimeAudit.at(-1).kind, 'run-end')
  assert.equal(store.state.runtimeAudit.at(-1).status, 'ok')
  assert.equal(store.state.agentTaskLedger[0].status, 'verified')
  assert.equal(store.state.agentTaskLedger[0].verification, 'pnpm test')
  assert.equal(store.state.agentTaskLedger[0].result, 'Serveur vérifié.')
})

test('renderer run controller uses run-end result when stream closes without result event', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
  }
  let prompt = 'analyse le projet'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const serviceController = OPCServiceController.createServiceController({
    state: store.state,
    store,
    taskManager: OPCTaskManager,
    opc: {},
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController,
    chatController,
    projectController: {},
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  const assistant = store.activeAssistant()

  runController.onRunEnd({
    taskId: assistant.diagnostics.taskId,
    code: 0,
    durationMs: 1200,
    reason: 'close',
    result: 'Examinons les modules Rust restants.',
  })

  assert.equal(assistant.status, 'done')
  assert.equal(assistant.content, 'Examinons les modules Rust restants.')
})

test('renderer run controller auto-continues bounded continuation prompts', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
  }
  const chat = store.activeChat()
  chat.cliSessionId = 'session-1'
  let prompt = 'analyse le code et applique les corrections nécessaires'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  assert.equal(runPayloads.length, 1)
  const firstAssistant = store.activeAssistant()
  runController.onCliEvent({
    taskId: firstAssistant.diagnostics.taskId,
    type: 'result',
    result: 'Vérification réussie. Prochaine étape : analyser les autres modules. Veux-tu que je continue ?',
    is_error: false,
  })

  runController.onRunEnd({
    taskId: firstAssistant.diagnostics.taskId,
    code: 0,
    durationMs: 1800,
    reason: 'result',
  })

  assert.equal(runPayloads.length, 2)
  assert.equal(runPayloads[1].displayPrompt, 'continue')
  assert.equal(runPayloads[1].sessionId, 'session-1')
  assert.equal(runPayloads[1].cwd, '/repo')
  assert.equal(runPayloads[1].autoContinueCount, 1)
  assert.equal(store.state.running, true)
  assert.equal(runController.runtimeSnapshot().activeTaskId, runPayloads[1].taskId)
  assert.equal(store.activeAssistant().status, 'running')
  assert.equal(store.activeChat().messages.at(-2).role, 'user')
  assert.equal(store.activeChat().messages.at(-2).autoContinue, true)
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'auto-continue' &&
    entry.status === 'ok' &&
    entry.detail.includes('1/')
  ), true)
})

test('renderer run controller auto-continues promised actions that ended without tools', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
  }
  const chat = store.activeChat()
  chat.cliSessionId = 'session-1'
  let prompt = 'applique les modifications à lib.rs'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  const firstAssistant = store.activeAssistant()
  runController.onCliEvent({
    taskId: firstAssistant.diagnostics.taskId,
    type: 'result',
    result: "I'll apply the changes to lib.rs now. First, let me read the current file to see the exact content I need to modify:",
    is_error: false,
  })

  runController.onRunEnd({
    taskId: firstAssistant.diagnostics.taskId,
    code: 0,
    durationMs: 1200,
    reason: 'result',
  })

  assert.equal(runPayloads.length, 2)
  assert.equal(runPayloads[1].displayPrompt, 'continue')
  assert.equal(runPayloads[1].sessionId, 'session-1')
  assert.equal(runPayloads[1].autoContinueCount, 1)
  assert.equal(store.activeAssistant().autoContinue, true)
  assert.equal(store.state.running, true)
})

test('renderer run controller auto-continues mutating runs without verification evidence', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
  }
  const chat = store.activeChat()
  chat.cliSessionId = 'session-1'
  let prompt = 'corrige le bug provider dans util.ts'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  const firstAssistant = store.activeAssistant()
  firstAssistant.tools.push({ name: 'Edit', detail: 'Modification de fichier util.ts' })
  firstAssistant.diagnostics.toolCount = 1
  runController.onCliEvent({
    taskId: firstAssistant.diagnostics.taskId,
    type: 'result',
    result: 'Modification terminée.',
    is_error: false,
  })

  runController.onRunEnd({
    taskId: firstAssistant.diagnostics.taskId,
    code: 0,
    durationMs: 1300,
    reason: 'result',
  })

  assert.equal(runPayloads.length, 2)
  assert.equal(runPayloads[1].displayPrompt, 'continue')
  assert.match(runPayloads[1].prompt, /Phase OPC: verify/)
  assert.match(runPayloads[1].prompt, /Worker OPC:/)
  assert.match(runPayloads[1].prompt, /test minimal/i)
  assert.equal(runPayloads[1].autoContinueCount, 1)
  assert.equal(store.activeAssistant().autoContinue, true)
  assert.equal(store.state.running, true)
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'auto-continue' &&
    entry.source === 'step-verify-missing-evidence'
  ), true)
})

test('renderer run controller retries once without resume when CLI session is stale', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
  }
  const chat = store.activeChat()
  chat.cliSessionId = 'stale-session'
  let prompt = 'continue le diagnostic'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  assert.equal(runPayloads.length, 1)
  assert.equal(runPayloads[0].sessionId, 'stale-session')
  const assistant = store.activeAssistant()
  const firstTaskId = runPayloads[0].taskId

  runController.onCliEvent({
    taskId: firstTaskId,
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['No conversation found with session ID: stale-session'],
  })
  assert.equal(chat.cliSessionId, '')
  assert.equal(assistant.status, 'running')
  assert.match(assistant.content, /relance automatiquement/)
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'resume-recovery' &&
    entry.status === 'warning' &&
    entry.detail.includes('stale-session')
  ), true)

  runController.onRunEnd({
    taskId: firstTaskId,
    code: 1,
    durationMs: 0,
    reason: 'result',
    result: 'No conversation found with session ID: stale-session',
  })
  assert.equal(runPayloads.length, 2)
  assert.equal(runPayloads[1].sessionId, '')
  assert.equal(runPayloads[1].resumeRecoveryTried, true)
  assert.equal(runPayloads[1].previousSessionId, 'stale-session')
  assert.equal(assistant.status, 'running')
  assert.equal(assistant.content, '')
  assert.equal(assistant.diagnostics.taskId, runPayloads[1].taskId)
  assert.equal(runController.runtimeSnapshot().activeTaskId, runPayloads[1].taskId)

  runController.onCliEvent({
    taskId: runPayloads[1].taskId,
    type: 'system',
    subtype: 'init',
    model: 'mock/model',
    session_id: 'fresh-session',
  })
  assert.equal(chat.cliSessionId, 'fresh-session')
})

test('renderer run controller uses explicit analysis path as cwd and keeps Think globally disabled', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCProjectController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo/selected',
    model: 'mock/model',
    permissionMode: 'bypassPermissions',
    memoryEnabled: true,
    thinkEnabled: true,
  }
  let prompt = 'analyse /Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const project = store.createProject({
    name: 'OPC',
    runtime: { cwd: '/repo/selected', model: 'mock/model', permissionMode: 'bypassPermissions', memoryEnabled: true },
  })
  store.createChat({ projectId: project.id })
  const projectController = OPCProjectController.createProjectController({ state: store.state, store })
  const serviceController = OPCServiceController.createServiceController({
    state: store.state,
    store,
    taskManager: OPCTaskManager,
    opc: {},
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController,
    chatController,
    projectController,
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()

  assert.equal(runPayloads.length, 1)
  assert.equal(runPayloads[0].cwd, '/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal')
  assert.equal(runPayloads[0].skipPermissions, false)
  assert.equal(runPayloads[0].trustedWorkspaceRoot, '/repo/selected')
  assert.equal(runPayloads[0].permissionDecision.workspaceTrusted, false)
  assert.equal(runPayloads[0].permissionDecision.reason, 'workspace non approuve')
  assert.equal(runPayloads[0].effort, '')
  assert.equal(runPayloads[0].thinkEnabled, false)
  assert.equal(runPayloads[0].projectRuntimeContext.runtime.cwd, '/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal')
  assert.match(runPayloads[0].prompt, /CIBLE EXPLICITE UTILISATEUR/)
  assert.match(runPayloads[0].prompt, /Mode Think OPC: inactif/)
  assert.equal(store.activeAssistant().cwd, '/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal')
})

test('renderer run controller surfaces run-end stderr details', () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = { cwd: '/repo', model: 'mock/model', permissionMode: 'acceptEdits', memoryEnabled: true }
  const chat = store.activeChat()
  const assistant = {
    id: 'assistant-stderr',
    role: 'assistant',
    content: '',
    status: 'running',
    diagnostics: { taskId: 'task-stderr', startedAt: Date.now() - 1000 },
    events: [],
  }
  chat.messages.push(assistant)
  store.state.activeAssistantId = assistant.id
  store.state.running = true
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: { run: async () => {}, stop: async () => false },
  })

  runController.onRunEnd({
    taskId: 'task-stderr',
    code: 1,
    durationMs: 1200,
    reason: 'close',
    stderr: 'mock fatal: provider rejected unsupported parameter',
  })

  assert.equal(assistant.status, 'error')
  assert.match(assistant.content, /provider rejected unsupported parameter/)
  assert.match(runController.runtimeSnapshot().lastError, /provider rejected unsupported parameter/)
  assert.match(store.state.companionJobs[0].error, /provider rejected unsupported parameter/)
})

test('renderer run controller checkpoints failed tasks and recommends provider fallback after repeat failures', () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = { cwd: '/repo', model: 'bad/model', permissionMode: 'acceptEdits', memoryEnabled: true }
  store.state.providerProfiles = [
    { id: 'bad', label: 'Bad Model', model: 'bad/model', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 12000 },
    { id: 'fallback', label: 'Fallback Model', model: 'fallback/model', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 64000 },
  ]
  store.state.providerFailureHistory = [{
    id: 'failure-1',
    model: 'bad/model',
    reason: 'Prompt is too long',
    at: Date.now() - 1000,
  }]
  const chat = store.activeChat()
  const assistant = {
    id: 'assistant-fallback',
    role: 'assistant',
    content: '',
    status: 'running',
    model: 'bad/model',
    cwd: '/repo',
    diagnostics: { taskId: 'task-fallback', startedAt: Date.now() - 1000 },
    events: [],
  }
  chat.messages.push(assistant)
  store.state.activeAssistantId = assistant.id
  store.state.running = true
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: { run: async () => {}, stop: async () => false },
  })

  runController.onRunEnd({
    taskId: 'task-fallback',
    code: 124,
    durationMs: 304000,
    reason: 'idle-timeout',
    stderr: 'Aucune activité CLI depuis 304s.',
  })

  assert.equal(store.state.providerFailureHistory.length, 2)
  assert.equal(store.state.providerFailureHistory[0].model, 'bad/model')
  assert.equal(store.state.taskCheckpoints[0].id, 'task-fallback')
  assert.equal(store.state.taskCheckpoints[0].status, 'interrupted')
  assert.match(store.state.taskCheckpoints[0].nextAction, /reprendre/i)
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'provider-fallback' &&
    entry.status === 'warning' &&
    /Fallback Model/.test(entry.detail)
  ), true)
})

test('renderer run controller enriches continue prompts from the latest checkpoint', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = { cwd: '/repo', model: 'mock/model', permissionMode: 'acceptEdits', memoryEnabled: true }
  store.state.taskCheckpoints = [{
    id: 'task-checkpoint',
    assistantId: 'assistant-old',
    chatId: store.activeChat().id,
    model: 'mock/model',
    cwd: '/repo',
    prompt: 'corrige le provider',
    status: 'interrupted',
    phase: 'ended',
    error: 'idle-timeout',
    nextAction: 'reprendre la tâche depuis le dernier checkpoint',
    steps: [
      { phase: 'tool', status: 'tool', tool: 'Bash', command: 'pnpm test', detail: 'Bash: pnpm test' },
    ],
    updatedAt: Date.now(),
  }]
  let prompt = 'continue'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: {
      run: async payload => runPayloads.push(payload),
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()

  assert.equal(runPayloads.length, 1)
  assert.match(runPayloads[0].prompt, /CHECKPOINT OPC/)
  assert.match(runPayloads[0].prompt, /task-checkpoint/)
  assert.match(runPayloads[0].prompt, /idle-timeout/)
  assert.equal(runPayloads[0].resumeCheckpoint.id, 'task-checkpoint')
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'checkpoint-resume' &&
    entry.status === 'warning' &&
    /task-checkpoint/.test(entry.detail)
  ), true)
})

test('renderer run controller auto-routes repeated provider failures when enabled', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCProviderHealth,
    OPCTaskManager,
    OPCChatController,
    OPCProviderController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'bad/model',
    permissionMode: 'acceptEdits',
    memoryEnabled: true,
    providerAutoRouterEnabled: true,
  }
  store.state.providerFailureHistory = [
    { id: 'f1', model: 'bad/model', reason: 'timeout', at: Date.now() - 1000 },
    { id: 'f2', model: 'bad/model', reason: 'Prompt is too long', at: Date.now() - 500 },
  ]
  store.state.providerProfiles = [
    { id: 'bad', label: 'Bad Model', model: 'bad/model', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 12000 },
    { id: 'fallback', label: 'Fallback Model', model: 'fallback/model', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 64000 },
  ]
  let prompt = 'analyse le codebase complet et applique les corrections'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const providerController = OPCProviderController.createProviderController({
    state: store.state,
    store,
    providerHealth: OPCProviderHealth,
    opc: {},
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    providerController,
    opc: {
      run: async payload => runPayloads.push(payload),
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()

  assert.equal(store.state.settings.model, 'fallback/model')
  assert.equal(runPayloads.length, 1)
  assert.equal(runPayloads[0].model, 'fallback/model')
  assert.equal(store.state.runtimeAudit.some(entry =>
    entry.kind === 'provider-auto-router' &&
    entry.status === 'warning' &&
    /Fallback Model/.test(entry.detail)
  ), true)
})

test('renderer run controller surfaces stop failures', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = { cwd: '/repo', model: 'mock/model', permissionMode: 'acceptEdits', memoryEnabled: true }
  let prompt = 'hello'
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController: OPCServiceController.createServiceController({ state: store.state, store, taskManager: OPCTaskManager, opc: {} }),
    chatController,
    projectController: {},
    opc: {
      run: async () => {},
      stop: async () => {
        throw new Error('ipc down')
      },
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  runController.stopActiveTask()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(runController.runtimeSnapshot().phase, 'error')
  assert.match(runController.runtimeSnapshot().lastError, /Arrêt impossible/)
  assert.equal(store.state.runtimeAudit.at(-1).kind, 'stop-error')
})

test('renderer run controller uses full permission bypass mode directly', async () => {
  const {
    OPCState,
    OPCActivity,
    OPCConversation,
    OPCTaskManager,
    OPCChatController,
    OPCServiceController,
    OPCRunController,
  } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.settings = {
    cwd: '/repo',
    model: 'mock/model',
    permissionMode: 'bypassPermissions',
    memoryEnabled: true,
  }
  let prompt = 'corrige le build'
  const runPayloads = []
  const chatController = OPCChatController.createChatController({ state: store.state, store })
  const serviceController = OPCServiceController.createServiceController({
    state: store.state,
    store,
    taskManager: OPCTaskManager,
    opc: {},
  })
  const runController = OPCRunController.createRunController({
    state: store.state,
    store,
    activity: OPCActivity,
    conversation: OPCConversation,
    taskManager: OPCTaskManager,
    serviceController,
    chatController,
    opc: {
      run: async payload => {
        runPayloads.push(payload)
      },
      stop: async () => false,
    },
    getPrompt: () => prompt,
    setPrompt: value => {
      prompt = value
    },
    syncSettings: () => {},
  })

  await runController.sendPrompt()
  assert.equal(runPayloads.length, 1)
  assert.equal(runPayloads[0].skipPermissions, true)
  assert.equal(runPayloads[0].trustedWorkspaceRoot, '/repo')
  assert.equal(runPayloads[0].workspaceTrusted, true)
  assert.match(runPayloads[0].prompt, /Mode Tout autoriser actif/)
})
