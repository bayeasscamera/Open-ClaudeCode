(function () {
  const MAX_WORKERS = 80
  const MAX_EVENTS = 32
  const ACTIVE_STATUSES = new Set(['queued', 'running', 'needs_verification'])
  const CLOSED_STATUSES = new Set(['done', 'verified', 'error', 'stopped', 'interrupted'])

  function clean(value, max = 600) {
    return String(value || '')
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  }

  function finiteTime(value, fallback) {
    const time = Number(value)
    return Number.isFinite(time) && time > 0 ? Math.round(time) : fallback
  }

  function cloneStepPlan(stepPlan = null) {
    if (!stepPlan || typeof stepPlan !== 'object') return null
    const normalized = window.OPCAgentTaskStepEngine?.normalizeStepPlan
      ? window.OPCAgentTaskStepEngine.normalizeStepPlan(stepPlan)
      : stepPlan
    return {
      ...normalized,
      steps: Array.isArray(normalized.steps)
        ? normalized.steps.map(step => ({ ...step, tools: Array.isArray(step.tools) ? step.tools.slice() : [] }))
        : [],
    }
  }

  function currentStep(stepPlan = null) {
    if (!stepPlan) return null
    return window.OPCAgentTaskStepEngine?.nextReadyStep?.(stepPlan) || null
  }

  function phaseFromStep(step = null, fallback = 'execute') {
    const id = clean(step?.id, 80)
    if (['read', 'research'].includes(id)) return 'plan'
    if (['test', 'verify'].includes(id)) return 'verify'
    if (id === 'conclude') return 'conclude'
    return fallback
  }

  function normalizeEvent(event = {}, now = Date.now()) {
    if (!event || typeof event !== 'object') return null
    const kind = clean(event.kind, 40)
    if (!kind) return null
    return {
      kind,
      at: finiteTime(event.at, now),
      label: clean(event.label, 140),
      detail: clean(event.detail, 600),
      tool: clean(event.tool, 120),
      verification: clean(event.verification, 240),
    }
  }

  function normalizeEvents(events = [], now = Date.now()) {
    if (!Array.isArray(events)) return []
    return events.map(event => normalizeEvent(event, now)).filter(Boolean).slice(-MAX_EVENTS)
  }

  function normalizeWorker(entry = {}, {
    now = Date.now(),
    interruptActive = false,
  } = {}) {
    if (!entry || typeof entry !== 'object') return null
    const id = clean(entry.id || entry.taskId, 160)
    if (!id) return null
    const createdAt = finiteTime(entry.createdAt || entry.startedAt || entry.at, now)
    const updatedAt = finiteTime(entry.updatedAt || entry.at, createdAt)
    let status = clean(entry.status, 50) || 'queued'
    let events = normalizeEvents(entry.events, now)
    if (interruptActive && ACTIVE_STATUSES.has(status)) {
      status = 'interrupted'
      events = [...events, {
        kind: 'interrupted',
        at: now,
        label: 'Worker interrompu',
        detail: 'Le worker agentique était actif lors du redémarrage.',
        tool: '',
        verification: '',
      }].slice(-MAX_EVENTS)
    }
    const stepPlan = cloneStepPlan(entry.stepPlan)
    const step = currentStep(stepPlan)
    return {
      id,
      taskId: clean(entry.taskId || id, 160),
      assistantId: clean(entry.assistantId, 160),
      chatId: clean(entry.chatId, 160),
      projectId: clean(entry.projectId, 160),
      title: clean(entry.title || entry.prompt || 'Worker OPC', 160),
      prompt: clean(entry.prompt, 1000),
      model: clean(entry.model, 240),
      cwd: clean(entry.cwd, 1000),
      command: clean(entry.command, 1000),
      status,
      phase: clean(entry.phase, 80) || phaseFromStep(step, status === 'queued' ? 'queued' : 'execute'),
      currentStepId: CLOSED_STATUSES.has(status) || status === 'blocked' ? '' : clean(step?.id, 80),
      blockedStepId: clean(entry.blockedStepId, 80),
      blockedReason: clean(entry.blockedReason, 600),
      verification: clean(entry.verification, 240),
      result: clean(entry.result, 1000),
      error: clean(entry.error, 1000),
      isolated: true,
      stepPlan,
      createdAt,
      updatedAt: interruptActive && ACTIVE_STATUSES.has(clean(entry.status, 50)) ? now : updatedAt,
      endedAt: finiteTime(entry.endedAt, CLOSED_STATUSES.has(status) ? updatedAt : 0) || '',
      events,
    }
  }

  function normalizeEntries(entries = [], options = {}) {
    if (!Array.isArray(entries)) return []
    return entries
      .map(entry => normalizeWorker(entry, { now: Date.now(), ...options }))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_WORKERS)
  }

  function cloneWorker(worker = null) {
    if (!worker) return null
    return {
      ...worker,
      events: (worker.events || []).map(event => ({ ...event })),
      stepPlan: cloneStepPlan(worker.stepPlan),
    }
  }

  function workerActionLabel(actionId = '') {
    if (actionId === 'resume') return 'Reprendre'
    if (actionId === 'verify') return 'Vérifier'
    if (actionId === 'interrupt') return 'Interrompre'
    return actionId || 'Action'
  }

  function actionsForWorker(worker = {}) {
    if (!worker || !worker.id) return []
    const status = clean(worker.status, 80)
    const actions = []
    if (!CLOSED_STATUSES.has(status)) {
      actions.push({ id: 'resume', label: workerActionLabel('resume'), tone: 'primary' })
      actions.push({ id: 'verify', label: workerActionLabel('verify'), tone: 'neutral' })
      actions.push({ id: 'interrupt', label: workerActionLabel('interrupt'), tone: 'danger' })
    } else if (status === 'interrupted' || status === 'error') {
      actions.push({ id: 'resume', label: workerActionLabel('resume'), tone: 'primary' })
    }
    return actions
  }

  function lastEventText(worker = {}) {
    const last = Array.isArray(worker.events) ? worker.events.at(-1) : null
    return clean([last?.label, last?.detail, last?.tool, last?.verification].filter(Boolean).join(' · '), 500)
  }

  function checkpointLines(checkpoint = null) {
    if (!checkpoint) return []
    const lastStep = Array.isArray(checkpoint.steps) ? checkpoint.steps.at(-1) : null
    return [
      `Checkpoint: ${clean(checkpoint.id || checkpoint.taskId, 140)}`,
      checkpoint.status ? `Statut checkpoint: ${clean(checkpoint.status, 120)}` : '',
      checkpoint.phase ? `Phase checkpoint: ${clean(checkpoint.phase, 120)}` : '',
      checkpoint.command ? `Commande checkpoint: ${clean(checkpoint.command, 300)}` : '',
      lastStep?.detail ? `Dernière preuve checkpoint: ${clean(lastStep.detail, 360)}` : '',
    ].filter(Boolean)
  }

  function resumePrompt(worker = {}, checkpoint = null, { userPrompt = 'continue' } = {}) {
    return [
      userPrompt || 'continue',
      '',
      `Worker OPC: ${clean(worker.id || worker.taskId, 160)}`,
      worker.title || worker.prompt ? `Tâche: ${clean(worker.prompt || worker.title, 700)}` : '',
      worker.status ? `Statut worker: ${clean(worker.status, 80)}` : '',
      worker.phase ? `Phase worker: ${clean(worker.phase, 80)}` : '',
      worker.currentStepId ? `Étape courante: ${clean(worker.currentStepId, 80)}` : '',
      worker.blockedReason ? `Blocage: ${clean(worker.blockedReason, 500)}` : '',
      worker.error ? `Erreur: ${clean(worker.error, 500)}` : '',
      lastEventText(worker) ? `Dernier événement: ${lastEventText(worker)}` : '',
      ...checkpointLines(checkpoint),
      '',
      'Reprends depuis ce worker sans recommencer inutilement.',
      'Relis seulement le contexte ciblé nécessaire, corrige le blocage éventuel, puis lance un test minimal ciblé.',
      "Si le test échoue, ne passe pas à la conclusion tant que le problème n'est pas réglé.",
    ].filter(Boolean).join('\n')
  }

  function verificationPrompt(worker = {}) {
    return [
      'continue',
      '',
      `Worker OPC: ${clean(worker.id || worker.taskId, 160)}`,
      worker.prompt || worker.title ? `Tâche: ${clean(worker.prompt || worker.title, 700)}` : '',
      'Vérification fraîche requise.',
      'Lance maintenant le test minimal ciblé le plus pertinent pour confirmer le résultat.',
      "Si la vérification échoue, corrige la cause avant toute conclusion.",
    ].filter(Boolean).join('\n')
  }

  function createAgentWorkerRuntime({
    workers = [],
    now = () => Date.now(),
    makeId = prefix => `${prefix}_${Date.now().toString(36)}`,
    onChange = () => {},
  } = {}) {
    let rows = normalizeEntries(workers, { now: now(), interruptActive: false })

    function publish() {
      rows = normalizeEntries(rows, { now: now(), interruptActive: false })
      onChange(rows.map(cloneWorker))
    }

    function findIndex(taskId) {
      const id = clean(taskId, 160)
      return rows.findIndex(worker => worker.id === id || worker.taskId === id)
    }

    function worker(taskId) {
      const index = findIndex(taskId)
      return index >= 0 ? cloneWorker(rows[index]) : null
    }

    function appendEvent(row, event = {}) {
      row.events = [...(row.events || []), normalizeEvent(event, now())].filter(Boolean).slice(-MAX_EVENTS)
      return row
    }

    function upsert(taskId, patch = {}, event = null) {
      const at = finiteTime(patch.at, now())
      const id = clean(taskId || patch.taskId || patch.id || makeId('worker'), 160)
      const index = findIndex(id)
      const current = index >= 0 ? rows[index] : normalizeWorker({ id, taskId: id, createdAt: at }, { now: at })
      const next = normalizeWorker({
        ...current,
        ...patch,
        id: current.id || id,
        taskId: patch.taskId || current.taskId || id,
        updatedAt: at,
        endedAt: CLOSED_STATUSES.has(patch.status || current.status) ? (patch.endedAt || at) : patch.endedAt || current.endedAt,
      }, { now: at })
      if (!next) return null
      if (event) appendEvent(next, { ...event, at })
      if (index >= 0) rows[index] = next
      else rows.unshift(next)
      publish()
      return cloneWorker(next)
    }

    function spawn(payload = {}) {
      const at = finiteTime(payload.at, now())
      return upsert(payload.taskId || payload.id, {
        ...payload,
        id: payload.id || payload.taskId,
        taskId: payload.taskId || payload.id,
        status: 'queued',
        phase: 'queued',
        createdAt: at,
        updatedAt: at,
        at,
      }, {
        kind: 'queued',
        label: 'Worker planifié',
        detail: payload.cwd || payload.model || '',
      })
    }

    function start(taskId, patch = {}) {
      const row = worker(taskId)
      const step = currentStep(row?.stepPlan)
      return upsert(taskId, {
        ...patch,
        status: 'running',
        phase: phaseFromStep(step, 'execute'),
      }, {
        kind: 'running',
        label: patch.label || 'Worker actif',
        detail: patch.detail || clean(step?.label, 200),
      })
    }

    function recordTool(taskId, patch = {}) {
      const row = worker(taskId)
      if (!row) return null
      const step = currentStep(row.stepPlan)
      let stepPlan = row.stepPlan
      const evidence = window.OPCAgentToolEvidence?.fromTool?.({
        name: patch.tool,
        target: patch.target,
        command: patch.command,
        detail: patch.detail || patch.proof,
        status: patch.status,
        error: patch.error,
      }) || null
      const failed = patch.status === 'failed' || evidence?.failed || /\b(?:fail|failed|error|erreur|échec|echec)\b/i.test(patch.error || '')
      if (step && window.OPCAgentTaskStepEngine?.recordStepResult) {
        stepPlan = window.OPCAgentTaskStepEngine.recordStepResult(stepPlan, step.id, {
          status: failed ? 'failed' : 'done',
          proof: evidence?.proof || evidence?.command || evidence?.target || patch.detail || patch.verification || patch.tool || '',
          error: failed ? patch.error || patch.detail || 'étape échouée' : '',
        })
      }
      if (stepPlan?.blocked) {
        return upsert(taskId, {
          stepPlan,
          status: 'blocked',
          phase: 'correct',
          currentStepId: '',
          blockedStepId: step?.id || row.currentStepId || '',
          blockedReason: stepPlan.blockedReason || patch.error || patch.detail || '',
          error: patch.error || patch.detail || row.error,
        }, {
          kind: 'blocked',
          label: patch.label || 'Étape bloquée',
          tool: patch.tool || '',
          detail: patch.detail || patch.error || '',
        })
      }
      const nextStep = currentStep(stepPlan)
      return upsert(taskId, {
        stepPlan,
        status: 'running',
        phase: phaseFromStep(nextStep, 'execute'),
        currentStepId: clean(nextStep?.id, 80),
      }, {
        kind: 'tool',
        label: patch.label || patch.tool || 'Outil',
        tool: patch.tool || '',
        detail: patch.detail || '',
      })
    }

    function repair(taskId, patch = {}) {
      const row = worker(taskId)
      if (!row) return null
      const stepId = row.blockedStepId || row.currentStepId
      const stepPlan = stepId && window.OPCAgentTaskStepEngine?.recordStepResult
        ? window.OPCAgentTaskStepEngine.recordStepResult(row.stepPlan, stepId, {
          status: 'done',
          proof: patch.proof || patch.detail || 'corrigé',
        })
        : row.stepPlan
      const nextStep = currentStep(stepPlan)
      return upsert(taskId, {
        ...patch,
        stepPlan,
        status: 'running',
        phase: phaseFromStep(nextStep, 'execute'),
        currentStepId: clean(nextStep?.id, 80),
        blockedStepId: '',
        blockedReason: '',
        error: '',
      }, {
        kind: 'repaired',
        label: patch.label || 'Étape corrigée',
        detail: patch.proof || patch.detail || '',
      })
    }

    function verify(taskId, patch = {}) {
      const row = worker(taskId)
      if (!row) return null
      let stepPlan = row.stepPlan
      let step = currentStep(stepPlan)
      while (step && ['test', 'verify', 'conclude'].includes(step.id) && window.OPCAgentTaskStepEngine?.recordStepResult) {
        stepPlan = window.OPCAgentTaskStepEngine.recordStepResult(stepPlan, step.id, {
          status: 'done',
          proof: patch.verification || patch.detail || 'vérifié',
        })
        step = currentStep(stepPlan)
      }
      return upsert(taskId, {
        ...patch,
        stepPlan,
        status: 'verified',
        phase: 'done',
        currentStepId: '',
        verification: patch.verification || patch.detail || '',
        result: patch.result || row.result,
        error: '',
      }, {
        kind: 'verified',
        label: patch.label || 'Worker vérifié',
        detail: patch.detail || '',
        verification: patch.verification || '',
      })
    }

    function needsVerification(taskId, patch = {}) {
      const row = worker(taskId)
      const step = currentStep(row?.stepPlan)
      return upsert(taskId, {
        ...patch,
        status: 'needs_verification',
        phase: 'verify',
        currentStepId: clean(step?.id || row?.currentStepId, 80),
      }, {
        kind: 'needs_verification',
        label: patch.label || 'Vérification requise',
        detail: patch.detail || '',
      })
    }

    function done(taskId, patch = {}) {
      return upsert(taskId, {
        ...patch,
        status: patch.verification ? 'verified' : 'done',
        phase: 'done',
        currentStepId: '',
        verification: patch.verification || '',
        result: patch.result || patch.detail || '',
      }, {
        kind: patch.verification ? 'verified' : 'done',
        label: patch.label || 'Worker terminé',
        detail: patch.detail || patch.result || '',
        verification: patch.verification || '',
      })
    }

    function fail(taskId, patch = {}) {
      return upsert(taskId, {
        ...patch,
        status: 'error',
        phase: 'error',
        currentStepId: '',
        error: patch.error || patch.detail || '',
      }, {
        kind: 'error',
        label: patch.label || 'Worker en erreur',
        detail: patch.error || patch.detail || '',
      })
    }

    function interrupt(taskId, patch = {}) {
      return upsert(taskId, {
        ...patch,
        status: patch.status || 'interrupted',
        phase: patch.phase || 'interrupted',
        currentStepId: '',
        error: patch.error || patch.detail || '',
      }, {
        kind: patch.status || 'interrupted',
        label: patch.label || 'Worker interrompu',
        detail: patch.detail || patch.error || '',
      })
    }

    return {
      done,
      fail,
      interrupt,
      needsVerification,
      recordTool,
      repair,
      spawn,
      start,
      verify,
      worker,
      workers: () => rows.map(cloneWorker),
    }
  }

  window.OPCAgentWorkerRuntime = {
    ACTIVE_STATUSES,
    actionsForWorker,
    createAgentWorkerRuntime,
    normalizeEntries,
    normalizeWorker,
    resumePrompt,
    verificationPrompt,
  }
})()
