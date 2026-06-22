const fs = require('node:fs')
const path = require('node:path')
const {
  BYPASS_PERMISSION_MODES,
  COMMAND_INTENT_SOURCES,
  DEFAULT_PERMISSION_MODE,
  LOCAL_HTTP_HOSTNAMES,
  MAX_ALLOWED_TOOLS,
  MAX_BUDGET_USD,
  MAX_COMMAND_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_ERROR_CHARS,
  MAX_HEADING_CHARS,
  MAX_HEADINGS,
  MAX_INDEXED_AT_CHARS,
  MAX_KEYWORDS,
  MAX_KEYWORD_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_MEDIUM_TEXT_CHARS,
  MAX_MODEL_CHARS,
  MAX_PAUSE_MODELS,
  MAX_PROJECT_CONTEXT_FILES,
  MAX_PROMPT_CHARS,
  MAX_QUERY_CHARS,
  MAX_REASON_CHARS,
  MAX_REFINE_PROMPT_CHARS,
  MAX_SERVICES_PER_TASK,
  MAX_SERVICE_NAME_CHARS,
  MAX_SHORT_ID_CHARS,
  MAX_SNIPPETS,
  MAX_SNIPPET_CHARS,
  MAX_STRING_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_TASKS,
  MAX_TAG_CHARS,
  MAX_TOOL_NAME_CHARS,
  MAX_TURNS,
  PERMISSION_MODES,
  PID_MAX,
  PID_MIN,
  STATE_SEARCH_DEFAULT_LIMIT,
  STATE_SEARCH_LIMIT_MAX,
  STATE_SEARCH_LIMIT_MIN,
  STATE_SEARCH_TYPES,
  TRUSTED_BYPASS_COMMANDS,
} = require('./ipcValidation.constants.cjs')

function text(value, max = MAX_STRING_CHARS) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .slice(0, max)
    .trim()
}

