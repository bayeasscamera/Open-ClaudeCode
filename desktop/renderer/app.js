const opcClient = window.OPCOpcClient.createOpcClient(window.opc)
const stateRepository = window.OPCStateRepository.createStateRepository({
  remoteSave: payload => opcClient.saveState?.(payload),
})
const store = window.OPCState.createStateStore(window.localStorage, stateRepository)
const activity = window.OPCActivity
const conversation = window.OPCConversation
const providerHealth = window.OPCProviderHealth
const taskManager = window.OPCTaskManager
const markdown = window.OPCMarkdown
const inspector = window.OPCInspector
const { state } = store

const els = {
  chatList: document.querySelector('#chatList'),
  messages: document.querySelector('#messages'),
  prompt: document.querySelector('#promptInput'),
  send: document.querySelector('#sendButton'),
  stop: document.querySelector('#stopButton'),
  rescue: document.querySelector('#rescueButton'),
  refine: document.querySelector('#refineButton'),
  refineUndo: document.querySelector('#refineUndoButton'),
  composerPlus: document.querySelector('#composerPlusButton'),
  composerMenu: document.querySelector('#composerMenu'),
  composerAddFolder: document.querySelector('#composerAddFolder'),
  composerStatus: document.querySelector('#composerStatus'),
  newChat: document.querySelector('#newChat'),
  sidebarSearch: document.querySelector('#sidebarSearch'),
  newProject: document.querySelector('#newProject'),
  sidebarProjects: document.querySelector('#sidebarProjects'),
  sidebarArtifacts: document.querySelector('#sidebarArtifacts'),
  sidebarCustomize: document.querySelector('#sidebarCustomize'),
  pinnedHeader: document.querySelector('#pinnedHeader'),
  pinnedChatList: document.querySelector('#pinnedChatList'),
  projectList: document.querySelector('#projectList'),
  clearHistory: document.querySelector('#clearHistory'),
  cwd: document.querySelector('#cwdInput'),
  project: document.querySelector('#projectSelect'),
  model: document.querySelector('#modelInput'),
  composerModel: document.querySelector('#composerModelInput'),
  permission: document.querySelector('#permissionSelect'),
  memory: document.querySelector('#memoryToggle'),
  think: document.querySelector('#thinkToggle'),
  providerCheck: document.querySelector('#providerCheck'),
  settingsToggle: document.querySelector('#settingsToggle'),
  checkAllProviders: document.querySelector('#checkAllProviders'),
  providerPanel: document.querySelector('#providerPanel'),
  taskPanel: document.querySelector('#taskPanel'),
  logsPanel: document.querySelector('#logsPanel'),
  logsToggle: document.querySelector('#logsToggle'),
  logs: document.querySelector('#logs'),
  clearLogs: document.querySelector('#clearLogs'),
  healthDot: document.querySelector('#healthDot'),
  healthText: document.querySelector('#healthText'),
  healthDetail: document.querySelector('#healthDetail'),
  projectModal: document.querySelector('#projectModal'),
  projectForm: document.querySelector('#projectForm'),
  projectModalTitle: document.querySelector('#projectModalTitle'),
  projectNameInput: document.querySelector('#projectNameInput'),
  projectDescriptionInput: document.querySelector('#projectDescriptionInput'),
  projectMemoryInput: document.querySelector('#projectMemoryInput'),
  projectInstructionsInput: document.querySelector('#projectInstructionsInput'),
  projectCancel: document.querySelector('#projectCancel'),
  projectSave: document.querySelector('#projectSave'),
  settingsModal: document.querySelector('#settingsModal'),
}

let renderer = null
let settingsController = null
let composerController = null
const logBuffer = window.OPCLogBuffer.createLogBuffer({ element: els.logs })
const speedReader = window.OPCSpeedReader.createSpeedReader()

function appendLog(line) {
  logBuffer.append(line)
}

