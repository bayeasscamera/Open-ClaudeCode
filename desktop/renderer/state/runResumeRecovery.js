(function () {
  function eventErrorText(event = {}) {
    return [
      event.message,
      event.error,
      event.result,
      event.text,
      ...(Array.isArray(event.errors) ? event.errors : []),
    ].filter(Boolean).map(String).join('\n')
  }

  function isMissingResumeSessionError(event = {}) {
    return /No conversation found with session ID/i.test(eventErrorText(event))
  }

  function createRunResumeRecovery({
    state,
    store,
    chatController,
    runDiagnostics,
    addRuntimeAudit,
    upsertCompanionJob,
  } = {}) {
    let pendingTask = null

    function resetAssistantForRetry(assistant, task) {
      if (!assistant || !task) return
      assistant.content = ''
      assistant.events = []
      assistant.tools = []
      assistant.toolPartials = {}
      assistant.focus = 'Relance sans reprise de session'
      assistant.diagnostics = {
        ...runDiagnostics(task.payload.model, task.id),
        queuedAt: Date.now(),
        resumeRecoveryTried: true,
        previousSessionId: task.payload.previousSessionId || '',
      }
    }

    function schedule({ assistant, event = {}, activeTask = null } = {}) {
      if (!assistant || !activeTask || activeTask.payload?.resumeRecoveryTried) return false
      const chat = chatController.chatForAssistant(assistant)
      const staleSessionId = activeTask.payload?.sessionId || assistant.diagnostics?.sessionId || ''
      const retryTaskId = store.makeId('task')
      if (chat) chat.cliSessionId = ''
      assistant.diagnostics ||= runDiagnostics(assistant.model || state.settings.model, activeTask.id)
      assistant.diagnostics.sessionId = ''
      assistant.diagnostics.resumeRecoveryPending = true
      assistant.diagnostics.staleSessionId = staleSessionId
      assistant.focus = 'Session CLI introuvable, relance sans reprise.'
      assistant.content = 'La session CLI précédente n’existe plus. OPC relance automatiquement la même demande dans une nouvelle session.'
      assistant.status = 'running'
      pendingTask = {
        ...activeTask,
        id: retryTaskId,
        chatId: activeTask.chatId,
        assistantId: assistant.id,
        payload: {
          ...activeTask.payload,
          taskId: retryTaskId,
          assistantId: assistant.id,
          sessionId: '',
          resumeRecoveryTried: true,
          previousSessionId: staleSessionId,
        },
      }
      addRuntimeAudit('resume-recovery', {
        taskId: activeTask.id,
        assistantId: assistant.id,
        command: activeTask.payload?.commandIntent?.command || '',
        source: 'stale-session',
        permissionMode: activeTask.payload?.permissionMode || state.settings.permissionMode,
        skipPermissions: Boolean(activeTask.payload?.skipPermissions),
        trusted: Boolean(activeTask.payload?.commandIntent?.trusted),
        status: 'warning',
        label: 'Session CLI expiree',
        detail: staleSessionId ? `Relance sans --resume ${staleSessionId}` : 'Relance sans --resume',
      })
      upsertCompanionJob(activeTask.id, {
        assistantId: assistant.id,
        chatId: activeTask.chatId,
        status: 'running',
        phase: 'resume-recovery',
        summary: 'Session CLI introuvable, relance sans reprise',
        error: eventErrorText(event),
      })
      return true
    }

    function pendingForAssistant(assistant) {
      return assistant && pendingTask?.assistantId === assistant.id ? pendingTask : null
    }

    function consumeForAssistant(assistant) {
      const task = pendingForAssistant(assistant)
      if (task) pendingTask = null
      return task
    }

    return {
      consumeForAssistant,
      pendingForAssistant,
      resetAssistantForRetry,
      schedule,
    }
  }

  window.OPCRunResumeRecovery = {
    createRunResumeRecovery,
    eventErrorText,
    isMissingResumeSessionError,
  }
})()
