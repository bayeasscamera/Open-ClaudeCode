const fs = require('node:fs')
const path = require('node:path')
const { writePrivateJsonFile } = require('./persistence/privateJsonFile.cjs')
const policy = require('./providerProfilePolicy.cjs')
const { createProviderSecretVault } = require('./providerSecretVault.cjs')

const MAX_TEXT_CHARS = 8192
const MAX_PROVIDER_PROFILES = 80

function text(value, max = MAX_TEXT_CHARS) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .slice(0, max)
    .trim()
}

function number(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function safeHttpUrl(value) {
  return policy.normalizeBaseUrl(text(value, 2048))
}

function apiKeyPreview(value, sealed = false) {
  const key = String(value || '')
  if (!key && sealed) return '••••'
  if (!key) return ''
  if (key.length <= 10) return '••••'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

function normalizedTransport(value) {
  return text(value, 40).toLowerCase() === 'buffered' ? 'buffered' : 'stream'
}

function normalizedUpstreamApi(value) {
  const normalized = text(value, 64).toLowerCase()
  if (normalized === 'anthropic') return 'anthropic'
  if (['gitlab', 'gitlab-code-suggestions', 'code-suggestions'].includes(normalized)) return 'gitlab-code-suggestions'
  return 'openai'
}

function normalizeExtraBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const {
    thinking,
    chat_template_kwargs: chatTemplateKwargs,
    ...rest
  } = value
  void thinking
  if (!chatTemplateKwargs || typeof chatTemplateKwargs !== 'object' || Array.isArray(chatTemplateKwargs)) return rest
  const {
    enable_thinking: enableThinking,
    ...remainingChatTemplateKwargs
  } = chatTemplateKwargs
  void enableThinking
  return Object.keys(remainingChatTemplateKwargs).length
    ? { ...rest, chat_template_kwargs: remainingChatTemplateKwargs }
    : rest
}

function repairExtraBody(value) {
  const repaired = normalizeExtraBody(value)
  return JSON.stringify(repaired) === JSON.stringify(value || {}) ? value : repaired
}

function isFreemodelClaudeCodeProfile(profile = {}) {
  const haystack = [
    profile.id,
    profile.model,
    profile.label,
    profile.provider,
    profile.providerName,
    profile.baseUrl,
  ].filter(Boolean).join(' ').toLowerCase()
  return /freemodel/.test(haystack) && (
    normalizedUpstreamApi(profile.upstreamApi || profile.apiFormat || profile.providerApi) === 'anthropic' ||
    /claude|sonnet|opus|haiku/.test(haystack)
  )
}

function repairRawProfile(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { profile, changed: false, changes: [] }
  const next = { ...profile }
  const changes = []
  const model = text(profile.model || profile.id || profile.label, 256)
  const label = text(profile.label || profile.model || profile.id, 256)

  function record(field, message, from = '', to = '') {
    changes.push({
      scope: 'profile',
      model,
      label,
      field,
      message,
      from: text(from, 2048),
      to: text(to, 2048),
    })
  }

  if (profile.baseUrl) {
    const baseUrl = safeHttpUrl(profile.baseUrl)
    if (baseUrl && baseUrl !== profile.baseUrl) {
      next.baseUrl = baseUrl
      record('baseUrl', 'Base URL canonisée.', profile.baseUrl, baseUrl)
    }
    const repairedBaseUrl = next.baseUrl || baseUrl
    if (repairedBaseUrl && isFreemodelClaudeCodeProfile(next)) {
      const freemodelClaudeCodeBase = repairedBaseUrl.replace(/\/v1$/i, '')
      if (freemodelClaudeCodeBase !== repairedBaseUrl) {
        next.baseUrl = freemodelClaudeCodeBase
        record('baseUrl', 'Endpoint Freemodel Claude Code corrigé.', repairedBaseUrl, freemodelClaudeCodeBase)
      }
    }
  }
  if (profile.extraBody && typeof profile.extraBody === 'object' && !Array.isArray(profile.extraBody)) {
    const extraBody = repairExtraBody(profile.extraBody)
    if (extraBody !== profile.extraBody) {
      next.extraBody = extraBody
      record('extraBody', 'Paramètres Think retirés du corps provider.', 'thinking présent', 'thinking retiré')
    }
  }
  if (profile.capabilities && typeof profile.capabilities === 'object' && !Array.isArray(profile.capabilities) && profile.capabilities.thinking !== false) {
    next.capabilities = { ...profile.capabilities, thinking: false }
    record('capabilities.thinking', 'Think désactivé pour éviter les paramètres refusés.', String(profile.capabilities.thinking), 'false')
  }

  return { profile: next, changed: changes.length > 0, changes }
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return {
    ...Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'boolean')),
    thinking: false,
  }
}