function resizePrompt() {
  if (composerController?.resizePrompt) {
    composerController.resizePrompt()
    return
  }
  els.prompt.style.height = 'auto'
  els.prompt.style.height = `${Math.min(180, els.prompt.scrollHeight)}px`
}

function syncSettings() {
  const previousModel = state.settings.model
  state.settings.cwd = window.OPCStateRules?.normalizePathSetting
    ? window.OPCStateRules.normalizePathSetting(els.cwd.value)
    : els.cwd.value.trim()
  state.settings.model = els.model.value.trim()
  state.settings.permissionMode = els.permission.value
  state.settings.memoryEnabled = els.memory.checked
  state.settings.thinkEnabled = false
  state.settings.inspectorOpen = !els.logsPanel.classList.contains('hidden')
  if (previousModel !== state.settings.model) state.providerCheck = providerController.selectedProviderCheck()
  persistActiveProjectRuntime()
  applyUiSettings()
}

function applySettingsPatch(patch = {}, { persistRuntime = true, renderView = true } = {}) {
  const previousModel = state.settings.model
  Object.assign(state.settings, patch, { permissionSchemaVersion: 2 })
  state.settings.thinkEnabled = false
  if (previousModel !== state.settings.model) state.providerCheck = providerController?.selectedProviderCheck?.() || state.providerCheck
  if (persistRuntime) persistActiveProjectRuntime()
  applyUiSettings()
  store.save()
  if (renderView) {
    renderer?.render()
    settingsController?.render()
  }
}

function applyUiSettings() {
  document.body.classList.toggle('compactMode', Boolean(state.settings.compactMode))
  document.body.classList.toggle('textSizeSmall', state.settings.textSize === 'small')
  document.body.classList.toggle('textSizeLarge', state.settings.textSize === 'large')
  document.body.classList.toggle('thinkMode', Boolean(state.settings.thinkEnabled))
  if (els.think) {
    const active = false
    els.think.disabled = true
    els.think.classList.toggle('active', active)
    els.think.classList.toggle('unsupported', true)
    els.think.setAttribute('aria-pressed', active ? 'true' : 'false')
    els.think.title = 'Think désactivé globalement'
  }
  if (state.settings.inspectorOpen !== undefined) {
    els.logsPanel.classList.toggle('hidden', !state.settings.inspectorOpen)
  }
}

function runtimePatchFromSettings() {
  return {
    cwd: state.settings.cwd,
    model: state.settings.model,
    permissionMode: state.settings.permissionMode,
    memoryEnabled: state.settings.memoryEnabled !== false,
    thinkEnabled: Boolean(state.settings.thinkEnabled),
  }
}

function persistActiveProjectRuntime() {
  const project = projectController?.activeProject?.()
  if (!project) return null
  return projectController.updateProjectRuntime?.(project.id, runtimePatchFromSettings())
}

function applyProjectRuntime(project) {
  const runtime = project?.runtime || null
  if (!runtime) return false
  let changed = false
  for (const [field, value] of [
    ['cwd', runtime.cwd],
    ['model', runtime.model],
    ['permissionMode', runtime.permissionMode],
  ]) {
    if (value && state.settings[field] !== value) {
      state.settings[field] = value
      changed = true
    }
  }
  if (runtime.memoryEnabled !== null && runtime.memoryEnabled !== undefined && state.settings.memoryEnabled !== Boolean(runtime.memoryEnabled)) {
    state.settings.memoryEnabled = Boolean(runtime.memoryEnabled)
    changed = true
  }
  if (changed) {
    state.providerCheck = providerController?.selectedProviderCheck?.() || state.providerCheck
    store.save()
  }
  return changed
}

async function copyText(value) {
  const text = String(value || '')
  if (!text.trim()) return false
  try {
    if (opcClient.copyText && await opcClient.copyText(text)) return true
  } catch {
    // Fall back to renderer-side clipboard paths.
  }
  try {
    await navigator.clipboard?.writeText(text)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  }
}