function pathText(value, max = MAX_STRING_CHARS) {
  let normalized = text(value, max)
  while (/^["'`]/.test(normalized) || /["'`]$/.test(normalized)) {
    const next = normalized.replace(/^["'`]+|["'`]+$/g, '').trim()
    if (next === normalized) break
    normalized = next
  }
  return normalized
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isSafeHttpUrl(value, { localOnly = false } = {}) {
  try {
    const url = new URL(String(value || ''))
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (!localOnly) return true
    return LOCAL_HTTP_HOSTNAMES.includes(url.hostname)
  } catch {
    return false
  }
}

function normalizePermissionMode(value) {
  const mode = text(value, MAX_TAG_CHARS)
  return PERMISSION_MODES.has(mode) ? mode : DEFAULT_PERMISSION_MODE
}

function normalizeAllowedTools(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => text(item, MAX_TOOL_NAME_CHARS))
    .filter(Boolean)
    .slice(0, MAX_ALLOWED_TOOLS)
}

function uniqueTools(value) {
  return Array.from(new Set(value.filter(Boolean)))
}

function normalizeCommand(value) {
  return text(value, MAX_COMMAND_CHARS)
    .replace(/^Commande:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trustedBypassCommand(command) {
  const normalized = normalizeCommand(command)
  return TRUSTED_BYPASS_COMMANDS.find(item => normalized === item || normalized.startsWith(`${item} `)) || ''
}

function isLongRunningCommand(command) {
  const normalized = normalizeCommand(command)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return /\b(pnpm|npm|yarn|bun)\s+([^;&|]*\s)?(dev|start|serve|web)\b/.test(normalized) || /\b(next|vite|astro|nuxt)\s+dev\b/.test(normalized)
}

function commandAllowRules(command) {
  const normalized = normalizeCommand(command)
  if (!normalized) return []
  const rules = new Set([`Bash(${normalized})`])
  if (trustedBypassCommand(normalized)) {
    rules.add(`Bash(${normalized} *)`)
    rules.add(`Bash(nohup ${normalized} *)`)
    rules.add(`Bash(cd * && ${normalized} *)`)
  }
  return Array.from(rules)
}

function validateCommandIntent(value, permissionMode = DEFAULT_PERMISSION_MODE) {
  const input = record(value)
  const command = normalizeCommand(input.command)
  if (!command) return null
  const source = text(input.source, MAX_TAG_CHARS)
  const allowRules = commandAllowRules(command)
  const trusted = Boolean(trustedBypassCommand(command))
  return {
    version: 1,
    command,
    source: COMMAND_INTENT_SOURCES.has(source) ? source : 'prompt',
    reason: text(input.reason, MAX_REASON_CHARS),
    trusted,
    longRunning: isLongRunningCommand(command),
    permissionMode,
    allowRules,
    allowedTools: [...allowRules, 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    skipPermissions: Boolean(trusted && BYPASS_PERMISSION_MODES.has(permissionMode)),
  }
}

function allowedToolsForIntent(intent, allowedTools) {
  if (!intent?.command) return allowedTools
  const nonBashTools = allowedTools.filter(tool => tool !== 'Bash' && !tool.startsWith('Bash('))
  return uniqueTools([...intent.allowRules, ...nonBashTools])
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

// Clamp maxTurns to a sane integer range. Claude Code rejects >999 turns;
// we cap at MAX_TURNS to keep the value predictable across providers. Null/undefined/NaN
// resolve to null so the CLI can omit --max-turns entirely.
function normalizeMaxTurns(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(Math.floor(parsed), MAX_TURNS)
}

// Bound maxBudgetUsd to a positive finite USD value, capped to avoid
// pathological inputs (e.g. Number.MAX_VALUE). Null/undefined/NaN/<=0 resolve
// to null so the CLI can omit --max-budget-tokens entirely.
function normalizeMaxBudgetUsd(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(parsed, MAX_BUDGET_USD)
}

function normalizeProjectRuntimeFile(value) {
  const input = record(value)
  const path = text(input.path, MAX_STRING_CHARS)
  if (!path) return null
  return {
    id: text(input.id, MAX_SHORT_ID_CHARS),
    name: text(input.name || path, MAX_MEDIUM_TEXT_CHARS),
    path,
    role: text(input.role, MAX_TAG_CHARS),
    summary: text(input.summary, MAX_SUMMARY_CHARS),
    snippets: Array.isArray(input.snippets) ? input.snippets.map(item => text(item, MAX_SNIPPET_CHARS)).filter(Boolean).slice(0, MAX_SNIPPETS) : [],
    keywords: Array.isArray(input.keywords) ? input.keywords.map(item => text(item, MAX_KEYWORD_CHARS)).filter(Boolean).slice(0, MAX_KEYWORDS) : [],
    headings: Array.isArray(input.headings) ? input.headings.map(item => text(item, MAX_HEADING_CHARS)).filter(Boolean).slice(0, MAX_HEADINGS) : [],
    indexedAt: text(input.indexedAt, MAX_INDEXED_AT_CHARS),
    error: text(input.error, MAX_ERROR_CHARS),
    lineCount: number(input.lineCount),
    wordCount: number(input.wordCount),
    score: number(input.score),
    readNext: Boolean(input.readNext),
  }
}

function normalizeProjectRuntimeFiles(value) {
  if (!Array.isArray(value)) return []
  return value.map(normalizeProjectRuntimeFile).filter(Boolean).slice(0, MAX_PROJECT_CONTEXT_FILES)
}

function validateProjectRuntimeContext(value) {
  const input = record(value)
  const projectId = text(input.projectId, MAX_SHORT_ID_CHARS)
  const projectName = text(input.projectName, MAX_MEDIUM_TEXT_CHARS)
  const attachedFiles = normalizeProjectRuntimeFiles(input.attachedFiles)
  const readNextFiles = normalizeProjectRuntimeFiles(input.readNextFiles)
  const relevantFiles = normalizeProjectRuntimeFiles(input.relevantFiles)
  if (!projectId && !projectName && !attachedFiles.length && !readNextFiles.length && !relevantFiles.length) return null
  return {
    version: 1,
    generatedAt: text(input.generatedAt, MAX_INDEXED_AT_CHARS),
    query: text(input.query, MAX_QUERY_CHARS),
    projectId,
    projectName,
    description: text(input.description, MAX_DESCRIPTION_CHARS),
    memoryChars: number(input.memoryChars),
    instructionChars: number(input.instructionChars),
    totalFiles: number(input.totalFiles),
    indexedFiles: number(input.indexedFiles),
    staleFiles: number(input.staleFiles),
    attachedFiles,
    readNextFiles,
    relevantFiles,
  }
}

function normalizeWorkspacePath(value) {
  const normalized = pathText(value, MAX_STRING_CHARS)
  if (!normalized) return ''
  try {
    return path.resolve(normalized)
  } catch {
    return ''
  }
}

function realWorkspacePath(value) {
  const normalized = normalizeWorkspacePath(value)
  if (!normalized) return ''
  try {
    return fs.realpathSync(normalized)
  } catch {
    return ''
  }
}

function workspaceTrustAllowed(cwd, trustedWorkspaceRoot) {
  const root = realWorkspacePath(trustedWorkspaceRoot)
  const target = realWorkspacePath(cwd)
  if (!root || !target) return false
  if (root === path.parse(root).root) return false
  const relative = path.relative(root, target)
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function trustedBypassAllowed(payload) {
  if (!payload.workspaceTrusted) return false
  if (payload.permissionMode === 'bypassPermissions') return true
  if (!BYPASS_PERMISSION_MODES.has(payload.permissionMode)) return false
  return Boolean(payload.commandIntent?.trusted)
}

function validateRunPayload(value) {
  const input = record(value)
  const prompt = text(input.prompt, MAX_PROMPT_CHARS)
  if (!prompt && !input.sessionId) throw new Error('Prompt vide.')
  const payload = {
    taskId: text(input.taskId, MAX_SHORT_ID_CHARS),
    assistantId: text(input.assistantId, MAX_SHORT_ID_CHARS),
    chatId: text(input.chatId, MAX_SHORT_ID_CHARS),
    prompt,
    displayPrompt: text(input.displayPrompt || prompt, MAX_PROMPT_CHARS),
    cwd: pathText(input.cwd, MAX_STRING_CHARS),
    model: text(input.model, MAX_MODEL_CHARS),
    permissionMode: normalizePermissionMode(input.permissionMode),
    sessionId: text(input.sessionId, MAX_LONG_TEXT_CHARS),
    trustedWorkspaceRoot: pathText(input.trustedWorkspaceRoot, MAX_STRING_CHARS),
    workspaceTrusted: false,
    allowedTools: normalizeAllowedTools(input.allowedTools),
    skipPermissions: false,
    memoryEnabled: input.memoryEnabled !== false,
    bare: input.bare !== false,
    effort: text(input.effort, MAX_TAG_CHARS),
    maxTurns: normalizeMaxTurns(input.maxTurns),
    maxBudgetUsd: normalizeMaxBudgetUsd(input.maxBudgetUsd),
    settingsPath: '',
    projectRuntimeContext: validateProjectRuntimeContext(input.projectRuntimeContext),
  }
  payload.settingsPath = validateSettingsPath(input.settingsPath, payload.cwd)
  payload.commandIntent = validateCommandIntent(input.commandIntent, payload.permissionMode)
  payload.allowedTools = allowedToolsForIntent(payload.commandIntent, payload.allowedTools)
  payload.workspaceTrusted = workspaceTrustAllowed(payload.cwd, payload.trustedWorkspaceRoot)
  payload.skipPermissions = Boolean(input.skipPermissions && trustedBypassAllowed(payload))
  return payload
}

function validateSettingsPath(value, cwd) {
  const requested = pathText(value, MAX_STRING_CHARS)
  if (!requested) return ''
  try {
    if (!path.isAbsolute(requested)) return ''
    if (!cwd || !fs.existsSync(cwd)) return ''
    const realSettings = fs.realpathSync(requested)
    const realCwd = fs.realpathSync(cwd)
    const relative = path.relative(realCwd, realSettings)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return ''
    const stat = fs.statSync(realSettings)
    if (!stat.isFile()) return ''
    return realSettings
  } catch {
    return ''
  }
}

function validateProviderCheckPayload(value) {
  const model = text(record(value).model, MAX_MODEL_CHARS)
  return { model }
}

function validateProviderDiscoveryPayload(value) {
  const input = record(value)
  return {
    model: text(input.model || input.sourceModel, MAX_MODEL_CHARS),
    baseUrl: text(input.baseUrl, MAX_STRING_CHARS),
    providerName: text(input.providerName || input.provider, MAX_MODEL_CHARS),
    upstreamApi: text(input.upstreamApi, MAX_KEYWORD_CHARS),
    transport: text(input.transport, MAX_TAG_CHARS),
    timeoutMs: number(input.timeoutMs),
    checkTimeoutMs: number(input.checkTimeoutMs),
    retries: number(input.retries),
    maxTokens: number(input.maxTokens),
    apiKey: text(input.apiKey, MAX_STRING_CHARS),
    noAuth: Boolean(input.noAuth),
    capabilities: record(input.capabilities),
    import: input.import !== false,
  }
}

function validateProviderPausePayload(value) {
  const input = record(value)
  const models = Array.isArray(input.models)
    ? input.models.map(item => text(item, MAX_MODEL_CHARS)).filter(Boolean).slice(0, MAX_PAUSE_MODELS)
    : [text(input.model || input.id, MAX_MODEL_CHARS)].filter(Boolean)
  return {
    models,
    reason: text(input.reason, MAX_COMMAND_CHARS),
  }
}

function validateDoctorPayload(value) {
  const input = record(value)
  return {
    cwd: pathText(input.cwd, MAX_STRING_CHARS),
    model: text(input.model, MAX_MODEL_CHARS),
  }
}

function validateStateSearchPayload(value) {
  const input = record(value)
  const type = text(input.type, MAX_TAG_CHARS)
  return {
    type: STATE_SEARCH_TYPES.has(type) ? type : 'messages',
    query: text(input.query, MAX_COMMAND_CHARS),
    limit: Math.max(STATE_SEARCH_LIMIT_MIN, Math.min(STATE_SEARCH_LIMIT_MAX, Number(input.limit) || STATE_SEARCH_DEFAULT_LIMIT)),
    chatId: text(input.chatId, MAX_MEDIUM_TEXT_CHARS),
  }
}

function validateRefinePromptPayload(value) {
  const input = record(value)
  const prompt = text(input.prompt, MAX_REFINE_PROMPT_CHARS)
  if (!prompt) throw new Error('Prompt vide.')
  return {
    prompt,
    model: text(input.model, MAX_MODEL_CHARS),
  }
}

function validateKillPidPayload(value) {
  const input = record(value)
  const pid = Number(input.pid)
  if (!Number.isInteger(pid) || pid <= PID_MIN || pid > PID_MAX) return { pid: 0 }
  const command = normalizeCommand(input.command)
  return {
    pid,
    taskId: text(input.taskId, MAX_SHORT_ID_CHARS),
    command,
    cwd: pathText(input.cwd, MAX_STRING_CHARS),
    longRunning: isLongRunningCommand(command),
  }
}

function validateOpenPathTarget(value, fallbackPath) {
  const requested = pathText(value, MAX_STRING_CHARS)
  if (requested && isSafeHttpUrl(requested, { localOnly: true })) {
    return { kind: 'url', target: requested }
  }
  if (/^https?:\/\//i.test(requested)) {
    return { kind: 'error', target: requested, error: 'Seules les URLs locales peuvent être ouvertes depuis OPC.' }
  }
  if (requested && fs.existsSync(requested)) return { kind: 'path', target: requested }
  return { kind: 'path', target: fallbackPath }
}

function normalizeService(service) {
  const input = record(service)
  const url = text(input.url, MAX_STRING_CHARS)
  const port = Number(input.port)
  const normalized = {
    name: text(input.name, MAX_SERVICE_NAME_CHARS),
    url: '',
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
  }
  if (url && isSafeHttpUrl(url, { localOnly: true })) normalized.url = url
  if (!normalized.port && normalized.url) {
    try {
      const parsed = new URL(normalized.url)
      normalized.port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
    } catch {
      normalized.port = 0
    }
  }
  return normalized.port || normalized.url ? normalized : null
}

function validateProbeServicesPayload(value) {
  const tasks = Array.isArray(record(value).tasks) ? record(value).tasks : []
  return {
    tasks: tasks.slice(0, MAX_TASKS).map(task => {
      const input = record(task)
      return {
        id: text(input.id, MAX_SHORT_ID_CHARS),
        services: (Array.isArray(input.services) ? input.services : [])
          .slice(0, MAX_SERVICES_PER_TASK)
          .map(normalizeService)
          .filter(Boolean),
      }
    }).filter(task => task.id && task.services.length),
  }
}

module.exports = {
  isLongRunningCommand,
  isSafeHttpUrl,
  validateDoctorPayload,
  validateKillPidPayload,
  validateOpenPathTarget,
  validateProbeServicesPayload,
  validateProviderCheckPayload,
  validateProviderDiscoveryPayload,
  validateProviderPausePayload,
  validateRefinePromptPayload,
  validateStateSearchPayload,
  workspaceTrustAllowed,
  validateCommandIntent,
  validateProjectRuntimeContext,
  validateRunPayload,
  // Re-export constants for callers / tests that want to align bounds
  // with what the IPC layer actually enforces.
  BYPASS_PERMISSION_MODES,
  COMMAND_INTENT_SOURCES,
  DEFAULT_PERMISSION_MODE,
  LOCAL_HTTP_HOSTNAMES,
  MAX_ALLOWED_TOOLS,
  MAX_BUDGET_USD,
  MAX_COMMAND_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_ERROR_CHARS,
  MAX_HEADING_CHARS,
  MAX_HEADINGS,
  MAX_INDEXED_AT_CHARS,
  MAX_KEYWORDS,
  MAX_KEYWORD_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_MEDIUM_TEXT_CHARS,
  MAX_MODEL_CHARS,
  MAX_PAUSE_MODELS,
  MAX_PROJECT_CONTEXT_FILES,
  MAX_PROMPT_CHARS,
  MAX_QUERY_CHARS,
  MAX_REASON_CHARS,
  MAX_REFINE_PROMPT_CHARS,
  MAX_SERVICES_PER_TASK,
  MAX_SERVICE_NAME_CHARS,
  MAX_SHORT_ID_CHARS,
  MAX_SNIPPETS,
  MAX_SNIPPET_CHARS,
  MAX_STRING_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_TASKS,
  MAX_TAG_CHARS,
  MAX_TOOL_NAME_CHARS,
  MAX_TURNS,
  PERMISSION_MODES,
  PID_MAX,
  PID_MIN,
  STATE_SEARCH_DEFAULT_LIMIT,
  STATE_SEARCH_LIMIT_MAX,
  STATE_SEARCH_LIMIT_MIN,
  STATE_SEARCH_TYPES,
  TRUSTED_BYPASS_COMMANDS,
}