function profileMatches(profile, target) {
  return Boolean(target && (profile?.model === target || profile?.id === target))
}

function profileIdentifier(profile = {}) {
  return text(profile.id || profile.model || profile.label, 256)
}

function sanitizeProviderBackupConfig(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : []
  return {
    ...raw,
    profiles: profiles.map(profile => {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile
      if (!profile.apiKey && !profile.apiKeySecret) return profile
      const next = { ...profile, secretMigratedTo: 'OPC' }
      delete next.apiKey
      delete next.apiKeySecret
      return next
    }),
  }
}

function configHasStoredSecret(raw = {}) {
  const profiles = Array.isArray(raw?.profiles) ? raw.profiles : []
  return profiles.some(profile => profile && typeof profile === 'object' && (profile.apiKey || profile.apiKeySecret))
}

function defaultAgentModel(profiles = [], requested = '') {
  const selected = profiles.find(profile => profileMatches(profile, requested) && policy.isAgentRunnable(profile))
  return selected?.model || profiles.find(policy.isAgentRunnable)?.model || policy.DEFAULT_FAST_MODEL
}

function isSupportedRuntimeProvider(profile = {}) {
  const providerName = text(profile.providerName || profile.provider, 256).toLowerCase()
  const baseUrl = safeHttpUrl(profile.baseUrl).toLowerCase()
  return (
    providerName === policy.DEFAULT_PROVIDER_NAME.toLowerCase() ||
    providerName === policy.OLLAMA_PROVIDER_NAME.toLowerCase() ||
    baseUrl === policy.DEFAULT_BASE_URL.toLowerCase() ||
    baseUrl === policy.OLLAMA_BASE_URL.toLowerCase()
  )
}

function defaultProfileClone(profile = {}) {
  return {
    ...profile,
    capabilities: profile.capabilities ? { ...profile.capabilities } : undefined,
  }
}

function canonicalSupportedProfile(profile = {}) {
  const baseUrl = safeHttpUrl(profile.baseUrl)
  if (baseUrl.toLowerCase() === policy.OLLAMA_BASE_URL.toLowerCase()) {
    return {
      ...profile,
      provider: policy.OLLAMA_PROVIDER_NAME,
      providerName: policy.OLLAMA_PROVIDER_NAME,
      upstreamApi: 'openai',
      auth: false,
      noAuth: true,
    }
  }
  if (baseUrl.toLowerCase() === policy.DEFAULT_BASE_URL.toLowerCase() || text(profile.providerName || profile.provider, 256).toLowerCase() === policy.DEFAULT_PROVIDER_NAME.toLowerCase()) {
    return {
      ...profile,
      provider: policy.DEFAULT_PROVIDER_NAME,
      providerName: policy.DEFAULT_PROVIDER_NAME,
      baseUrl: baseUrl || policy.DEFAULT_BASE_URL,
      upstreamApi: profile.upstreamApi || 'openai',
    }
  }
  return profile
}