function setPromptValue(value, options = {}) {
  if (composerController?.setPrompt) {
    composerController.setPrompt(value, options)
    return
  }
  els.prompt.value = String(value || '')
  resizePrompt()
  els.send.disabled = !els.prompt.value.trim()
}

function setComposerStatus(message = '', tone = '') {
  if (!els.composerStatus) return
  els.composerStatus.textContent = message
  els.composerStatus.dataset.tone = tone
  els.composerStatus.classList.toggle('hidden', !message)
}

function shortFolderName(folder = '') {
  const parts = String(folder || '').split('/').filter(Boolean)
  return parts.at(-1) || folder || 'dossier'
}

function retryAssistant(message) {
  const prompt = chatController.previousUserPrompt(message)
  const chat = chatController.chatForAssistant(message)
  if (!chat || !prompt) return
  store.setActiveChat(chat.id)
  setPromptValue(prompt)
  runController.sendPrompt()
}

function editUserPrompt(message, fallbackContent = '') {
  const text = String(message?.content || fallbackContent || '').trim()
  if (!text) return
  setPromptValue(text, { clearUndo: true })
  els.prompt?.focus?.()
}

function openMessageFolder(message) {
  const target = message.diagnostics?.cwd || message.cwd || state.settings.cwd
  opcClient.openPath?.(target)
}

function createProjectDialog() {
  let onSave = null

  function close() {
    els.projectModal.classList.add('hidden')
    onSave = null
  }

  function open({ mode = 'create', project = null, onSave: saveHandler } = {}) {
    onSave = saveHandler
    const editing = mode === 'edit'
    els.projectModalTitle.textContent = editing ? 'Modifier le projet' : 'Nouveau projet'
    els.projectSave.textContent = editing ? 'Enregistrer' : 'Créer'
    els.projectNameInput.value = project?.name || ''
    els.projectDescriptionInput.value = project?.description || ''
    els.projectMemoryInput.value = project?.memory || ''
    els.projectInstructionsInput.value = project?.instructions || ''
    els.projectModal.classList.remove('hidden')
    requestAnimationFrame(() => {
      els.projectNameInput.focus()
      els.projectNameInput.select()
    })
  }

  els.projectForm.addEventListener('submit', event => {
    event.preventDefault()
    const name = els.projectNameInput.value.replace(/\s+/g, ' ').trim()
    if (!name) {
      els.projectNameInput.focus()
      return
    }
    onSave?.({
      name,
      description: els.projectDescriptionInput.value.replace(/\s+/g, ' ').trim(),
      memory: els.projectMemoryInput.value.trim(),
      instructions: els.projectInstructionsInput.value.trim(),
    })
    close()
  })
  els.projectCancel.addEventListener('click', close)
  els.projectModal.addEventListener('click', event => {
    if (event.target === els.projectModal) close()
  })
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !els.projectModal.classList.contains('hidden')) close()
  })

  return { open, close }
}

const projectDialog = createProjectDialog()

async function exportProject(projectId) {
  const bundle = projectController.exportProjectBundle(projectId)
  if (!bundle || !opcClient.exportProject) return null
  return opcClient.exportProject(bundle)
}

async function importProject() {
  if (!opcClient.importProject) return null
  const result = await opcClient.importProject()
  if (!result?.ok || !result.bundle) return null
  return projectController.importProjectBundle(result.bundle)
}

function setComposerMenuOpen(open) {
  els.composerMenu?.classList.toggle('hidden', !open)
  els.composerPlus?.setAttribute('aria-expanded', open ? 'true' : 'false')
}

