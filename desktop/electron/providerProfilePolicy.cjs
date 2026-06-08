const crypto = require('node:crypto')
const { isRateLimitedProviderIssue } = require('./providerIssue.cjs')

const DEFAULT_FAST_MODEL = 'mistralai/mistral-medium-3.5-128b'
const PROVIDER_REQUEST_TIMEOUT_MS = 300000
const PROVIDER_BUFFERED_REQUEST_TIMEOUT_MS = 300000
const PROVIDER_CHECK_TIMEOUT_MS = 60000
const PROVIDER_BUFFERED_CHECK_TIMEOUT_MS = 60000
const PROVIDER_SAME_MODEL_RETRIES = 3
const PROVIDER_BUFFERED_RETRIES = 0
const PROVIDER_RETRY_BASE_DELAY_MS = 1200
const DEFAULT_PROVIDER_NAME = 'NVIDIA'
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const OLLAMA_PROVIDER_NAME = 'Ollama'
const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b'
const DEFAULT_OLLAMA_CONTEXT_WINDOW_TOKENS = 8192
const GITLAB_CODE_SUGGESTIONS_API = 'gitlab-code-suggestions'
const PROVIDER_USAGE_AGENT = 'agent'
const PROVIDER_USAGE_CODE_SUGGESTIONS = 'code-suggestions'
const PROVIDER_USAGE_DISABLED = 'disabled'
const LEGACY_BASE_URL_HOST_REWRITES = Object.freeze({
  'api.openrouter.ai': 'openrouter.ai',
})
const DEFAULT_CAPABILITIES = Object.freeze({
  agent: true,
  system: true,
  streaming: true,
  tools: true,
  toolResultRole: true,
  toolChoice: true,
  temperature: true,
  thinking: false,
  refine: true,
  reasoningPassThrough: false,
  reasoningExclude: false,
})
const DEFAULT_PROVIDER_PROFILES = Object.freeze([
  {
    id: DEFAULT_FAST_MODEL,
    label: 'Mistral Medium 3.5 128B',
    model: DEFAULT_FAST_MODEL,
    provider: DEFAULT_PROVIDER_NAME,
    providerName: DEFAULT_PROVIDER_NAME,
    baseUrl: DEFAULT_BASE_URL,
    upstreamApi: 'openai',
    transport: 'stream',
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    checkTimeoutMs: PROVIDER_CHECK_TIMEOUT_MS,
    retries: PROVIDER_SAME_MODEL_RETRIES,
    maxTokens: 8192,
  },
  {
    id: 'qwen/qwen3.5-122b-a10b',
    label: 'Qwen 3.5 122B',
    model: 'qwen/qwen3.5-122b-a10b',
    provider: DEFAULT_PROVIDER_NAME,
    providerName: DEFAULT_PROVIDER_NAME,
    baseUrl: DEFAULT_BASE_URL,
    upstreamApi: 'openai',
    transport: 'stream',
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    checkTimeoutMs: PROVIDER_CHECK_TIMEOUT_MS,
    retries: PROVIDER_SAME_MODEL_RETRIES,
    maxTokens: 8192,
  },
  {
    id: DEFAULT_OLLAMA_MODEL,
    label: 'Ollama Local',
    model: DEFAULT_OLLAMA_MODEL,
    provider: OLLAMA_PROVIDER_NAME,
    providerName: OLLAMA_PROVIDER_NAME,
    baseUrl: OLLAMA_BASE_URL,
    upstreamApi: 'openai',
    transport: 'stream',
    auth: false,
    noAuth: true,
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    checkTimeoutMs: PROVIDER_CHECK_TIMEOUT_MS,
    retries: 0,
    maxTokens: 8192,
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      toolChoice: false,
      thinking: false,
    },
  },
])

function normalizeProviderConfig(value = {}) {
  const profiles = Array.isArray(value.profiles)
    ? value.profiles
    : DEFAULT_PROVIDER_PROFILES.map(profile => ({ ...profile, capabilities: profile.capabilities ? { ...profile.capabilities } : undefined }))
  return {
    baseUrl: value.baseUrl || DEFAULT_BASE_URL,
    defaultModel: defaultModelForProfiles(value.defaultModel, profiles),
    profiles,
  }
}

