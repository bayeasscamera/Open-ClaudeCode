(function () {
  const DEFAULT_PROBE_INTERVAL_MS = 4000

  function createServiceController({
    state,
    store,
    taskManager,
    opc = window.opc,
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
    onInspectorChange = () => {},
  } = {}) {
    let probingLongTasks = false
    let lastLongTaskProbeAt = 0

    function hasLiveLongTasks() {
      return Boolean(taskManager?.probePayload?.(state.longTasks || []).length)
    }

    function trackAssistantActivity(assistant, chat, text = '', toolText = '') {
      state.longTasks ||= []
      taskManager?.syncFromAssistant(state.longTasks, assistant, chat)
      if (text) taskManager?.updateRelated(state.longTasks, assistant, text)
      if (toolText) taskManager?.updateRelated(state.longTasks, assistant, toolText)
    }

    function markStoppedForAssistant(assistantId) {
      for (const task of state.longTasks || []) {
        if (task.assistantId === assistantId && task.status !== 'stopped') task.status = 'stopped'
      }
    }

    async function probeLongTasks(force = false) {
      if (!taskManager?.probePayload || !opc?.probeServices) return
      const payload = taskManager.probePayload(state.longTasks || [])
      if (!payload.length || probingLongTasks) return
      const now = Date.now()
      if (!force && now - lastLongTaskProbeAt < probeIntervalMs) return
      probingLongTasks = true
      lastLongTaskProbeAt = now
      try {
        const results = await opc.probeServices({ tasks: payload })
        let changed = false
        for (const result of Array.isArray(results) ? results : []) {
          const task = (state.longTasks || []).find(item => item.id === result.id)
          const before = task
            ? JSON.stringify({ status: task.status, url: task.url, summary: task.serviceSummary, services: task.services })
            : ''
          taskManager.applyProbeResult(state.longTasks, result)
          const after = task
            ? JSON.stringify({ status: task.status, url: task.url, summary: task.serviceSummary, services: task.services })
            : ''
          if (before !== after) changed = true
        }
        if (changed) {
          onInspectorChange()
          store.scheduleSave()
        }
      } catch {
        // Service probes are best-effort and should never block the chat UI.
      } finally {
        probingLongTasks = false
      }
    }

    async function stopTrackedTask(taskId) {
      const task = (state.longTasks || []).find(item => item.id === taskId)
      if (!task) return
      if (!task.pid) {
        taskManager?.mark(state.longTasks, taskId, { status: 'unknown', lastOutput: 'Aucun PID disponible pour arrêter cette tâche.' })
        onInspectorChange()
        store.save()
        return
      }
      taskManager?.mark(state.longTasks, taskId, { status: 'stopping' })
      onInspectorChange()
      const result = await opc.killPid?.({
        pid: task.pid,
        taskId: task.id,
        command: task.command,
        cwd: task.cwd || '',
      })
      taskManager?.mark(state.longTasks, taskId, {
        status: result?.ok ? 'stopped' : 'error',
        lastOutput: result?.ok ? `PID ${task.pid} arrêté.` : result?.error || 'Arrêt impossible.',
      })
      onInspectorChange()
      store.save()
      probeLongTasks(true)
    }

    return {
      hasLiveLongTasks,
      markStoppedForAssistant,
      probeLongTasks,
      stopTrackedTask,
      trackAssistantActivity,
    }
  }

  window.OPCServiceController = { createServiceController }
})()