async function addFolderFromComposer() {
  setComposerMenuOpen(false)
  if (!opcClient.selectProjectFolder) {
    setComposerStatus('Sélecteur de dossier indisponible.', 'error')
    return null
  }
  setComposerStatus('Sélection du dossier...', 'running')
  const result = await opcClient.selectProjectFolder()
  if (!result?.ok) {
    setComposerStatus(result?.error || 'Ajout du dossier impossible.', 'error')
    return null
  }
  if (!result.folder) {
    setComposerStatus('')
    return null
  }

  applySettingsPatch({ cwd: result.folder }, { persistRuntime: true, renderView: false })
  els.cwd.value = state.settings.cwd
  const project = projectController.activeProject?.()
  if (project?.id && Array.isArray(result.files) && result.files.length) {
    await projectFileController.addSelectedFiles(project.id, result)
  }
  renderer?.render()
  settingsController?.render()
  const count = Array.isArray(result.files) ? result.files.length : 0
  const detail = count ? ` · ${count} fichier${count > 1 ? 's' : ''} indexé${count > 1 ? 's' : ''}` : ''
  setComposerStatus(`Dossier actif: ${shortFolderName(result.folder)}${detail}`, 'done')
  appendLog(`DOSSIER ${result.folder}${count ? ` fichiers=${count}` : ''}`)
  els.prompt?.focus?.()
  return result
}

const chatController = window.OPCChatController.createChatController({
  state,
  store,
  onChange: () => renderer?.render(),
})

const projectController = window.OPCProjectController.createProjectController({
  state,
  store,
  defaultRuntime: runtimePatchFromSettings,
  openProjectEditor: projectDialog.open,
  onChange: () => renderer?.render(),
})

const projectFileController = window.OPCProjectFileController.createProjectFileController({
  projectController,
  opc: opcClient,
  indexer: window.OPCProjectFileIndex,
})

const serviceController = window.OPCServiceController.createServiceController({
  state,
  store,
  taskManager,
  opc: opcClient,
  onInspectorChange: () => renderer?.renderInspector(),
})

const providerController = window.OPCProviderController.createProviderController({
  state,
  store,
  providerHealth,
  opc: opcClient,
  onChange: () => {
    renderer?.render()
    settingsController?.render()
  },
  onInspectorChange: () => {
    renderer?.renderInspector()
    settingsController?.render()
  },
  onRunningControlsChange: () => renderer?.setRunning(state.running),
})

const runController = window.OPCRunController.createRunController({
  state,
  store,
  activity,
  conversation,
  taskManager,
  serviceController,
  chatController,
  projectController,
  providerController,
  opc: opcClient,
  getPrompt: () => els.prompt.value,
  setPrompt: value => {
    setPromptValue(value, { clearUndo: true })
  },
  syncSettings,
  resizePrompt,
  onRender: () => renderer?.render(),
  onMessagesChange: () => renderer?.scheduleRenderMessages(),
  onInspectorChange: () => renderer?.renderInspector(),
  onRunningChange: value => renderer?.setRunning(value),
  appendLog,
})

composerController = window.OPCPromptComposerController.createPromptComposerController({
  els,
  state,
  opc: opcClient,
  runController,
  appendLog,
})

const actions = {
  copyText,
  addProjectFiles: projectId => projectFileController.addProjectFiles(projectId),
  addProjectFolder: projectId => projectFileController.addProjectFolder(projectId),
  createProject: () => projectController.createProject(),
  deleteProject: projectId => projectController.deleteProject(projectId),
  editProject: projectId => projectController.editProject(projectId),
  exportProject,
  editUserPrompt,
  importProject,
  indexProjectFile: (projectId, file) => projectFileController.indexProjectFile(projectId, file),
  indexProjectFiles: projectId => projectFileController.indexProjectFiles(projectId),
  openSpeedReader: text => speedReader.open(text),
  moveChatToProject: (chatId, projectId) => projectController.moveChatToProject(chatId, projectId),
  moveSelectedChatsToProject: projectId => projectController.moveSelectedChatsToProject(projectId),
  openMessageFolder,
  openPath: target => opcClient.openPath?.(target),
  removeProjectFile: (projectId, fileId) => projectController.removeProjectFile(projectId, fileId),
  renameChat: (chatId, title) => chatController.renameChat(chatId, title),
  retryAssistant,
  selectProject: projectId => {
    const project = projectController.selectProject(projectId)
    applyProjectRuntime(project)
    renderer?.render()
    return project
  },
  applyProjectRuntime: projectId => applyProjectRuntime(projectController.projectById(projectId)),
  saveProjectRuntime: projectId => projectController.updateProjectRuntime(projectId, runtimePatchFromSettings()),
  runProviderCheck: model => providerController.runProviderCheck(model),
  stopActiveTask: () => runController.stopActiveTask(),
  toggleChatPinned: (chatId, pinned) => chatController.toggleChatPinned(chatId, pinned),
  toggleChatSelection: (chatId, selected) => projectController.toggleChatSelection(chatId, selected),
  clearChatSelection: () => projectController.clearChatSelection(),
  setProjectFileReadNext: (projectId, fileId, readNext) => projectController.setProjectFileReadNext(projectId, fileId, readNext),
  setProjectFileSearchQuery: (projectId, query) => projectController.setProjectFileSearchQuery(projectId, query),
  updateProjectField: (projectId, field, value) => projectController.updateProjectField(projectId, field, value),
}