function createSecretHelpers(secretVault) {
  function hydrateProfile(profile = {}) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile
    if (profile.apiKey && secretVault.plaintextAllowed?.() === false && profile.auth !== false && profile.noAuth !== true) {
      throw new Error('Configuration provider refusee: clé API en clair détectée alors que safeStorage est requis.')
    }
    if (profile.apiKey || !profile.apiKeySecret) return profile
    const apiKey = secretVault.open(profile)
    return apiKey ? { ...profile, apiKey } : profile
  }

  function hydrateConfig(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const profiles = Array.isArray(raw.profiles) ? raw.profiles.map(hydrateProfile) : raw.profiles
    if (!Array.isArray(profiles)) return { ...raw, profiles }
    const byId = new Map()
    for (const profile of profiles) {
      if (!profile || typeof profile !== 'object') continue
      for (const key of [profile.id, profile.model].map(item => text(item, 256)).filter(Boolean)) {
        if (!byId.has(key)) byId.set(key, profile)
      }
    }
    return {
      ...raw,
      profiles: profiles.map(profile => {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile
        const authProfileId = text(profile.authProfileId || profile.authProfile || profile.inheritAuthFrom, 256)
        if (!authProfileId || profile.apiKey || profile.apiKeySecret || profile.auth === false || profile.noAuth === true) return profile
        const source = byId.get(authProfileId)
        if (!source?.apiKey) return profile
        return {
          ...profile,
          apiKey: source.apiKey,
          apiKeyInheritedFrom: profileIdentifier(source),
        }
      }),
    }
  }

  function sealProfile(profile = {}) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile
    if (profile.auth === false || profile.noAuth === true) {
      const next = { ...profile }
      delete next.apiKey
      delete next.apiKeySecret
      return next
    }
    if (!profile.apiKey) return profile
    const next = { ...profile }
    const sealed = secretVault.seal(profile.apiKey)
    delete next.apiKey
    delete next.apiKeySecret
    return { ...next, ...sealed }
  }

  return { hydrateConfig, hydrateProfile, sealProfile }
}

function editableProfile(profile, config, index) {
  const summary = policy.profileSummary(profile, config)
  const apiKeySet = Boolean(profile.apiKey || profile.apiKeySecret)
  return {
    ...summary,
    index,
    id: text(profile.id || summary.id || summary.model || `profile-${index + 1}`, 256),
    label: text(profile.label || summary.label || policy.name(profile), 256),
    model: text(profile.model || summary.model || profile.id, 256),
    provider: text(profile.provider || profile.providerName || summary.providerName, 256),
    providerName: text(profile.providerName || summary.providerName, 256),
    baseUrl: text(summary.baseUrl, 2048),
    upstreamApi: summary.upstreamApi,
    transport: summary.transport,
    timeoutMs: summary.timeoutMs,
    checkTimeoutMs: summary.checkTimeoutMs,
    retries: summary.retries,
    maxTokens: summary.maxTokens,
    maxInputTokens: summary.maxInputTokens,
    contextWindowTokens: summary.contextWindowTokens,
    apiKeySet,
    apiKeyPreview: apiKeyPreview(profile.apiKey, apiKeySet),
    noAuth: profile.auth === false || profile.noAuth === true,
    disabled: Boolean(profile.disabled || profile.quarantinedAt),
    disabledReason: text(profile.disabledReason, 1000),
    quarantinedAt: text(profile.quarantinedAt, 120),
    systemPrefix: text(profile.systemPrefix, MAX_TEXT_CHARS),
    extraBody: normalizeExtraBody(profile.extraBody),
    capabilities: summary.capabilities,
  }
}

