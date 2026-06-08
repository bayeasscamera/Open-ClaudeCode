(function () {
  function compactText(value, max = 300) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function usage(profile = {}) {
    if (profile.usage) return profile.usage
    if (profile.disabled || profile.quarantinedAt) return 'disabled'
    return profile.agentRunnable === false ? 'code-suggestions' : 'agent'
  }

  function inputTokens(profile = {}) {
    if (window.OPCAgentContextBudget?.profileInputTokens) return window.OPCAgentContextBudget.profileInputTokens(profile)
    const value = Number(profile.maxInputTokens || profile.inputTokens || profile.max_input_tokens)
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  }

  function localProfile(profile = {}) {
    const baseUrl = String(profile.baseUrl || profile.url || '').trim()
    return Boolean(profile.noAuth || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(baseUrl))
  }

  function routeIssues(profile = {}, { requireAgent = true, requireTools = false, minInputTokens = 0 } = {}) {
    const caps = profile.capabilities || {}
    const issues = []
    if (!profile) issues.push('profil introuvable')
    if (usage(profile) === 'disabled') issues.push('provider en pause')
    if (profile.configured === false) issues.push('clé manquante')
    if (requireAgent && (usage(profile) !== 'agent' || caps.agent === false)) issues.push('agent CLI indisponible')
    if (requireTools && caps.tools === false) issues.push('outils désactivés')
    const capacity = inputTokens(profile)
    if (minInputTokens && capacity && capacity < minInputTokens) issues.push(`contexte insuffisant (${capacity} < ${minInputTokens})`)
    return issues
  }

  function scoreProfile(profile = {}, requirements = {}) {
    const caps = profile.capabilities || {}
    let score = 0
    if (usage(profile) === 'agent') score += 50
    if (profile.configured !== false) score += 25
    if (caps.tools !== false) score += 20
    if (caps.streaming !== false) score += 8
    if (caps.refine !== false) score += 5
    const capacity = inputTokens(profile)
    score += Math.min(30, Math.floor(capacity / 1000))
    if (requirements.requireTools && caps.tools !== false) score += 12
    if (requirements.preferLargeContext && capacity >= Math.max(8000, requirements.minInputTokens || 0)) score += 18
    if (requirements.preferLocal && localProfile(profile)) score += 14
    if (requirements.preferFast && caps.streaming !== false) score += 5
    if (requirements.selectedModel && (profile.model === requirements.selectedModel || profile.id === requirements.selectedModel)) score += 4
    return score
  }

  function routeTask({ profiles = [], selectedModel = '', requireAgent = true, requireTools = false, minInputTokens = 0, requirements = {} } = {}) {
    const selected = profiles.find(profile => profile.model === selectedModel || profile.id === selectedModel) || null
    const mergedRequirements = { ...requirements, requireAgent, requireTools, minInputTokens, selectedModel }
    const selectedIssues = selected ? routeIssues(selected, mergedRequirements) : ['profil introuvable']
    const candidates = profiles
      .filter(profile => routeIssues(profile, mergedRequirements).length === 0)
      .sort((a, b) => scoreProfile(b, mergedRequirements) - scoreProfile(a, mergedRequirements))
    const suggested = candidates[0] || null
    return {
      ok: Boolean(selected && selectedIssues.length === 0),
      selected,
      suggested,
      candidates,
      reason: compactText(selectedIssues.join(' · ') || 'profil compatible'),
      requirements: mergedRequirements,
    }
  }

  window.OPCAgentProviderRouter = {
    localProfile,
    routeIssues,
    routeTask,
  }
})()
