(function () {
  const MAX_ACTIVITY_TOOLS = 18
  const AUTO_CONTINUE_PROMPT = 'continue'
  const AUTO_CONTINUE_MAX = 3

  function createRunController({
    state,
    store,
    activity,
    conversation,
    taskManager,
    serviceController,
    chatController,
    projectController,
    providerController = null,
    opc = window.opc,
    getPrompt = () => '',
    setPrompt = () => {},
    syncSettings = () => {},
    resizePrompt = () => {},
    onRender = () => {},
    onMessagesChange = () => {},
    onInspectorChange = () => {},
    onRunningChange = () => {},
    appendLog = () => {},
    maxActivityTools = MAX_ACTIVITY_TOOLS,
  } = {}) {
    const taskQueue = window.OPCRunTaskQueue.createRunTaskQueue()
    const runtimeState = window.OPCRunRuntimeState.createRunRuntimeState({
      state,
      store,
      getQueueLength: () => taskQueue.length(),
      onRunningChange,
      onInspectorChange,
    })
    const addRuntimeAudit = runtimeState.addRuntimeAudit
    const currentRuntime = runtimeState.currentRuntime
    const runtimeSnapshot = runtimeState.runtimeSnapshot
    const setRuntime = runtimeState.setRuntime
    const setRunning = runtimeState.setRunning
    const upsertCompanionJob = runtimeState.upsertCompanionJob
    const finishTaskCheckpoint = runtimeState.finishTaskCheckpoint
    const enqueueAgentTask = runtimeState.enqueueAgentTask
    const markAgentTaskDone = runtimeState.markAgentTaskDone
    const markAgentTaskError = runtimeState.markAgentTaskError
    const markAgentTaskInterrupted = runtimeState.markAgentTaskInterrupted
    const markAgentTaskNeedsVerification = runtimeState.markAgentTaskNeedsVerification
    const markAgentTaskRunning = runtimeState.markAgentTaskRunning
    const recordTaskCheckpoint = runtimeState.recordTaskCheckpoint
    const recordAgentTaskTool = runtimeState.recordAgentTaskTool
    const resumeAgentWorkerState = runtimeState.resumeAgentWorker
    const verifyAgentWorkerState = runtimeState.verifyAgentWorker
    const interruptAgentWorkerState = runtimeState.interruptAgentWorker
    const verificationEngine = window.OPCAgentVerificationEngine
    const runtimeDiagnostics = window.OPCRuntimeDiagnostics
    const completionGuard = window.OPCCompletionGuard
    const runDiagnostics = runtimeDiagnostics.createRunDiagnostics
    const diagnosticItems = runtimeDiagnostics.diagnosticItems
    const sessionProgress = runtimeDiagnostics.sessionProgress
    const requestPlanner = window.OPCRunRequestPlanner.createRunRequestPlanner({
      state,
      store,
      conversation,
      taskManager,
      projectController,
    })
    const resumeRecovery = window.OPCRunResumeRecovery.createRunResumeRecovery({
      state,
      store,
      chatController,
      runDiagnostics,
      addRuntimeAudit,
      upsertCompanionJob,
    })

    function updateDiagnostics(assistant, event, text) {
      return runtimeDiagnostics.updateDiagnostics(assistant, event, text, {
        fallbackModel: state.settings.model,
        chatForAssistant: item => chatController.chatForAssistant(item),
      })
    }

    function runEndFailureText(payload = {}) {
      const detail = String(payload.stderr || payload.result || payload.stdout || '').trim()
      if (detail) return detail.length > 2400 ? `...${detail.slice(-2397)}` : detail
      return payload.reason || `Process terminé avec code ${payload.code}.`
    }

    function runEndSuccessText(payload = {}) {
      const detail = String(payload.result || payload.stdout || '').trim()
      if (detail) return detail.length > 2400 ? `...${detail.slice(-2397)}` : detail
      return ''
    }

    function modelForAssistant(assistant, payload = {}) {
      return payload.model || assistant?.model || assistant?.diagnostics?.model || state.settings.model || ''
    }

    function checkpointEndStatus(payload = {}, recoverResume = false) {
      if (recoverResume) return 'interrupted'
      if (payload.reason === 'stopped') return 'stopped'
      if (payload.reason === 'idle-timeout') return 'interrupted'
      return payload.code === 0 ? 'done' : 'error'
    }

    function recordProviderFailureIfNeeded({ assistant, payload = {}, activeTask = null, failureText = '' } = {}) {
      if (!window.OPCProviderFailurePolicy || payload.code === 0) return null
      const model = modelForAssistant(assistant, payload)
      if (!model) return null
      state.providerFailureHistory = window.OPCProviderFailurePolicy.recordFailure(state.providerFailureHistory || [], {
        model,
        reason: failureText || payload.reason || `code ${payload.code}`,
        code: payload.code,
        taskId: payload.taskId || assistant?.diagnostics?.taskId || '',
        assistantId: assistant?.id || '',
        category: payload.reason || 'run-end',
      })
      const requirements = activeTask?.payload?.agentRuntimeProfile?.requirements || {}
      const recommendation = window.OPCProviderFailurePolicy.recommend({
        history: state.providerFailureHistory,
        selectedModel: model,
        profiles: state.providerProfiles || [],
        requirements: {
          requireAgent: true,
          requireTools: Boolean(requirements.requireTools || activeTask?.payload?.actionPrompt),
          minInputTokens: requirements.minInputTokens || activeTask?.payload?.contextBudget?.contextBudget?.estimatedTokens || 0,
        },
      })
      if (recommendation?.shouldFallback) {
        addRuntimeAudit('provider-fallback', {
          taskId: payload.taskId || assistant?.diagnostics?.taskId || '',
          assistantId: assistant?.id || '',
          status: 'warning',
          label: recommendation.label,
          detail: recommendation.detail,
        })
      }
      return recommendation
    }

    function applyRuntimeDiagnostics(assistant, payload = {}) {
      if (!assistant) return
      assistant.diagnostics ||= runDiagnostics(assistant.model || state.settings.model, payload.taskId || '')
      const diagnostics = assistant.diagnostics
      diagnostics.taskId = payload.taskId || diagnostics.taskId
      diagnostics.pid = payload.pid || diagnostics.pid
      diagnostics.cwd = payload.cwd || diagnostics.cwd || assistant.cwd
      diagnostics.model = payload.model || diagnostics.model || assistant.model
      diagnostics.startedAt = payload.startedAt || diagnostics.startedAt
      diagnostics.lastActivityAt = payload.lastActivityAt || payload.updatedAt || diagnostics.lastActivityAt
      diagnostics.durationMs = payload.status === 'finished' ? payload.durationMs || diagnostics.durationMs : diagnostics.durationMs
      diagnostics.eventCount = payload.eventCount ?? diagnostics.eventCount
      diagnostics.providerEventCount = payload.providerEventCount ?? diagnostics.providerEventCount
      diagnostics.providerMessage = payload.providerStatus || diagnostics.providerMessage
      diagnostics.providerElapsedMs = payload.providerElapsedMs || diagnostics.providerElapsedMs
      diagnostics.providerAttempt = payload.providerAttempt || diagnostics.providerAttempt
      diagnostics.providerMaxRetries = payload.providerMaxRetries
      diagnostics.toolCount = payload.toolCount ?? diagnostics.toolCount
      diagnostics.firstTextAt = payload.firstTextAt || diagnostics.firstTextAt
      diagnostics.runtimePhase = payload.phase || diagnostics.runtimePhase
      diagnostics.runtimePhaseLabel = payload.phaseLabel || diagnostics.runtimePhaseLabel
      diagnostics.runtimeStatusText = payload.statusText || diagnostics.runtimeStatusText
      diagnostics.currentTool = payload.currentTool || diagnostics.currentTool
      diagnostics.idleMs = payload.idleMs || diagnostics.idleMs
      if (Array.isArray(payload.recentEvents)) assistant.runtimeSteps = payload.recentEvents.slice(-8)
      if (payload.currentTool?.detail) {
        assistant.focus = payload.currentTool.detail
      } else if (payload.statusText) {
        assistant.focus = payload.statusText
      }
    }

    function queueLength() {
      return taskQueue.length()
    }

    function auditCommandDecision({ taskId, assistantId = '', commandIntent = {}, approvedCommand = '', allowedTools = [], skipPermissions = false, permissionDecision = null }) {
      addRuntimeAudit('decision', window.OPCRunAudit.commandDecisionAudit({
        taskId,
        assistantId,
        commandIntent,
        approvedCommand,
        allowedTools,
        skipPermissions,
        permissionDecision,
        permissionMode: state.settings.permissionMode,
      }))
    }

    function currentLedgerEntry(taskId) {
      return (state.agentTaskLedger || []).find(entry => entry.id === taskId) || null
    }

    function markTaskAfterSuccess(taskId, assistant, patch = {}) {
      const task = currentLedgerEntry(taskId)
      const verdict = verificationEngine?.evaluateTaskVerification?.({
        task,
        assistant,
        payload: patch.payload || {},
      })
      if (verdict?.status === 'verified') {
        return markAgentTaskDone(taskId, {
          assistantId: assistant?.id || patch.assistantId || '',
          result: patch.result || assistant?.content || '',
          verification: verdict.command,
          detail: verdict.detail,
        })
      }
      if (verdict?.status === 'needs_verification') {
        return markAgentTaskNeedsVerification(taskId, {
          assistantId: assistant?.id || patch.assistantId || '',
          result: patch.result || assistant?.content || '',
          detail: verdict.detail,
        })
      }
      return markAgentTaskDone(taskId, {
        assistantId: assistant?.id || patch.assistantId || '',
        result: patch.result || assistant?.content || '',
        detail: patch.detail || verdict?.detail || 'Execution terminee',
      })
    }

    function reusableTaskMessage(reusableTask, prompt, cwd = state.settings.cwd) {
      return window.OPCRunTaskPlanner.reusableTaskMessage({
        reusableTask,
        prompt,
        cwd,
        model: state.settings.model,
        makeId: store.makeId,
      })
    }

    function preliminaryRequirements(prompt = '', { actionPrompt = false } = {}) {
      return window.OPCAgentRuntimeProfile?.taskRequirements?.({
        prompt,
        actionPrompt,
        commandIntent: conversation.commandIntentForPrompt?.(prompt, chatController.activeChat?.(), state.settings.permissionMode) || {},
      }) || { requireTools: Boolean(actionPrompt), minInputTokens: 0 }
    }

    function providerPreflight({ requireTools = false, minInputTokens = 0, requirements = null } = {}) {
      if (!providerController?.preflightForModel) {
        return {
          ok: true,
          model: state.settings.model,
          warnings: [],
          adjusted: [],
          thinkEnabled: false,
        }
      }
      return providerController.preflightForModel(state.settings.model, {
        thinkEnabled: Boolean(state.settings.thinkEnabled),
        requireAgent: true,
        requireTools,
        minInputTokens,
        requirements: requirements || {},
      })
    }

    async function providerPreflightWithRefresh(options = {}) {
      let preflight = providerPreflight(options)
      const errorText = String(preflight.error || '')
      const canRefresh = Boolean(providerController?.refreshHealth)
      const looksLikeStaleProviderSnapshot = !preflight.ok && /mal configur|introuvable|authentification|clé API/i.test(errorText)
      if (!canRefresh || !looksLikeStaleProviderSnapshot) return preflight
      try {
        await providerController.refreshHealth()
        preflight = providerPreflight(options)
      } catch {
        // Keep the original actionable preflight error if the refresh itself fails.
      }
      return preflight
    }

    function isCheckpointResumePrompt(prompt = '') {
      const text = String(prompt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
      return /^(continue|continuer|reprends|reprendre|resume|reprise)\b/.test(text)
    }

    function checkpointResumeForPrompt(prompt = '') {
      if (!isCheckpointResumePrompt(prompt) || !window.OPCTaskCheckpointStore?.createTaskCheckpointStore) return null
      const checkpointStore = window.OPCTaskCheckpointStore.createTaskCheckpointStore({
        checkpoints: state.taskCheckpoints || [],
      })
      const checkpoint = checkpointStore.resumeCandidate({ model: state.settings.model, cwd: state.settings.cwd })
        || checkpointStore.resumeCandidate({ cwd: state.settings.cwd })
        || checkpointStore.resumeCandidate({})
      if (!checkpoint) return null
      const resumePrompt = window.OPCTaskCheckpointSummarizer?.buildResumePrompt
        ? window.OPCTaskCheckpointSummarizer.buildResumePrompt(checkpoint, { userPrompt: prompt }).text
        : [
            'CHECKPOINT OPC',
            `Tâche checkpoint: ${checkpoint.id}`,
            `Statut: ${checkpoint.status || 'inconnu'}`,
            checkpoint.error ? `Erreur: ${checkpoint.error}` : '',
            checkpoint.nextAction ? `Action attendue: ${checkpoint.nextAction}` : '',
            `DEMANDE UTILISATEUR ACTUELLE: ${prompt}`,
          ].filter(Boolean).join('\n')
      return {
        checkpoint,
        prompt: resumePrompt,
        summary: checkpointStore.summarize(checkpoint),
      }
    }

    function applyProviderAutoRouter(requirements = {}) {
      if (!window.OPCProviderFailurePolicy?.applyControlledAutoRoute) return null
      const selectedModel = state.settings.model
      const result = window.OPCProviderFailurePolicy.applyControlledAutoRoute({
        enabled: Boolean(state.settings.providerAutoRouterEnabled),
        history: state.providerFailureHistory || [],
        selectedModel,
        profiles: state.providerProfiles || [],
        requirements: {
          requireAgent: true,
          ...requirements,
        },
        threshold: Number(state.settings.providerAutoRouterThreshold || 2),
      })
      if (!result?.switched || !result.model || result.model === selectedModel) return result
      state.settings.model = result.model
      addRuntimeAudit('provider-auto-router', {
        command: '',
        source: 'provider-failure-history',
        permissionMode: state.settings.permissionMode,
        skipPermissions: false,
        trusted: false,
        status: result.audit?.status || 'warning',
        label: result.audit?.label || 'Provider auto-router',
        detail: result.audit?.detail || `Fallback vers ${result.model}`,
      })
      return result
    }

    function preflightErrorMessage(preflight) {
      return window.OPCRunTaskPlanner.preflightErrorMessage(preflight)
    }

    function autoContinueLimitReached(task) {
      const max = Number(task?.payload?.agentRuntimeProfile?.autoContinue?.max || AUTO_CONTINUE_MAX)
      return Number(task?.payload?.autoContinueCount || 0) >= Math.max(1, max)
    }

    function autoContinuePrompt(previousAssistant = {}, previousTask = {}) {
      const decision = previousAssistant.diagnostics?.completionGuard || {}
      const originalPrompt = previousTask.payload?.displayPrompt || ''
      const worker = (state.agentWorkers || []).find(item => item.id === previousTask.id || item.taskId === previousTask.id)
      const checkpoint = (state.taskCheckpoints || []).find(item => item.id === previousTask.id)
      const workerPrompt = worker && window.OPCAgentWorkerRuntime?.resumePrompt
        ? window.OPCAgentWorkerRuntime.resumePrompt(worker, checkpoint).replace(/^continue\s*/i, '').trim()
        : ''
      if (decision.prompt) return [decision.prompt, workerPrompt].filter(Boolean).join('\n\n')
      if (decision.reason === 'runtime-required-verification') {
        return [
          AUTO_CONTINUE_PROMPT,
          '',
          'OPC runtime: la tâche précédente a modifié ou exécuté une action, mais aucune vérification fraîche n’a été observée.',
          'Lance maintenant le test minimal ciblé le plus pertinent. Si le test échoue, corrige la cause avant de passer à une autre étape.',
          originalPrompt ? `Tâche originale: ${originalPrompt}` : '',
          workerPrompt,
        ].filter(Boolean).join('\n')
      }
      if (decision.reason === 'runtime-required-tool-evidence') {
        return [
          AUTO_CONTINUE_PROMPT,
          '',
          "OPC runtime: la tâche précédente s'est terminée sans outil réel alors que le profil runtime exige une exécution.",
          'Utilise maintenant les outils nécessaires dans ce tour, puis lance un test minimal avant de conclure.',
          originalPrompt ? `Tâche originale: ${originalPrompt}` : '',
          workerPrompt,
        ].filter(Boolean).join('\n')
      }
      return [AUTO_CONTINUE_PROMPT, workerPrompt].filter(Boolean).join('\n\n')
    }

    function shouldAutoContinue({ assistant, payload = {}, activeTask }) {
      if (!assistant || payload.code !== 0) return false
      if (payload.reason === 'stopped' || payload.reason === 'idle-timeout') return false
      if (autoContinueLimitReached(activeTask)) return false
      if (completionGuard?.evaluateCompletion) {
        const decision = completionGuard.evaluateCompletion({ assistant, payload, activeTask, activity })
        assistant.diagnostics ||= runDiagnostics(assistant.model || state.settings.model, payload.taskId || '')
        assistant.diagnostics.completionGuard = decision
        if (decision.phase || decision.nextPhase) assistant.diagnostics.agentStep = decision
        return Boolean(decision.shouldContinue)
      }
      const text = [assistant.content, payload.result, payload.stdout].filter(Boolean).join('\n')
      if (activity.asksForContinuation?.(text)) return true
      const toolCount = Number(assistant.diagnostics?.toolCount || 0)
      const visibleTools = Array.isArray(assistant.tools) ? assistant.tools.length : 0
      return toolCount === 0 && visibleTools === 0 && Boolean(activity.promisesActionWithoutTool?.(text))
    }

    function enqueueAutoContinue({ chat, previousAssistant, previousTask }) {
      if (!chat || !previousAssistant || !previousTask) return false
      const previousRequirements = previousTask.payload?.agentRuntimeProfile?.requirements || {}
      const preflight = providerPreflight({
        requireTools: Boolean(previousTask.payload?.actionPrompt || previousRequirements.requireTools),
        minInputTokens: previousRequirements.minInputTokens || 0,
        requirements: previousRequirements,
      })
      if (!preflight.ok) return false
      const continuationPrompt = autoContinuePrompt(previousAssistant, previousTask)
      const planned = requestPlanner.plan({ prompt: continuationPrompt, chat })
      const {
        effectiveCwd,
        commandIntent,
        approvedCommand,
        reusableTask,
        project,
        projectRuntimeContext,
        rescueMode,
        contextBudget,
        cliPrompt,
        allowedTools,
        permissions,
        agentRuntimeProfile,
        taskId,
        sessionId,
      } = planned
      if (reusableTask) return false
      if (project?.files?.some(file => file.readNext)) projectController?.clearProjectFileReadNext?.(project.id)

      const autoContinueCount = Number(previousTask.payload?.autoContinueCount || 0) + 1
      const inheritedActionPrompt = Boolean(previousTask.payload?.actionPrompt)
      const inheritedAllowedTools = inheritedActionPrompt && Array.isArray(previousTask.payload?.allowedTools) && previousTask.payload.allowedTools.length
        ? previousTask.payload.allowedTools
        : allowedTools
      const inheritedPermissions = inheritedActionPrompt
        ? { ...permissions, actionPrompt: true, reason: permissions.reason === 'message standard' ? 'continuation action precedente' : permissions.reason }
        : permissions
      const userMessage = {
        id: store.makeId('user'),
        role: 'user',
        content: AUTO_CONTINUE_PROMPT,
        autoContinue: true,
        createdAt: new Date().toISOString(),
      }
      const assistant = {
        id: store.makeId('assistant'),
        role: 'assistant',
        content: '',
        events: ['relance auto'],
        tools: [],
        focus: 'Continuation automatique',
        cwd: effectiveCwd,
        model: state.settings.model,
        projectId: chat.projectId || '',
        projectRuntimeContext,
        commandIntent,
        permissionDecision: inheritedPermissions,
        autoContinue: true,
        previousAssistantId: previousAssistant.id,
        diagnostics: {
          ...runDiagnostics(state.settings.model, taskId),
          queuedAt: Date.now(),
          autoContinueCount,
          agentRuntime: agentRuntimeProfile?.diagnostics || null,
        },
        status: 'queued',
        createdAt: new Date().toISOString(),
      }
      chat.messages.push(userMessage, assistant)
      taskQueue.push({
        id: taskId,
        chatId: chat.id,
        assistantId: assistant.id,
        payload: {
          taskId,
          assistantId: assistant.id,
          chatId: chat.id,
          projectId: chat.projectId || '',
          prompt: cliPrompt,
          displayPrompt: AUTO_CONTINUE_PROMPT,
          cwd: effectiveCwd,
          model: state.settings.model,
          permissionMode: state.settings.permissionMode,
          sessionId,
          allowedTools: inheritedAllowedTools,
          skipPermissions: inheritedPermissions.skipPermissions,
          trustedWorkspaceRoot: inheritedPermissions.trustedWorkspaceRoot,
          workspaceTrusted: inheritedPermissions.workspaceTrusted,
          memoryEnabled: state.settings.memoryEnabled,
          thinkEnabled: Boolean(preflight.thinkEnabled),
          effort: preflight.thinkEnabled ? 'high' : '',
          providerCapabilities: preflight.capabilities || {},
          providerCapabilityWarnings: preflight.warnings || [],
          providerPreflight: {
            adjusted: preflight.adjusted || [],
            warnings: preflight.warnings || [],
          },
          projectRuntimeContext,
          contextBudget: contextBudget?.context?.contextBudget || contextBudget || null,
          agentRuntimeProfile,
          commandIntent,
          permissionDecision: inheritedPermissions,
          rescueMode,
          actionPrompt: inheritedActionPrompt,
          maxTurns: '',
          autoContinue: true,
          autoContinueCount,
          previousAssistantId: previousAssistant.id,
        },
      })
      enqueueAgentTask({
        taskId,
        assistantId: assistant.id,
        chatId: chat.id,
        projectId: chat.projectId || '',
        prompt: continuationPrompt,
        model: state.settings.model,
        cwd: effectiveCwd,
        command: commandIntent.command || approvedCommand || '',
        detail: 'Continuation automatique',
        agentRuntimeProfile,
      })
      recordTaskCheckpoint(taskId, {
        assistantId: assistant.id,
        chatId: chat.id,
        projectId: chat.projectId || '',
        prompt: continuationPrompt,
        model: state.settings.model,
        cwd: effectiveCwd,
        command: commandIntent.command || approvedCommand || '',
        phase: 'queued',
        status: 'queued',
        nextAction: 'reprendre la continuation automatique',
      })
      upsertCompanionJob(taskId, {
        assistantId: assistant.id,
        chatId: chat.id,
        title: 'Continuation automatique',
        status: state.running ? 'queued' : 'running',
        model: state.settings.model,
        cwd: effectiveCwd,
        command: commandIntent.command || approvedCommand || '',
        permissionMode: state.settings.permissionMode,
        permissionDecision: inheritedPermissions,
        phase: 'auto-continue',
        summary: `Relance ${autoContinueCount}/${agentRuntimeProfile?.autoContinue?.max || AUTO_CONTINUE_MAX}`,
      })
      addRuntimeAudit('auto-continue', {
        taskId,
        assistantId: assistant.id,
        command: commandIntent.command || approvedCommand || '',
        source: previousAssistant.diagnostics?.completionGuard?.reason || 'assistant-continuation',
        permissionMode: state.settings.permissionMode,
        skipPermissions: Boolean(inheritedPermissions.skipPermissions),
        trusted: Boolean(commandIntent.trusted),
        status: 'ok',
        label: previousAssistant.diagnostics?.completionGuard?.label || 'Continuation automatique',
        detail: [
          previousAssistant.diagnostics?.completionGuard?.detail || '',
          `relance ${autoContinueCount}/${agentRuntimeProfile?.autoContinue?.max || AUTO_CONTINUE_MAX}`,
        ].filter(Boolean).join(' · '),
      })
      setRuntime('queued', { lastError: '' })
      return true
    }

    async function sendPrompt() {
      const prompt = getPrompt().trim()
      if (!prompt) return
      let chat = chatController.activeChat()
      if (!chat) chat = store.createChat({ projectId: state.activeProjectId || '' })
      if (!chat) return

      syncSettings()
      if (chat.title === 'Nouvelle conversation') chat.title = store.titleFromPrompt(prompt)
      const checkpointResume = checkpointResumeForPrompt(prompt)
      const planningPrompt = checkpointResume?.prompt || prompt
      const actionPrompt = Boolean(conversation.isActionPrompt?.(planningPrompt))
      const requirements = preliminaryRequirements(planningPrompt, { actionPrompt })
      applyProviderAutoRouter(requirements)
      const preflight = await providerPreflightWithRefresh({
        requireTools: Boolean(requirements.requireTools || actionPrompt),
        minInputTokens: requirements.minInputTokens || 0,
        requirements,
      })
      if (preflight.ok && Boolean(state.settings.thinkEnabled) !== Boolean(preflight.thinkEnabled)) {
        state.settings.thinkEnabled = Boolean(preflight.thinkEnabled)
        addRuntimeAudit('preflight', {
          command: '',
          source: 'provider-capabilities',
          permissionMode: state.settings.permissionMode,
          skipPermissions: false,
          trusted: false,
          status: 'warning',
          label: 'Préflight modèle',
          detail: preflight.adjusted?.join(' · ') || 'Paramètres ajustés',
        })
      }
      if (!preflight.ok) {
        chat.messages.push({ id: store.makeId('user'), role: 'user', content: prompt, createdAt: new Date().toISOString() })
        chat.messages.push({
          id: store.makeId('assistant'),
          role: 'assistant',
          content: preflightErrorMessage(preflight),
          events: [],
          tools: [],
          focus: preflight.error || 'Modèle incompatible',
          cwd: state.settings.cwd,
          model: state.settings.model,
          diagnostics: {
            ...runDiagnostics(state.settings.model, store.makeId('task')),
            capabilityWarnings: preflight.warnings || [],
            completionGuard: {
              actionPrompt,
              preflightBlocked: true,
            },
          },
          status: 'error',
          createdAt: new Date().toISOString(),
        })
        addRuntimeAudit('preflight', {
          command: '',
          source: 'provider-capabilities',
          permissionMode: state.settings.permissionMode,
          skipPermissions: false,
          trusted: false,
          status: 'error',
          label: 'Modèle incompatible',
          detail: preflight.error || '',
        })
        onRender()
        store.save()
        return
      }
      const planned = requestPlanner.plan({ prompt: planningPrompt, chat })
      const maxTurnsVal = typeof document !== 'undefined' ? document.querySelector('#maxTurnsInput')?.value : ''
      const maxBudgetVal = typeof document !== 'undefined' ? document.querySelector('#maxBudgetInput')?.value : ''
      const {
        effectiveCwd,
        commandIntent,
        approvedCommand,
        reusableTask,
        project,
        projectRuntimeContext,
        rescueMode,
        contextBudget,
        agentRuntimeProfile,
        cliPrompt,
        allowedTools,
        permissions,
        taskId,
        sessionId,
      } = planned
      if (permissions?.advanced?.blocked) {
        const assistantId = store.makeId('assistant')
        const message = permissions.advanced.label || 'Action critique bloquée'
        const detail = permissions.advanced.detail || permissions.advanced.reason || ''
        chat.messages.push({ id: store.makeId('user'), role: 'user', content: prompt, createdAt: new Date().toISOString() })
        chat.messages.push({
          id: assistantId,
          role: 'assistant',
          content: `${message}. OPC n’a pas envoyé cette tâche au CLI. Désactive le mode strict uniquement si cette action est volontaire et maîtrisée.`,
          events: ['permissions'],
          tools: [],
          focus: message,
          cwd: effectiveCwd,
          model: state.settings.model,
          projectId: chat.projectId || '',
          commandIntent,
          permissionDecision: permissions,
          diagnostics: {
            ...runDiagnostics(state.settings.model, taskId),
            completionGuard: {
              actionPrompt,
              permissionBlocked: true,
            },
          },
          status: 'error',
          createdAt: new Date().toISOString(),
        })
        addRuntimeAudit('permission-blocked', {
          taskId,
          assistantId,
          command: commandIntent.command || approvedCommand || '',
          source: commandIntent.source || 'advanced-permission-policy',
          permissionMode: state.settings.permissionMode,
          skipPermissions: false,
          trusted: Boolean(commandIntent.trusted),
          status: 'error',
          label: message,
          detail,
        })
        setRuntime('error', { activeTaskId: taskId, activeAssistantId: assistantId, lastError: message })
        setPrompt('')
        resizePrompt()
        onRender()
        store.save()
        return
      }
      if (reusableTask) {
        chat.messages.push({ id: store.makeId('user'), role: 'user', content: prompt, createdAt: new Date().toISOString() })
        chat.messages.push(reusableTaskMessage(reusableTask, prompt, effectiveCwd))
        addRuntimeAudit('reuse', {
          command: approvedCommand,
          source: commandIntent.source || '',
          permissionMode: state.settings.permissionMode,
          skipPermissions: Boolean(commandIntent.skipPermissions),
          trusted: Boolean(commandIntent.trusted),
          status: 'ok',
          label: 'Tache longue reutilisee',
          detail: reusableTask.url || reusableTask.serviceSummary || reusableTask.status || '',
        })
        setPrompt('')
        resizePrompt()
        onRender()
        store.save()
        serviceController.probeLongTasks(true)
        return
      }

      if (project?.files?.some(file => file.readNext)) projectController?.clearProjectFileReadNext?.(project.id)

      chat.messages.push({ id: store.makeId('user'), role: 'user', content: prompt, createdAt: new Date().toISOString() })
      const assistant = {
        id: store.makeId('assistant'),
        role: 'assistant',
        content: '',
        events: [],
        tools: [],
        focus: '',
        cwd: effectiveCwd,
        model: state.settings.model,
        projectId: chat.projectId || '',
        projectRuntimeContext,
        commandIntent,
        permissionDecision: permissions,
        diagnostics: {
          ...runDiagnostics(state.settings.model, taskId),
          queuedAt: Date.now(),
          agentRuntime: agentRuntimeProfile?.diagnostics || null,
        },
        status: 'queued',
        createdAt: new Date().toISOString(),
      }
      chat.messages.push(assistant)
      taskQueue.push({
        id: taskId,
        chatId: chat.id,
        assistantId: assistant.id,
        payload: {
          taskId,
          assistantId: assistant.id,
          chatId: chat.id,
          projectId: chat.projectId || '',
          prompt: cliPrompt,
          displayPrompt: prompt,
          resumeCheckpoint: checkpointResume?.checkpoint || null,
          cwd: effectiveCwd,
          model: state.settings.model,
          permissionMode: state.settings.permissionMode,
          sessionId,
          allowedTools,
          skipPermissions: permissions.skipPermissions,
          trustedWorkspaceRoot: permissions.trustedWorkspaceRoot,
          workspaceTrusted: permissions.workspaceTrusted,
          memoryEnabled: state.settings.memoryEnabled,
          thinkEnabled: Boolean(preflight.thinkEnabled),
          effort: preflight.thinkEnabled ? 'high' : '',
          providerCapabilities: preflight.capabilities || {},
          providerCapabilityWarnings: preflight.warnings || [],
          providerPreflight: {
            adjusted: preflight.adjusted || [],
            warnings: preflight.warnings || [],
          },
          projectRuntimeContext,
          contextBudget: contextBudget?.context?.contextBudget || contextBudget || null,
          agentRuntimeProfile,
          commandIntent,
          permissionDecision: permissions,
          rescueMode,
          actionPrompt: planned.actionPrompt,
          maxTurns: maxTurnsVal ? Number(maxTurnsVal) : '',
          maxBudgetUsd: maxBudgetVal ? Number(maxBudgetVal) : '',
        },
      })
      enqueueAgentTask({
        taskId,
        assistantId: assistant.id,
        chatId: chat.id,
        projectId: chat.projectId || '',
        prompt: planningPrompt,
        model: state.settings.model,
        cwd: effectiveCwd,
        command: commandIntent.command || approvedCommand || '',
        detail: checkpointResume?.summary || (state.running ? 'En file d’attente' : 'Prêt à lancer'),
        agentRuntimeProfile,
      })
      recordTaskCheckpoint(taskId, {
        assistantId: assistant.id,
        chatId: chat.id,
        projectId: chat.projectId || '',
        prompt: planningPrompt,
        model: state.settings.model,
        cwd: effectiveCwd,
        command: commandIntent.command || approvedCommand || '',
        phase: 'queued',
        status: 'queued',
        nextAction: 'reprendre la tâche depuis la file',
      })
      upsertCompanionJob(taskId, {
        assistantId: assistant.id,
        chatId: chat.id,
        title: rescueMode ? `Rescue · ${prompt.replace(/^\/opc:rescue\s*/i, '').trim() || prompt}` : prompt,
        status: state.running ? 'queued' : 'running',
        model: state.settings.model,
        cwd: effectiveCwd,
        command: commandIntent.command || approvedCommand || '',
        permissionMode: state.settings.permissionMode,
        permissionDecision: permissions,
        phase: rescueMode ? 'rescue' : '',
        summary: rescueMode ? 'Mode Rescue OPC' : state.running ? 'En file d’attente' : 'Prêt à lancer',
      })
      auditCommandDecision({
        taskId,
        assistantId: assistant.id,
        commandIntent,
        approvedCommand,
        allowedTools,
        skipPermissions: permissions.skipPermissions,
        permissionDecision: permissions,
      })
      if (checkpointResume) {
        addRuntimeAudit('checkpoint-resume', {
          taskId,
          assistantId: assistant.id,
          command: checkpointResume.checkpoint.command || commandIntent.command || approvedCommand || '',
          source: 'task-checkpoint',
          permissionMode: state.settings.permissionMode,
          skipPermissions: Boolean(permissions.skipPermissions),
          trusted: Boolean(commandIntent.trusted),
          status: 'warning',
          label: 'Reprise checkpoint',
          detail: checkpointResume.summary || checkpointResume.checkpoint.id,
        })
      }
      setRuntime(state.running ? 'running' : 'queued', { lastError: '' })
      setPrompt('')
      resizePrompt()
      onRender()
      store.save()
      startNextTask()
    }

    function startNextTask() {
      if (state.running) return
      const task = taskQueue.shift()
      if (!task) {
        taskQueue.clearActive()
        setRunning(false)
        setRuntime('idle', {
          activeTaskId: '',
          activeAssistantId: '',
          activePid: '',
          cwd: '',
          model: '',
        })
        onRender()
        return
      }
      const assistant = state.chats
        .find(chat => chat.id === task.chatId)
        ?.messages.find(message => message.id === task.assistantId)
      if (!assistant) {
        startNextTask()
        return
      }

      taskQueue.setActive(task)
      if (task.payload.resumeRecoveryTried) {
        resumeRecovery.resetAssistantForRetry(assistant, task)
      }
      assistant.status = 'running'
      assistant.diagnostics ||= runDiagnostics(task.payload.model, task.id)
      assistant.diagnostics.taskId = task.id
      assistant.diagnostics.startedAt = Date.now()
      assistant.diagnostics.queueWaitMs = assistant.diagnostics.queuedAt ? Date.now() - assistant.diagnostics.queuedAt : 0
      state.activeAssistantId = assistant.id
      markAgentTaskRunning(task.id, {
        assistantId: assistant.id,
        chatId: task.chatId,
        model: task.payload.model,
        cwd: task.payload.cwd,
        command: task.payload.commandIntent?.command || '',
        detail: 'Transmission au CLI',
      })
      recordTaskCheckpoint(task.id, {
        assistantId: assistant.id,
        chatId: task.chatId,
        projectId: task.payload.projectId || '',
        prompt: task.payload.displayPrompt || task.payload.prompt || '',
        model: task.payload.model,
        cwd: task.payload.cwd,
        command: task.payload.commandIntent?.command || '',
        phase: 'running',
        status: 'running',
        nextAction: 'reprendre après transmission au CLI',
      }, {
        phase: 'running',
        status: 'running',
        detail: 'Transmission au CLI',
      })
      upsertCompanionJob(task.id, {
        assistantId: assistant.id,
        chatId: task.chatId,
        status: 'running',
        model: task.payload.model,
        cwd: task.payload.cwd,
        command: task.payload.commandIntent?.command || '',
        phase: 'running',
        summary: 'Transmission au CLI',
      })
      setRuntime('running', {
        activeTaskId: task.id,
        activeAssistantId: assistant.id,
        activePid: '',
        cwd: task.payload.cwd,
        model: task.payload.model,
        lastError: '',
      })
      setRunning(true)
      addRuntimeAudit('run-start', {
        taskId: task.id,
        assistantId: assistant.id,
        command: task.payload.commandIntent?.command || '',
        source: task.payload.commandIntent?.source || '',
        permissionMode: task.payload.permissionMode,
        skipPermissions: Boolean(task.payload.skipPermissions),
        trusted: Boolean(task.payload.commandIntent?.trusted),
        status: 'ok',
        label: 'Execution envoyee au CLI',
        detail: task.payload.cwd,
      })
      onRender()
      store.save()

      opc.run(task.payload).catch(error => {
        const errorMessage = error.message || String(error)
        assistant.content = errorMessage
        assistant.status = 'error'
        assistant.diagnostics.lastActivityAt = Date.now()
        state.activeAssistantId = null
        upsertCompanionJob(task.id, {
          assistantId: assistant.id,
          chatId: task.chatId,
          status: 'error',
          phase: 'run-error',
          error: errorMessage,
          summary: errorMessage,
        })
        markAgentTaskError(task.id, {
          assistantId: assistant.id,
          error: errorMessage,
          detail: errorMessage,
        })
        finishTaskCheckpoint(task.id, {
          assistantId: assistant.id,
          chatId: task.chatId,
          model: task.payload.model,
          cwd: task.payload.cwd,
          status: 'error',
          phase: 'run-error',
          error: errorMessage,
          nextAction: 'reprendre après correction de l’erreur de lancement',
        })
        setRunning(false)
        setRuntime('error', {
          activeTaskId: task.id,
          activeAssistantId: assistant.id,
          activePid: '',
          lastError: errorMessage,
        })
        addRuntimeAudit('run-error', {
          taskId: task.id,
          assistantId: assistant.id,
          command: task.payload.commandIntent?.command || '',
          source: task.payload.commandIntent?.source || '',
          permissionMode: task.payload.permissionMode,
          skipPermissions: Boolean(task.payload.skipPermissions),
          trusted: Boolean(task.payload.commandIntent?.trusted),
          status: 'error',
          label: 'Execution refusee ou echouee',
          detail: errorMessage,
        })
        onRender()
        store.save()
        taskQueue.clearActive()
        startNextTask()
      })
    }

    function markStopFailure(error) {
      const errorMessage = `Arrêt impossible: ${error.message || String(error)}`
      const assistant = chatController.activeAssistant()
      if (assistant && assistant.status === 'running') {
        assistant.focus = errorMessage
        assistant.diagnostics ||= {}
        assistant.diagnostics.lastActivityAt = Date.now()
        assistant.diagnostics.lastError = errorMessage
      }
      upsertCompanionJob(currentRuntime().activeTaskId, {
        assistantId: assistant?.id || currentRuntime().activeAssistantId,
        status: 'error',
        phase: 'stop-error',
        error: errorMessage,
        summary: errorMessage,
      })
      markAgentTaskError(currentRuntime().activeTaskId, {
        assistantId: assistant?.id || currentRuntime().activeAssistantId,
        error: errorMessage,
        detail: errorMessage,
      })
      finishTaskCheckpoint(currentRuntime().activeTaskId, {
        assistantId: assistant?.id || currentRuntime().activeAssistantId,
        status: 'error',
        phase: 'stop-error',
        error: errorMessage,
        nextAction: 'reprendre après correction de l’arrêt impossible',
      })
      setRuntime('error', { lastError: errorMessage })
      addRuntimeAudit('stop-error', {
        status: 'error',
        label: 'Arret refuse ou impossible',
        detail: errorMessage,
      })
      onRender()
      store.save()
    }

    function stopActiveTask() {
      if (state.running) setRuntime('stopping')
      opc.stop().then(stopped => {
        if (stopped) return
        const assistant = chatController.activeAssistant()
        if (!assistant || assistant.status !== 'queued') return
        taskQueue.removeByAssistantId(assistant.id)
        assistant.status = 'error'
        assistant.content = 'Tâche retirée de la file.'
        upsertCompanionJob(assistant.diagnostics?.taskId, {
          assistantId: assistant.id,
          status: 'stopped',
          phase: 'queued-stop',
          result: assistant.content,
          summary: 'Retirée de la file',
        })
        markAgentTaskInterrupted(assistant.diagnostics?.taskId, {
          assistantId: assistant.id,
          status: 'stopped',
          detail: assistant.content,
        })
        finishTaskCheckpoint(assistant.diagnostics?.taskId, {
          assistantId: assistant.id,
          status: 'stopped',
          phase: 'queued-stop',
          result: assistant.content,
          nextAction: 'reprendre si la tâche reste nécessaire',
        })
        state.activeAssistantId = null
        setRunning(false)
        setRuntime('idle', {
          activeTaskId: '',
          activeAssistantId: '',
          activePid: '',
        })
        onRender()
        store.save()
      }).catch(markStopFailure)
    }

    function queueWorkerPrompt(action) {
      if (!action?.ok || !action.prompt) return false
      setPrompt(action.prompt)
      resizePrompt()
      const result = sendPrompt()
      return result || true
    }

    function resumeAgentWorker(taskId) {
      const action = resumeAgentWorkerState?.(taskId)
      if (!action?.ok) return false
      addRuntimeAudit('worker-resume', {
        taskId,
        assistantId: action.worker?.assistantId || '',
        status: 'info',
        label: 'Reprise worker',
        detail: action.worker?.blockedReason || action.checkpoint?.nextAction || action.worker?.phase || '',
      })
      return queueWorkerPrompt(action)
    }

    function verifyAgentWorker(taskId) {
      const action = verifyAgentWorkerState?.(taskId)
      if (!action?.ok) return false
      addRuntimeAudit('worker-verify', {
        taskId,
        assistantId: action.worker?.assistantId || '',
        status: 'info',
        label: 'Vérification worker',
        detail: action.worker?.currentStepId || action.worker?.phase || '',
      })
      return queueWorkerPrompt(action)
    }

    function interruptAgentWorker(taskId) {
      const result = interruptAgentWorkerState?.(taskId, { detail: 'Interruption ciblée depuis l’inspecteur.' })
      if (!result) return false
      upsertCompanionJob(taskId, {
        assistantId: result.assistantId || '',
        status: 'interrupted',
        summary: 'Worker interrompu',
      })
      addRuntimeAudit('worker-interrupt', {
        taskId,
        assistantId: result.assistantId || '',
        status: 'warning',
        label: 'Worker interrompu',
        detail: 'Interruption ciblée sans arrêt de l’app.',
      })
      onRender()
      store.save()
      return true
    }

    function onCliEvent(event) {
      appendLog(JSON.stringify(event))

      const assistant = chatController.assistantForEvent(event)
      if (!assistant) return
      const resumeRecoveryScheduled = event.type === 'result' && event.is_error && window.OPCRunResumeRecovery.isMissingResumeSessionError(event)
        ? resumeRecovery.schedule({ assistant, event, activeTask: taskQueue.active() })
        : false
      if (event.type === 'provider_status') {
        assistant.focus = event.message || 'Provider en cours'
        setRuntime('running', { model: event.model || currentRuntime().model })
        upsertCompanionJob(assistant.diagnostics?.taskId || event.taskId, {
          assistantId: assistant.id,
          status: 'running',
          model: event.model || assistant.model || currentRuntime().model,
          phase: 'provider',
          summary: event.message || 'Provider en cours',
        })
      }
      if (event.type === 'memory') {
        assistant.focus = event.message || 'Mémoire durable OPC active'
      }
      if (event.type === 'tool_heartbeat') {
        assistant.focus = event.message || 'Commande longue toujours active'
      }
      if (event.type === 'stopped') {
        assistant.focus = event.message || 'Tâche arrêtée'
        assistant.status = 'error'
        upsertCompanionJob(assistant.diagnostics?.taskId || event.taskId, {
          assistantId: assistant.id,
          status: 'stopped',
          phase: 'stopped',
          result: event.message || 'Tâche arrêtée',
          summary: event.message || 'Tâche arrêtée',
        })
        markAgentTaskInterrupted(assistant.diagnostics?.taskId || event.taskId, {
          assistantId: assistant.id,
          status: 'stopped',
          detail: event.message || 'Tâche arrêtée',
        })
      }

      const text = resumeRecoveryScheduled ? '' : activity.extractText(event)
      const toolText = activity.toolResultText?.(event) || ''
      if (text) {
        if (event.type === 'result') {
          assistant.content = text.trim() || assistant.content
          assistant.liveDraft = ''
        } else if (event.type === 'error') {
          assistant.content += `${assistant.content ? '\n' : ''}${text}`
          assistant.status = 'error'
        } else {
          activity.appendLiveDraft?.(assistant, text)
        }
      }

      const toolCountBefore = assistant.tools?.length || 0
      activity.recordToolActivity(assistant, event, state.settings.cwd)
      activity.recordToolPartial(assistant, event, state.settings.cwd)
      if ((assistant.tools?.length || 0) > toolCountBefore) {
        const tool = assistant.tools.at(-1)
        recordAgentTaskTool(assistant.diagnostics?.taskId || event.taskId, {
          assistantId: assistant.id,
          tool: tool?.name || '',
          detail: tool?.detail || tool?.target || assistant.focus || '',
        })
        recordTaskCheckpoint(assistant.diagnostics?.taskId || event.taskId, {
          assistantId: assistant.id,
          chatId: chatController.chatForAssistant(assistant)?.id || '',
          model: assistant.model || state.settings.model,
          cwd: assistant.cwd || state.settings.cwd,
          phase: 'tool',
          status: 'tool',
        }, {
          phase: 'tool',
          status: 'tool',
          tool: tool?.name || '',
          command: tool?.command || tool?.target || '',
          detail: tool?.detail || tool?.target || assistant.focus || '',
        })
      }
      if (assistant.tools?.length > maxActivityTools) assistant.tools = assistant.tools.slice(-maxActivityTools)
      serviceController.trackAssistantActivity(assistant, chatController.chatForAssistant(assistant), text, toolText)
      updateDiagnostics(assistant, event, text)

      const chip = resumeRecoveryScheduled ? 'reprise session' : activity.eventChip(event)
      if (chip) {
        assistant.events.push(chip)
        assistant.events = assistant.events.slice(-12)
      }

      if (event.type === 'result') {
        assistant.status = resumeRecoveryScheduled ? 'running' : event.is_error ? 'error' : 'done'
        upsertCompanionJob(assistant.diagnostics?.taskId || event.taskId, {
          assistantId: assistant.id,
          status: resumeRecoveryScheduled ? 'running' : event.is_error ? 'error' : 'done',
          phase: resumeRecoveryScheduled ? 'resume-recovery' : 'result',
          result: text || assistant.content,
          error: event.is_error && !resumeRecoveryScheduled ? text || assistant.content : '',
          summary: resumeRecoveryScheduled ? 'Relance sans reprise de session' : event.is_error ? 'Résultat en erreur' : 'Résultat reçu',
        })
        if (!resumeRecoveryScheduled) {
          if (event.is_error) {
            markAgentTaskError(assistant.diagnostics?.taskId || event.taskId, {
              assistantId: assistant.id,
              error: text || assistant.content,
              detail: text || assistant.content,
            })
            recordTaskCheckpoint(assistant.diagnostics?.taskId || event.taskId, {
              assistantId: assistant.id,
              status: 'error',
              phase: 'result',
              error: text || assistant.content,
              nextAction: 'reprendre après correction du résultat en erreur',
            }, {
              phase: 'result',
              status: 'error',
              detail: text || assistant.content,
            })
          } else {
            markTaskAfterSuccess(assistant.diagnostics?.taskId || event.taskId, assistant, {
              result: text || assistant.content,
              detail: 'Résultat reçu',
              payload: event,
            })
            recordTaskCheckpoint(assistant.diagnostics?.taskId || event.taskId, {
              assistantId: assistant.id,
              status: 'done',
              phase: 'result',
              result: text || assistant.content,
            }, {
              phase: 'result',
              status: 'done',
              detail: 'Résultat reçu',
            })
          }
        }
      } else {
        upsertCompanionJob(assistant.diagnostics?.taskId || event.taskId, {
          assistantId: assistant.id,
          status: assistant.status === 'error' ? 'error' : 'running',
          phase: event.type || '',
          summary: assistant.focus || text || activity.eventChip(event) || '',
          eventCount: assistant.diagnostics?.eventCount || 0,
        })
      }

      onMessagesChange()
      onInspectorChange()
      store.scheduleSave()
      serviceController.probeLongTasks()
    }

    function onRunStart(payload) {
      appendLog(`RUN ${payload.pid} ${payload.cwd}${payload.memoryEnabled ? ' mémoire=active' : ''}`)
      const assistant = chatController.assistantByTaskId(payload.taskId) || chatController.activeAssistant()
      if (!assistant) return
      const runtime = currentRuntime()
      assistant.diagnostics ||= runDiagnostics(assistant.model || state.settings.model)
      assistant.diagnostics.taskId = payload.taskId || assistant.diagnostics.taskId
      assistant.diagnostics.pid = payload.pid
      assistant.diagnostics.cwd = payload.cwd
      assistant.diagnostics.command = payload.command
      assistant.diagnostics.model = payload.model || assistant.diagnostics.model
      assistant.diagnostics.memoryEnabled = Boolean(payload.memoryEnabled)
      if (payload.projectRuntimeContext) assistant.projectRuntimeContext = payload.projectRuntimeContext
      assistant.diagnostics.startedAt ||= Date.now()
      upsertCompanionJob(payload.taskId || runtime.activeTaskId, {
        assistantId: assistant.id,
        status: 'running',
        phase: 'started',
        pid: payload.pid || runtime.activePid || '',
        cwd: payload.cwd || runtime.cwd,
        model: payload.model || assistant.diagnostics.model,
        command: payload.command || payload.commandIntent?.command || '',
        summary: payload.pid ? `PID ${payload.pid}` : 'CLI démarré',
      })
      markAgentTaskRunning(payload.taskId || runtime.activeTaskId, {
        assistantId: assistant.id,
        model: payload.model || assistant.diagnostics.model,
        cwd: payload.cwd || runtime.cwd,
        command: payload.command || payload.commandIntent?.command || '',
        detail: payload.pid ? `PID ${payload.pid}` : 'CLI démarré',
      })
      recordTaskCheckpoint(payload.taskId || runtime.activeTaskId, {
        assistantId: assistant.id,
        chatId: chatController.chatForAssistant(assistant)?.id || '',
        model: payload.model || assistant.diagnostics.model,
        cwd: payload.cwd || runtime.cwd,
        command: payload.command || payload.commandIntent?.command || '',
        phase: 'started',
        status: 'running',
        nextAction: 'reprendre après démarrage CLI',
      }, {
        phase: 'started',
        status: 'running',
        detail: payload.pid ? `PID ${payload.pid}` : 'CLI démarré',
      })
      setRuntime('running', {
        activeTaskId: payload.taskId || runtime.activeTaskId,
        activeAssistantId: assistant.id,
        activePid: payload.pid || runtime.activePid,
        cwd: payload.cwd || runtime.cwd,
        model: payload.model || runtime.model,
        lastError: '',
      })
      addRuntimeAudit('run-started', {
        taskId: payload.taskId || runtime.activeTaskId,
        assistantId: assistant.id,
        command: payload.commandIntent?.command || '',
        source: payload.commandIntent?.source || '',
        permissionMode: payload.permissionMode || state.settings.permissionMode,
        skipPermissions: Boolean(payload.skipPermissions),
        trusted: Boolean(payload.commandIntent?.trusted),
        status: 'ok',
        label: 'CLI demarre',
        detail: payload.pid ? `PID ${payload.pid}` : '',
      })
      onMessagesChange()
      onInspectorChange()
      serviceController.probeLongTasks(true)
    }

    function onRunEnd(payload) {
      const assistant = chatController.assistantByTaskId(payload.taskId) || chatController.activeAssistant()
      const activeTask = taskQueue.active()
      const failureText = payload.code === 0 ? '' : runEndFailureText(payload)
      const successText = payload.code === 0 ? runEndSuccessText(payload) : ''
      const recoveryTask = resumeRecovery.pendingForAssistant(assistant)
      const recoverResume = Boolean(assistant?.diagnostics?.resumeRecoveryPending && recoveryTask)
      const providerFallback = recoverResume ? null : recordProviderFailureIfNeeded({ assistant, payload, activeTask, failureText })
      const autoContinue = !recoverResume && shouldAutoContinue({ assistant, payload, activeTask })
      if (assistant) {
        assistant.diagnostics ||= runDiagnostics(assistant.model || state.settings.model)
        if (recoverResume) {
          assistant.status = 'queued'
          assistant.content = 'La session CLI précédente n’existe plus. OPC relance automatiquement la même demande dans une nouvelle session.'
          assistant.focus = 'Relance sans reprise de session'
          assistant.diagnostics.resumeRecoveryPending = false
          assistant.diagnostics.queuedAt = Date.now()
          assistant.events.push('reprise session')
          upsertCompanionJob(recoveryTask.id, {
            assistantId: assistant.id,
            chatId: recoveryTask.chatId,
            status: 'queued',
            phase: 'resume-recovery',
            result: '',
            error: '',
            summary: 'Relance sans --resume',
          })
          markAgentTaskInterrupted(payload.taskId || assistant.diagnostics?.taskId, {
            assistantId: assistant.id,
            detail: 'Relance sans reprise de session',
          })
        } else {
          assistant.status = payload.code === 0 ? 'done' : 'error'
          assistant.diagnostics.durationMs = payload.durationMs
          if (!String(assistant.content || '').trim()) {
            assistant.content = payload.reason === 'stopped'
              ? 'Tâche arrêtée.'
              : payload.reason === 'idle-timeout'
                ? 'Tâche arrêtée après inactivité.'
                : payload.code === 0
                  ? successText || 'Terminé sans sortie visible.'
                  : failureText
          }
          assistant.events.push(`${(payload.durationMs / 1000).toFixed(1)}s`)
          if (payload.reason) assistant.events.push(payload.reason)
          if (payload.reason === 'stopped') serviceController.markStoppedForAssistant(assistant.id)
          upsertCompanionJob(payload.taskId || assistant.diagnostics?.taskId, {
            assistantId: assistant.id,
            status: payload.reason === 'stopped' ? 'stopped' : payload.code === 0 ? 'done' : 'error',
            phase: 'ended',
            result: assistant.content,
            error: payload.code === 0 ? '' : failureText,
            summary: autoContinue ? 'Continuation préparée' : payload.code === 0 ? 'Terminé' : payload.reason || failureText || `Code ${payload.code}`,
          })
          if (payload.reason === 'stopped') {
            markAgentTaskInterrupted(payload.taskId || assistant.diagnostics?.taskId, {
              assistantId: assistant.id,
              status: 'stopped',
              detail: assistant.content,
            })
          } else if (payload.code === 0) {
            markTaskAfterSuccess(payload.taskId || assistant.diagnostics?.taskId, assistant, {
              result: assistant.content,
              detail: 'Execution terminee',
              payload,
            })
          } else {
            markAgentTaskError(payload.taskId || assistant.diagnostics?.taskId, {
              assistantId: assistant.id,
              error: failureText,
              detail: failureText,
            })
          }
        }
      }
      const taskId = payload.taskId || assistant?.diagnostics?.taskId || ''
      const finalCheckpointStatus = checkpointEndStatus(payload, recoverResume)
      finishTaskCheckpoint(taskId, {
        assistantId: assistant?.id || '',
        chatId: assistant ? chatController.chatForAssistant(assistant)?.id || '' : '',
        model: modelForAssistant(assistant, payload),
        cwd: payload.cwd || assistant?.cwd || assistant?.diagnostics?.cwd || state.settings.cwd,
        status: finalCheckpointStatus,
        phase: recoverResume ? 'resume-recovery' : 'ended',
        result: payload.code === 0 ? assistant?.content || payload.result || '' : '',
        error: payload.code === 0 ? '' : failureText,
        nextAction: finalCheckpointStatus === 'done'
          ? ''
          : providerFallback?.shouldFallback
            ? `reprendre avec ${providerFallback.suggested?.label || providerFallback.suggested?.model}`
            : 'reprendre la tâche depuis le dernier checkpoint',
      })
      state.activeAssistantId = null
      setRunning(false)
      setRuntime(recoverResume ? 'queued' : payload.code === 0 ? 'idle' : 'error', {
        activeTaskId: '',
        activeAssistantId: '',
        activePid: '',
        lastError: recoverResume || payload.code === 0 ? '' : failureText,
      })
      addRuntimeAudit('run-end', {
        taskId: payload.taskId || '',
        assistantId: assistant?.id || '',
        status: recoverResume ? 'warning' : payload.code === 0 ? 'ok' : 'error',
        label: recoverResume ? 'Execution relancee sans reprise' : payload.code === 0 ? 'Execution terminee' : 'Execution terminee en erreur',
        detail: [
          `code ${payload.code}`,
          payload.durationMs ? `${(payload.durationMs / 1000).toFixed(1)}s` : '',
          payload.reason || '',
        ].filter(Boolean).join(' · '),
      })
      taskQueue.clearActive()
      if (recoverResume) {
        const retryTask = resumeRecovery.consumeForAssistant(assistant)
        taskQueue.unshift(retryTask)
        onRender()
        store.save()
        serviceController.probeLongTasks(true)
        startNextTask()
        return
      }
      if (autoContinue) {
        const chat = chatController.chatForAssistant(assistant)
        enqueueAutoContinue({ chat, previousAssistant: assistant, previousTask: activeTask })
      }
      onRender()
      store.save()
      serviceController.probeLongTasks(true)
      startNextTask()
    }

    function onRuntime(payload = {}) {
      const assistant = chatController.assistantByTaskId(payload.taskId) || chatController.activeAssistant()
      if (assistant) applyRuntimeDiagnostics(assistant, payload)
      const runtime = currentRuntime()
      const phase = payload.status === 'finished' || payload.status === 'idle'
        ? 'idle'
        : payload.phase || (payload.active ? 'running' : runtime.phase)
      setRuntime(phase, {
        ...payload,
        activeTaskId: payload.taskId || runtime.activeTaskId,
        activeAssistantId: assistant?.id || runtime.activeAssistantId,
        activePid: payload.pid || runtime.activePid,
        cwd: payload.cwd || runtime.cwd,
        model: payload.model || runtime.model,
        lastError: payload.status === 'error' ? payload.statusText || payload.reason || runtime.lastError : runtime.lastError,
      })
      upsertCompanionJob(payload.taskId || runtime.activeTaskId, {
        assistantId: assistant?.id || runtime.activeAssistantId,
        status: payload.status === 'error' ? 'error' : phase === 'idle' ? 'done' : 'running',
        phase: payload.phase || phase,
        pid: payload.pid || runtime.activePid || '',
        cwd: payload.cwd || runtime.cwd,
        model: payload.model || runtime.model,
        eventCount: payload.eventCount || runtime.eventCount || 0,
        summary: payload.statusText || payload.phaseLabel || payload.reason || '',
        error: payload.status === 'error' ? payload.statusText || payload.reason || '' : '',
      })
      if (payload.currentTool?.detail) {
        recordAgentTaskTool(payload.taskId || runtime.activeTaskId, {
          assistantId: assistant?.id || runtime.activeAssistantId,
          tool: payload.currentTool.name || '',
          detail: payload.currentTool.detail,
        })
        recordTaskCheckpoint(payload.taskId || runtime.activeTaskId, {
          assistantId: assistant?.id || runtime.activeAssistantId,
          chatId: assistant ? chatController.chatForAssistant(assistant)?.id || '' : '',
          model: payload.model || runtime.model,
          cwd: payload.cwd || runtime.cwd,
          phase: payload.phase || phase,
          status: 'tool',
        }, {
          phase: payload.phase || phase,
          status: 'tool',
          tool: payload.currentTool.name || '',
          command: payload.currentTool.target || payload.currentTool.command || '',
          detail: payload.currentTool.detail,
        })
      } else if (payload.statusText || payload.phase) {
        recordTaskCheckpoint(payload.taskId || runtime.activeTaskId, {
          assistantId: assistant?.id || runtime.activeAssistantId,
          chatId: assistant ? chatController.chatForAssistant(assistant)?.id || '' : '',
          model: payload.model || runtime.model,
          cwd: payload.cwd || runtime.cwd,
          phase: payload.phase || phase,
          status: payload.status === 'error' ? 'error' : phase === 'idle' ? 'done' : 'running',
        }, {
          phase: payload.phase || phase,
          status: payload.status === 'error' ? 'error' : 'running',
          detail: payload.statusText || payload.phaseLabel || payload.reason || '',
        })
      }
      onMessagesChange()
      onInspectorChange()
    }

    return {
      diagnosticItems,
      onCliEvent,
      onRunEnd,
      onRunStart,
      onRuntime,
      queueLength,
      runDiagnostics,
      runtimeSnapshot,
      sendPrompt,
      sessionProgress,
      startNextTask,
      stopActiveTask,
      resumeAgentWorker,
      verifyAgentWorker,
      interruptAgentWorker,
      updateDiagnostics,
    }
  }

  window.OPCRunController = { createRunController }
})()
