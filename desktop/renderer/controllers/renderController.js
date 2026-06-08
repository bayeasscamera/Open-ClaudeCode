(function () {
  function createRenderController({
    els,
    state,
    store,
    markdown,
    inspector,
    providerHealth,
    chatController,
    projectController,
    providerController,
    runController,
    serviceController,
    actions,
  } = {}) {
    let modelOptionsSignature = ''
    let projectOptionsSignature = ''
    let renderedChatId = ''
    let welcomeNode = null
    const messageNodes = new Map()
    const messageScroll = window.OPCMessageScroll.createMessageScrollController(els.messages)
    const messageActions = window.OPCMessageActions.createMessageActions({ state, chatController, actions })
    const renderScheduler = window.OPCRenderScheduler.createRenderScheduler({ win: window })
    const runtimeContextView = window.OPCRuntimeContextView.createRuntimeContextView({ actions })
    const messageView = window.OPCMessageView.createMessageView({
      markdown,
      messageActions,
      runtimeContextView,
      runController,
      providerController,
      assistantLabel,
    })
    const projectContextView = window.OPCProjectContextView.createProjectContextView({
      els,
      actions: { ...actions, render },
      projectController,
      store,
      nowLabel,
      projectFileLabel,
    })
    const sidebarView = window.OPCSidebarView.createSidebarView({
      els,
      state,
      store,
      projectController,
      chatController,
      actions,
      nowLabel,
      searchQuery,
      includesQuery,
      render,
    })

    function nowLabel(value = new Date()) {
      const date = value ? new Date(value) : new Date()
      return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(Number.isNaN(date.getTime()) ? new Date() : date)
    }

    function assistantLabel(message) {
      if (message.status === 'running') return 'OPC travaille'
      if (message.status === 'queued') return 'OPC attend son tour'
      if (message.status === 'error') return 'OPC a rencontré une erreur'
      return 'OPC'
    }

    function renderWelcome(chat) {
      const hasUserMessage = (chat?.messages || []).some(message => message.role === 'user')
      const shouldShow = Boolean(chat && !hasUserMessage)
      if (!shouldShow) {
        welcomeNode?.remove?.()
        welcomeNode = null
        return
      }
      if (!welcomeNode) {
        const doc = els.messages?.ownerDocument || globalThis.document
        if (!doc?.createElement) return
        welcomeNode = doc.createElement('section')
        welcomeNode.className = 'welcomePane'
        welcomeNode.innerHTML = '<div class="welcomeTitle"><span aria-hidden="true">✳</span><strong>Bonsoir, Asse.</strong></div>'
      }
      if (welcomeNode.parentNode !== els.messages) {
        els.messages.prepend(welcomeNode)
      } else if (els.messages.firstElementChild !== welcomeNode) {
        els.messages.prepend(welcomeNode)
      }
    }

    function searchQuery() {
      return String(state.ui?.searchQuery || '').toLowerCase()
    }

    function includesQuery(...values) {
      const query = searchQuery()
      if (!query) return true
      return values.some(value => String(value || '').toLowerCase().includes(query))
    }

    function projectFileLabel(file) {
      if (!file?.size) return file?.name || 'Fichier'
      if (file.size < 1024) return `${file.name} · ${file.size} o`
      if (file.size < 1024 * 1024) return `${file.name} · ${(file.size / 1024).toFixed(1)} Ko`
      return `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} Mo`
    }

    function renderInspector() {
      if (!inspector) return
      inspector.renderProviders(els.providerPanel, state.providerProfiles, state.providerChecks || {}, state.settings.model)
      const runtimeQuality = window.OPCRuntimeQualityDashboard?.summarize?.({
        providerFailureHistory: state.providerFailureHistory || [],
        taskCheckpoints: state.taskCheckpoints || [],
        agentTaskLedger: state.agentTaskLedger || [],
        agentWorkers: state.agentWorkers || [],
        runtimeAudit: state.runtimeAudit || [],
        companionJobs: state.companionJobs || [],
      }) || null
      const activeAssistant = chatController.activeAssistant()
      const runtimeRequirements = activeAssistant?.diagnostics?.agentRuntime
        ? {
            requireTools: Boolean(activeAssistant.diagnostics.agentRuntime.requiresTools),
            minInputTokens: Number(activeAssistant.diagnostics.agentRuntime.minInputTokens || 0),
          }
        : {}
      const providerRuntimeDiagnostics = window.OPCProviderRuntimeDiagnostics?.diagnose?.({
        runtime: state.runtime || {},
        assistant: activeAssistant || {},
        profile: providerController?.profileForModel?.(state.settings.model) || null,
        providerCheck: providerController?.selectedProviderCheck?.() || state.providerCheck || null,
        requirements: runtimeRequirements,
        profiles: state.providerProfiles || [],
      }) || null
      inspector.renderTask(els.taskPanel, activeAssistant, chatController.chatForAssistant(activeAssistant), runController.queueLength(), state.longTasks || [], {
        stop: serviceController.stopTrackedTask,
        stopActive: runController.stopActiveTask,
        resumeAgentWorker: taskId => runController.resumeAgentWorker?.(taskId),
        verifyAgentWorker: taskId => runController.verifyAgentWorker?.(taskId),
        interruptAgentWorker: taskId => runController.interruptAgentWorker?.(taskId),
        open: target => actions.openPath?.(target),
      }, state.runtime, state.runtimeAudit || [], state.companionJobs || [], state.agentTaskLedger || [], runtimeQuality, providerRuntimeDiagnostics, state.agentWorkers || [])
    }

    function scheduleRenderMessages() {
      renderScheduler.schedule(renderMessages)
    }

    function setRunning(value) {
      state.running = value
      document.body.classList.toggle('isRunning', value)
      els.send.disabled = !els.prompt.value.trim()
      els.stop.disabled = !value
      els.newChat.disabled = false
      if (els.newProject) els.newProject.disabled = value
      if (els.project) els.project.disabled = value
      els.clearHistory.disabled = value || !state.chats.length
      const providerCheck = providerController.selectedProviderCheck()
      els.providerCheck.disabled = Boolean(providerCheck?.status === 'checking')
      els.checkAllProviders.disabled = providerController.isCheckingAll() || !state.providerProfiles.length
      renderInspector()
    }

    function renderProjects() {
      sidebarView.renderProjects()
    }

    function renderChats() {
      sidebarView.renderChats()
    }

    function renderMessages() {
      if (renderScheduler.activeSelectionDelay() > 0) {
        scheduleRenderMessages()
        return
      }
      const chat = chatController.activeChat()
      const shouldStickToBottom = messageScroll.shouldFollow()
      const scrollAnchor = shouldStickToBottom ? null : messageScroll.captureAnchor()
      if (renderedChatId !== (chat?.id || '')) {
        renderedChatId = chat?.id || ''
        messageNodes.clear()
        projectContextView.reset()
        els.messages.replaceChildren()
        messageScroll.reset()
      }

      projectContextView.renderProjectContext(chat)
      projectContextView.renderEmptyProjectConversation(chat)
      renderWelcome(chat)
      const hasUserMessage = (chat?.messages || []).some(message => message.role === 'user')

      const liveIds = new Set(hasUserMessage ? (chat?.messages || []).map(message => message.id) : [])
      for (const [id, node] of messageNodes.entries()) {
        if (!liveIds.has(id)) {
          node.remove()
          messageNodes.delete(id)
        }
      }

      for (const message of chat?.messages || []) {
        if (!hasUserMessage) continue
        let article = messageNodes.get(message.id)
        if (!article) {
          article = document.createElement('article')
          messageNodes.set(message.id, article)
        }
        messageView.renderArticle(message, article)
        if (els.messages.lastElementChild !== article) els.messages.appendChild(article)
      }
      if (shouldStickToBottom) {
        messageScroll.scrollToBottom()
      } else {
        messageScroll.restoreAnchor(scrollAnchor)
      }
      renderScheduler.markRendered()
    }

    function renderProjectOptions() {
      if (!els.project) return
      const chat = chatController.activeChat()
      const selectedProjectId = chat?.projectId || state.activeProjectId || ''
      const signature = JSON.stringify({
        activeChatId: chat?.id || '',
        activeProjectId: state.activeProjectId || '',
        selectedProjectId,
        projects: (state.projects || []).map(project => [project.id, project.name]),
      })
      if (signature === projectOptionsSignature) {
        els.project.value = selectedProjectId
        return
      }
      projectOptionsSignature = signature
      els.project.innerHTML = ''
      const none = document.createElement('option')
      none.value = ''
      none.textContent = 'Aucun projet'
      els.project.appendChild(none)
      for (const project of state.projects || []) {
        const option = document.createElement('option')
        option.value = project.id
        option.textContent = project.name
        els.project.appendChild(option)
      }
      els.project.value = selectedProjectId
    }

    function renderSettings() {
      els.cwd.value = state.settings.cwd
      els.model.value = state.settings.model
      if (els.composerModel) els.composerModel.value = state.settings.model
      els.permission.value = state.settings.permissionMode
      els.memory.checked = state.settings.memoryEnabled !== false
      renderThinkControl()
    }

    function renderThinkControl() {
      if (!els.think) return
      const supported = providerController.supportsThinking ? providerController.supportsThinking(state.settings.model) : true
      const active = Boolean(state.settings.thinkEnabled && supported)
      els.think.disabled = !supported
      els.think.classList.toggle('active', active)
      els.think.classList.toggle('unsupported', !supported)
      els.think.setAttribute('aria-pressed', active ? 'true' : 'false')
      els.think.title = !supported
        ? `Think non supporté par ${providerController.modelLabel(state.settings.model)}`
        : active
          ? 'Désactiver Think'
          : 'Activer Think'
    }

    function renderHealthDetail() {
      els.healthDot.className = `dot ${state.healthOk ? 'ok' : state.healthError ? 'error' : 'pending'}`
      els.healthText.textContent = state.healthError ? 'Erreur' : state.healthOk ? 'CLI prêt' : 'Vérification'
      if (state.healthError) {
        els.healthDetail.textContent = state.healthError
        return
      }
      if (state.providerConfigError || state.persistenceError) {
        els.healthDot.className = 'dot error'
        els.healthText.textContent = state.providerConfigError ? 'Provider' : 'Sauvegarde'
        els.healthDetail.textContent = state.providerConfigError || state.persistenceError
        return
      }
      const providerCheck = providerController.selectedProviderCheck()
      const providerText = providerCheck
        ? providerCheck.status === 'checking'
          ? 'test modèle...'
          : providerCheck.ok
            ? `modèle OK ${Math.round(providerCheck.latencyMs || 0)}ms`
            : `modèle ${providerHealth?.statusLabel?.(providerCheck) || 'erreur'}`
        : ''
      const capabilityText = providerController.capabilityWarnings?.(state.settings.model)
        ?.filter(item => item !== 'Think non supporté' || state.settings.thinkEnabled)
        ?.slice(0, 2)
        ?.join(' · ') || ''
      els.healthDetail.textContent = [
        state.healthVersion,
        providerController.modelLabel(state.settings.model),
        providerController.capabilityLabel?.(state.settings.model),
        state.memoryEnabled && state.settings.memoryEnabled !== false ? 'mémoire active' : 'mémoire pause',
        state.settings.thinkEnabled ? 'Think actif' : '',
        capabilityText,
        providerText,
      ]
        .filter(Boolean)
        .join(' · ')
    }

    function renderProviderControls() {
      const providerCheck = providerController.selectedProviderCheck()
      els.providerCheck.disabled = Boolean(providerCheck?.status === 'checking')
      els.providerCheck.textContent = providerCheck?.status === 'checking' ? '...' : providerCheck?.ok === false ? '!' : '✓'
      els.providerCheck.title = providerCheck?.status === 'checking'
        ? 'Test du modèle en cours'
        : providerCheck?.ok
          ? `Modèle OK en ${Math.round(providerCheck.latencyMs || 0)}ms${providerCheck.warning ? ` · ${providerCheck.warning}` : ''}`
          : providerCheck
            ? `Erreur modèle: ${providerHealth?.statusLabel?.(providerCheck) || providerCheck?.error || 'échec'}`
            : 'Tester le modèle sélectionné'
      const warnings = providerController.capabilityWarnings?.(state.settings.model)?.filter(Boolean) || []
      if (warnings.length && providerCheck?.status !== 'checking') {
        els.providerCheck.title = `${els.providerCheck.title} · ${warnings.join(' · ')}`
      }
      els.checkAllProviders.disabled = providerController.isCheckingAll() || !state.providerProfiles.length
      els.checkAllProviders.textContent = providerController.isCheckingAll() ? 'Test...' : 'Tester'
    }

    function renderModelOptions() {
      const profiles = providerController.agentProfiles ? providerController.agentProfiles() : state.providerProfiles.filter(profile => profile.agentRunnable !== false)
      const signature = JSON.stringify({
        defaultModel: state.providerDefaultModel,
        profiles: profiles.map(profile => [profile.id, profile.label, profile.model, profile.capabilities]),
        checks: profiles.map(profile => {
          const check = state.providerChecks?.[profile.model] || state.providerChecks?.[profile.id]
          return [profile.model, check?.status, check?.ok, check?.checkedAt, check?.latencyMs, check?.statusCode]
        }),
      })
      if (signature === modelOptionsSignature) {
        if (els.composerModel) els.composerModel.value = els.model.value
        return
      }
      modelOptionsSignature = signature
      const selects = [els.model, els.composerModel].filter(Boolean)
      for (const select of selects) select.innerHTML = ''
      if (!profiles.length && state.providerDefaultModel) {
        for (const select of selects) {
          const option = document.createElement('option')
          option.value = state.providerDefaultModel
          option.textContent = state.providerDefaultModel
          select.appendChild(option)
        }
        return
      }
      for (const profile of profiles) {
        const check = state.providerChecks?.[profile.model] || state.providerChecks?.[profile.id]
        const category = providerHealth?.statusCategory?.(check)
        const healthSuffix = !check
          ? ''
          : check.ok
            ? 'OK'
            : providerHealth?.categoryLabel?.(category) || providerHealth?.statusLabel?.(check) || ''
        const warnings = providerController.capabilityWarnings?.(profile) || []
        const capability = providerController.capabilityLabel?.(profile) || ''
        for (const select of selects) {
          const option = document.createElement('option')
          option.value = profile.model
          option.textContent = [providerController.profileOptionLabel(profile), capability, healthSuffix].filter(Boolean).join(' · ')
          option.title = [
            capability || 'capacité inconnue',
            warnings.length ? warnings.join(' · ') : 'Compatible agent CLI',
            providerHealth?.title?.(check) || '',
          ].filter(Boolean).join('\n')
          select.appendChild(option)
        }
      }
      for (const select of selects) select.value = state.settings.model
    }

    function render() {
      renderProjects()
      renderChats()
      renderModelOptions()
      renderProjectOptions()
      renderSettings()
      renderMessages()
      setRunning(state.running)
      renderHealthDetail()
      renderProviderControls()
      renderInspector()
    }

    return {
      render,
      renderHealthDetail,
      renderInspector,
      renderMessages,
      renderModelOptions,
      renderProviderControls,
      renderProjectOptions,
      renderProjects,
      renderSettings,
      scheduleRenderMessages,
      setRunning,
    }
  }

  window.OPCRenderController = { createRenderController }
})()