function profileMatches(profile, identifier) {
  return Boolean(identifier && (profile?.id === identifier || profile?.model === identifier))
}

function defaultModelForProfiles(requested, profiles = []) {
  if (requested && profiles.some(profile => profileMatches(profile, requested) && isAgentRunnable(profile))) return requested
  return profiles.find(isAgentRunnable)?.model || DEFAULT_FAST_MODEL
}

function profileForModel(config, model) {
  const selected = model || config.defaultModel
  return (
    config.profiles.find(profile => profile.id === selected || profile.model === selected) ||
    config.profiles.find(profile => profile.model === config.defaultModel) ||
    config.profiles[0] ||
    null
  )
}

function providerName(profile) {
  return profile?.providerName || profile?.provider || DEFAULT_PROVIDER_NAME
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').replace(/\u0000/g, '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    const replacementHost = LEGACY_BASE_URL_HOST_REWRITES[url.hostname.toLowerCase()]
    if (replacementHost) url.hostname = replacementHost
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function baseUrl(profile, config = {}) {
  return normalizeBaseUrl(profile?.baseUrl) || normalizeBaseUrl(config.baseUrl) || DEFAULT_BASE_URL
}

function name(profile) {
  return profile?.label || profile?.id || profile?.model || providerName(profile)
}

function shouldUseBufferedUpstream(profile) {
  if (upstreamApi(profile) === GITLAB_CODE_SUGGESTIONS_API) return true
  return profile?.stream === false || profile?.disableStreaming === true || profile?.transport === 'buffered'
}

function shouldUseStreamingProviderCheck(profile) {
  const api = upstreamApi(profile)
  if (api === GITLAB_CODE_SUGGESTIONS_API) return false
  if (api === 'anthropic') return true
  return !shouldUseBufferedUpstream(profile) && usesOpenCodeZen(profile)
}

function upstreamApi(profile) {
  const value = String(profile?.upstreamApi || profile?.apiFormat || profile?.providerApi || 'openai').toLowerCase()
  if (value === 'anthropic') return 'anthropic'
  if (['gitlab', 'gitlab-code-suggestions', 'code-suggestions'].includes(value)) return GITLAB_CODE_SUGGESTIONS_API
  return 'openai'
}

function boolCapability(value, fallback) {
  if (typeof value === 'boolean') return value
  return fallback
}

function modelText(profile) {
  return [
    profile?.id,
    profile?.model,
    profile?.label,
    profile?.provider,
    profile?.providerName,
    profile?.baseUrl,
  ].filter(Boolean).join(' ').toLowerCase()
}

function usesOpenCodeZen(profile = {}) {
  return /opencode\.ai\/zen/.test(modelText(profile))
}

function usesOllama(profile = {}) {
  return providerName(profile).toLowerCase() === OLLAMA_PROVIDER_NAME.toLowerCase() ||
    normalizeBaseUrl(profile?.baseUrl).toLowerCase() === OLLAMA_BASE_URL.toLowerCase()
}

function capabilities(profile = {}) {
  const explicit = profile.capabilities && typeof profile.capabilities === 'object' && !Array.isArray(profile.capabilities)
    ? profile.capabilities
    : {}
  const text = modelText(profile)
  const streamEnabled = !shouldUseBufferedUpstream(profile)
  const isDeepSeekReasoning = /deepseek/.test(text) && /(v4|r1|reason|think)/.test(text)
  const isOpenRouterLike = /openrouter\.ai/.test(text)
  const isOpenCodeZen = usesOpenCodeZen(profile)
  const isGitLabCodeSuggestions = upstreamApi(profile) === GITLAB_CODE_SUGGESTIONS_API
  const needsTextToolTranscript = /mistral-nemotron/.test(text)
  const inferred = {
    ...DEFAULT_CAPABILITIES,
    agent: isGitLabCodeSuggestions ? false : DEFAULT_CAPABILITIES.agent,
    streaming: isGitLabCodeSuggestions ? false : streamEnabled,
    tools: isGitLabCodeSuggestions ? false : DEFAULT_CAPABILITIES.tools,
    toolResultRole: isGitLabCodeSuggestions ? false : !needsTextToolTranscript,
    toolChoice: isGitLabCodeSuggestions ? false : DEFAULT_CAPABILITIES.toolChoice,
    temperature: isGitLabCodeSuggestions ? false : DEFAULT_CAPABILITIES.temperature,
    thinking: false,
    refine: isGitLabCodeSuggestions ? false : DEFAULT_CAPABILITIES.refine,
    reasoningPassThrough: isDeepSeekReasoning,
    reasoningExclude: !isOpenCodeZen && (isOpenRouterLike || isDeepSeekReasoning),
  }
  const tools = boolCapability(explicit.tools, boolCapability(profile.supportsTools, inferred.tools))
  const resolved = {
    agent: boolCapability(explicit.agent, inferred.agent),
    system: boolCapability(explicit.system, inferred.system),
    streaming: boolCapability(explicit.streaming, inferred.streaming),
    tools,
    toolResultRole: tools && boolCapability(explicit.toolResultRole, boolCapability(profile.supportsToolResultRole, inferred.toolResultRole)),
    toolChoice: tools && boolCapability(explicit.toolChoice, boolCapability(profile.supportsToolChoice, inferred.toolChoice)),
    temperature: boolCapability(explicit.temperature, inferred.temperature),
    thinking: false,
    refine: boolCapability(explicit.refine, inferred.refine),
    reasoningPassThrough: boolCapability(explicit.reasoningPassThrough, inferred.reasoningPassThrough),
    reasoningExclude: boolCapability(explicit.reasoningExclude, inferred.reasoningExclude),
  }
  if (!isGitLabCodeSuggestions) return resolved
  return {
    ...resolved,
    agent: false,
    system: false,
    streaming: false,
    tools: false,
    toolResultRole: false,
    toolChoice: false,
    temperature: false,
    thinking: false,
    refine: false,
    reasoningPassThrough: false,
    reasoningExclude: false,
  }
}

function capabilityWarnings(profile, caps = capabilities(profile)) {
  const warnings = []
  if (profile?.disabled || profile?.quarantinedAt) warnings.push('provider en pause')
  if (caps.agent === false) warnings.push('agent CLI indisponible')
  if (caps.tools === false) warnings.push('outils désactivés')
  if (caps.streaming === false) warnings.push('streaming indisponible')
  if (caps.thinking === false) warnings.push('Think non supporté')
  if (caps.refine === false) warnings.push('raffinage indisponible')
  if (upstreamApi(profile) === GITLAB_CODE_SUGGESTIONS_API) warnings.push('suggestions code uniquement')
  return Array.from(new Set(warnings))
}

function providerUsage(profile, caps = capabilities(profile)) {
  if (profile?.disabled || profile?.quarantinedAt) return PROVIDER_USAGE_DISABLED
  return caps.agent === false ? PROVIDER_USAGE_CODE_SUGGESTIONS : PROVIDER_USAGE_AGENT
}

function isAgentRunnable(profile) {
  return providerUsage(profile) === PROVIDER_USAGE_AGENT
}

function retryCount(profile) {
  const value = Number(profile?.retries)
  if (Number.isFinite(value) && value >= 0) return value
  return shouldUseBufferedUpstream(profile) ? PROVIDER_BUFFERED_RETRIES : PROVIDER_SAME_MODEL_RETRIES
}

function retryDelay(attempt) {
  return Math.min(PROVIDER_RETRY_BASE_DELAY_MS * attempt, 5000)
}

function requestTimeout(profile) {
  const value = Number(profile?.timeoutMs || profile?.requestTimeoutMs)
  const fallback = shouldUseBufferedUpstream(profile) ? PROVIDER_BUFFERED_REQUEST_TIMEOUT_MS : PROVIDER_REQUEST_TIMEOUT_MS
  if (Number.isFinite(value) && value > 0) return Math.min(Math.max(value, 5000), 1800000)
  return fallback
}

function providerCheckTimeout(profile) {
  const value = Number(profile?.checkTimeoutMs || profile?.providerCheckTimeoutMs)
  const fallback = shouldUseBufferedUpstream(profile) ? PROVIDER_BUFFERED_CHECK_TIMEOUT_MS : PROVIDER_CHECK_TIMEOUT_MS
  const runtimeTimeout = requestTimeout(profile)
  if (Number.isFinite(value) && value > 0) return Math.min(Math.max(value, 5000), runtimeTimeout)
  return Math.min(fallback, runtimeTimeout)
}

function maxTokens(profile, requested) {
  const value = Number(profile?.maxTokens || profile?.max_tokens)
  const requestedValue = Number(requested)
  const contextWindow = contextWindowTokens(profile)
  const contextOutputCap = contextWindow ? Math.max(512, Math.floor(contextWindow / 4)) : 0
  const cap = contextOutputCap || Number.MAX_SAFE_INTEGER
  if (Number.isFinite(value) && value > 0) {
    if (Number.isFinite(requestedValue) && requestedValue > 0) return Math.min(requestedValue, value, cap)
    return Math.min(value, cap)
  }
  return Math.min(requested || 4096, cap)
}

function contextWindowTokens(profile) {
  const value = Number(profile?.contextWindowTokens || profile?.contextTokens || profile?.contextWindow || profile?.maxContextTokens)
  if (Number.isFinite(value) && value > 0) return Math.round(value)
  return usesOllama(profile) ? DEFAULT_OLLAMA_CONTEXT_WINDOW_TOKENS : 0
}

function maxInputTokens(profile, outputTokens = 0) {
  const explicit = Number(profile?.maxInputTokens || profile?.inputTokens || profile?.max_input_tokens)
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit)
  const contextWindow = contextWindowTokens(profile)
  if (!contextWindow) return 0
  const output = Number(outputTokens)
  const reservedOutput = Number.isFinite(output) && output > 0 ? output : maxTokens(profile)
  return Math.max(512, contextWindow - reservedOutput)
}