settingsController = window.OPCSettingsController.createSettingsController({
  els,
  state,
  store,
  providerController,
  projectController,
  chatController,
  opc: opcClient,
  actions,
  applySettingsPatch,
  applyUiSettings,
  render: () => renderer?.render(),
})

renderer = window.OPCRenderController.createRenderController({
  els,
  state,
  store,
  markdown,
  inspector,
  providerHealth,
  chatController,
  providerController,
  projectController,
  runController,
  serviceController,
  actions,
})

window.OPCReportSelection.install({ copyText })
composerController.wire()

els.stop.addEventListener('click', () => runController.stopActiveTask())
els.composerPlus?.addEventListener('click', event => {
  event.stopPropagation()
  setComposerMenuOpen(els.composerPlus.getAttribute('aria-expanded') !== 'true')
})
els.composerAddFolder?.addEventListener('click', () => {
  void addFolderFromComposer()
})
document.addEventListener('click', event => {
  if (!event.target?.closest?.('.composerMenuWrap')) setComposerMenuOpen(false)
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') setComposerMenuOpen(false)
})
els.newChat.addEventListener('click', () => chatController.createChat())
els.newProject.addEventListener('click', () => {
  const project = projectController.createProject()
  if (project) projectController.updateProjectRuntime(project.id, runtimePatchFromSettings())
})
els.sidebarProjects?.addEventListener('click', () => {
  const project = projectController.createProject()
  if (project) projectController.updateProjectRuntime(project.id, runtimePatchFromSettings())
})
els.sidebarArtifacts?.addEventListener('click', () => {
  els.logsPanel.classList.remove('hidden')
  state.settings.inspectorOpen = true
  store.save()
  renderer.renderInspector()
  settingsController?.render()
})
els.sidebarCustomize?.addEventListener('click', () => settingsController?.open?.())
els.clearHistory.addEventListener('click', () => chatController.clearHistory())
els.sidebarSearch.addEventListener('input', () => {
  store.setSearchQuery(els.sidebarSearch.value)
  renderer.renderProjects()
  renderer.render()
})
els.logsToggle.addEventListener('click', () => {
  els.logsPanel.classList.toggle('hidden')
  state.settings.inspectorOpen = !els.logsPanel.classList.contains('hidden')
  store.save()
  settingsController?.render()
})
els.providerCheck.addEventListener('click', () => providerController.checkSelectedProvider(els.model.value.trim()))
els.think?.addEventListener('click', () => {
  applySettingsPatch({ thinkEnabled: false }, { persistRuntime: true })
  renderer.renderHealthDetail()
})
els.checkAllProviders.addEventListener('click', () => providerController.checkAllProviders())
els.clearLogs.addEventListener('click', () => {
  logBuffer.clear()
})
function persistSettingsFromControls() {
  syncSettings()
  renderer.renderHealthDetail()
  renderer.renderProviderControls()
  renderer.renderInspector()
  store.save()
}

