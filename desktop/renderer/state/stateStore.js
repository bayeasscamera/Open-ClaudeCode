(function () {
  const rules = window.OPCStateRules || {}
  const MAX_STORED_CHATS = rules.MAX_STORED_CHATS || 40
  const MAX_STORED_PROJECTS = rules.MAX_STORED_PROJECTS || 30
  const MAX_PROJECT_FILES = rules.MAX_PROJECT_FILES || 40
  const DEFAULT_PERMISSION_MODE = rules.DEFAULT_PERMISSION_MODE || 'acceptEdits'

  function initialState() {
    return {
      chats: [],
      activeChatId: null,
      projects: [],
      activeProjectId: '',
      running: false,
      activeAssistantId: null,
      providerProfiles: [],
      providerDefaultModel: '',
      healthVersion: '',
      memoryEnabled: false,
      providerCheck: null,
      providerChecks: {},
      providerCheckHistory: [],
      providerFailureHistory: [],
      providerConfigError: '',
      longTasks: [],
      companionJobs: [],
      agentTaskLedger: [],
      agentWorkers: [],
      taskCheckpoints: [],
      runtime: null,
      runtimeAudit: [],
      persistenceError: '',
      settings: {
        cwd: '',
        model: '',
        permissionMode: DEFAULT_PERMISSION_MODE,
        permissionSchemaVersion: 3,
        providerAutoRouterEnabled: false,
        providerAutoRouterThreshold: 2,
        advancedPermissionStrictMode: false,
        memoryEnabled: true,
        thinkEnabled: false,
        refineModel: 'qwen/qwen3.5-122b-a10b',
        textSize: 'medium',
      },
      ui: {
        searchQuery: '',
        projectFileQueries: {},
        selectedChatIds: [],
      },
    }
  }

  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function welcomeMessage() {
    return {
      id: makeId('assistant'),
      role: 'assistant',
      content: 'Prêt. Le moteur utilisé est le CLI OPC en mode stream-json.',
      events: [],
      status: 'done',
    }
  }

  function normalizeChat(chat) {
    return {
      ...chat,
      id: chat.id || makeId('chat'),
      title: chat.title || 'Nouvelle conversation',
      createdAt: chat.createdAt || new Date().toISOString(),
      pinnedAt: typeof chat.pinnedAt === 'string' ? chat.pinnedAt : '',
      projectId: typeof chat.projectId === 'string' ? chat.projectId : '',
      messages:
        Array.isArray(chat.messages) && chat.messages.length
          ? chat.messages.map(rules.normalizeAssistant || (message => message))
          : [welcomeMessage()],
    }
  }

  function normalizeProject(project) {
    const now = new Date().toISOString()
    const name = String(project?.name || '').replace(/\s+/g, ' ').trim()
    const compactText = rules.compactProjectText || (value => String(value || '').trim())
    return {
      id: String(project?.id || makeId('project')),
      name: name || 'Nouveau projet',
      description: String(project?.description || '').replace(/\s+/g, ' ').trim(),
      instructions: compactText(project?.instructions),
      memory: compactText(project?.memory),
      files: normalizeProjectFiles(project?.files),
      runtime: normalizeProjectRuntime(project?.runtime),
      createdAt: project?.createdAt || now,
      updatedAt: project?.updatedAt || now,
    }
  }

  function normalizeProjectRuntime(runtime = {}) {
    const source = runtime && typeof runtime === 'object' ? runtime : {}
    const normalizePath = rules.normalizePathSetting || (value => String(value || '').replace(/\u0000/g, '').trim())
    const cwd = normalizePath(source.cwd)
    const model = String(source.model || '').trim()
    const permissionMode = String(source.permissionMode || '').trim()
    return {
      cwd,
      model,
      permissionMode,
      memoryEnabled: source.memoryEnabled === undefined ? null : Boolean(source.memoryEnabled),
      updatedAt: source.updatedAt || '',
    }
  }

  function normalizeProjectFile(file) {
    const now = new Date().toISOString()
    const filePath = String(file?.path || '').replace(/\u0000/g, '').trim()
    if (!filePath) return null
    const name = String(file?.name || filePath.split('/').filter(Boolean).pop() || filePath).replace(/\s+/g, ' ').trim()
    const size = Number(file?.size)
    return {
      id: String(file?.id || makeId('file')),
      path: filePath,
      name,
      size: Number.isFinite(size) && size >= 0 ? size : 0,
      summary: String(file?.summary || '').trim().slice(0, 1200),
      preview: String(file?.preview || '').trim().slice(0, 5000),
      searchIndex: String(file?.searchIndex || '').trim().slice(0, 12000),
      headings: normalizeProjectFileList(file?.headings, 12, 180),
      keywords: normalizeProjectFileList(file?.keywords, 18, 80),
      error: String(file?.error || '').trim(),
      lineCount: Number.isFinite(Number(file?.lineCount)) ? Number(file.lineCount) : 0,
      wordCount: Number.isFinite(Number(file?.wordCount)) ? Number(file.wordCount) : 0,
      indexedAt: file?.indexedAt || '',
      readNext: Boolean(file?.readNext),
      addedAt: file?.addedAt || now,
    }
  }

  function normalizeProjectFileList(value, limit, maxChars) {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const list = []
    for (const item of value) {
      const text = String(item || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
      if (!text || seen.has(text)) continue
      seen.add(text)
      list.push(text)
      if (list.length >= limit) break
    }
    return list
  }

  function normalizeProjectFiles(files) {
    if (!Array.isArray(files)) return []
    const seen = new Set()
    const normalized = []
    for (const file of files) {
      const item = normalizeProjectFile(file)
      if (!item || seen.has(item.path)) continue
      seen.add(item.path)
      normalized.push(item)
      if (normalized.length >= MAX_PROJECT_FILES) break
    }
    return normalized
  }

  const titleFromPrompt = rules.titleFromPrompt || (prompt => String(prompt || '').replace(/\s+/g, ' ').trim() || 'Nouvelle conversation')

  function createStateStore(storage = window.localStorage, repository = null) {
    const state = initialState()
    let saveQueued = false
    const stateRepository = repository || window.OPCStateRepository?.createStateRepository?.({
      storage,
      remoteSave: payload => window.opc?.saveState?.(payload),
    })

    function serializedState() {
      const payload = {
        chats: state.chats.slice(0, MAX_STORED_CHATS),
        activeChatId: state.activeChatId,
        projects: state.projects.slice(0, MAX_STORED_PROJECTS),
        activeProjectId: state.activeProjectId,
        settings: { ...state.settings, permissionSchemaVersion: 3 },
        providerChecks: state.providerChecks,
        providerCheckHistory: state.providerCheckHistory,
        providerFailureHistory: state.providerFailureHistory,
        longTasks: state.longTasks,
        companionJobs: state.companionJobs,
        agentTaskLedger: state.agentTaskLedger,
        agentWorkers: state.agentWorkers,
        taskCheckpoints: state.taskCheckpoints,
      }
      return rules.redactStateSecrets ? rules.redactStateSecrets(payload) : payload
    }

    function save() {
      const payload = serializedState()
      const result = stateRepository.write(payload)
      if (result.ok) {
        state.persistenceError = ''
      } else {
        state.persistenceError = result.localError || 'Sauvegarde locale impossible.'
      }
      result.pendingRemote?.catch?.(error => {
        state.persistenceError = `Sauvegarde disque impossible: ${error.message || String(error)}`
      })
    }

    function scheduleSave() {
      if (saveQueued) return
      saveQueued = true
      setTimeout(() => {
        saveQueued = false
        save()
      }, 250)
    }

    function createChat({ persist = true, projectId = state.activeProjectId || '' } = {}) {
      const chat = {
        id: makeId('chat'),
        title: 'Nouvelle conversation',
        createdAt: new Date().toISOString(),
        projectId,
        messages: [welcomeMessage()],
      }
      state.chats.unshift(chat)
      state.activeChatId = chat.id
      if (persist) save()
      return chat
    }

    function applySaved(saved) {
      const savedChats = Array.isArray(saved.chats) ? saved.chats : []
      const savedProjects = Array.isArray(saved.projects) ? saved.projects : []
      state.projects = savedProjects
        .filter(project => project && typeof project === 'object')
        .slice(0, MAX_STORED_PROJECTS)
        .map(normalizeProject)
      const projectIds = new Set(state.projects.map(project => project.id))
      state.chats = savedChats.filter(chat => chat && typeof chat === 'object').slice(0, MAX_STORED_CHATS).map(normalizeChat)
      state.chats = state.chats.map(chat => ({
        ...chat,
        projectId: projectIds.has(chat.projectId) ? chat.projectId : '',
      }))
      state.activeChatId = saved.activeChatId || null
      state.activeProjectId = projectIds.has(saved.activeProjectId) ? saved.activeProjectId : ''
      state.settings = rules.normalizeSettings
        ? rules.normalizeSettings(saved.settings || {}, state.settings)
        : { ...state.settings, ...(saved.settings || {}), permissionSchemaVersion: 3 }
      state.providerChecks = rules.normalizeProviderChecks ? rules.normalizeProviderChecks(saved.providerChecks) : saved.providerChecks || {}
      state.providerCheckHistory = rules.normalizeProviderCheckHistory
        ? rules.normalizeProviderCheckHistory(saved.providerCheckHistory)
        : (Array.isArray(saved.providerCheckHistory) ? saved.providerCheckHistory : [])
      state.providerFailureHistory = window.OPCProviderFailurePolicy?.normalizeHistory
        ? window.OPCProviderFailurePolicy.normalizeHistory(saved.providerFailureHistory)
        : (Array.isArray(saved.providerFailureHistory) ? saved.providerFailureHistory : [])
      state.longTasks = rules.normalizeLongTasks ? rules.normalizeLongTasks(saved.longTasks) : saved.longTasks || []
      state.companionJobs = rules.normalizeCompanionJobs ? rules.normalizeCompanionJobs(saved.companionJobs) : saved.companionJobs || []
      state.agentTaskLedger = window.OPCAgentTaskLedger?.normalizeEntries
        ? window.OPCAgentTaskLedger.normalizeEntries(saved.agentTaskLedger, { interruptActive: true })
        : (Array.isArray(saved.agentTaskLedger) ? saved.agentTaskLedger : [])
      state.agentWorkers = window.OPCAgentWorkerRuntime?.normalizeEntries
        ? window.OPCAgentWorkerRuntime.normalizeEntries(saved.agentWorkers, { interruptActive: true })
        : (Array.isArray(saved.agentWorkers) ? saved.agentWorkers : [])
      state.taskCheckpoints = window.OPCTaskCheckpointStore?.normalizeEntries
        ? window.OPCTaskCheckpointStore.normalizeEntries(saved.taskCheckpoints)
        : (Array.isArray(saved.taskCheckpoints) ? saved.taskCheckpoints : [])
      const chatIds = new Set(state.chats.map(chat => chat.id))
      const assistantIds = new Set(state.chats.flatMap(chat => chat.messages.map(message => message.id)))
      state.companionJobs = state.companionJobs.filter(job =>
        (!job.chatId || chatIds.has(job.chatId)) && (!job.assistantId || assistantIds.has(job.assistantId))
      )
      state.agentTaskLedger = state.agentTaskLedger.filter(entry =>
        (!entry.chatId || chatIds.has(entry.chatId)) && (!entry.assistantId || assistantIds.has(entry.assistantId))
      )
      state.agentWorkers = state.agentWorkers.filter(entry =>
        (!entry.chatId || chatIds.has(entry.chatId)) && (!entry.assistantId || assistantIds.has(entry.assistantId))
      )
      state.taskCheckpoints = state.taskCheckpoints.filter(entry =>
        (!entry.chatId || chatIds.has(entry.chatId)) && (!entry.assistantId || assistantIds.has(entry.assistantId))
      )
      if (!state.chats.length && !state.activeProjectId) createChat({ persist: false })
      if (!state.activeChatId || !state.chats.some(chat => chat.id === state.activeChatId) || !activeChat()) {
        state.activeChatId = firstVisibleChatId()
      }
      return Boolean(savedChats.length || savedProjects.length || saved.settings || saved.providerChecks || saved.providerCheckHistory || saved.providerFailureHistory || saved.longTasks || saved.companionJobs || saved.agentTaskLedger || saved.agentWorkers || saved.taskCheckpoints)
    }

    function loadFromPayload(payload) {
      if (!payload || typeof payload !== 'object') return false
      state.persistenceError = ''
      return applySaved(payload)
    }

    function load() {
      let loaded = false
      const saved = stateRepository.read()
      if (saved.ok) {
        loaded = applySaved(saved.value)
      } else {
        state.chats = []
        state.persistenceError = `État local illisible: ${saved.error}`
      }
      if (!state.chats.length && !state.activeProjectId) createChat({ persist: false })
      if (!state.activeChatId || !state.chats.some(chat => chat.id === state.activeChatId) || !activeChat()) {
        state.activeChatId = firstVisibleChatId()
      }
      return loaded
    }

    function activeChat() {
      const chat = state.chats.find(item => item.id === state.activeChatId)
      if (!chat) return null
      if (state.activeProjectId && chat.projectId !== state.activeProjectId) return null
      return chat
    }

    function activeProject() {
      return state.projects.find(project => project.id === state.activeProjectId) || null
    }

    function projectById(projectId) {
      return state.projects.find(project => project.id === projectId) || null
    }

    function visibleChats(projectId = state.activeProjectId) {
      return projectId ? state.chats.filter(chat => chat.projectId === projectId) : state.chats
    }

    function firstVisibleChatId(projectId = state.activeProjectId) {
      const visible = visibleChats(projectId)
      if (visible.length) return visible[0].id
      return projectId ? null : state.chats[0]?.id || null
    }

    function activeAssistant() {
      for (const chat of state.chats) {
        const message = chat.messages.find(item => item.id === state.activeAssistantId)
        if (message) return message
      }
      return null
    }

    function chatForMessage(messageId) {
      return state.chats.find(chat => chat.messages.some(message => message.id === messageId)) || null
    }

    function setActiveChat(chatId) {
      const chat = state.chats.find(item => item.id === chatId)
      if (!chat) return false
      state.activeProjectId = chat.projectId || ''
      state.activeChatId = chatId
      save()
      return true
    }

    function renameChat(chatId, title = '') {
      const chat = state.chats.find(item => item.id === chatId)
      if (!chat) return false
      const nextTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!nextTitle) return false
      chat.title = nextTitle
      save()
      return true
    }

    function toggleChatPinned(chatId, pinned) {
      const chat = state.chats.find(item => item.id === chatId)
      if (!chat) return false
      const shouldPin = pinned === undefined ? !chat.pinnedAt : Boolean(pinned)
      chat.pinnedAt = shouldPin ? new Date().toISOString() : ''
      save()
      return true
    }

    function setActiveProject(projectId = '') {
      const targetProjectId = projectId && projectById(projectId) ? projectId : ''
      state.activeProjectId = targetProjectId
      state.activeChatId = firstVisibleChatId(targetProjectId)
      save()
      return true
    }

    function createProject(input = {}) {
      const project = normalizeProject({
        ...input,
        id: makeId('project'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      state.projects.unshift(project)
      state.activeProjectId = project.id
      state.activeChatId = firstVisibleChatId(project.id)
      save()
      return project
    }

    function updateProject(projectId, patch = {}) {
      const project = projectById(projectId)
      if (!project) return null
      const updated = normalizeProject({
        ...project,
        ...patch,
        id: project.id,
        createdAt: project.createdAt,
        updatedAt: new Date().toISOString(),
      })
      Object.assign(project, updated)
      save()
      return project
    }

    function updateProjectRuntime(projectId, patch = {}) {
      const project = projectById(projectId)
      if (!project) return null
      const runtime = normalizeProjectRuntime({
        ...(project.runtime || {}),
        ...patch,
        updatedAt: new Date().toISOString(),
      })
      project.runtime = runtime
      project.updatedAt = new Date().toISOString()
      save()
      return project
    }

    function deleteProject(projectId) {
      if (!projectById(projectId)) return false
      state.projects = state.projects.filter(project => project.id !== projectId)
      for (const chat of state.chats) {
        if (chat.projectId === projectId) chat.projectId = ''
      }
      if (state.activeProjectId === projectId) state.activeProjectId = ''
      if (!state.chats.some(chat => chat.id === state.activeChatId)) {
        if (!state.chats.length) createChat({ persist: false, projectId: '' })
        state.activeChatId = state.chats[0].id
      }
      save()
      return true
    }

    function assignChatToProject(chatId, projectId = '', options = {}) {
      const chat = state.chats.find(item => item.id === chatId)
      if (!chat) return false
      const targetProjectId = projectId && projectById(projectId) ? projectId : ''
      const previousActiveProjectId = state.activeProjectId
      chat.projectId = targetProjectId
      if (options.focus !== false) {
        state.activeProjectId = targetProjectId
        state.activeChatId = chat.id
      } else if (previousActiveProjectId && state.activeChatId === chat.id && targetProjectId !== previousActiveProjectId) {
        state.activeChatId = firstVisibleChatId(previousActiveProjectId)
      }
      save()
      return true
    }

    function addProjectFiles(projectId, files = []) {
      const project = projectById(projectId)
      if (!project) return null
      const existing = normalizeProjectFiles(project.files)
      const incoming = normalizeProjectFiles(files)
      const byPath = new Map(existing.map(file => [file.path, file]))
      for (const file of incoming) byPath.set(file.path, file)
      project.files = Array.from(byPath.values()).slice(0, MAX_PROJECT_FILES)
      project.updatedAt = new Date().toISOString()
      save()
      return project
    }

    function removeProjectFile(projectId, fileId) {
      const project = projectById(projectId)
      if (!project) return null
      const before = project.files?.length || 0
      project.files = normalizeProjectFiles(project.files).filter(file => file.id !== fileId)
      if (project.files.length === before) return project
      project.updatedAt = new Date().toISOString()
      save()
      return project
    }

    function updateProjectFile(projectId, fileId, patch = {}) {
      const project = projectById(projectId)
      if (!project) return null
      project.files = normalizeProjectFiles(project.files).map(file => {
        if (file.id !== fileId) return file
        return normalizeProjectFile({ ...file, ...patch, id: file.id, path: file.path, addedAt: file.addedAt }) || file
      })
      project.updatedAt = new Date().toISOString()
      save()
      return project
    }

    function setProjectFileReadNext(projectId, fileId, readNext) {
      return updateProjectFile(projectId, fileId, { readNext: Boolean(readNext) })
    }

    function clearProjectFileReadNext(projectId) {
      const project = projectById(projectId)
      if (!project) return null
      let changed = false
      project.files = normalizeProjectFiles(project.files).map(file => {
        if (!file.readNext) return file
        changed = true
        return { ...file, readNext: false }
      })
      if (changed) {
        project.updatedAt = new Date().toISOString()
        save()
      }
      return project
    }

    function setSearchQuery(value = '') {
      state.ui.searchQuery = String(value || '').trim()
    }

    function setProjectFileSearchQuery(projectId, value = '') {
      const id = String(projectId || '')
      if (!id) return ''
      if (!state.ui.projectFileQueries || typeof state.ui.projectFileQueries !== 'object') state.ui.projectFileQueries = {}
      state.ui.projectFileQueries[id] = String(value || '').trim()
      return state.ui.projectFileQueries[id]
    }

    function projectFileSearchQuery(projectId) {
      const id = String(projectId || '')
      return id && state.ui.projectFileQueries ? String(state.ui.projectFileQueries[id] || '') : ''
    }

    function selectedChatIds() {
      const valid = new Set(state.chats.map(chat => chat.id))
      state.ui.selectedChatIds = (state.ui.selectedChatIds || []).filter(id => valid.has(id))
      return state.ui.selectedChatIds.slice()
    }

    function toggleChatSelection(chatId, selected) {
      const chat = state.chats.find(item => item.id === chatId)
      if (!chat) return selectedChatIds()
      const ids = new Set(selectedChatIds())
      if (selected === undefined ? !ids.has(chatId) : selected) ids.add(chatId)
      else ids.delete(chatId)
      state.ui.selectedChatIds = Array.from(ids)
      return selectedChatIds()
    }

    function clearChatSelection() {
      state.ui.selectedChatIds = []
      return []
    }

    function moveSelectedChatsToProject(projectId = '') {
      const ids = selectedChatIds()
      if (!ids.length) return 0
      let moved = 0
      for (const chatId of ids) {
        if (assignChatToProject(chatId, projectId, { focus: false })) moved += 1
      }
      clearChatSelection()
      save()
      return moved
    }

    function exportProjectBundle(projectId) {
      const project = projectById(projectId)
      if (!project) return null
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        project,
        chats: state.chats.filter(chat => chat.projectId === project.id),
      }
    }

    function importProjectBundle(bundle = {}) {
      const sourceProject = bundle.project && typeof bundle.project === 'object' ? bundle.project : bundle
      if (!sourceProject || typeof sourceProject !== 'object') return null
      const project = normalizeProject({
        ...sourceProject,
        id: makeId('project'),
        name: `${sourceProject.name || 'Projet importé'} importé`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      const sourceChats = Array.isArray(bundle.chats) ? bundle.chats : []
      const importedChats = sourceChats
        .filter(chat => chat && typeof chat === 'object')
        .map(chat => normalizeChat({
          ...chat,
          id: makeId('chat'),
          projectId: project.id,
          createdAt: chat.createdAt || new Date().toISOString(),
        }))
      state.projects.unshift(project)
      state.chats.unshift(...importedChats)
      state.activeProjectId = project.id
      state.activeChatId = firstVisibleChatId(project.id)
      save()
      return project
    }

    function deleteChat(chatId) {
      const removedActive = state.activeChatId === chatId
      state.chats = state.chats.filter(item => item.id !== chatId)
      state.companionJobs = (state.companionJobs || []).filter(job => job.chatId !== chatId)
      if (!state.chats.length) {
        state.activeChatId = null
        if (!state.activeProjectId) createChat({ persist: false })
      } else if (removedActive) {
        state.activeChatId = firstVisibleChatId()
      }
      save()
    }

    function clearHistory() {
      state.chats = []
      state.activeChatId = null
      state.companionJobs = []
      if (!state.activeProjectId) createChat({ persist: false })
      save()
    }

    return {
      state,
      makeId,
      titleFromPrompt,
      load,
      loadFromPayload,
      save,
      scheduleSave,
      serializedState,
      createChat,
      activeChat,
      activeProject,
      activeAssistant,
      chatForMessage,
      projectById,
      visibleChats,
      setActiveChat,
      renameChat,
      toggleChatPinned,
      setActiveProject,
      createProject,
      updateProject,
      updateProjectRuntime,
      deleteProject,
      assignChatToProject,
      addProjectFiles,
      removeProjectFile,
      updateProjectFile,
      setProjectFileReadNext,
      clearProjectFileReadNext,
      setSearchQuery,
      setProjectFileSearchQuery,
      projectFileSearchQuery,
      selectedChatIds,
      toggleChatSelection,
      clearChatSelection,
      moveSelectedChatsToProject,
      exportProjectBundle,
      importProjectBundle,
      deleteChat,
      clearHistory,
    }
  }

  window.OPCState = { createStateStore }
})()
