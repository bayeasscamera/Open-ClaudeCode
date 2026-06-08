(function () {
  const ACTIVE_STATUSES = new Set(['queued', 'running', 'tool', 'needs_verification', 'error', 'interrupted', 'stopped'])
  const CLOSED_STATUSES = new Set(['done', 'verified'])

  function clean(value, max = 800) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function normalizeStep(step = {}, now = Date.now()) {
    return {
      at: Number.isFinite(Number(step.at)) ? Number(step.at) : now,
      phase: clean(step.phase, 80),
      status: clean(step.status, 80) || 'running',
      tool: clean(step.tool, 80),
      command: clean(step.command || step.target, 300),
      detail: clean(step.detail || step.message || step.command || step.target, 500),
    }
  }

  function normalizeCheckpoint(entry = {}, now = Date.now(), { maxStepsPerCheckpoint = 12 } = {}) {
    const createdAt = Number.isFinite(Number(entry.createdAt || entry.at)) ? Number(entry.createdAt || entry.at) : now
    const updatedAt = Number.isFinite(Number(entry.updatedAt || entry.at)) ? Number(entry.updatedAt || entry.at) : createdAt
    return {
      id: clean(entry.id || entry.taskId, 120),
      assistantId: clean(entry.assistantId, 120),
      chatId: clean(entry.chatId, 120),
      projectId: clean(entry.projectId, 120),
      model: clean(entry.model, 180),
      cwd: clean(entry.cwd, 500),
      prompt: clean(entry.prompt || entry.displayPrompt, 1200),
      phase: clean(entry.phase, 120),
      status: clean(entry.status, 80) || 'queued',
      command: clean(entry.command, 400),
      result: clean(entry.result, 1200),
      error: clean(entry.error, 1200),
      nextAction: clean(entry.nextAction, 500),
      toolCount: Number.isFinite(Number(entry.toolCount)) ? Number(entry.toolCount) : 0,
      verification: clean(entry.verification, 300),
      createdAt,
      updatedAt,
      steps: Array.isArray(entry.steps)
        ? entry.steps.map(step => normalizeStep(step, now)).slice(-maxStepsPerCheckpoint)
        : [],
    }
  }

  function normalizeEntries(entries = [], options = {}) {
    if (!Array.isArray(entries)) return []
    const maxCheckpoints = Number(options.maxCheckpoints || 80)
    const seen = new Set()
    const normalized = []
    for (const entry of entries) {
      const item = normalizeCheckpoint(entry, Date.now(), options)
      if (!item.id || seen.has(item.id)) continue
      seen.add(item.id)
      normalized.push(item)
    }
    return normalized.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxCheckpoints)
  }

  function createTaskCheckpointStore({
    checkpoints = [],
    now = Date.now,
    maxCheckpoints = 80,
    maxStepsPerCheckpoint = 12,
    onChange = () => {},
  } = {}) {
    let entries = normalizeEntries(checkpoints, { maxCheckpoints, maxStepsPerCheckpoint })

    function publish() {
      entries = normalizeEntries(entries, { maxCheckpoints, maxStepsPerCheckpoint })
      onChange(entries.slice())
      return entries
    }

    function findIndex(taskId) {
      return entries.findIndex(entry => entry.id === taskId)
    }

    function upsert(taskId, patch = {}) {
      const id = clean(taskId || patch.id || patch.taskId, 120)
      if (!id) return null
      const at = Number.isFinite(Number(patch.at)) ? Number(patch.at) : now()
      const index = findIndex(id)
      const current = index >= 0 ? entries[index] : { id, createdAt: at, steps: [] }
      const next = normalizeCheckpoint({
        ...current,
        ...patch,
        id,
        updatedAt: at,
        steps: current.steps || [],
      }, at, { maxStepsPerCheckpoint })
      if (index >= 0) entries[index] = next
      else entries.unshift(next)
      publish()
      return next
    }

    function recordStep(taskId, step = {}) {
      const at = Number.isFinite(Number(step.at)) ? Number(step.at) : now()
      const current = upsert(taskId, {
        phase: step.phase,
        status: step.status || 'running',
        command: step.command || step.target,
        updatedAt: at,
        at,
      })
      if (!current) return null
      const normalizedStep = normalizeStep(step, at)
      const index = findIndex(current.id)
      entries[index] = normalizeCheckpoint({
        ...entries[index],
        phase: normalizedStep.phase || entries[index].phase,
        status: normalizedStep.status || entries[index].status,
        command: normalizedStep.command || entries[index].command,
        toolCount: normalizedStep.tool ? Number(entries[index].toolCount || 0) + 1 : entries[index].toolCount,
        steps: [...(entries[index].steps || []), normalizedStep].slice(-maxStepsPerCheckpoint),
        updatedAt: at,
      }, at, { maxStepsPerCheckpoint })
      publish()
      return entries[index]
    }

    function finish(taskId, patch = {}) {
      const at = Number.isFinite(Number(patch.at)) ? Number(patch.at) : now()
      const status = clean(patch.status, 80) || 'done'
      return upsert(taskId, {
        ...patch,
        status,
        phase: patch.phase || status,
        nextAction: patch.nextAction || (CLOSED_STATUSES.has(status) ? '' : 'reprendre la tâche depuis le dernier checkpoint'),
        at,
      })
    }

    function resumeCandidate({ model = '', cwd = '', taskId = '' } = {}) {
      return entries.find(entry => {
        if (taskId && entry.id !== taskId) return false
        if (model && entry.model && entry.model !== model) return false
        if (cwd && entry.cwd && entry.cwd !== cwd) return false
        return ACTIVE_STATUSES.has(entry.status) && !CLOSED_STATUSES.has(entry.status)
      }) || null
    }

    function summarize(entry = null) {
      if (!entry) return ''
      const lastStep = entry.steps?.at?.(-1)
      const detail = clean(entry.error || lastStep?.detail || entry.nextAction || entry.phase, 220)
      return [`reprendre ${entry.id}`, entry.status, detail].filter(Boolean).join(' · ')
    }

    return {
      entries: () => entries.slice(),
      finish,
      recordStep,
      resumeCandidate,
      summarize,
      upsert,
    }
  }

  window.OPCTaskCheckpointStore = {
    ACTIVE_STATUSES,
    createTaskCheckpointStore,
    normalizeEntries,
    normalizeCheckpoint,
  }
})()