function mergePlainObject(left = {}, right = {}) {
  return {
    ...(left && typeof left === 'object' && !Array.isArray(left) ? left : {}),
    ...(right && typeof right === 'object' && !Array.isArray(right) ? right : {}),
  }
}

function stripReasoningControls(body = {}) {
  const {
    thinking,
    chat_template_kwargs: chatTemplateKwargs,
    include_reasoning: includeReasoning,
    reasoning,
    ...rest
  } = body
  void thinking
  void chatTemplateKwargs
  void includeReasoning
  void reasoning
  return rest
}

function stripThinkingControls(body = {}) {
  const {
    thinking,
    chat_template_kwargs: chatTemplateKwargs,
    ...rest
  } = body
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

function extraBody(profile) {
  const body = profile?.extraBody && typeof profile.extraBody === 'object' && !Array.isArray(profile.extraBody)
    ? profile.extraBody
    : {}
  if (upstreamApi(profile) !== 'openai') return body
  if (usesOpenCodeZen(profile)) return stripReasoningControls(body)
  const caps = capabilities(profile)
  let next = { ...body }
  if (caps.thinking === false) {
    next = stripThinkingControls(next)
  }
  if (caps.reasoningExclude) {
    next = {
      ...next,
      include_reasoning: false,
      reasoning: {
        ...mergePlainObject(next.reasoning),
        exclude: true,
      },
    }
  }
  return next
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stableJson(value[key])
    return acc
  }, {})
}

