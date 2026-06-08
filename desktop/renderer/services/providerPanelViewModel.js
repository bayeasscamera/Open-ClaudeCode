(function () {
  function repairLogTitle(log = {}) {
    const repaired = Number(log.repair?.count || 0)
    const checked = Array.isArray(log.checkedModels) ? log.checkedModels.length : 0
    if (repaired && checked) return `${repaired} correction(s), ${checked} provider(s) retesté(s)`
    if (repaired) return `${repaired} correction(s) appliquée(s)`
    if (checked) return `${checked} provider(s) en erreur retesté(s)`
    return 'Aucune correction ni erreur provider à retester'
  }

  function repairChangeLabel(change = {}) {
    const owner = change.scope === 'global'
      ? 'Configuration globale'
      : change.label || change.model || 'Provider'
    return `${owner} · ${change.field || 'provider'}`
  }

  function providerSubtitle(profile = {}, defaultModel = '') {
    return [
      profile.model,
      profile.providerName || profile.provider,
      providerAuthLabel(profile),
      ...providerBudgetMeta(profile),
      profile.disabled || profile.quarantinedAt ? 'en pause' : '',
      profile.agentRunnable === false ? 'outil de suggestion' : 'agent',
      profile.model === defaultModel ? 'défaut' : '',
    ].filter(Boolean).join(' · ')
  }

  function positiveInteger(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
  }

  function providerAuthLabel(profile = {}) {
    if (profile.noAuth) return 'sans auth'
    if (profile.configured === false) return 'clé manquante'
    return ''
  }

  function providerBudgetMeta(profile = {}) {
    const contextWindowTokens = positiveInteger(profile.contextWindowTokens)
    const maxInputTokens = positiveInteger(profile.maxInputTokens)
    const maxTokens = positiveInteger(profile.maxTokens)
    return [
      contextWindowTokens ? `ctx ${contextWindowTokens}` : '',
      maxInputTokens ? `entrée ${maxInputTokens}` : '',
      maxTokens ? `sortie ${maxTokens}` : '',
    ].filter(Boolean)
  }

  function providerCopyPayload(profile = {}, { editable = null, baseUrl = '' } = {}) {
    const source = editable || profile
    const payload = {
      id: source.id || source.model,
      label: source.label || source.model,
      model: source.model,
      providerName: source.providerName || source.provider || 'Provider',
      baseUrl: source.baseUrl || baseUrl || '',
      upstreamApi: source.upstreamApi || 'openai',
      transport: source.transport || 'stream',
      timeoutMs: source.timeoutMs || 300000,
      checkTimeoutMs: source.checkTimeoutMs || 60000,
      retries: source.retries || 0,
      maxTokens: source.maxTokens || 4096,
      maxInputTokens: positiveInteger(source.maxInputTokens),
      contextWindowTokens: positiveInteger(source.contextWindowTokens),
      noAuth: Boolean(source.noAuth),
      systemPrefix: source.systemPrefix || '',
      extraBody: source.extraBody || {},
      capabilities: source.capabilities || {},
    }
    if (source.apiKeySet) payload.apiKey = ''
    return payload
  }

  function duplicateProviderPayload(profile = {}, context = {}) {
    const payload = providerCopyPayload(profile, context)
    return {
      ...payload,
      id: '',
      label: `${payload.label || payload.model} copie`,
      model: `${payload.model}-copy`,
    }
  }

  function deleteModelLabel() {
    return 'Supprimer'
  }

  function deleteModelConfirmMessage(profile = {}) {
    const name = profile.label || profile.model || 'ce modèle'
    return `Supprimer le modèle "${name}" de OPC ?`
  }

  function profileHost(profile = {}, fallbackBaseUrl = '') {
    try {
      return new URL(profile.baseUrl || fallbackBaseUrl || '').host || profile.baseUrl || 'base URL manquante'
    } catch {
      return profile.baseUrl || 'base URL manquante'
    }
  }

  function upstreamApiLabel(value) {
    if (value === 'anthropic') return 'Anthropic'
    if (value === 'gitlab-code-suggestions') return 'GitLab Code Suggestions'
    return 'OpenAI compatible'
  }

  function isSuggestionProfile(profile = {}, usage = profile.usage) {
    if (usage === 'disabled' || profile.disabled || profile.quarantinedAt) return false
    return usage === 'code-suggestions' || profile.agentRunnable === false || profile.upstreamApi === 'gitlab-code-suggestions'
  }

  function isDisabledProfile(profile = {}, usage = profile.usage) {
    return Boolean(usage === 'disabled' || profile.disabled || profile.quarantinedAt)
  }

  function formatClock(value) {
    const date = new Date(Number(value || 0))
    if (Number.isNaN(date.getTime())) return '--:--'
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  function providerHistoryMeta(row = {}, { cooldownRemainingMs = () => 0, now } = {}) {
    const meta = []
    if (row.latencyMs) meta.push(`${Math.round(row.latencyMs)}ms`)
    if (row.statusCode) meta.push(`HTTP ${row.statusCode}`)
    if (row.issue?.code) meta.push(row.issue.code)
    const remainingMs = cooldownRemainingMs(row, now)
    if (remainingMs > 0) meta.push(`pause ${Math.ceil(remainingMs / 1000)}s`)
    meta.push(formatClock(row.checkedAt))
    return meta
  }

  window.OPCProviderPanelViewModel = {
    deleteModelConfirmMessage,
    deleteModelLabel,
    duplicateProviderPayload,
    formatClock,
    isDisabledProfile,
    isSuggestionProfile,
    profileHost,
    providerAuthLabel,
    providerBudgetMeta,
    providerCopyPayload,
    providerHistoryMeta,
    providerSubtitle,
    repairChangeLabel,
    repairLogTitle,
    upstreamApiLabel,
  }
})()
