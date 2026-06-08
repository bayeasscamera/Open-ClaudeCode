(function () {
  const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000
  const DEFAULT_MAX_FAILURES = 80

  function clean(value, max = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function failureAt(value, fallback = Date.now()) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback
  }

  function normalizeFailure(entry = {}, index = 0, now = Date.now()) {
    const at = failureAt(entry.at || entry.createdAt, now - index)
    const model = clean(entry.model, 180)
    if (!model) return null
    return {
      id: clean(entry.id, 160) || `${model}:${at}:${index}`,
      model,
      reason: clean(entry.reason || entry.error || entry.status, 700),
      code: Number.isFinite(Number(entry.code)) ? Number(entry.code) : 0,
      taskId: clean(entry.taskId, 120),
      assistantId: clean(entry.assistantId, 120),
      category: clean(entry.category, 80),
      at,
    }
  }

  function normalizeHistory(history = [], { now = Date.now(), maxFailures = DEFAULT_MAX_FAILURES } = {}) {
    if (!Array.isArray(history)) return []
    const rows = []
    const seen = new Set()
    for (const [index, entry] of history.entries()) {
      const row = normalizeFailure(entry, index, now)
      if (!row || seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
    }
    return rows.sort((a, b) => b.at - a.at).slice(0, maxFailures)
  }

  function recordFailure(history = [], failure = {}, options = {}) {
    const now = Number.isFinite(Number(failure.at)) ? Number(failure.at) : Date.now()
    const row = normalizeFailure({ ...failure, at: now }, 0, now)
    if (!row) return normalizeHistory(history, options)
    return normalizeHistory([row, ...(Array.isArray(history) ? history : [])], {
      ...options,
      now,
    })
  }

  function recentFailures(history = [], model = '', { now = Date.now(), windowMs = DEFAULT_WINDOW_MS } = {}) {
    const selected = clean(model, 180)
    return normalizeHistory(history, { now })
      .filter(entry => entry.model === selected && now - entry.at <= windowMs)
  }

  function recommend({
    history = [],
    selectedModel = '',
    profiles = [],
    requirements = {},
    threshold = 2,
    now = Date.now(),
    windowMs = DEFAULT_WINDOW_MS,
  } = {}) {
    const failures = recentFailures(history, selectedModel, { now, windowMs })
    const shouldFallback = failures.length >= threshold
    const router = window.OPCAgentProviderRouter
    const route = shouldFallback && router?.routeTask
      ? router.routeTask({
          profiles,
          selectedModel,
          requireAgent: requirements.requireAgent !== false,
          requireTools: Boolean(requirements.requireTools),
          minInputTokens: Number(requirements.minInputTokens || 0),
          requirements: {
            ...requirements,
            preferLargeContext: true,
            selectedModel,
          },
        })
      : null
    const suggested = route?.suggested && route.suggested.model !== selectedModel ? route.suggested : null
    const fallbackLabel = suggested?.label || suggested?.model || ''
    return {
      shouldFallback: Boolean(shouldFallback && suggested),
      selectedModel,
      failureCount: failures.length,
      failures,
      suggested,
      route,
      label: suggested ? 'Fallback provider recommandé' : 'Échecs provider répétés',
      detail: shouldFallback
        ? `${failures.length} echecs recents sur ${selectedModel}.${fallbackLabel ? ` Fallback compatible: ${fallbackLabel}.` : ''}`
        : '',
    }
  }

  function applyControlledAutoRoute({
    enabled = false,
    history = [],
    selectedModel = '',
    profiles = [],
    requirements = {},
    threshold = 2,
    now = Date.now(),
    windowMs = DEFAULT_WINDOW_MS,
  } = {}) {
    const recommendation = recommend({
      history,
      selectedModel,
      profiles,
      requirements,
      threshold,
      now,
      windowMs,
    })
    if (!enabled || !recommendation.shouldFallback || !recommendation.suggested?.model) {
      return {
        model: selectedModel,
        switched: false,
        recommendation,
        audit: null,
      }
    }
    const fallbackModel = recommendation.suggested.model
    return {
      model: fallbackModel,
      switched: true,
      recommendation,
      audit: {
        kind: 'provider-auto-router',
        status: 'warning',
        label: 'Provider auto-router',
        detail: recommendation.detail || `Fallback vers ${fallbackModel}`,
        selectedModel,
        fallbackModel,
      },
    }
  }

  window.OPCProviderFailurePolicy = {
    applyControlledAutoRoute,
    normalizeHistory,
    recentFailures,
    recordFailure,
    recommend,
  }
})()
