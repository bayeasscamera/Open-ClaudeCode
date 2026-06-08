(function () {
  const PERMISSION_LABELS = {
    bypassPermissions: 'Tout autoriser',
    dontAsk: 'Ne pas demander',
    acceptEdits: 'Autoriser éditions',
    auto: 'Auto',
    plan: 'Plan seulement',
    default: 'Standard',
  }
  const TEXT_SIZE_LABELS = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
  }

  function normalizePathSetting(value) {
    if (window.OPCStateRules?.normalizePathSetting) return window.OPCStateRules.normalizePathSetting(value)
    return String(value || '').replace(/\u0000/g, '').trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  }

  function normalizeSettingsPatch(patch = {}, current = {}) {
    const next = {}
    const defaultPermissionMode = window.OPCStateRules?.DEFAULT_PERMISSION_MODE || 'acceptEdits'
    if ('cwd' in patch) next.cwd = normalizePathSetting(patch.cwd || current.cwd || '')
    if ('model' in patch) next.model = String(patch.model || current.model || '').trim()
    if ('refineModel' in patch) next.refineModel = String(patch.refineModel || current.refineModel || 'qwen/qwen3.5-122b-a10b').trim()
    if ('permissionMode' in patch) {
      const mode = String(patch.permissionMode || current.permissionMode || defaultPermissionMode)
      next.permissionMode = PERMISSION_LABELS[mode] ? mode : defaultPermissionMode
    }
    if ('memoryEnabled' in patch) next.memoryEnabled = Boolean(patch.memoryEnabled)
    if ('thinkEnabled' in patch) next.thinkEnabled = false
    if ('providerAutoRouterEnabled' in patch) next.providerAutoRouterEnabled = Boolean(patch.providerAutoRouterEnabled)
    if ('providerAutoRouterThreshold' in patch) {
      const threshold = Number(patch.providerAutoRouterThreshold)
      const fallback = Number(current.providerAutoRouterThreshold)
      next.providerAutoRouterThreshold = Number.isFinite(threshold) && threshold >= 1
        ? Math.min(5, Math.round(threshold))
        : Number.isFinite(fallback) && fallback >= 1
          ? Math.min(5, Math.round(fallback))
          : 2
    }
    if ('advancedPermissionStrictMode' in patch) next.advancedPermissionStrictMode = Boolean(patch.advancedPermissionStrictMode)
    if ('compactMode' in patch) next.compactMode = Boolean(patch.compactMode)
    if ('inspectorOpen' in patch) next.inspectorOpen = Boolean(patch.inspectorOpen)
    if ('textSize' in patch) {
      const size = String(patch.textSize || current.textSize || 'medium').toLowerCase()
      next.textSize = TEXT_SIZE_LABELS[size] ? size : (TEXT_SIZE_LABELS[current.textSize] ? current.textSize : 'medium')
    }
    return next
  }

  function settingsCounts(state = {}) {
    const projects = Array.isArray(state.projects) ? state.projects : []
    const chats = Array.isArray(state.chats) ? state.chats : []
    const profiles = Array.isArray(state.providerProfiles) ? state.providerProfiles : []
    const checks = state.providerChecks && typeof state.providerChecks === 'object' ? Object.values(state.providerChecks) : []
    const category = check => window.OPCProviderHealth?.statusCategory?.(check) || (check?.ok ? 'ok' : check?.status || 'pending')
    const categoryCount = name => checks.filter(check => category(check) === name).length
    return {
      chats: chats.length,
      projects: projects.length,
      providers: profiles.length,
      agentProviders: profiles.filter(profile => profile?.agentRunnable !== false && profile?.usage !== 'code-suggestions').length,
      refineProviders: profiles.filter(profile => profile?.agentRunnable !== false && profile?.usage !== 'code-suggestions' && profile?.capabilities?.refine !== false).length,
      localProviders: profiles.filter(profile => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(String(profile?.baseUrl || '')) || profile?.noAuth).length,
      okProviders: checks.filter(check => check?.ok).length,
      errorProviders: checks.filter(check => check && check.ok === false && check.status !== 'checking').length,
      rateLimitedProviders: categoryCount('rate_limited'),
      timeoutProviders: categoryCount('timeout'),
      unsupportedProviders: categoryCount('unsupported'),
      needsConfigProviders: categoryCount('needs_config'),
    }
  }

  function normalizeSettingsSearch(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  }

  function settingsSearchTokens(value = '') {
    const normalized = normalizeSettingsSearch(value)
    return normalized ? normalized.split(' ').filter(Boolean) : []
  }

  function settingsSearchMatches(text = '', query = '') {
    const haystack = normalizeSettingsSearch(text)
    const tokens = settingsSearchTokens(query)
    return !tokens.length || tokens.every(token => haystack.includes(token))
  }

  function textSize(value = '') {
    return String(value || '').trim().length
  }

  function fileStats(files = []) {
    const list = Array.isArray(files) ? files : []
    return {
      total: list.length,
      indexed: list.filter(file => file?.indexedAt || file?.summary || file?.searchIndex).length,
      readNext: list.filter(file => file?.readNext).length,
      errors: list.filter(file => file?.error).length,
    }
  }

  function checkLabel(check) {
    if (window.OPCProviderHealth?.statusLabel) return window.OPCProviderHealth.statusLabel(check)
    if (!check) return 'Non testé'
    if (check.status === 'checking') return 'Test...'
    if (check.ok) return check.latencyMs ? `OK ${Math.round(check.latencyMs)}ms` : 'OK'
    return check.error || check.code || 'Erreur'
  }

  function normalizeProviderEditorPayload(value = {}) {
    const model = String(value.model || '').replace(/\u0000/g, '').trim()
    const baseUrl = String(value.baseUrl || '').replace(/\u0000/g, '').trim()
    if (!model) throw new Error('Le modèle est requis.')
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('La base URL doit commencer par http:// ou https://.')
    let extraBody = {}
    const extraBodyText = String(value.extraBody || '').trim()
    if (extraBodyText) {
      extraBody = JSON.parse(extraBodyText)
      if (!extraBody || typeof extraBody !== 'object' || Array.isArray(extraBody)) {
        throw new Error('Extra body doit être un objet JSON.')
      }
    }
    const numberValue = (input, fallback) => {
      const parsed = Number(input)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
    }
    const rawUpstreamApi = String(value.upstreamApi || '').toLowerCase()
    const isOllama = rawUpstreamApi === 'ollama'
    const upstreamApi = rawUpstreamApi === 'anthropic'
      ? 'anthropic'
      : ['gitlab', 'gitlab-code-suggestions', 'code-suggestions'].includes(rawUpstreamApi)
        ? 'gitlab-code-suggestions'
        : 'openai'
    const payload = {
      id: String(value.id || '').replace(/\u0000/g, '').trim(),
      label: String(value.label || model).replace(/\u0000/g, '').trim(),
      model,
      providerName: String(isOllama ? 'Ollama' : value.providerName || value.provider || 'Provider').replace(/\u0000/g, '').trim(),
      baseUrl: isOllama && !value.baseUrl ? 'http://localhost:11434/v1' : baseUrl,
      upstreamApi,
      transport: String(value.transport || '').toLowerCase() === 'buffered' ? 'buffered' : 'stream',
      timeoutMs: Math.round(numberValue(value.timeoutMs, 300000)),
      checkTimeoutMs: Math.round(numberValue(value.checkTimeoutMs, 60000)),
      retries: Math.round(numberValue(value.retries, 0)),
      maxTokens: Math.round(numberValue(value.maxTokens, 4096)),
      apiKey: String(value.apiKey || '').trim(),
      clearApiKey: Boolean(value.clearApiKey),
      noAuth: Boolean(value.noAuth || isOllama),
      makeDefault: Boolean(value.makeDefault),
      systemPrefix: String(value.systemPrefix || '').trim(),
      extraBody,
    }
    if (value.capabilities && typeof value.capabilities === 'object' && !Array.isArray(value.capabilities)) {
      const allowed = [
        'agent',
        'system',
        'streaming',
        'tools',
        'toolChoice',
        'temperature',
        'thinking',
        'refine',
        'reasoningPassThrough',
        'reasoningExclude',
      ]
      payload.capabilities = Object.fromEntries(allowed.map(key => [key, key === 'thinking' ? false : Boolean(value.capabilities[key])]))
    }
    return payload
  }

  function activeProjectSummary(state = {}, projectController) {
    const project = projectController?.activeProject?.() || null
    if (!project) return {
      name: 'Aucun projet actif',
      description: 'Les réglages globaux seront utilisés pour les conversations hors projet.',
      runtime: [],
      chats: state.chats?.length || 0,
      files: 0,
      fileStats: fileStats([]),
      memoryChars: 0,
      instructionsChars: 0,
      runtimeOverrides: 0,
      memoryStatus: 'Globale',
      instructionsStatus: 'Globales',
    }
    const runtime = project.runtime || {}
    const stats = fileStats(project.files)
    const memoryChars = textSize(project.memory)
    const instructionsChars = textSize(project.instructions)
    const runtimeOverrides = [
      runtime.cwd,
      runtime.model,
      runtime.permissionMode,
      runtime.memoryEnabled === null || runtime.memoryEnabled === undefined ? '' : 'memory',
    ].filter(Boolean).length
    return {
      name: project.name,
      description: project.description || 'Projet sans description.',
      runtime: [
        runtime.cwd ? `dossier ${runtime.cwd}` : 'dossier global',
        runtime.model ? `modèle ${runtime.model}` : 'modèle global',
        runtime.permissionMode ? `permissions ${PERMISSION_LABELS[runtime.permissionMode] || runtime.permissionMode}` : 'permissions globales',
        runtime.memoryEnabled === null || runtime.memoryEnabled === undefined ? 'mémoire globale' : runtime.memoryEnabled ? 'mémoire active' : 'mémoire pause',
      ],
      chats: projectController?.chatCount?.(project.id) || 0,
      files: stats.total,
      fileStats: stats,
      memoryChars,
      instructionsChars,
      runtimeOverrides,
      memoryStatus: memoryChars ? 'Mémoire projet active' : 'Mémoire projet vide',
      instructionsStatus: instructionsChars ? 'Instructions projet actives' : 'Instructions projet vides',
    }
  }

  function metric(label, value, detail = '') {
    const item = document.createElement('div')
    item.className = 'settingsMetric'
    item.innerHTML = '<span></span><strong></strong><em></em>'
    item.querySelector('span').textContent = label
    item.querySelector('strong').textContent = value
    item.querySelector('em').textContent = detail
    return item
  }

  window.OPCSettingsHelpers = {
    PERMISSION_LABELS,
    TEXT_SIZE_LABELS,
    activeProjectSummary,
    checkLabel,
    metric,
    normalizeProviderEditorPayload,
    normalizeSettingsSearch,
    normalizeSettingsPatch,
    settingsSearchMatches,
    settingsSearchTokens,
    settingsCounts,
  }
})()
