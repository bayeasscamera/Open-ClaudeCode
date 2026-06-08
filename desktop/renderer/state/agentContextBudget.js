(function () {
  const DEFAULT_CHARS_PER_TOKEN = 4
  const DEFAULT_SOFT_CONTEXT_CHARS = 28000
  const SMALL_CONTEXT_THRESHOLD_TOKENS = 1600
  const MEDIUM_CONTEXT_THRESHOLD_TOKENS = 8000
  const LARGE_CONTEXT_THRESHOLD_TOKENS = 32000

  function compactText(value, max = 700) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, Math.max(0, max - 3))}...`
  }

  function estimateChars(value) {
    try {
      return JSON.stringify(value || {}).length
    } catch {
      return String(value || '').length
    }
  }

  function estimateTokens(value) {
    return Math.ceil(estimateChars(value) / DEFAULT_CHARS_PER_TOKEN)
  }

  function profileInputTokens(profile = {}) {
    const explicit = Number(profile.maxInputTokens || profile.inputTokens || profile.max_input_tokens)
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit)
    const context = Number(profile.contextWindowTokens || profile.contextTokens || profile.contextWindow || profile.maxContextTokens)
    if (Number.isFinite(context) && context > 0) {
      const output = Number(profile.maxTokens || profile.max_tokens || 4096)
      return Math.max(512, Math.round(context - (Number.isFinite(output) && output > 0 ? output : 4096)))
    }
    return 0
  }

  function budgetCharsForProfile(profile = {}) {
    const inputTokens = profileInputTokens(profile)
    if (!inputTokens) return DEFAULT_SOFT_CONTEXT_CHARS
    const reserved = inputTokens <= SMALL_CONTEXT_THRESHOLD_TOKENS ? 0.35 : 0.5
    return Math.max(2200, Math.floor(inputTokens * DEFAULT_CHARS_PER_TOKEN * reserved))
  }

  function contextTier(inputTokens = 0) {
    if (!inputTokens) return 'unknown'
    if (inputTokens <= SMALL_CONTEXT_THRESHOLD_TOKENS) return 'small'
    if (inputTokens <= MEDIUM_CONTEXT_THRESHOLD_TOKENS) return 'medium'
    if (inputTokens >= LARGE_CONTEXT_THRESHOLD_TOKENS) return 'large'
    return 'standard'
  }

  function profileContextPolicy(profile = {}, { requiredTokens = 0 } = {}) {
    const inputTokens = profileInputTokens(profile)
    const budgetChars = budgetCharsForProfile(profile)
    const tier = contextTier(inputTokens)
    const required = Number(requiredTokens)
    const normalizedRequired = Number.isFinite(required) && required > 0 ? Math.round(required) : 0
    const budgetTokens = Math.max(0, Math.floor(budgetChars / DEFAULT_CHARS_PER_TOKEN))
    const compactBeforeSend = Boolean(
      tier === 'small' ||
      (normalizedRequired && budgetTokens && normalizedRequired > budgetTokens)
    )
    const fallbackRecommended = Boolean(inputTokens && normalizedRequired && normalizedRequired > inputTokens)
    const strategy = fallbackRecommended
      ? 'compactage strict avant envoi et fallback grand contexte recommandé'
      : compactBeforeSend
        ? 'compactage automatique avant envoi'
        : 'contexte direct possible'
    return {
      model: compactText(profile.model || profile.id || '', 220),
      tier,
      inputTokens,
      requiredTokens: normalizedRequired,
      budgetChars,
      budgetTokens,
      compactBeforeSend,
      fallbackRecommended,
      strategy,
    }
  }

  function trimFile(file = {}, summaryMax = 220, snippetMax = 120) {
    return {
      ...file,
      summary: compactText(file.summary, summaryMax),
      snippets: Array.isArray(file.snippets)
        ? file.snippets.map(item => compactText(item, snippetMax)).filter(Boolean).slice(0, 2)
        : [],
      keywords: Array.isArray(file.keywords) ? file.keywords.slice(0, 5) : [],
      headings: Array.isArray(file.headings) ? file.headings.slice(0, 4) : [],
    }
  }

  function trimSession(session = {}) {
    return {
      ...session,
      lastUser: compactText(session.lastUser, 160),
      lastAssistant: compactText(session.lastAssistant, 180),
    }
  }

  function cloneContext(context = {}) {
    return {
      ...context,
      attachedFiles: Array.isArray(context.attachedFiles) ? context.attachedFiles.map(file => ({ ...file })) : [],
      readNextFiles: Array.isArray(context.readNextFiles) ? context.readNextFiles.map(file => ({ ...file })) : [],
      relevantFiles: Array.isArray(context.relevantFiles) ? context.relevantFiles.map(file => ({ ...file })) : [],
      projectSessions: Array.isArray(context.projectSessions) ? context.projectSessions.map(session => ({ ...session })) : [],
    }
  }

  function compactOnce(context, level) {
    const next = cloneContext(context)
    if (level >= 1) {
      next.attachedFiles = next.attachedFiles.slice(0, 6).map(file => trimFile(file, 320, 160))
      next.relevantFiles = next.relevantFiles.slice(0, 4).map(file => trimFile(file, 260, 140))
      next.projectSessions = next.projectSessions.slice(0, 4).map(trimSession)
    }
    if (level >= 2) {
      next.attachedFiles = next.attachedFiles.slice(0, 3).map(file => trimFile(file, 180, 90))
      next.relevantFiles = next.relevantFiles.slice(0, 2).map(file => trimFile(file, 160, 80))
      next.projectSessions = next.projectSessions.slice(0, 2).map(trimSession)
    }
    if (level >= 3) {
      next.attachedFiles = next.attachedFiles.slice(0, 1).map(file => trimFile(file, 120, 60))
      next.relevantFiles = []
      next.projectSessions = []
    }
    next.readNextFiles = next.readNextFiles.map(file => trimFile(file, 360, 160))
    return next
  }

  function applyProjectRuntimeBudget(context, { profile = {}, model = profile.model || '' } = {}) {
    if (!context || typeof context !== 'object') return { context, compacted: false, beforeChars: 0, afterChars: 0, budgetChars: 0 }
    const beforeChars = estimateChars(context)
    const budgetChars = budgetCharsForProfile(profile)
    let next = cloneContext(context)
    let level = 0
    while (estimateChars(next) > budgetChars && level < 3) {
      level += 1
      next = compactOnce(context, level)
    }
    const afterChars = estimateChars(next)
    const compacted = level > 0 || afterChars < beforeChars
    next.contextBudget = {
      compacted,
      level,
      model: compactText(model || profile.model, 220),
      beforeChars,
      afterChars,
      estimatedTokens: estimateTokens(next),
      budgetChars,
    }
    return {
      context: next,
      compacted,
      beforeChars,
      afterChars,
      budgetChars,
      level,
    }
  }

  window.OPCAgentContextBudget = {
    applyProjectRuntimeBudget,
    budgetCharsForProfile,
    estimateTokens,
    profileContextPolicy,
    profileInputTokens,
  }
})()
