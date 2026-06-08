(function () {
  const FINAL_STATUSES = new Set(['done', 'verified', 'skipped'])
  const FAILED_STATUSES = new Set(['failed', 'error'])

  function clean(value, max = 360) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function normalizeStep(step = {}, index = 0) {
    const id = clean(step.id || `step_${index + 1}`, 80)
    return {
      id,
      label: clean(step.label || id, 140),
      tools: Array.isArray(step.tools) ? step.tools.map(tool => clean(tool, 80)).filter(Boolean) : [],
      required: step.required !== false,
      status: clean(step.status, 40) || (index === 0 ? 'ready' : 'pending'),
      proof: clean(step.proof, 500),
      error: clean(step.error, 500),
      attempts: Number.isFinite(Number(step.attempts)) ? Math.max(0, Math.round(Number(step.attempts))) : 0,
      detail: clean(step.detail, 500),
    }
  }

  function normalizeStepPlan(plan = {}) {
    const sourceSteps = Array.isArray(plan.steps) ? plan.steps : []
    const steps = sourceSteps.map(normalizeStep)
    let blocked = Boolean(plan.blocked)
    const failedIndex = steps.findIndex(step => FAILED_STATUSES.has(step.status))
    if (failedIndex >= 0) blocked = true
    if (!blocked) {
      const readyIndex = steps.findIndex(step => step.status === 'ready')
      if (readyIndex < 0) {
        const nextIndex = steps.findIndex(step => !FINAL_STATUSES.has(step.status))
        if (nextIndex >= 0) steps[nextIndex].status = 'ready'
      }
    }
    return {
      version: 1,
      blocked,
      blockedReason: clean(plan.blockedReason, 500),
      steps,
    }
  }

  function createStepPlan({ toolPlan = {} } = {}) {
    return normalizeStepPlan({
      steps: (toolPlan.steps || []).map((step, index) => ({
        id: step.id,
        label: step.label,
        tools: step.tools || [],
        required: step.required !== false,
        status: index === 0 ? 'ready' : 'pending',
        detail: step.detail || '',
      })),
    })
  }

  function clonePlan(plan = {}) {
    const normalized = normalizeStepPlan(plan)
    return {
      ...normalized,
      steps: normalized.steps.map(step => ({ ...step, tools: step.tools.slice() })),
    }
  }

  function nextReadyStep(plan = {}) {
    const normalized = normalizeStepPlan(plan)
    if (normalized.blocked) return null
    return normalized.steps.find(step => step.status === 'ready') || null
  }

  function recordStepResult(plan = {}, stepId = '', patch = {}) {
    const next = clonePlan(plan)
    const id = clean(stepId, 80)
    const index = next.steps.findIndex(step => step.id === id)
    if (index < 0) return next
    const requested = clean(patch.status, 40) || 'done'
    const failed = FAILED_STATUSES.has(requested)
    const status = failed ? 'failed' : FINAL_STATUSES.has(requested) ? requested : requested === 'blocked' ? 'failed' : 'done'
    next.steps[index] = {
      ...next.steps[index],
      status,
      proof: clean(patch.proof || patch.verification || patch.detail, 500),
      error: clean(patch.error, 500),
      attempts: Number(next.steps[index].attempts || 0) + 1,
    }
    if (failed) {
      next.blocked = true
      next.blockedReason = next.steps[index].error || `${next.steps[index].id} failed`
      return next
    }
    next.blocked = false
    next.blockedReason = ''
    for (let cursor = index + 1; cursor < next.steps.length; cursor += 1) {
      if (!FINAL_STATUSES.has(next.steps[cursor].status)) {
        next.steps[cursor] = { ...next.steps[cursor], status: 'ready' }
        break
      }
    }
    return normalizeStepPlan(next)
  }

  function summary(plan = {}) {
    const normalized = normalizeStepPlan(plan)
    const steps = normalized.steps
      .map(step => `${step.id}: ${step.status}${step.proof ? ` (${step.proof})` : ''}${step.error ? ` erreur ${step.error}` : ''}`)
      .join(' · ')
    return [normalized.blocked ? `bloqué: ${normalized.blockedReason || 'étape en erreur'}` : '', steps].filter(Boolean).join(' · ')
  }

  window.OPCAgentTaskStepEngine = {
    createStepPlan,
    nextReadyStep,
    normalizeStepPlan,
    recordStepResult,
    summary,
  }
})()