function createProviderConfigStore({ configPath, secretVault = createProviderSecretVault() }) {
  let providerConfig = null
  let providerConfigError = ''
  const secrets = createSecretHelpers(secretVault)

  function malformedMessage(error) {
    return `Configuration provider illisible: ${error.message || String(error)}`
  }

  function providerEventsPath() {
    return path.join(path.dirname(configPath()), 'provider-events.jsonl')
  }

  function providerKeyState(profile = {}) {
    if (profile.auth === false || profile.noAuth === true) return 'no_auth'
    if (profile.apiKey || profile.apiKeySecret) return 'configured'
    return 'missing'
  }

  function providerEventPayload(action, profile = {}, extra = {}) {
    return {
      at: new Date().toISOString(),
      action,
      id: text(profile.id || profile.model, 256),
      model: text(profile.model || profile.id, 256),
      label: text(profile.label || profile.model || profile.id, 256),
      providerName: text(profile.providerName || profile.provider, 256),
      baseUrl: text(profile.baseUrl, 2048),
      upstreamApi: normalizedUpstreamApi(profile.upstreamApi || profile.apiFormat || profile.providerApi),
      keyState: providerKeyState(profile),
      reason: text(extra.reason, 1000),
    }
  }

  function writeProviderEvent(action, profile = {}, extra = {}) {
    try {
      const filePath = providerEventsPath()
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.appendFileSync(filePath, `${JSON.stringify(providerEventPayload(action, profile, extra))}\n`, { mode: 0o600 })
      fs.chmodSync(filePath, 0o600)
    } catch {
      // The provider config remains the source of truth; journal write failures must not break edits.
    }
  }

  function providerEvents({ limit = 100 } = {}) {
    try {
      const rows = fs.readFileSync(providerEventsPath(), 'utf8')
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line))
      return rows.slice(Math.max(0, rows.length - Math.max(1, Number(limit) || 100)))
    } catch {
      return []
    }
  }

  function readRawConfig({ tolerateMalformed = false } = {}) {
    try {
      const raw = fs.readFileSync(configPath(), 'utf8')
      const parsed = JSON.parse(raw)
      providerConfigError = ''
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      if (error?.code === 'ENOENT') {
        providerConfigError = ''
        return {}
      }
      providerConfigError = malformedMessage(error)
      if (tolerateMalformed) return {}
      throw new Error(providerConfigError)
    }
  }

  function writeRawConfig(rawConfig, { returnEditable = true } = {}) {
    const target = configPath()
    writePrivateJsonFile(target, rawConfig, { atomic: true })
    providerConfig = null
    providerConfigError = ''
    return returnEditable ? editableConfig() : null
  }

  function hasPlainApiKey(profile = {}) {
    return Boolean(
      profile &&
      typeof profile === 'object' &&
      !Array.isArray(profile) &&
      profile.apiKey &&
      !profile.apiKeySecret &&
      profile.auth !== false &&
      profile.noAuth !== true
    )
  }

  function backupRawConfig(target) {
    try {
      if (!fs.existsSync(target)) return ''
      const backupPath = `${target}.bak.${Date.now()}`
      const raw = JSON.parse(fs.readFileSync(target, 'utf8'))
      writePrivateJsonFile(backupPath, sanitizeProviderBackupConfig(raw))
      return backupPath
    } catch {
      return ''
    }
  }

  function redactPlainBackups() {
    const target = configPath()
    const dir = path.dirname(target)
    const prefix = `${path.basename(target)}.bak.`
    let count = 0
    try {
      if (!fs.existsSync(dir)) return { redacted: false, count: 0 }
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(prefix)) continue
        const filePath = path.join(dir, name)
        let raw = null
        try {
          raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        } catch {
          continue
        }
        if (!configHasStoredSecret(raw)) continue
        writePrivateJsonFile(filePath, sanitizeProviderBackupConfig(raw))
        count += 1
      }
    } catch {
      return { redacted: count > 0, count }
    }
    return { redacted: count > 0, count }
  }

  function migratePlainApiKeys() {
    const backupRedaction = redactPlainBackups()
    if (!secretVault.canEncrypt?.()) {
      return { migrated: false, count: 0, reason: 'encryption-unavailable', backupRedaction }
    }
    const raw = readRawConfig({ tolerateMalformed: true })
    const profiles = Array.isArray(raw.profiles) ? raw.profiles : []
    const count = profiles.filter(hasPlainApiKey).length
    if (!count) return { migrated: false, count: 0, backupRedaction }
    const target = configPath()
    const backupPath = backupRawConfig(target)
    const migrated = {
      ...raw,
      profiles: profiles.map(secrets.sealProfile),
    }
    writeRawConfig(migrated, { returnEditable: false })
    return { migrated: true, count, backupPath, backupRedaction }
  }

  function repairKnownProviderIssues() {
    const raw = readRawConfig({ tolerateMalformed: true })
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { repaired: false, count: 0, changes: [] }

    const next = { ...raw }
    const changes = []

    if (raw.baseUrl) {
      const baseUrl = safeHttpUrl(raw.baseUrl)
      if (baseUrl && baseUrl !== raw.baseUrl) {
        next.baseUrl = baseUrl
        changes.push({
          scope: 'global',
          field: 'baseUrl',
          message: 'Base URL globale canonisée.',
          from: text(raw.baseUrl, 2048),
          to: text(baseUrl, 2048),
        })
      }
    }

    if (Array.isArray(raw.profiles)) {
      next.profiles = raw.profiles.map(profile => {
        const repaired = repairRawProfile(profile)
        if (repaired.changed) changes.push(...repaired.changes)
        return repaired.profile
      })
    }

    const count = changes.length
    if (!count) return { repaired: false, count: 0, changes: [] }
    writeRawConfig(next, { returnEditable: false })
    return { repaired: true, count, changes }
  }

  function pruneToSupportedProviders() {
    const raw = readRawConfig({ tolerateMalformed: true })
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { pruned: false, removed: 0, added: 0, config: editableConfig() }

    const hasExplicitProfiles = Array.isArray(raw.profiles)
    const sourceProfiles = hasExplicitProfiles ? raw.profiles : []
    const kept = sourceProfiles.map(canonicalSupportedProfile)
    const existingModels = new Set(kept.map(profile => text(profile.model || profile.id, 256)).filter(Boolean))
    let added = 0
    if (!hasExplicitProfiles) {
      for (const profile of policy.DEFAULT_PROVIDER_PROFILES) {
        if (existingModels.has(profile.model)) continue
        kept.push(defaultProfileClone(profile))
        existingModels.add(profile.model)
        added += 1
      }
    }
    const removed = 0
    const changed = added > 0 || JSON.stringify(sourceProfiles) !== JSON.stringify(kept)
    if (!changed) return { pruned: false, removed: 0, added: 0, config: editableConfig() }

    const target = configPath()
    backupRawConfig(target)
    const next = {
      ...raw,
      baseUrl: policy.DEFAULT_BASE_URL,
      profiles: kept.map(secrets.sealProfile),
    }
    next.defaultModel = defaultAgentModel(next.profiles, raw.defaultModel)
    const config = writeRawConfig(next)
    return {
      pruned: true,
      removed,
      added,
      config,
    }
  }

  function rawConfigForWrite() {
    repairKnownProviderIssues()
    const raw = readRawConfig({ tolerateMalformed: true })
    const normalized = policy.normalizeProviderConfig(secrets.hydrateConfig(raw))
    return {
      ...raw,
      baseUrl: raw.baseUrl || normalized.baseUrl,
      defaultModel: raw.defaultModel || normalized.defaultModel,
      profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    }
  }

  function load() {
    if (providerConfig) return providerConfig
    try {
      migratePlainApiKeys()
      repairKnownProviderIssues()
      const parsed = secrets.hydrateConfig(readRawConfig())
      providerConfig = policy.normalizeProviderConfig(parsed)
      providerConfigError = ''
    } catch (error) {
      providerConfig = policy.normalizeProviderConfig()
      providerConfigError = error.message || String(error)
    }
    return providerConfig
  }

  function reload() {
    providerConfig = null
    return load()
  }

  function profiles() {
    const config = load()
    return config.profiles.map(profile => policy.profileSummary(profile, config))
  }

  function editableConfig() {
    migratePlainApiKeys()
    repairKnownProviderIssues()
    const raw = secrets.hydrateConfig(readRawConfig({ tolerateMalformed: true }))
    const config = policy.normalizeProviderConfig(raw)
    return {
      path: configPath(),
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      configError: providerConfigError,
      profiles: config.profiles.map((profile, index) => editableProfile(profile, config, index)),
      providerEvents: providerEvents({ limit: 80 }),
    }
  }

  function exportConfig() {
    const config = editableConfig()
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      profiles: config.profiles,
    }
  }

  function sanitizeProfilePayload(payload = {}, existing = {}) {
    const model = text(payload.model || existing.model || payload.id || existing.id, 256)
    if (!model) throw new Error('Le modèle du provider est requis.')
    const baseUrl = safeHttpUrl(payload.baseUrl || existing.baseUrl)
    if (!baseUrl) throw new Error('URL provider invalide. Utilise une URL http(s) complète.')
    const providerName = text(payload.providerName || payload.provider || existing.providerName || existing.provider || policy.DEFAULT_PROVIDER_NAME, 256)
    const transport = normalizedTransport(payload.transport || existing.transport)
    const upstreamApi = normalizedUpstreamApi(payload.upstreamApi || payload.apiFormat || payload.providerApi || existing.upstreamApi || existing.apiFormat || existing.providerApi)
    const noAuth = Boolean(payload.noAuth)
    const explicitApiKey = text(payload.apiKey, MAX_TEXT_CHARS)
    const next = {
      ...existing,
      id: text(payload.id || existing.id || model, 256),
      label: text(payload.label || existing.label || model, 256),
      model,
      provider: providerName,
      providerName,
      baseUrl,
      upstreamApi,
      transport,
      stream: transport !== 'buffered',
      timeoutMs: Math.round(number(payload.timeoutMs ?? existing.timeoutMs ?? existing.requestTimeoutMs, 300000, { min: 5000, max: 1800000 })),
      checkTimeoutMs: Math.round(number(payload.checkTimeoutMs ?? existing.checkTimeoutMs ?? existing.providerCheckTimeoutMs, 60000, { min: 5000, max: 300000 })),
      retries: Math.round(number(payload.retries ?? existing.retries, 0, { min: 0, max: 10 })),
      maxTokens: Math.round(number(payload.maxTokens ?? existing.maxTokens ?? existing.max_tokens, 4096, { min: 1, max: 2000000 })),
      maxInputTokens: Math.round(number(payload.maxInputTokens ?? existing.maxInputTokens ?? existing.inputTokens ?? existing.max_input_tokens, 0, { min: 0, max: 2000000 })),
      contextWindowTokens: Math.round(number(payload.contextWindowTokens ?? existing.contextWindowTokens ?? existing.contextTokens ?? existing.contextWindow ?? existing.maxContextTokens, 0, { min: 0, max: 2000000 })),
      systemPrefix: text(payload.systemPrefix ?? existing.systemPrefix, MAX_TEXT_CHARS),
      extraBody: normalizeExtraBody(payload.extraBody ?? existing.extraBody),
    }
    const authProfileId = text(payload.authProfileId ?? payload.authProfile ?? payload.inheritAuthFrom ?? existing.authProfileId, 256)
    if (authProfileId && authProfileId !== model && authProfileId !== next.id) next.authProfileId = authProfileId
    else delete next.authProfileId
    if ('disabled' in payload) {
      if (payload.disabled) {
        next.disabled = true
        next.disabledReason = text(payload.disabledReason || existing.disabledReason || 'Provider mis en pause.', 1000)
        next.quarantinedAt = text(payload.quarantinedAt || existing.quarantinedAt || new Date().toISOString(), 120)
      } else {
        delete next.disabled
        delete next.disabledReason
        delete next.quarantinedAt
      }
    }
    const capabilities = normalizeCapabilities(payload.capabilities ?? existing.capabilities)
    if (capabilities) next.capabilities = capabilities
    else delete next.capabilities
    if (noAuth) {
      next.auth = false
      next.noAuth = true
      delete next.apiKey
      delete next.apiKeySecret
      delete next.authProfileId
      delete next.apiKeyInheritedFrom
    } else {
      delete next.auth
      delete next.noAuth
      if (payload.clearApiKey) {
        delete next.apiKey
        delete next.apiKeySecret
      } else if (explicitApiKey) {
        next.apiKey = explicitApiKey
        delete next.apiKeySecret
      } else if (next.authProfileId) {
        delete next.apiKey
        delete next.apiKeySecret
      } else if (existing.apiKey && !existing.apiKeyInheritedFrom) next.apiKey = existing.apiKey
      delete next.apiKeyInheritedFrom
    }
    return next
  }

  function upsertProfile(payload = {}) {
    const raw = rawConfigForWrite()
    const profiles = Array.isArray(raw.profiles) ? raw.profiles.slice(0, MAX_PROVIDER_PROFILES) : []
    const requestedId = text(payload.id, 256)
    const requestedModel = text(payload.model, 256)
    const index = profiles.findIndex(profile => (
      (requestedId && profile.id === requestedId) ||
      (requestedModel && profile.model === requestedModel)
    ))
    const existing = index >= 0 ? secrets.hydrateProfile(profiles[index]) : {}
    const nextProfile = sanitizeProfilePayload(payload, existing)
    const action = index >= 0 ? 'updated' : 'added'
    if (payload.makeDefault && !policy.isAgentRunnable(nextProfile)) {
      throw new Error('Ce provider est un outil de suggestion et ne peut pas devenir le modèle agent par défaut.')
    }
    if (index >= 0) profiles[index] = nextProfile
    else profiles.push(nextProfile)
    raw.profiles = profiles.map(secrets.sealProfile)
    if (payload.makeDefault) raw.defaultModel = nextProfile.model
    else if (!raw.defaultModel || !profiles.some(profile => profileMatches(profile, raw.defaultModel) && policy.isAgentRunnable(profile))) {
      raw.defaultModel = defaultAgentModel(profiles)
    }
    const config = writeRawConfig(raw)
    writeProviderEvent(action, nextProfile)
    return config
  }

  function importConfig(payload = {}) {
    const raw = rawConfigForWrite()
    const importedProfiles = Array.isArray(payload?.profiles) ? payload.profiles : Array.isArray(payload) ? payload : [payload]
    const profiles = Array.isArray(raw.profiles) ? raw.profiles.slice(0, MAX_PROVIDER_PROFILES) : []
    let imported = 0
    for (const profile of importedProfiles.slice(0, MAX_PROVIDER_PROFILES)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
      const requestedId = text(profile.id, 256)
      const requestedModel = text(profile.model, 256)
      const index = profiles.findIndex(item => (
        (requestedId && item.id === requestedId) ||
        (requestedModel && item.model === requestedModel)
      ))
      const existing = index >= 0 ? secrets.hydrateProfile(profiles[index]) : {}
      const nextProfile = sanitizeProfilePayload(profile, existing)
      if (index >= 0) profiles[index] = nextProfile
      else profiles.push(nextProfile)
      imported += 1
    }
    if (!imported) throw new Error('Aucun provider importable trouvé dans le JSON.')
    raw.profiles = profiles.slice(0, MAX_PROVIDER_PROFILES).map(secrets.sealProfile)
    const requestedDefault = text(payload?.defaultModel, 256)
    if (requestedDefault && raw.profiles.some(profile => profileMatches(profile, requestedDefault) && policy.isAgentRunnable(profile))) {
      raw.defaultModel = requestedDefault
    } else if (!raw.defaultModel) {
      raw.defaultModel = defaultAgentModel(raw.profiles)
    } else if (!raw.profiles.some(profile => profileMatches(profile, raw.defaultModel) && policy.isAgentRunnable(profile))) {
      raw.defaultModel = defaultAgentModel(raw.profiles)
    }
    return writeRawConfig(raw)
  }

  function deleteProfile(identifier) {
    const target = text(identifier, 256)
    if (!target) throw new Error('Provider à supprimer introuvable.')
    const raw = rawConfigForWrite()
    const currentProfiles = Array.isArray(raw.profiles) ? raw.profiles : []
    const removedProfile = currentProfiles.find(profile => profile.id === target || profile.model === target)
    const profiles = currentProfiles.filter(profile => profile.id !== target && profile.model !== target)
    if (!removedProfile || profiles.length === currentProfiles.length) throw new Error('Provider à supprimer introuvable.')
    raw.profiles = profiles.map(secrets.sealProfile)
    if (raw.defaultModel === target || !profiles.some(profile => profileMatches(profile, raw.defaultModel) && policy.isAgentRunnable(profile))) {
      raw.defaultModel = defaultAgentModel(profiles)
    }
    const config = writeRawConfig(raw)
    writeProviderEvent('deleted', secrets.hydrateProfile(removedProfile))
    return config
  }

  function setDefaultModel(model) {
    const target = text(model, 256)
    if (!target) throw new Error('Modèle par défaut invalide.')
    const raw = rawConfigForWrite()
    const profiles = Array.isArray(raw.profiles) ? raw.profiles : []
    const profile = profiles.find(item => profileMatches(item, target))
    if (!profile) {
      throw new Error('Ce modèle n’existe pas dans les providers configurés.')
    }
    if (!policy.isAgentRunnable(profile)) {
      throw new Error('Ce provider est un outil de suggestion et ne peut pas devenir le modèle agent par défaut.')
    }
    raw.defaultModel = profile.model
    return writeRawConfig(raw)
  }

  function updateProfilePauseState(identifiers = [], { disabled, reason = '' } = {}) {
    const targets = new Set((Array.isArray(identifiers) ? identifiers : [identifiers]).map(item => text(item, 256)).filter(Boolean))
    if (!targets.size) throw new Error('Aucun provider ciblé.')
    const raw = rawConfigForWrite()
    const profiles = Array.isArray(raw.profiles) ? raw.profiles : []
    let changed = 0
    const now = new Date().toISOString()
    const changedProfiles = []
    raw.profiles = profiles.map(profile => {
      if (!targets.has(profile.id) && !targets.has(profile.model)) return profile
      changed += 1
      if (!disabled) {
        const next = { ...profile }
        delete next.disabled
        delete next.disabledReason
        delete next.quarantinedAt
        changedProfiles.push(next)
        return next
      }
      const next = {
        ...profile,
        disabled: true,
        disabledReason: text(reason || profile.disabledReason || 'Provider mis en pause après diagnostic OPC.', 1000),
        quarantinedAt: profile.quarantinedAt || now,
      }
      changedProfiles.push(next)
      return next
    })
    if (!changed) throw new Error('Provider à mettre à jour introuvable.')
    if (!raw.profiles.some(profile => profileMatches(profile, raw.defaultModel) && policy.isAgentRunnable(profile))) {
      raw.defaultModel = defaultAgentModel(raw.profiles)
    }
    const config = writeRawConfig(raw)
    for (const profile of changedProfiles) {
      writeProviderEvent(disabled ? 'paused' : 'restored', secrets.hydrateProfile(profile), { reason })
    }
    return { config, changed }
  }

  function quarantineProfiles(identifiers = [], reason = '') {
    return updateProfilePauseState(identifiers, { disabled: true, reason })
  }

  function restoreProfiles(identifiers = []) {
    return updateProfilePauseState(identifiers, { disabled: false })
  }

  function profileForModel(model) {
    return policy.profileForModel(load(), model)
  }

  function profileRevision(profile) {
    return policy.profileRevision(profile, load())
  }

  return {
    deleteProfile,
    editableConfig,
    exportConfig,
    importConfig,
    load,
    loadError: () => providerConfigError,
    migratePlainApiKeys,
    pruneToSupportedProviders,
    providerEvents,
    repairKnownProviderIssues,
    reload,
    quarantineProfiles,
    restoreProfiles,
    setDefaultModel,
    upsertProfile,
    profiles,
    profileForModel,
    name: policy.name,
    providerName: policy.providerName,
    baseUrl: profile => policy.baseUrl(profile, load()),
    shouldUseBufferedUpstream: policy.shouldUseBufferedUpstream,
    upstreamApi: policy.upstreamApi,
    retryCount: policy.retryCount,
    retryDelay: policy.retryDelay,
    requestTimeout: policy.requestTimeout,
    providerCheckTimeout: policy.providerCheckTimeout,
    profileRevision,
    maxTokens: policy.maxTokens,
    maxInputTokens: policy.maxInputTokens,
    extraBody: policy.extraBody,
    capabilities: policy.capabilities,
    withSystemPrefix: policy.withSystemPrefix,
    errorMessage: policy.errorMessage,
    failureText: policy.failureText,
    isRetryableFailure: policy.isRetryableFailure,
    shouldUseStreamingProviderCheck: policy.shouldUseStreamingProviderCheck,
  }
}

module.exports = { createProviderConfigStore }