function profileRevision(profile = {}, config = {}) {
  const caps = capabilities(profile)
  const signature = {
    id: profile.id || '',
    model: profile.model || '',
    baseUrl: baseUrl(profile, config),
    upstreamApi: upstreamApi(profile),
    transport: shouldUseBufferedUpstream(profile) ? 'buffered' : 'stream',
    timeoutMs: requestTimeout(profile),
    checkTimeoutMs: providerCheckTimeout(profile),
    retries: retryCount(profile),
    maxTokens: maxTokens(profile),
    maxInputTokens: maxInputTokens(profile),
    contextWindowTokens: contextWindowTokens(profile),
    noAuth: Boolean(profile.auth === false || profile.noAuth === true),
    disabled: Boolean(profile.disabled || profile.quarantinedAt),
    disabledReason: profile.disabledReason || '',
    quarantinedAt: profile.quarantinedAt || '',
    configured: Boolean(profile.apiKey || profile.apiKeySecret || profile.auth === false || profile.noAuth === true),
    systemPrefix: profile.systemPrefix || '',
    extraBody: extraBody(profile),
    capabilities: caps,
  }
  return crypto.createHash('sha256').update(JSON.stringify(stableJson(signature))).digest('hex').slice(0, 16)
}

function withSystemPrefix(messages, profile) {
  const prefix = String(profile?.systemPrefix || '').trim()
  if (!prefix) return messages
  const [first, ...rest] = messages
  if (first?.role === 'system') return [{ ...first, content: `${prefix}\n\n${first.content || ''}`.trim() }, ...rest]
  return [{ role: 'system', content: prefix }, ...messages]
}

