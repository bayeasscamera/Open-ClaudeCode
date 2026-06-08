(function () {
  function clean(value, max = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function issue(code, label, detail, tone = 'warning') {
    return { code, label, detail: clean(detail, 500), tone }
  }

  function modelName({ runtime = {}, assistant = {}, profile = {} } = {}) {
    return clean(runtime.model || assistant.model || assistant.diagnostics?.model || profile.model, 180)
  }

  function invalidBaseUrl(profile = {}) {
    const baseUrl = clean(profile.baseUrl, 500)
    return baseUrl && !/^https?:\/\//i.test(baseUrl)
  }

  function inputTokens(profile = {}) {
    if (window.OPCAgentContextBudget?.profileInputTokens) return window.OPCAgentContextBudget.profileInputTokens(profile)
    const value = Number(profile.maxInputTokens || profile.inputTokens || profile.max_input_tokens)
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  }

  function compatibleFallback({ profiles = [], model = '', requirements = {} } = {}) {
    const router = window.OPCAgentProviderRouter
    if (!router?.routeTask || !Array.isArray(profiles) || !profiles.length) return null
    const route = router.routeTask({
      profiles,
      selectedModel: model,
      requireAgent: requirements.requireAgent !== false,
      requireTools: Boolean(requirements.requireTools),
      minInputTokens: Number(requirements.minInputTokens || 0),
      requirements: {
        ...requirements,
        preferLargeContext: true,
        selectedModel: model,
      },
    })
    return route?.suggested && route.suggested.model !== model ? route.suggested : null
  }

  function diagnose({
    now = Date.now(),
    runtime = {},
    assistant = {},
    profile = null,
    providerCheck = null,
    requirements = {},
    profiles = [],
  } = {}) {
    const diagnostics = assistant?.diagnostics || {}
    const items = []
    const model = modelName({ runtime, assistant, profile: profile || {} })
    const startedAt = Number(diagnostics.startedAt || 0)
    const lastActivityAt = Number(diagnostics.lastActivityAt || runtime.updatedAt || startedAt || 0)
    const elapsedMs = startedAt > 0 ? Math.max(0, now - startedAt) : 0
    const idleMs = lastActivityAt > 0 ? Math.max(0, now - lastActivityAt) : 0
    const providerEvents = Number(diagnostics.providerEventCount || 0)
    const eventCount = Number(diagnostics.eventCount || 0)
    const providerPhase = /provider|stream|running/i.test(String(runtime.phase || diagnostics.runtimePhase || ''))

    if (providerPhase && idleMs >= 45000) {
      items.push(issue('provider_silence', 'Silence provider', `${Math.round(idleMs / 1000)}s sans activité provider.`, 'warning'))
    }
    if (elapsedMs >= 30000 && eventCount <= 2 && providerEvents <= 1) {
      items.push(issue('low_throughput', 'Débit provider faible', `${Math.round(elapsedMs / 1000)}s avec ${eventCount} événement(s).`, 'warning'))
    }

    const category = window.OPCProviderHealth?.statusCategory?.(providerCheck) || providerCheck?.status || ''
    const errorText = clean([providerCheck?.error, providerCheck?.issue?.detail, diagnostics.providerMessage].filter(Boolean).join(' '), 1000)
    if (category === 'context_length' || /prompt is too long|reduce the length|context/i.test(errorText)) {
      items.push(issue('context_length', 'Contexte trop long', errorText || 'Le provider refuse la taille du contexte.', 'error'))
    }
    if (category === 'unsupported' || /unsupported|not supported|parameter/i.test(errorText)) {
      items.push(issue('unsupported', 'Paramètre non supporté', errorText || 'Le provider refuse un paramètre.', 'error'))
    }
    if (category === 'timeout') {
      items.push(issue('timeout', 'Timeout provider', errorText || 'Le provider ne répond pas dans le délai attendu.', 'warning'))
    }
    if (category === 'rate_limited') {
      items.push(issue('rate_limited', 'Rate limit provider', errorText || 'Le provider impose une pause.', 'warning'))
    }
    if (profile && profile.configured === false) {
      items.push(issue('key_missing', 'Clé provider manquante', 'Le profil sélectionné n’est pas configuré avec une clé valide.', 'error'))
    }
    if (invalidBaseUrl(profile || {})) {
      items.push(issue('bad_endpoint', 'Base URL invalide', `Base URL sans protocole valide: ${profile.baseUrl}`, 'error'))
    }
    if (requirements.requireTools && profile?.capabilities?.tools === false) {
      items.push(issue('tools_missing', 'Outils indisponibles', 'Le profil sélectionné ne supporte pas les outils requis par cette tâche.', 'error'))
    }
    const requiredTokens = Number(requirements.minInputTokens || 0)
    const capacity = inputTokens(profile || {})
    if (requiredTokens && capacity && capacity < requiredTokens) {
      items.push(issue('context_insufficient', 'Contexte insuffisant', `Capacité ${capacity} tokens pour ${requiredTokens} tokens requis.`, 'error'))
    }
    const fallback = compatibleFallback({ profiles, model, requirements })
    if (fallback) {
      items.push(issue('fallback_available', 'Fallback disponible', `Fallback compatible: ${fallback.label || fallback.model}.`, 'info'))
    }

    const status = items.some(item => item.tone === 'error') ? 'error' : items.length ? 'warning' : 'ok'
    const top = items[0] || null
    return {
      version: 1,
      status,
      model,
      elapsedMs,
      idleMs,
      eventCount: Number.isFinite(eventCount) ? eventCount : 0,
      providerEventCount: Number.isFinite(providerEvents) ? providerEvents : 0,
      items,
      fallback,
      topIssue: top,
      label: top ? top.label : 'Provider stable',
      detail: top ? `${model || 'provider'} · ${top.detail}` : `${model || 'provider'} · aucun blocage provider détecté`,
    }
  }

  window.OPCProviderRuntimeDiagnostics = {
    diagnose,
  }
})()
