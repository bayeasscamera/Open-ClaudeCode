(function () {
  const DEFAULT_MAX_ENTRIES = 80
  const DEFAULT_MAX_EVENTS_PER_ENTRY = 24
  const ACTIVE_STATUSES = new Set(['queued', 'running', 'tool'])
  const FINAL_STATUSES = new Set(['done', 'verified', 'needs_verification', 'error', 'stopped', 'interrupted'])
  const KNOWN_STATUSES = new Set([...ACTIVE_STATUSES, ...FINAL_STATUSES])

  function compactText(value, max = 600) {
    return String(value || '')
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  }

  function titleFromPrompt(value) {
    const title = window.OPCStateRules?.titleFromPrompt?.(value) || compactText(value, 80)
    return title || 'Tâche OPC'
  }

  function finiteTime(value, fallback) {
    const time = Number(value)
    return Number.isFinite(time) && time > 0 ? Math.round(time) : fallback
  }

  function normalizeStatus(value, fallback = 'queued') {
    const status = compactText(value, 40)
    return KNOWN_STATUSES.has(status) ? status : fallback
  }

  function normalizeEvent(event, now) {
    if (!event || typeof event !== 'object') return null
    const kind = compactText(event.kind, 40)
    if (!kind) return null
    return {
      kind,
      at: finiteTime(event.at, now),
      label: compactText(event.label, 120),
      detail: compactText(event.detail, 500),
      tool: compactText(event.tool, 120),
      verification: compactText(event.verification, 240),
    }
  }

  function normalizeStepPlan(stepPlan = null) {
    if (!stepPlan || typeof stepPlan !== 'object') return null
    return window.OPCAgentTaskStepEngine?.normalizeStepPlan
      ? window.OPCAgentTaskStepEngine.normalizeStepPlan(stepPlan)
      : stepPlan
  }

  function normalizeEvents(events, now, maxEventsPerEntry = DEFAULT_MAX_EVENTS_PER_ENTRY) {
    if (!Array.isArray(events)) return []
    return events
      .map(event => normalizeEvent(event, now))
      .filter(Boolean)
      .slice(-maxEventsPerEntry)
  }

  function normalizeEntry(entry, {
    now = Date.now(),
    maxEventsPerEntry = DEFAULT_MAX_EVENTS_PER_ENTRY,
    interruptActive = false,
  } = {}) {
    if (!entry || typeof entry !== 'object') return null
    const id = compactText(entry.id || entry.taskId, 160)
    if (!id) return null
    const createdAt = finiteTime(entry.createdAt || entry.startedAt, now)
    const updatedAt = finiteTime(entry.updatedAt || createdAt, createdAt)
    let status = normalizeStatus(entry.status)
    let events = normalizeEvents(entry.events, now, maxEventsPerEntry)
    if (interruptActive && ACTIVE_STATUSES.has(status)) {
      status = 'interrupted'
      events = [...events, {
        kind: 'interrupted',
        at: now,
        label: 'Interrompue au redémarrage',
        detail: 'La tâche était active lors du chargement de l’état.',
        tool: '',
        verification: '',
      }].slice(-maxEventsPerEntry)
    }
    return {
      id,
      assistantId: compactText(entry.assistantId, 160),
      chatId: compactText(entry.chatId, 160),
      projectId: compactText(entry.projectId, 160),
      title: titleFromPrompt(entry.title || entry.prompt || id),
      prompt: compactText(entry.prompt, 1000),
      status,
      model: compactText(entry.model, 240),
      cwd: compactText(entry.cwd, 1000),
      command: compactText(entry.command, 1000),
      verification: compactText(entry.verification, 240),
      result: compactText(entry.result, 1000),
      error: compactText(entry.error, 1000),
      stepPlan: normalizeStepPlan(entry.stepPlan),
      createdAt,
      updatedAt: interruptActive && ACTIVE_STATUSES.has(normalizeStatus(entry.status)) ? now : updatedAt,
      endedAt: finiteTime(entry.endedAt, FINAL_STATUSES.has(status) ? updatedAt : 0) || '',
      events,
    }
  }

  function normalizeEntries(entries, {
    now = Date.now(),
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxEventsPerEntry = DEFAULT_MAX_EVENTS_PER_ENTRY,
    interruptActive = false,
  } = {}) {
    if (!Array.isArray(entries)) return []
    return entries
      .map(entry => normalizeEntry(entry, { now, maxEventsPerEntry, interruptActive }))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, maxEntries)
  }

  function cloneEntry(entry) {
    return {
      ...entry,
      events: (entry.events || []).map(event => ({ ...event })),
      stepPlan: entry.stepPlan
        ? { ...entry.stepPlan, steps: (entry.stepPlan.steps || []).map(step => ({ ...step, tools: (step.tools || []).slice() })) }
        : null,
    }
  }

  function createAgentTaskLedger({
    entries = [],
    makeId = prefix => `${prefix}_${Date.now().toString(36)}`,
    now = () => Date.now(),
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxEventsPerEntry = DEFAULT_MAX_EVENTS_PER_ENTRY,
    onChange = () => {},
  } = {}) {
    let rows = normalizeEntries(entries, {
      now: now(),
      maxEntries,
      maxEventsPerEntry,
      interruptActive: false,
    })

    function publish() {
      rows = normalizeEntries(rows, {
        now: now(),
        maxEntries,
        maxEventsPerEntry,
        interruptActive: false,
      })
      onChange(rows.map(cloneEntry))
    }

    function findIndex(taskId) {
      const id = compactText(taskId, 160)
      return rows.findIndex(entry => entry.id === id)
    }

    function appendEvent(entry, event) {
      entry.events = [...(entry.events || []), normalizeEvent(event, now())].filter(Boolean).slice(-maxEventsPerEntry)
      return entry
    }

    function upsert(taskId, patch = {}, event = null) {
      const id = compactText(taskId || patch.taskId || patch.id || makeId('agentTask'), 160)
      const at = finiteTime(patch.at, now())
      const index = findIndex(id)
      const current = index >= 0 ? rows[index] : normalizeEntry({ id, createdAt: at, updatedAt: at }, { now: at, maxEventsPerEntry })
      const next = {
        ...current,
        ...patch,
        id,
        title: titleFromPrompt(patch.title || patch.prompt || current.title || id),
        stepPlan: normalizeStepPlan(patch.stepPlan || current.stepPlan),
        updatedAt: at,
      }
      if (FINAL_STATUSES.has(next.status) && !next.endedAt) next.endedAt = at
      if (event) appendEvent(next, { ...event, at })
      const normalized = normalizeEntry(next, { now: at, maxEventsPerEntry }) || next
      if (index >= 0) rows[index] = normalized
      else rows.unshift(normalized)
      publish()
      return cloneEntry(normalized)
    }

    function enqueue(payload = {}) {
      const at = finiteTime(payload.at, now())
      const taskId = compactText(payload.taskId || payload.id || makeId('agentTask'), 160)
      return upsert(taskId, {
        id: taskId,
        assistantId: payload.assistantId,
        chatId: payload.chatId,
        projectId: payload.projectId,
        title: payload.title || titleFromPrompt(payload.prompt || taskId),
        prompt: payload.prompt,
        status: 'queued',
        model: payload.model,
        cwd: payload.cwd,
        command: payload.command,
        stepPlan: payload.stepPlan,
        verification: '',
        result: '',
        error: '',
        createdAt: at,
        updatedAt: at,
        at,
      }, {
        kind: 'queued',
        label: 'Planifiée',
        detail: payload.detail || payload.cwd || '',
      })
    }

    function markRunning(taskId, patch = {}) {
      return upsert(taskId, { ...patch, status: 'running' }, {
        kind: 'running',
        label: patch.label || 'Exécution',
        detail: patch.detail || '',
      })
    }

    function recordTool(taskId, patch = {}) {
      const index = findIndex(taskId)
      let stepPlan = index >= 0 ? rows[index].stepPlan : null
      const currentStep = stepPlan ? window.OPCAgentTaskStepEngine?.nextReadyStep?.(stepPlan) : null
      if (currentStep && window.OPCAgentTaskStepEngine?.recordStepResult) {
        const proof = patch.detail || patch.verification || patch.tool || ''
        const status = /test|verify|verification/i.test(currentStep.id) && /fail|error|échec|erreur/i.test(proof) ? 'failed' : 'done'
        stepPlan = window.OPCAgentTaskStepEngine.recordStepResult(stepPlan, currentStep.id, { status, proof, error: status === 'failed' ? proof : '' })
      }
      return upsert(taskId, { ...patch, stepPlan, status: patch.status || 'running' }, {
        kind: 'tool',
        label: patch.label || patch.tool || 'Outil',
        tool: patch.tool || '',
        detail: patch.detail || '',
      })
    }

    function markDone(taskId, patch = {}) {
      return upsert(taskId, { ...patch, status: 'done' }, {
        kind: 'done',
        label: patch.label || 'Terminée',
        detail: patch.detail || patch.result || '',
      })
    }

    function markVerified(taskId, patch = {}) {
      const index = findIndex(taskId)
      let stepPlan = index >= 0 ? rows[index].stepPlan : null
      const currentStep = stepPlan ? window.OPCAgentTaskStepEngine?.nextReadyStep?.(stepPlan) : null
      if (currentStep && window.OPCAgentTaskStepEngine?.recordStepResult) {
        stepPlan = window.OPCAgentTaskStepEngine.recordStepResult(stepPlan, currentStep.id, { status: 'done', proof: patch.verification || patch.detail || 'vérifié' })
      }
      return upsert(taskId, { ...patch, stepPlan, status: 'verified' }, {
        kind: 'verified',
        label: patch.label || 'Vérifiée',
        detail: patch.detail || '',
        verification: patch.verification || '',
      })
    }

    function markNeedsVerification(taskId, patch = {}) {
      return upsert(taskId, { ...patch, status: 'needs_verification' }, {
        kind: 'needs_verification',
        label: patch.label || 'Vérification requise',
        detail: patch.detail || 'Lance un test minimal pour confirmer que tout marche pour cette tâche.',
        verification: patch.verification || '',
      })
    }

    function markError(taskId, patch = {}) {
      const index = findIndex(taskId)
      let stepPlan = index >= 0 ? rows[index].stepPlan : null
      const currentStep = stepPlan ? window.OPCAgentTaskStepEngine?.nextReadyStep?.(stepPlan) : null
      if (currentStep && window.OPCAgentTaskStepEngine?.recordStepResult) {
        stepPlan = window.OPCAgentTaskStepEngine.recordStepResult(stepPlan, currentStep.id, { status: 'failed', error: patch.detail || patch.error || 'erreur' })
      }
      return upsert(taskId, { ...patch, stepPlan, status: 'error' }, {
        kind: 'error',
        label: patch.label || 'Erreur',
        detail: patch.detail || patch.error || '',
      })
    }

    function markInterrupted(taskId, patch = {}) {
      return upsert(taskId, { ...patch, status: patch.status || 'interrupted' }, {
        kind: patch.status || 'interrupted',
        label: patch.label || 'Interrompue',
        detail: patch.detail || '',
      })
    }

    return {
      enqueue,
      entries: () => rows.map(cloneEntry),
      markDone,
      markError,
      markInterrupted,
      markNeedsVerification,
      markRunning,
      markVerified,
      recordTool,
    }
  }

  window.OPCAgentTaskLedger = {
    ACTIVE_STATUSES,
    DEFAULT_MAX_ENTRIES,
    DEFAULT_MAX_EVENTS_PER_ENTRY,
    createAgentTaskLedger,
    normalizeEntries,
    normalizeEntry,
  }
})()