function errorMessage(error) {
  return error?.message || String(error || 'erreur provider')
}

function failureText(profile, error, statusCode = 0) {
  const status = statusCode ? `HTTP ${statusCode}: ` : ''
  return `${name(profile)} (${profile?.model || 'modèle inconnu'}) ne répond pas via ${providerName(profile)}: ${status}${errorMessage(error)}. Aucun autre modèle n'a été utilisé.`
}

function isRetryableFailure(error, statusCode = 0) {
  if (isRateLimitedProviderIssue(errorMessage(error), statusCode)) return false
  if (statusCode === 408 || statusCode === 409 || statusCode >= 500) return true
  const text = errorMessage(error).toLowerCase()
  return ['timeout', 'etimedout', 'econnreset', 'socket hang up', 'network', 'fetch failed'].some(part => text.includes(part))
}

function profileSummary(profile, config) {
  const caps = capabilities(profile)
  return {
    id: profile.id,
    label: profile.label,
    model: profile.model,
    provider: profile.provider,
    providerName: providerName(profile),
    baseUrl: baseUrl(profile, config),
    timeoutMs: requestTimeout(profile),
    checkTimeoutMs: providerCheckTimeout(profile),
    retries: retryCount(profile),
    maxTokens: maxTokens(profile),
    maxInputTokens: maxInputTokens(profile),
    contextWindowTokens: contextWindowTokens(profile),
    upstreamApi: upstreamApi(profile),
    transport: shouldUseBufferedUpstream(profile) ? 'buffered' : 'stream',
    capabilities: caps,
    capabilityWarnings: capabilityWarnings(profile, caps),
    agentRunnable: isAgentRunnable(profile),
    usage: providerUsage(profile, caps),
    disabled: Boolean(profile.disabled || profile.quarantinedAt),
    disabledReason: profile.disabledReason || '',
    quarantinedAt: profile.quarantinedAt || '',
    configured: Boolean(profile.apiKey || profile.auth === false || profile.noAuth === true),
    revision: profileRevision(profile, config),
  }
}

module.exports = {
  DEFAULT_CAPABILITIES,
  DEFAULT_BASE_URL,
  DEFAULT_FAST_MODEL,
  DEFAULT_PROVIDER_NAME,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_CONTEXT_WINDOW_TOKENS,
  DEFAULT_PROVIDER_PROFILES,
  GITLAB_CODE_SUGGESTIONS_API,
  OLLAMA_BASE_URL,
  OLLAMA_PROVIDER_NAME,
  PROVIDER_USAGE_AGENT,
  PROVIDER_USAGE_CODE_SUGGESTIONS,
  PROVIDER_USAGE_DISABLED,
  baseUrl,
  capabilities,
  capabilityWarnings,
  defaultModelForProfiles,
  errorMessage,
  extraBody,
  failureText,
  contextWindowTokens,
  isAgentRunnable,
  isRetryableFailure,
  maxTokens,
  maxInputTokens,
  name,
  normalizeBaseUrl,
  normalizeProviderConfig,
  profileForModel,
  profileRevision,
  providerCheckTimeout,
  profileSummary,
  providerName,
  providerUsage,
  requestTimeout,
  retryCount,
  retryDelay,
  shouldUseBufferedUpstream,
  shouldUseStreamingProviderCheck,
  upstreamApi,
  withSystemPrefix,
}
