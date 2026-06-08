(function () {
  function createRunDiagnostics(model, taskId = '') {
    const now = Date.now()
    return {
      taskId,
      model,
      startedAt: now,
      lastActivityAt: now,
      eventCount: 0,
      providerEventCount: 0,
      toolCount: 0,
    }
  }

  function updateDiagnostics(assistant, event, text, { fallbackModel = '', chatForAssistant = () => null } = {}) {
    const diagnostics = (assistant.diagnostics ||= createRunDiagnostics(assistant.model || fallbackModel))
    diagnostics.eventCount += 1
    diagnostics.lastActivityAt = Date.now()

    if (event.type === 'system' && event.subtype === 'init') {
      diagnostics.model = event.model || diagnostics.model
      diagnostics.sessionId = event.session_id || diagnostics.sessionId
      const chat = chatForAssistant(assistant)
      if (chat && event.session_id) chat.cliSessionId = event.session_id
    }
    if (event.type === 'provider_status') {
      diagnostics.providerEventCount += 1
      diagnostics.providerMessage = event.message || diagnostics.providerMessage
      diagnostics.providerElapsedMs = event.elapsedMs || diagnostics.providerElapsedMs
      diagnostics.providerAttempt = event.attempt || diagnostics.providerAttempt
      diagnostics.providerMaxRetries = event.maxRetries
      diagnostics.model = event.model || diagnostics.model
    }
    if (text && !diagnostics.firstTextAt && event.type !== 'stderr') {
      diagnostics.firstTextAt = Date.now()
    }
    diagnostics.toolCount = Math.max(Number(diagnostics.toolCount || 0), assistant.tools?.length || 0)
    return diagnostics
  }

  function diagnosticItems(message, modelLabel = value => value) {
    const diagnostics = message.diagnostics || {}
    const items = []
    if (diagnostics.model) items.push(['Modèle', modelLabel(diagnostics.model)])
    if (diagnostics.pid) items.push(['PID', diagnostics.pid])
    if (diagnostics.runtimePhaseLabel && message.status === 'running') items.push(['Phase', diagnostics.runtimePhaseLabel])
    if (diagnostics.firstTextAt && diagnostics.startedAt) {
      items.push(['Premier flux', `${((diagnostics.firstTextAt - diagnostics.startedAt) / 1000).toFixed(1)}s`])
    } else if (message.status === 'running' && diagnostics.startedAt) {
      const elapsedMs = diagnostics.providerElapsedMs || Date.now() - diagnostics.startedAt
      items.push(['Attente', `${Math.round(elapsedMs / 1000)}s`])
    }
    if (message.status === 'running' && diagnostics.lastActivityAt) {
      const quietSeconds = Math.round((Date.now() - diagnostics.lastActivityAt) / 1000)
      if (quietSeconds >= 30) items.push(['Silence', `${quietSeconds}s`])
    }
    if (diagnostics.providerAttempt) {
      items.push(['Essai', `${diagnostics.providerAttempt}/${(diagnostics.providerMaxRetries || 0) + 1}`])
    }
    if (diagnostics.toolCount) items.push(['Outils', diagnostics.toolCount])
    if (diagnostics.eventCount) items.push(['Flux', diagnostics.eventCount])
    return items
  }

  function sessionProgress(message) {
    const diagnostics = message?.diagnostics || {}
    const status = message?.status || 'done'
    const startedAt = diagnostics.startedAt || diagnostics.queuedAt || Date.now()
    const elapsedMs = Math.max(0, (diagnostics.durationMs || Date.now() - startedAt))
    const elapsedLabel = `${Math.max(1, Math.round(elapsedMs / 1000))}s`
    const hasFirstFlux = Boolean(diagnostics.firstTextAt)
    const toolCount = diagnostics.toolCount || message?.tools?.length || 0
    const eventCount = diagnostics.eventCount || 0
    const runtimePhase = diagnostics.runtimePhase || ''
    const currentTool = diagnostics.currentTool?.detail || ''

    if (status === 'queued') {
      return { value: 8, label: 'En file d’attente', detail: elapsedLabel, tone: 'pending' }
    }

    if (status === 'running') {
      if (runtimePhase === 'finishing' || runtimePhase === 'stopping') {
        return {
          value: runtimePhase === 'stopping' ? 96 : 94,
          label: runtimePhase === 'stopping' ? 'Arrêt en cours' : 'Finalisation',
          detail: diagnostics.runtimeStatusText || elapsedLabel,
          tone: runtimePhase === 'stopping' ? 'warning' : 'running',
        }
      }

      if (runtimePhase === 'tool' && currentTool) {
        const eventFactor = Math.min(Math.floor(eventCount / 18), 22)
        return {
          value: Math.min(90, 52 + Math.min(toolCount * 5, 22) + eventFactor),
          label: currentTool,
          detail: elapsedLabel,
          tone: 'running',
        }
      }

      if (runtimePhase === 'provider') {
        const quietSeconds = diagnostics.lastActivityAt ? Math.round((Date.now() - diagnostics.lastActivityAt) / 1000) : 0
        return {
          value: hasFirstFlux ? 44 : 30,
          label: diagnostics.providerMessage || diagnostics.runtimeStatusText || 'Provider en attente',
          detail: quietSeconds >= 30 ? `silence ${quietSeconds}s` : elapsedLabel,
          tone: quietSeconds >= 60 ? 'warning' : 'running',
        }
      }

      if (!hasFirstFlux) {
        const waitingValue = diagnostics.providerEventCount ? 32 : 20
        const quietSeconds = diagnostics.lastActivityAt ? Math.round((Date.now() - diagnostics.lastActivityAt) / 1000) : 0
        return {
          value: waitingValue,
          label: diagnostics.providerEventCount ? 'Provider connecté' : 'Ouverture du flux',
          detail: quietSeconds >= 30 ? `silence ${quietSeconds}s` : elapsedLabel,
          tone: quietSeconds >= 60 ? 'warning' : 'running',
        }
      }

      const toolFactor = Math.min(toolCount * 4, 28)
      const eventFactor = Math.min(Math.floor(eventCount / 20), 20)
      const value = Math.min(92, 44 + toolFactor + eventFactor)
      return {
        value,
        label: toolCount ? `${toolCount} outil${toolCount > 1 ? 's' : ''} suivi${toolCount > 1 ? 's' : ''}` : 'Flux en cours',
        detail: elapsedLabel,
        tone: 'running',
      }
    }

    if (status === 'error') {
      return { value: 100, label: 'Erreur ou arrêt', detail: elapsedLabel, tone: 'error' }
    }

    return { value: 100, label: 'Session terminée', detail: elapsedLabel, tone: 'done' }
  }

  window.OPCRuntimeDiagnostics = {
    createRunDiagnostics,
    diagnosticItems,
    sessionProgress,
    updateDiagnostics,
  }
})()
