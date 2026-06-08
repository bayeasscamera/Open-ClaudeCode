(function () {
  const MAX_RUNTIME_AUDIT = 36
  const MAX_COMPANION_JOBS = 60
  const ACTIVE_RUNTIME_PHASES = new Set(['starting', 'provider', 'streaming', 'tool', 'running', 'finishing', 'stopping'])

  function initialRuntime() {
    return {
      phase: 'idle',
      activeTaskId: '',
      activeAssistantId: '',
      activePid: '',
      cwd: '',
      model: '',
      lastError: '',
      updatedAt: Date.now(),
    }
  }

  function createRunRuntimeState({
    state,
    store,
    getQueueLength = () => 0,
    onRunningChange = () => {},
    onInspectorChange = () => {},
    maxRuntimeAudit = MAX_RUNTIME_AUDIT,
  } = {}) {
    let runtime = initialRuntime()
    state.agentTaskLedger ||= []
    state.agentWorkers ||= []
    state.taskCheckpoints ||= []
    const agentTaskLedger = window.OPCAgentTaskLedger?.createAgentTaskLedger?.({
      entries: state.agentTaskLedger,
      makeId: prefix => store?.makeId?.(prefix) || `${prefix}_${Date.now().toString(36)}`,
      onChange: entries => {
        state.agentTaskLedger = entries
        onInspectorChange()
      },
    })
    const taskCheckpointStore = window.OPCTaskCheckpointStore?.createTaskCheckpointStore?.({
      checkpoints: state.taskCheckpoints,
      onChange: entries => {
        state.taskCheckpoints = entries
        onInspectorChange()
      },
    })
    const agentWorkerRuntime = window.OPCAgentWorkerRuntime?.createAgentWorkerRuntime?.({
      workers: state.agentWorkers,
      makeId: prefix => store?.makeId?.(prefix) || `${prefix}_${Date.now().toString(36)}`,
      onChange: entries => {
        state.agentWorkers = entries
      },
    })

    function currentRuntime() {
      return runtime
    }

    function runtimeSnapshot() {
      return {
        ...runtime,
        queueLength: getQueueLength(),
        running: ACTIVE_RUNTIME_PHASES.has(runtime.phase),
      }
    }

    function setRuntime(phase, patch = {}) {
      runtime = {
        ...runtime,
        phase,
        ...patch,
        updatedAt: Date.now(),
      }
      state.runtime = runtimeSnapshot()
      return state.runtime
    }

    function setRunning(value) {
      state.running = value
      onRunningChange(value)
    }

    function addRuntimeAudit(kind, patch = {}) {
      const entry = {
        id: store.makeId('audit'),
        at: Date.now(),
        kind,
        status: patch.status || 'info',
        label: patch.label || '',
        detail: patch.detail || '',
        command: patch.command || '',
        source: patch.source || '',
        permissionMode: patch.permissionMode || state.settings.permissionMode || '',
        skipPermissions: Boolean(patch.skipPermissions),
        trusted: Boolean(patch.trusted),
        taskId: patch.taskId || runtime.activeTaskId || '',
        assistantId: patch.assistantId || runtime.activeAssistantId || '',
      }
      state.runtimeAudit = [...(state.runtimeAudit || []), entry].slice(-maxRuntimeAudit)
      onInspectorChange()
      return entry
    }

    function companionSummary(patch = {}) {
      return String(patch.summary || patch.statusText || patch.detail || patch.phaseLabel || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 360)
    }

    function upsertCompanionJob(taskId, patch = {}) {
      if (!taskId) return null
      const jobs = Array.isArray(state.companionJobs) ? state.companionJobs.slice() : []
      const index = jobs.findIndex(job => job.taskId === taskId || job.id === taskId)
      const now = Date.now()
      const current = index >= 0 ? jobs[index] : { id: taskId, taskId, startedAt: now, eventCount: 0 }
      const next = {
        ...current,
        ...patch,
        id: current.id || taskId,
        taskId,
        title: patch.title || current.title || 'Tâche OPC',
        status: patch.status || current.status || 'queued',
        summary: companionSummary(patch) || current.summary || '',
        eventCount: Number.isFinite(Number(patch.eventCount))
          ? Number(patch.eventCount)
          : Number(current.eventCount || 0),
        updatedAt: now,
      }
      if (['done', 'error', 'stopped', 'interrupted'].includes(next.status) && !next.endedAt) next.endedAt = now
      if (index >= 0) jobs[index] = next
      else jobs.unshift(next)
      state.companionJobs = jobs.slice(0, maxRuntimeAudit > MAX_COMPANION_JOBS ? maxRuntimeAudit : MAX_COMPANION_JOBS)
      onInspectorChange()
      return next
    }

    function enqueueAgentTask(payload = {}) {
      if (!payload.stepPlan && payload.agentRuntimeProfile?.toolPlan && window.OPCAgentTaskStepEngine?.createStepPlan) {
        payload = {
          ...payload,
          stepPlan: window.OPCAgentTaskStepEngine.createStepPlan({ toolPlan: payload.agentRuntimeProfile.toolPlan }),
        }
      }
      agentWorkerRuntime?.spawn?.(payload)
      return agentTaskLedger?.enqueue?.(payload) || null
    }

    function markAgentTaskRunning(taskId, patch = {}) {
      agentWorkerRuntime?.start?.(taskId, patch)
      return agentTaskLedger?.markRunning?.(taskId, patch) || null
    }

    function recordAgentTaskTool(taskId, patch = {}) {
      agentWorkerRuntime?.recordTool?.(taskId, patch)
      return agentTaskLedger?.recordTool?.(taskId, patch) || null
    }

    function markAgentTaskDone(taskId, patch = {}) {
      if (patch.verification) agentWorkerRuntime?.verify?.(taskId, patch)
      else agentWorkerRuntime?.done?.(taskId, patch)
      return patch.verification
        ? agentTaskLedger?.markVerified?.(taskId, patch) || null
        : agentTaskLedger?.markDone?.(taskId, patch) || null
    }

    function markAgentTaskNeedsVerification(taskId, patch = {}) {
      agentWorkerRuntime?.needsVerification?.(taskId, patch)
      return agentTaskLedger?.markNeedsVerification?.(taskId, patch) || null
    }

    function markAgentTaskError(taskId, patch = {}) {
      agentWorkerRuntime?.fail?.(taskId, patch)
      return agentTaskLedger?.markError?.(taskId, patch) || null
    }

    function markAgentTaskInterrupted(taskId, patch = {}) {
      agentWorkerRuntime?.interrupt?.(taskId, patch)
      return agentTaskLedger?.markInterrupted?.(taskId, patch) || null
    }

    function recordTaskCheckpoint(taskId, patch = {}, step = null) {
      if (!taskId || !taskCheckpointStore) return null
      const entry = taskCheckpointStore.upsert(taskId, patch)
      if (step) return taskCheckpointStore.recordStep(taskId, step)
      return entry
    }

    function finishTaskCheckpoint(taskId, patch = {}) {
      if (!taskId || !taskCheckpointStore) return null
      return taskCheckpointStore.finish(taskId, patch)
    }

    function workerForTask(taskId) {
      return agentWorkerRuntime?.worker?.(taskId) || null
    }

    function checkpointForWorker(taskId, worker = null) {
      return taskCheckpointStore?.resumeCandidate?.({
        taskId,
        model: worker?.model || '',
        cwd: worker?.cwd || '',
      }) || (taskCheckpointStore?.entries?.() || []).find(entry => entry.id === taskId) || null
    }

    function resumeAgentWorker(taskId, options = {}) {
      const worker = workerForTask(taskId)
      if (!worker) return { ok: false, prompt: '', error: 'Worker introuvable.' }
      const checkpoint = checkpointForWorker(taskId, worker)
      return {
        ok: true,
        worker,
        checkpoint,
        prompt: window.OPCAgentWorkerRuntime?.resumePrompt?.(worker, checkpoint, options) || 'continue',
      }
    }

    function verifyAgentWorker(taskId) {
      const worker = workerForTask(taskId)
      if (!worker) return { ok: false, prompt: '', error: 'Worker introuvable.' }
      return {
        ok: true,
        worker,
        prompt: window.OPCAgentWorkerRuntime?.verificationPrompt?.(worker) || 'continue',
      }
    }

    function interruptAgentWorker(taskId, patch = {}) {
      return markAgentTaskInterrupted(taskId, {
        ...patch,
        status: patch.status || 'interrupted',
        detail: patch.detail || 'Interruption ciblée du worker.',
      })
    }

    return {
      addRuntimeAudit,
      currentRuntime,
      enqueueAgentTask,
      finishTaskCheckpoint,
      interruptAgentWorker,
      markAgentTaskDone,
      markAgentTaskError,
      markAgentTaskInterrupted,
      markAgentTaskNeedsVerification,
      markAgentTaskRunning,
      recordTaskCheckpoint,
      recordAgentTaskTool,
      resumeAgentWorker,
      runtimeSnapshot,
      setRuntime,
      setRunning,
      upsertCompanionJob,
      verifyAgentWorker,
    }
  }

  window.OPCRunRuntimeState = { createRunRuntimeState }
})()
