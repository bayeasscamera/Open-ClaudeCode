const fs = require('node:fs')
const path = require('node:path')

const MAX_PROMPT_CHARS = 500000
const MAX_STRING_CHARS = 4096
const MAX_TASKS = 20
const MAX_SERVICES_PER_TASK = 20
const MAX_PROJECT_CONTEXT_FILES = 20
const TRUSTED_BYPASS_COMMANDS = [
  'pnpm tools-dev start',
  'pnpm tools-dev run web',
  'pnpm tools-dev dev',
  'npm run dev',
  'npm run start',
  'pnpm dev',
  'pnpm start',
]
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'])
const BYPASS_PERMISSION_MODES = new Set(['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'])
const COMMAND_INTENT_SOURCES = new Set(['prompt', 'tool-history', 'message-intent'])
const STATE_SEARCH_TYPES = new Set(['messages', 'project_files'])

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
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function normalizePermissionMode(value) {
  const mode = text(value, 40)
  return PERMISSION_MODES.has(mode) ? mode : 'default'
}

function normalizeAllowedTools(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => text(item, 1000))
    .filter(Boolean)
    .slice(0, 80)
}

function uniqueTools(value) {
  return Array.from(new Set(value.filter(Boolean)))
}

function normalizeCommand(value) {
  return text(value, 1000)
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

function validateCommandIntent(value, permissionMode = 'default') {
  const input = record(value)
  const command = normalizeCommand(input.command)
  if (!command) return null
  const source = text(input.source, 40)
  const allowRules = commandAllowRules(command)
  const trusted = Boolean(trustedBypassCommand(command))
  return {
    version: 1,
    command,
    source: COMMAND_INTENT_SOURCES.has(source) ? source : 'prompt',
    reason: text(input.reason, 240),
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

function normalizeProjectRuntimeFile(value) {
  const input = record(value)
  const path = text(input.path, MAX_STRING_CHARS)
  if (!path) return null
  return {
    id: text(input.id, 120),
    name: text(input.name || path, 240),
    path,
    role: text(input.role, 40),
    summary: text(input.summary, 1200),
    snippets: Array.isArray(input.snippets) ? input.snippets.map(item => text(item, 300)).filter(Boolean).slice(0, 4) : [],
    keywords: Array.isArray(input.keywords) ? input.keywords.map(item => text(item, 80)).filter(Boolean).slice(0, 10) : [],
    headings: Array.isArray(input.headings) ? input.headings.map(item => text(item, 180)).filter(Boolean).slice(0, 6) : [],
    indexedAt: text(input.indexedAt, 120),
    error: text(input.error, 400),
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
  const projectId = text(input.projectId, 120)
  const projectName = text(input.projectName, 240)
  const attachedFiles = normalizeProjectRuntimeFiles(input.attachedFiles)
  const readNextFiles = normalizeProjectRuntimeFiles(input.readNextFiles)
  const relevantFiles = normalizeProjectRuntimeFiles(input.relevantFiles)
  if (!projectId && !projectName && !attachedFiles.length && !readNextFiles.length && !relevantFiles.length) return null
  return {
    version: 1,
    generatedAt: text(input.generatedAt, 120),
    query: text(input.query, 600),
    projectId,
    projectName,
    description: text(input.description, 800),
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
  if (!prompt) throw new Error('Prompt vide.')
  const payload = {
    taskId: text(input.taskId, 120),
    assistantId: text(input.assistantId, 120),
    chatId: text(input.chatId, 120),
    prompt,
    displayPrompt: text(input.displayPrompt || prompt, MAX_PROMPT_CHARS),
    cwd: pathText(input.cwd, MAX_STRING_CHARS),
    model: text(input.model, 256),
    permissionMode: normalizePermissionMode(input.permissionMode),
    sessionId: text(input.sessionId, 256),
    trustedWorkspaceRoot: pathText(input.trustedWorkspaceRoot, MAX_STRING_CHARS),
    workspaceTrusted: false,
    allowedTools: normalizeAllowedTools(input.allowedTools),
    skipPermissions: false,
    memoryEnabled: input.memoryEnabled !== false,
    bare: input.bare !== false,
    effort: text(input.effort, 40),
    maxTurns: text(input.maxTurns, 20),
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
  const model = text(record(value).model, 256)
  return { model }
}

function validateProviderDiscoveryPayload(value) {
  const input = record(value)
  return {
    model: text(input.model || input.sourceModel, 256),
    baseUrl: text(input.baseUrl, MAX_STRING_CHARS),
    providerName: text(input.providerName || input.provider, 256),
    upstreamApi: text(input.upstreamApi, 80),
    transport: text(input.transport, 40),
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
    ? input.models.map(item => text(item, 256)).filter(Boolean).slice(0, 80)
    : [text(input.model || input.id, 256)].filter(Boolean)
  return {
    models,
    reason: text(input.reason, 1000),
  }
}

function validateDoctorPayload(value) {
  const input = record(value)
  return {
    cwd: pathText(input.cwd, MAX_STRING_CHARS),
    model: text(input.model, 256),
  }
}

function validateStateSearchPayload(value) {
  const input = record(value)
  const type = text(input.type, 40)
  return {
    type: STATE_SEARCH_TYPES.has(type) ? type : 'messages',
    query: text(input.query, 1000),
    limit: Math.max(1, Math.min(50, Number(input.limit) || 10)),
    chatId: text(input.chatId, 160),
  }
}

function validateRefinePromptPayload(value) {
  const input = record(value)
  const prompt = text(input.prompt, 20000)
  if (!prompt) throw new Error('Prompt vide.')
  return {
    prompt,
    model: text(input.model, 256),
  }
}

function validateKillPidPayload(value) {
  const input = record(value)
  const pid = Number(input.pid)
  if (!Number.isInteger(pid) || pid <= 1 || pid > Number.MAX_SAFE_INTEGER) return { pid: 0 }
  const command = normalizeCommand(input.command)
  return {
    pid,
    taskId: text(input.taskId, 120),
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
    name: text(input.name, 80),
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
        id: text(input.id, 120),
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
}