els.composerModel?.addEventListener('change', () => {
  els.model.value = els.composerModel.value
  persistSettingsFromControls()
})

for (const el of [els.cwd, els.model, els.permission, els.memory]) {
  el.addEventListener('change', () => {
    if (el === els.model && els.composerModel) els.composerModel.value = els.model.value
    persistSettingsFromControls()
  })
}
els.project.addEventListener('change', () => {
  projectController.assignActiveChat(els.project.value)
  applyProjectRuntime(projectController.projectById(els.project.value))
  renderer.render()
})


    // Instanciation de la bannière de session
    const resumeBanner = window.createSessionBanner({
      bannerElement: document.querySelector('#resumeBanner'),
      onResume: (session) => {
        // Remplir le prompt, cwd, model et lancer la reprise
        if (session.cwd) document.querySelector('#cwdInput').value = session.cwd
        if (session.model) {
          document.querySelector('#modelInput').value = session.model
          if (document.querySelector('#composerModelInput')) {
            document.querySelector('#composerModelInput').value = session.model
          }
        }
        // Force l'injection de sessionId pour ce run
        const activeChat = chatController.activeChat() || chatController.createChat()
        // On envoie le prompt vide ou 'Continue' pour reprendre
        setPrompt('')
        // On appelle sendPrompt directement mais avec sessionId résolu
        opc.run({
          taskId: session.taskId,
          chatId: activeChat.id,
          prompt: 'Continue from where you left off.',
          cwd: session.cwd,
          model: session.model,
          sessionId: session.id,
          maxTurns: document.querySelector('#maxTurnsInput')?.value || session.maxTurns,
          maxBudgetUsd: document.querySelector('#maxBudgetInput')?.value || session.maxBudgetUsd
        }).catch(err => {
          console.error('Erreur reprise session CLI:', err)
        })
      },
      onDismiss: (session) => {
        opc.sessionMarkDone({ id: session.id })
      }
    })

    window.opc.onResumeAvailable?.(({ sessions }) => {
      resumeBanner.show(sessions)
    })

    // Loop-engine human-in-the-loop gate (ReAct ask-human path).
    const humanGateBanner = window.createConfirmationBanner({
      bannerElement: document.querySelector('#humanGateBanner'),
      invoke: (id, decision) => window.opc.humanGateAsk?.({ id, decision }),
    })
    window.opc.onHumanGatePrompt?.((prompt) => {
      humanGateBanner.show(prompt)
    })

    opcClient.onRunStart(payload => runController.onRunStart(payload))
opcClient.onEvent(event => runController.onCliEvent(event))
opcClient.onRunEnd(payload => runController.onRunEnd(payload))
opcClient.onRuntime?.(payload => {
  runController.onRuntime(payload)
  renderer.renderHealthDetail()
})

async function bootstrap() {
  const hasLocalState = store.load()
  if (!hasLocalState) {
    try {
      const persisted = await opcClient.loadState?.()
      if (persisted?.ok && persisted.state) store.loadFromPayload(persisted.state)
    } catch {
      // Local storage is still enough to start OPC.
    }
  }
  state.longTasks = taskManager?.normalizeTasks?.(state.longTasks || []) || state.longTasks
  applyUiSettings()
  composerController.updatePromptControls()
  renderer.render()
  providerController.refreshHealth().finally(() => serviceController.probeLongTasks(true))
}

bootstrap()

setInterval(() => {
  const hasCheckingProvider = providerController.hasCheckingProvider()
  const hasTrackedServices = serviceController.hasLiveLongTasks()
  if (!state.running && !providerController.isCheckingAll() && !hasCheckingProvider && !hasTrackedServices) return
  renderer.scheduleRenderMessages()
  renderer.renderInspector()
  renderer.renderHealthDetail()
  if (hasTrackedServices) serviceController.probeLongTasks()
}, 1000)
