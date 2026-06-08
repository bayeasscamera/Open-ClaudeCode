const { assert, createStorage, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

test('renderer state store creates, persists, deletes and clears chats', () => {
  const { OPCState } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  assert.equal(store.state.chats.length, 1)
  assert.equal(store.state.settings.permissionMode, 'acceptEdits')
  assert.equal(store.state.settings.memoryEnabled, true)
  assert.equal(store.state.settings.providerAutoRouterEnabled, false)
  assert.equal(store.state.settings.providerAutoRouterThreshold, 2)
  assert.equal(store.state.settings.advancedPermissionStrictMode, false)
  assert.equal(store.state.settings.thinkEnabled, false)
  assert.equal(store.state.settings.compactMode, false)
  assert.equal(store.state.settings.inspectorOpen, false)
  const firstId = store.state.activeChatId

  store.createChat()
  assert.equal(store.state.chats.length, 2)
  assert.notEqual(store.state.activeChatId, firstId)

  store.deleteChat(store.state.activeChatId)
  assert.equal(store.state.chats.length, 1)
  store.clearHistory()
  assert.equal(store.state.chats.length, 1)
  assert.equal(store.activeChat().title, 'Nouvelle conversation')
})

test('renderer state store strips shell quotes from persisted runtime paths', () => {
  const { OPCState } = loadRendererModules()
  const storage = createStorage()
  storage.setItem('opc.desktop.state', JSON.stringify({
    settings: { cwd: "'/Users/example/project'", permissionMode: 'bypassPermissions' },
    projects: [{
      id: 'project-quoted',
      name: 'Quoted',
      runtime: { cwd: '"/Users/example/project/packages/app"' },
    }],
  }))
  const store = OPCState.createStateStore(storage)
  store.load()

  assert.equal(store.state.settings.cwd, '/Users/example/project')
  assert.equal(store.state.settings.permissionMode, 'acceptEdits')
  assert.equal(store.state.projects[0].runtime.cwd, '/Users/example/project/packages/app')
})

test('renderer state store persists projects and assigns conversations', () => {
  const { OPCState } = loadRendererModules()
  const storage = createStorage()
  const store = OPCState.createStateStore(storage)
  store.load()

  const project = store.createProject({
    name: 'Deep-search',
    description: 'Recherche',
    memory: 'Préférer les sources primaires.',
    instructions: 'Structurer les réponses en étapes.',
    runtime: {
      cwd: '/repo/deep-search',
      model: 'opencode/deepseek-v4-flash-free',
      permissionMode: 'bypassPermissions',
      memoryEnabled: true,
    },
    files: [{ path: '/tmp/audit.md', name: 'audit.md', size: 1200 }],
  })

  assert.equal(store.state.projects.length, 1)
  assert.equal(store.activeProject().id, project.id)
  assert.equal(store.activeProject().runtime.cwd, '/repo/deep-search')
  assert.equal(store.activeProject().runtime.model, 'opencode/deepseek-v4-flash-free')
  assert.equal(store.visibleChats(project.id).length, 0)
  assert.equal(store.activeChat(), null)
  assert.equal(store.activeProject().files.length, 1)

  store.createChat()
  assert.equal(store.activeChat().projectId, project.id)

  assert.equal(store.visibleChats(project.id).length, 1)
  const activeChatId = store.activeChat().id
  store.assignChatToProject(activeChatId, '', { focus: false })
  assert.equal(store.state.activeProjectId, project.id)
  assert.equal(store.state.activeChatId, null)
  store.setActiveChat(activeChatId)
  store.assignChatToProject(activeChatId, '')
  assert.equal(store.activeChat().projectId, '')
  store.addProjectFiles(project.id, [
    { path: '/tmp/audit.md', name: 'audit.md', size: 1200 },
    { path: '/tmp/spec.md', name: 'spec.md', size: 2200 },
  ])
  assert.equal(store.projectById(project.id).files.length, 2)
  const spec = store.projectById(project.id).files.find(file => file.name === 'spec.md')
  store.updateProjectFile(project.id, spec.id, {
    summary: 'Résumé spec',
    preview: 'Contenu spec',
    searchIndex: 'architecture modules services',
    headings: ['Architecture'],
    keywords: ['architecture', 'modules'],
    wordCount: 2,
    lineCount: 1,
  })
  store.setProjectFileReadNext(project.id, spec.id, true)
  assert.equal(store.projectById(project.id).files.find(file => file.id === spec.id).readNext, true)
  store.updateProjectRuntime(project.id, { cwd: '/repo/updated', model: 'qwen', permissionMode: 'dontAsk', memoryEnabled: false })
  assert.equal(store.projectById(project.id).runtime.cwd, '/repo/updated')
  assert.equal(store.projectById(project.id).runtime.memoryEnabled, false)
  store.setProjectFileSearchQuery(project.id, 'architecture')
  assert.equal(store.projectFileSearchQuery(project.id), 'architecture')
  store.clearProjectFileReadNext(project.id)
  assert.equal(store.projectById(project.id).files.find(file => file.id === spec.id).readNext, false)
  store.removeProjectFile(project.id, store.projectById(project.id).files[0].id)
  assert.equal(store.projectById(project.id).files.length, 1)
  const bundle = store.exportProjectBundle(project.id)
  assert.equal(bundle.project.name, 'Deep-search')
  assert.equal(bundle.chats.length, 0)
  store.setActiveProject(project.id)
  assert.equal(store.activeChat(), null)
  const looseA = store.createChat({ projectId: '' })
  const looseB = store.createChat({ projectId: '' })
  store.toggleChatSelection(looseA.id, true)
  store.toggleChatSelection(looseB.id, true)
  assert.equal(store.selectedChatIds().length, 2)
  assert.equal(store.moveSelectedChatsToProject(project.id), 2)
  assert.equal(store.selectedChatIds().length, 0)
  assert.equal(store.visibleChats(project.id).length, 2)

  const reloaded = OPCState.createStateStore(storage)
  reloaded.load()
  assert.equal(reloaded.state.projects[0].name, 'Deep-search')
  assert.equal(reloaded.state.projects[0].memory, 'Préférer les sources primaires.')
  assert.equal(reloaded.state.projects[0].runtime.cwd, '/repo/updated')
  assert.equal(reloaded.state.projects[0].runtime.permissionMode, 'dontAsk')
  assert.equal(reloaded.state.projects[0].files[0].name, 'spec.md')
  assert.equal(reloaded.state.projects[0].files[0].summary, 'Résumé spec')
  assert.equal(JSON.stringify(reloaded.state.projects[0].files[0].keywords), JSON.stringify(['architecture', 'modules']))
  assert.equal(reloaded.visibleChats(project.id).length, 2)

  const imported = reloaded.importProjectBundle(bundle)
  assert.equal(imported.name, 'Deep-search importé')
  assert.equal(reloaded.activeProject().id, imported.id)
})

test('renderer state store renames and pins chats durably', () => {
  const { OPCState } = loadRendererModules()
  const storage = createStorage()
  const store = OPCState.createStateStore(storage)
  store.load()
  const chat = store.activeChat()

  assert.equal(store.renameChat(chat.id, '  Audit   provider OPC  '), true)
  assert.equal(store.activeChat().title, 'Audit provider OPC')
  assert.equal(store.toggleChatPinned(chat.id, true), true)
  assert.equal(Boolean(store.activeChat().pinnedAt), true)
  store.save()

  const reloaded = OPCState.createStateStore(storage)
  reloaded.load()
  assert.equal(reloaded.activeChat().title, 'Audit provider OPC')
  assert.equal(Boolean(reloaded.activeChat().pinnedAt), true)
  assert.equal(reloaded.toggleChatPinned(chat.id, false), true)
  assert.equal(reloaded.activeChat().pinnedAt, '')
})

test('renderer state store persists provider health and long tasks', () => {
  const { OPCState } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  store.state.providerChecks = {
    'mock/model': { model: 'mock/model', ok: true, latencyMs: 42, status: 'ok', checkedAt: 123 },
  }
  store.state.providerCheckHistory = [{
    model: 'mock/model',
    label: 'Mock Model',
    ok: false,
    status: 'needs_config',
    category: 'needs_config',
    latencyMs: 33,
    statusCode: 401,
    error: 'api_key=sk-secretSECRET1234567890 rejected',
    checkedAt: 456,
  }]
  store.state.longTasks = [
    { id: 'long-1', command: 'pnpm tools-dev run web', pid: '321', status: 'running', startedAt: 123 },
  ]
  store.state.companionJobs = [
    { id: 'job-1', taskId: 'job-1', title: 'Audit OPC', status: 'running', model: 'mock/model', startedAt: 123 },
  ]
  store.state.agentTaskLedger = [
    {
      id: 'task-1',
      title: 'Implémenter le runtime agentique complet',
      status: 'running',
      model: 'mock/model',
      cwd: '/repo/opc',
      command: 'npm test',
      events: [
        { kind: 'queued', at: 100, detail: 'Planifiée' },
        { kind: 'running', at: 200, detail: 'Transmission au CLI' },
      ],
      createdAt: 100,
      updatedAt: 200,
    },
  ]
  store.state.agentWorkers = [
    {
      id: 'worker-1',
      taskId: 'worker-1',
      assistantId: store.activeChat().messages[0].id,
      chatId: store.activeChat().id,
      status: 'running',
      phase: 'execute',
      prompt: 'continue le worker',
      events: [{ kind: 'running', at: 200, detail: 'actif' }],
      updatedAt: 200,
    },
  ]
  store.save()

  const reloaded = OPCState.createStateStore()
  reloaded.load()
  assert.equal(reloaded.state.providerChecks['mock/model'].ok, true)
  assert.equal(reloaded.state.providerCheckHistory.length, 1)
  assert.equal(reloaded.state.providerCheckHistory[0].model, 'mock/model')
  assert.equal(reloaded.state.providerCheckHistory[0].error.includes('sk-secret'), false)
  assert.equal(reloaded.state.longTasks.length, 1)
  assert.equal(reloaded.state.longTasks[0].status, 'unknown')
  assert.equal(reloaded.state.companionJobs.length, 1)
  assert.equal(reloaded.state.companionJobs[0].status, 'interrupted')
  assert.equal(reloaded.state.agentTaskLedger.length, 1)
  assert.equal(reloaded.state.agentTaskLedger[0].status, 'interrupted')
  assert.equal(reloaded.state.agentTaskLedger[0].events.at(-1).kind, 'interrupted')
  assert.equal(reloaded.state.agentWorkers.length, 1)
  assert.equal(reloaded.state.agentWorkers[0].status, 'interrupted')
  assert.equal(reloaded.state.agentWorkers[0].events.at(-1).kind, 'interrupted')
})

test('renderer state store persists interface settings', () => {
  const { OPCState } = loadRendererModules()
  const storage = createStorage()
  const store = OPCState.createStateStore(storage)
  store.load()
  store.state.settings.compactMode = true
  store.state.settings.inspectorOpen = true
  store.state.settings.thinkEnabled = true
  store.save()

  const reloaded = OPCState.createStateStore(storage)
  reloaded.load()
  assert.equal(reloaded.state.settings.compactMode, true)
  assert.equal(reloaded.state.settings.inspectorOpen, true)
  assert.equal(reloaded.state.settings.thinkEnabled, false)
})

test('renderer state store keeps active assistant addressable across chats', () => {
  const { OPCState } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  const firstChat = store.activeChat()
  const assistant = {
    id: store.makeId('assistant'),
    role: 'assistant',
    content: '',
    status: 'running',
    diagnostics: { taskId: 'task_active' },
  }
  firstChat.messages.push(assistant)
  store.state.activeAssistantId = assistant.id
  store.createChat()

  assert.notEqual(store.activeChat().id, firstChat.id)
  assert.equal(store.activeAssistant().id, assistant.id)
  assert.equal(store.chatForMessage(assistant.id).id, firstChat.id)
})

test('renderer state store reports local persistence errors', () => {
  const { OPCState } = loadRendererModules()
  const storage = {
    getItem: () => '{bad json',
    setItem: () => {
      throw new Error('quota')
    },
  }
  const store = OPCState.createStateStore(storage)
  assert.equal(store.load(), false)
  assert.match(store.state.persistenceError, /État local illisible/)
  store.save()
  assert.match(store.state.persistenceError, /Sauvegarde locale impossible/)
})
