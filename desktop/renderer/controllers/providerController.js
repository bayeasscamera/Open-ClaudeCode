(function () {
  const FATAL_PROVIDER_CHECK_FRESH_MS = 10 * 60 * 1000
  const BLOCKING_PROVIDER_CATEGORIES = new Set(['needs_config', 'unsupported', 'context_length'])
  const MAX_PROVIDER_HISTORY_ROWS = 80

  function createProviderController({
    state,
    store,
    providerHealth,
    opc = window.opc,
    onChange = () => {},
    onInspectorChange = () => {},
    onRunningControlsChange = () => {},
  } = {}) {
    let checkingAllProviders = false

    function selectedProviderCheck() {
      const profile = profileForModel(state.settings.model)
      if (profile) return checkForProfile(profile)
      const model = state.settings.model
      return state.providerChecks?.[model] || (state.providerCheck?.model === model ? state.providerCheck : null)
    }

    function profileUsage(profile) {
      if (profile?.usage) return profile.usage
      if (profile?.disabled || profile?.quarantinedAt) return 'disabled'
      return profile?.agentRunnable === false ? 'code-suggestions' : 'agent'
    }

    function profileForModel(model = state.settings.model) {
      const selected = model || state.settings.model
      return (state.providerProfiles || []).find(profile => profile.model === selected || profile.id === selected) || null
    }

    function modelCapabilities(model = state.settings.model) {
      return profileForModel(model)?.capabilities || {}
    }

    function capabilityWarnings(profileOrModel = state.settings.model) {
      const profile = typeof profileOrModel === 'string' ? profileForModel(profileOrModel) : profileOrModel
      if (!profile) return ['profil introuvable']
      if (Array.isArray(profile.capabilityWarnings)) return profile.capabilityWarnings
      const caps = profile.capabilities || {}
      const warnings = []
      if (profileUsage(profile) === 'disabled') warnings.push('provider en pause')
      if (profile.configured === false) warnings.push('clé API manquante')
      if (profileUsage(profile) !== 'agent' || caps.agent === false) warnings.push('agent CLI indisponible')
      if (caps.tools === false) warnings.push('outils désactivés')
      if (caps.streaming === false) warnings.push('streaming indisponible')
      if (caps.thinking === false) warnings.push('Think non supporté')
      if (caps.refine === false) warnings.push('raffinage indisponible')
      return Array.from(new Set(warnings))
    }

    function profileBaseUrlIssue(profile) {
      if (!Object.prototype.hasOwnProperty.call(profile || {}, 'baseUrl')) return ''
      const baseUrl = String(profile?.baseUrl || '').trim()
      if (!baseUrl) return 'base URL manquante'
      if (!/^https?:\/\//i.test(baseUrl)) return 'base URL invalide'
      try {
        const UrlCtor = typeof URL !== 'undefined' ? URL : window.URL
        if (UrlCtor) {
          const url = new UrlCtor(baseUrl)
          if (url.hostname.toLowerCase() === 'api.openrouter.ai') return 'base URL OpenRouter legacy non réparée'
        } else if (/^https?:\/\/api\.openrouter\.ai(?::|\/|$)/i.test(baseUrl)) {
          return 'base URL OpenRouter legacy non réparée'
        }
      } catch {
        return 'base URL invalide'
      }
      return ''
    }

    function profileConfigIssue(profile) {
      if (profileBaseUrlIssue(profile)) return profileBaseUrlIssue(profile)
      if (profile.configured === false) return 'clé API manquante ou authentification non configurée'
      return ''
    }

    function freshBlockingProviderCheck(check) {
      if (!check) return null
      if (check.status === 'checking') {
        return {
          category: 'checking',
          label: 'test provider en cours',
          detail: 'Attends la fin du test du modèle avant de lancer une session.',
        }
      }
      if (check.ok) return null
      const checkedAt = Number(check.checkedAt)
      const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt <= FATAL_PROVIDER_CHECK_FRESH_MS
      if (!fresh) return null
      const category = providerHealth?.statusCategory?.(check) || check.status || 'error'
      if (!BLOCKING_PROVIDER_CATEGORIES.has(category)) return null
      return {
        category,
        label: providerHealth?.categoryLabel?.(category) || category,
        detail: providerHealth?.actionHint?.(check) || check.error || 'Corrige le provider puis relance le test modèle.',
      }
    }

    function supportsThinking(model = state.settings.model) {
      void model
      return false
    }

    function isAgentProfile(profile) {
      return profileUsage(profile) === 'agent'
    }

    function agentProfiles(profiles = state.providerProfiles || []) {
      return profiles.filter(isAgentProfile)
    }

    function suggestionProfiles(profiles = state.providerProfiles || []) {
      return profiles.filter(profile => profileUsage(profile) === 'code-suggestions')
    }

    function disabledProfiles(profiles = state.providerProfiles || []) {
      return profiles.filter(profile => profileUsage(profile) === 'disabled')
    }

    function refineProfiles(profiles = state.providerProfiles || []) {
      return profiles.filter(profile => isAgentProfile(profile) && profile.capabilities?.refine !== false)
    }

    function preflightForModel(model = state.settings.model, { thinkEnabled = Boolean(state.settings.thinkEnabled), requireAgent = true, requireRefine = false, requireTools = false, minInputTokens = 0, requirements = {} } = {}) {
      const profile = profileForModel(model)
      const mergedRequirements = { ...requirements, requireAgent, requireTools, minInputTokens }
      const route = window.OPCAgentProviderRouter?.routeTask?.({
        profiles: state.providerProfiles || [],
        selectedModel: model,
        requireAgent,
        requireTools,
        minInputTokens,
        requirements: mergedRequirements,
      }) || null
      const routeSuggestion = route?.suggested && route.suggested.model !== model
        ? ` Modèle compatible: ${route.suggested.label || route.suggested.model}.`
        : ''
      if (!profile) {
        return {
          ok: false,
          model,
          warnings: ['profil introuvable'],
          route,
          error: `Le modèle ${model || 'sélectionné'} est introuvable dans la configuration provider.${routeSuggestion}`,
        }
      }
      const caps = profile.capabilities || {}
      const warnings = capabilityWarnings(profile)
      if (profileUsage(profile) === 'disabled') {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings,
          error: `${profileOptionLabel(profile)} est en pause. Restaure le provider dans Settings > Providers avant de l'utiliser.`,
        }
      }
      if (requireAgent && !isAgentProfile(profile)) {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings,
          route,
          error: `${profileOptionLabel(profile)} ne peut pas piloter une session agent CLI.${routeSuggestion}`,
        }
      }
      if (requireRefine && caps.refine === false) {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings,
          error: `${profileOptionLabel(profile)} ne peut pas raffiner les prompts.`,
        }
      }
      if (requireTools && caps.tools === false) {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings,
          route,
          error: `${profileOptionLabel(profile)} ne peut pas exécuter cette demande d'action: les outils CLI sont désactivés pour ce provider.${routeSuggestion}`,
        }
      }
      const routeIssues = route?.selected === profile && route?.reason !== 'profil compatible' ? route.reason : ''
      if (routeIssues && /contexte insuffisant/i.test(routeIssues)) {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings: [...warnings, routeIssues],
          route,
          error: `${profileOptionLabel(profile)} n'a pas assez de contexte pour cette tâche: ${routeIssues}.${routeSuggestion}`,
        }
      }
      const configIssue = profileConfigIssue(profile)
      if (configIssue) {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings: [...warnings, configIssue],
          error: `${profileOptionLabel(profile)} est mal configuré: ${configIssue}.`,
        }
      }
      const check = checkForProfile(profile)
      const cooldownMs = providerHealth?.cooldownRemainingMs?.(check) || 0
      if (cooldownMs > 0) {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings,
          error: `${profileOptionLabel(profile)} est en pause provider encore ${Math.ceil(cooldownMs / 1000)}s après l'erreur précédente.`,
        }
      }
      const blockingCheck = freshBlockingProviderCheck(check)
      if (blockingCheck) {
        return {
          ok: false,
          model: profile.model,
          profile,
          capabilities: caps,
          warnings: [...warnings, blockingCheck.label],
          error: `${profileOptionLabel(profile)} est bloqué par le dernier test provider: ${blockingCheck.label}. ${blockingCheck.detail}`,
        }
      }
      const nextThinkEnabled = false
      const adjusted = []
      if (thinkEnabled && !nextThinkEnabled) adjusted.push('Think désactivé pour ce modèle')
      if (caps.streaming === false) adjusted.push('Transport buffered')
      if (caps.tools === false) adjusted.push('Outils retirés côté provider')
      return {
        ok: true,
        model: profile.model,
        profile,
        capabilities: caps,
        warnings,
        adjusted,
        route,
        thinkEnabled: nextThinkEnabled,
      }
    }

    function fallbackModel() {
      const runnable = agentProfiles()
      return (
        runnable.find(profile => profile.model === state.providerDefaultModel)?.model ||
        runnable[0]?.model ||
        state.providerDefaultModel ||
        ''
      )
    }

    function profileOptionLabel(profile) {
      return profile.label || profile.id || profile.model
    }

    function modelLabel(model) {
      const profile = state.providerProfiles.find(item => item.model === model || item.id === model)
      return profile ? profileOptionLabel(profile) : model
    }

    function capabilityLabel(profileOrModel = state.settings.model) {
      const profile = typeof profileOrModel === 'string' ? profileForModel(profileOrModel) : profileOrModel
      if (!profile) return 'profil introuvable'
      const caps = profile.capabilities || {}
      if (profileUsage(profile) === 'disabled') return 'désactivé'
      if (profile.configured === false) return 'clé manquante'
      if (profileUsage(profile) !== 'agent' || caps.agent === false || caps.tools === false) return 'chat seulement'
      const extras = []
      if (caps.streaming === false) extras.push('buffered')
      return ['agent + outils', ...extras].join(' · ')
    }

    function hasCheckingProvider() {
      return Object.values(state.providerChecks || {}).some(check => check?.status === 'checking')
    }

    function isCheckingAll() {
      return checkingAllProviders
    }

    function providerAuditSummary(profiles = state.providerProfiles || []) {
      return providerHealth?.auditSummary?.(profiles, state.providerChecks || {}) || {
        total: profiles.length,
        ready: 0,
        blocked: 0,
        tested: 0,
        buckets: {},
        rows: [],
      }
    }

    function uniqueByCode(items = []) {
      const seen = new Set()
      const rows = []
      for (const item of items) {
        const code = String(item?.code || item?.id || item?.label || '').trim()
        if (!code || seen.has(code)) continue
        seen.add(code)
        rows.push(item)
      }
      return rows
    }

    function providerDoctorSummary({ model = state.settings.model, requirements = {} } = {}) {
      const selectedModel = model || state.settings.model || ''
      const profile = profileForModel(selectedModel)
      const check = profile ? checkForProfile(profile) : state.providerChecks?.[selectedModel] || null
      const mergedRequirements = {
        requireAgent: true,
        ...requirements,
        requireTools: Boolean(requirements.requireTools),
        minInputTokens: Number(requirements.minInputTokens || 0),
      }
      const preflight = preflightForModel(selectedModel, {
        requireAgent: mergedRequirements.requireAgent !== false,
        requireTools: Boolean(mergedRequirements.requireTools),
        minInputTokens: mergedRequirements.minInputTokens,
        requirements: mergedRequirements,
      })
      const diagnostics = window.OPCProviderRuntimeDiagnostics?.diagnose?.({
        runtime: { phase: 'provider', model: selectedModel },
        assistant: { diagnostics: {} },
        profile,
        providerCheck: check,
        requirements: mergedRequirements,
        profiles: state.providerProfiles || [],
      }) || { status: preflight.ok ? 'ok' : 'error', items: [], fallback: null }
      const contextPolicy = window.OPCAgentContextBudget?.profileContextPolicy?.(profile || {}, {
        requiredTokens: mergedRequirements.minInputTokens || 0,
      }) || {
        tier: 'unknown',
        inputTokens: 0,
        requiredTokens: mergedRequirements.minInputTokens || 0,
        compactBeforeSend: false,
        fallbackRecommended: false,
        strategy: 'profil contexte indisponible',
      }
      const issues = uniqueByCode([
        ...(Array.isArray(diagnostics.items) ? diagnostics.items : []),
        !preflight.ok ? {
          code: 'preflight_blocked',
          label: 'Préflight bloqué',
          detail: preflight.error || 'Le modèle ne peut pas lancer cette tâche.',
          tone: 'error',
        } : null,
      ].filter(Boolean))
      const fallback = diagnostics.fallback || (
        preflight.route?.suggested && preflight.route.suggested.model !== selectedModel
          ? preflight.route.suggested
          : null
      )
      const actions = []
      if (check && !check.ok) {
        actions.push({ id: 'retest-provider', label: 'Retester provider', model: selectedModel })
      }
      if (issues.some(item => ['key_missing', 'bad_endpoint', 'preflight_blocked'].includes(item.code))) {
        actions.push({ id: 'repair-provider', label: 'Réparer provider', model: selectedModel })
      }
      if (contextPolicy.compactBeforeSend || issues.some(item => ['context_length', 'context_insufficient'].includes(item.code))) {
        actions.push({ id: 'compact-context', label: 'Compacter le contexte', model: selectedModel })
      }
      if (fallback?.model) {
        actions.push({ id: 'switch-provider', label: `Basculer vers ${fallback.label || fallback.model}`, model: fallback.model })
      }
      const status = diagnostics.status === 'error' || !preflight.ok
        ? 'error'
        : diagnostics.status === 'warning' || issues.length
          ? 'warning'
          : 'ok'
      return {
        version: 1,
        status,
        model: selectedModel,
        label: profile ? profileOptionLabel(profile) : selectedModel || 'Aucun modèle',
        profile: profile || null,
        check,
        preflight,
        diagnostics,
        contextPolicy,
        fallback,
        issues,
        actions,
        detail: issues[0]?.detail || preflight.error || diagnostics.detail || contextPolicy.strategy,
      }
    }

    function providerKey(profile = {}) {
      return profile.model || profile.id || profile.label || ''
    }

    function normalizeProviderHistory(rows = []) {
      return window.OPCStateRules?.normalizeProviderCheckHistory
        ? window.OPCStateRules.normalizeProviderCheckHistory(rows)
        : (Array.isArray(rows) ? rows : []).slice(0, MAX_PROVIDER_HISTORY_ROWS)
    }

    function providerHistoryRow(model, check = {}, { id = '' } = {}) {
      const profile = profileForModel(model)
      const category = providerHealth?.statusCategory?.(check) || (check.ok ? 'ok' : check.status || 'error')
      const checkedAt = Number(check.checkedAt || Date.now())
      return {
        id: id || `${model}:${checkedAt}:${Math.random().toString(36).slice(2, 8)}`,
        model: check.model || model,
        label: profile ? profileOptionLabel(profile) : modelLabel(model),
        ok: Boolean(check.ok),
        status: check.status || (check.ok ? 'ok' : 'error'),
        category,
        latencyMs: check.latencyMs || 0,
        statusCode: check.statusCode || 0,
        error: check.error || '',
        hint: providerHealth?.actionHint?.(check) || '',
        warning: check.warning || '',
        issue: check.issue || null,
        profileRevision: check.profileRevision || profile?.revision || '',
        checkedAt: Number.isFinite(checkedAt) ? checkedAt : Date.now(),
        cooldownUntil: check.cooldownUntil || 0,
      }
    }

    function recordProviderHistory(model, check = {}) {
      if (!model || !check || check.status === 'checking') return
      const current = Array.isArray(state.providerCheckHistory) ? state.providerCheckHistory : []
      state.providerCheckHistory = normalizeProviderHistory([
        providerHistoryRow(model, check),
        ...current,
      ]).slice(0, MAX_PROVIDER_HISTORY_ROWS)
    }

    function providerHistory({ limit = 20 } = {}) {
      const stored = normalizeProviderHistory(state.providerCheckHistory || [])
      if (stored.length) return stored.slice(0, limit)
      const derived = Object.entries(state.providerChecks || {}).map(([model, check], index) =>
        providerHistoryRow(model, check, { id: `provider_check_current_${index}` })
      )
      return normalizeProviderHistory(derived).slice(0, limit)
    }

    function checkForProfile(profile = {}) {
      if (providerHealth?.checkForProfile) return providerHealth.checkForProfile(profile, state.providerChecks || {})
      return state.providerChecks?.[profile.model] || state.providerChecks?.[profile.id] || null
    }

    function providerCheckCategory(profile = {}) {
      return providerHealth?.statusCategory?.(checkForProfile(profile)) || 'pending'
    }

    function problemProviderModels() {
      const retestable = new Set(['stale', 'rate_limited', 'timeout', 'context_length', 'unsupported', 'needs_config', 'network', 'server', 'error'])
      return (state.providerProfiles || [])
        .filter(profile => retestable.has(providerCheckCategory(profile)))
        .map(providerKey)
        .filter(Boolean)
    }

    function repairChangedModels(repair = {}) {
      const models = Array.isArray(repair?.changes)
        ? repair.changes.map(change => change?.model).filter(Boolean)
        : []
      return Array.from(new Set(models))
    }

    async function refreshHealth() {
      try {
        const health = await opc.health()
        state.healthOk = Boolean(health.ok)
        state.healthError = ''
        state.providerProfiles = Array.isArray(health.provider?.profiles) ? health.provider.profiles : []
        state.providerDefaultModel = health.provider?.defaultModel || ''
        state.providerConfigError = health.provider?.configError || ''
        state.providerBridgeUrl = health.provider?.bridgeUrl || ''
        state.healthVersion = health.version || health.error || health.cli || ''
        state.memoryEnabled = Boolean(health.memory?.enabled)
        state.runtime = health.runtime?.active || state.runtime || null
        if (!state.settings.cwd) {
          state.settings.cwd = health.projectRoot
        }
        const runnable = agentProfiles()
        const nextFallbackModel = fallbackModel()
        if (!state.settings.model || state.settings.model === 'default') state.settings.model = nextFallbackModel
        if (runnable.length && !runnable.some(profile => profile.model === state.settings.model)) {
          state.settings.model = nextFallbackModel
        }
        if (state.settings.thinkEnabled && !supportsThinking(state.settings.model)) state.settings.thinkEnabled = false
        const refiners = refineProfiles()
        if (!state.settings.refineModel || (refiners.length && !refiners.some(profile => profile.model === state.settings.refineModel))) {
          state.settings.refineModel = refiners[0]?.model || state.settings.refineModel || ''
        }
        onChange()
        onRunningControlsChange()
        store.save()
        return health
      } catch (error) {
        state.healthOk = false
        state.healthError = error.message || String(error)
        onChange()
        return null
      }
    }

    async function loadProviderConfig() {
      if (!opc.providerConfig) return null
      const result = await opc.providerConfig()
      return result?.config || null
    }

    async function repairProviderConfig() {
      if (!opc.repairProviderConfig) throw new Error('Réparation provider indisponible.')
      const result = await opc.repairProviderConfig()
      await refreshHealth()
      return result || { ok: false, repair: { repaired: false, count: 0 }, config: null }
    }

    async function repairAndCheckProblemProviders({ force = true } = {}) {
      const result = await repairProviderConfig()
      const checkedModels = await checkProblemProviders({ force, repair: result?.repair })
      return { ...(result || {}), checkedModels }
    }

    async function repairAndCheckAllProviders({ force = true } = {}) {
      return repairAndCheckProblemProviders({ force })
    }

    async function exportProviderConfig() {
      if (!opc.exportProviderConfig) throw new Error('Export provider indisponible.')
      const result = await opc.exportProviderConfig()
      return result?.config || null
    }

    async function importProviderConfig(payload) {
      if (!opc.importProviderConfig) throw new Error('Import provider indisponible.')
      const result = await opc.importProviderConfig(payload)
      await refreshHealth()
      return result?.config || null
    }

    async function readClipboardText() {
      return opc.readClipboard?.() || ''
    }

    async function copyText(value) {
      if (!opc.copyText) return false
      return opc.copyText(String(value || ''))
    }

    async function saveProviderProfile(payload) {
      if (!opc.saveProviderProfile) throw new Error('Édition provider indisponible.')
      const result = await opc.saveProviderProfile(payload)
      await refreshHealth()
      return result?.config || null
    }

    async function deleteProviderProfile(model) {
      if (!opc.deleteProviderProfile) throw new Error('Suppression provider indisponible.')
      const result = await opc.deleteProviderProfile({ model })
      await refreshHealth()
      return result?.config || null
    }

    async function setDefaultProvider(model) {
      if (!opc.setDefaultProvider) throw new Error('Modèle par défaut indisponible.')
      const result = await opc.setDefaultProvider({ model })
      await refreshHealth()
      return result?.config || null
    }

    function discoveryPayloadFromProfile(profile = profileForModel(state.settings.model)) {
      if (!profile) return {}
      return {
        model: profile.model,
        baseUrl: profile.baseUrl,
        providerName: profile.providerName || profile.provider || profile.label,
        upstreamApi: profile.upstreamApi || 'openai',
        transport: profile.transport || 'stream',
        timeoutMs: profile.timeoutMs,
        checkTimeoutMs: profile.checkTimeoutMs,
        retries: profile.retries,
        maxTokens: profile.maxTokens,
        maxInputTokens: profile.maxInputTokens,
        contextWindowTokens: profile.contextWindowTokens,
        noAuth: Boolean(profile.noAuth),
        capabilities: profile.capabilities || {},
        import: true,
      }
    }

    async function discoverProviderModels(payload = {}) {
      if (!opc.discoverProviderModels) throw new Error('Découverte provider indisponible.')
      const result = await opc.discoverProviderModels(payload)
      await refreshHealth()
      return result
    }

    async function discoverSelectedProviderModels() {
      return discoverProviderModels(discoveryPayloadFromProfile())
    }

    async function quarantineProviders(models = [], reason = 'Provider mis en pause depuis Settings OPC.') {
      if (!opc.quarantineProviders) throw new Error('Quarantaine provider indisponible.')
      const result = await opc.quarantineProviders({ models, reason })
      await refreshHealth()
      return result
    }

    async function quarantineProblemProviders() {
      const models = problemProviderModels()
      if (!models.length) return { ok: true, changed: 0, config: await loadProviderConfig() }
      return quarantineProviders(models, 'Mis en pause après diagnostic provider OPC.')
    }

    async function restoreProviderProfile(model) {
      if (!opc.restoreProviders) throw new Error('Restauration provider indisponible.')
      const result = await opc.restoreProviders({ models: [model] })
      await refreshHealth()
      return result
    }

    async function runProviderCheck(model, { force = false } = {}) {
      if (!model) return null
      state.providerChecks ||= {}
      const profile = profileForModel(model)
      const profileRevision = profile?.revision || ''
      const existing = profile ? checkForProfile(profile) : state.providerChecks[model]
      const cooldownMs = providerHealth?.cooldownRemainingMs?.(existing) || 0
      if (!force && cooldownMs > 0) {
        existing.skippedAt = Date.now()
        if (model === state.settings.model) state.providerCheck = existing
        onChange()
        onInspectorChange()
        store.save()
        return existing
      }
      state.providerChecks[model] = { model, status: 'checking', ok: false, checkedAt: Date.now(), profileRevision }
      if (model === state.settings.model) state.providerCheck = state.providerChecks[model]
      onChange()
      onInspectorChange()
      try {
        const result = await opc.checkProvider({ model })
        state.providerChecks[model] = providerHealth?.resultFromCheck?.(model, { ...result, profileRevision }) || { ...result, model, checkedAt: Date.now(), profileRevision }
      } catch (error) {
        state.providerChecks[model] = providerHealth?.normalizeCheck?.(model, { model, ok: false, error: error.message || String(error), profileRevision }) || { model, ok: false, error: error.message || String(error), checkedAt: Date.now(), profileRevision }
      } finally {
        recordProviderHistory(model, state.providerChecks[model])
        if (model === state.settings.model) state.providerCheck = state.providerChecks[model]
        onChange()
        onInspectorChange()
        store.save()
      }
      return state.providerChecks[model]
    }

    async function checkSelectedProvider(model = state.settings.model) {
      return runProviderCheck(model)
    }

    async function checkProviderModels(models = [], { force = false, scope = 'custom' } = {}) {
      const uniqueModels = Array.from(new Set((models || []).filter(Boolean)))
      if (checkingAllProviders) return []
      checkingAllProviders = true
      state.providerAudit = {
        status: 'running',
        scope,
        startedAt: Date.now(),
        completed: 0,
        total: uniqueModels.length,
      }
      onChange()
      if (!uniqueModels.length) {
        checkingAllProviders = false
        state.providerAudit = {
          ...(state.providerAudit || {}),
          status: 'done',
          finishedAt: Date.now(),
          summary: providerAuditSummary(),
          checkedModels: [],
        }
        onChange()
        onInspectorChange()
        store.save()
        return []
      }
      const concurrency = 3
      let cursor = 0
      async function worker() {
        while (cursor < uniqueModels.length) {
          const model = uniqueModels[cursor]
          cursor += 1
          await runProviderCheck(model, { force })
          state.providerAudit.completed += 1
          onChange()
          onInspectorChange()
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(concurrency, uniqueModels.length) }, worker))
      } finally {
        checkingAllProviders = false
        state.providerAudit = {
          ...(state.providerAudit || {}),
          status: 'done',
          finishedAt: Date.now(),
          summary: providerAuditSummary(),
          checkedModels: uniqueModels,
        }
        onChange()
        onInspectorChange()
        store.save()
      }
      return uniqueModels
    }

    async function checkProblemProviders({ force = true, repair = null } = {}) {
      const models = Array.from(new Set([
        ...repairChangedModels(repair || {}),
        ...problemProviderModels(),
      ]))
      return checkProviderModels(models, { force, scope: 'problem' })
    }

    async function checkAllProviders({ force = false } = {}) {
      const models = Array.from(new Set(state.providerProfiles.map(profile => profile.model).filter(Boolean)))
      return checkProviderModels(models, { force, scope: 'all' })
    }

    return {
      checkAllProviders,
      checkProblemProviders,
      checkSelectedProvider,
      capabilityLabel,
      capabilityWarnings,
      copyText,
      agentProfiles,
      modelCapabilities,
      hasCheckingProvider,
      isAgentProfile,
      isCheckingAll,
      deleteProviderProfile,
      disabledProfiles,
      discoverProviderModels,
      discoverSelectedProviderModels,
      exportProviderConfig,
      importProviderConfig,
      loadProviderConfig,
      modelLabel,
      preflightForModel,
      profileForModel,
      profileUsage,
      profileOptionLabel,
      providerAuditSummary,
      providerDoctorSummary,
      providerHistory,
      readClipboardText,
      repairAndCheckAllProviders,
      repairAndCheckProblemProviders,
      repairProviderConfig,
      quarantineProviders,
      quarantineProblemProviders,
      refineProfiles,
      refreshHealth,
      restoreProviderProfile,
      runProviderCheck,
      saveProviderProfile,
      selectedProviderCheck,
      setDefaultProvider,
      suggestionProfiles,
      supportsThinking,
    }
  }

  window.OPCProviderController = { createProviderController }
})()
