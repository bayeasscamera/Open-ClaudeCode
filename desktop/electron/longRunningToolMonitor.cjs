const DEFAULT_IDLE_TIMEOUT_MS = 300000
const DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS = 1800000
const MAX_TOOL_IDLE_TIMEOUT_MS = 7200000
const DEFAULT_HEARTBEAT_MS = 60000

const KIND_RULES = [
  {
    kind: 'download',
    label: 'Telechargement long',
    pattern: /(?:\bdownload(?:\b|_)|\bhf_hub_download\b|\bhuggingface\b|\bgit\s+lfs\b|\bwget\b|\bcurl\b|\baria2c\b)/i,
  },
  {
    kind: 'install',
    label: 'Installation longue',
    pattern: /(?:\bpip\s+install\b|\bnpm\s+(?:install|ci)\b|\bpnpm\s+install\b|\byarn\s+install\b|\bbrew\s+install\b)/i,
  },
  {
    kind: 'build',
    label: 'Build long',
    pattern: /(?:\bnpm\s+run\s+build\b|\bpnpm\s+(?:run\s+)?build\b|\byarn\s+(?:run\s+)?build\b|\bxcodebuild\b|\belectron-builder\b|\bcargo\s+build\b|\bswift\s+build\b)/i,
  },
  {
    kind: 'server',
    label: 'Serveur local',
    pattern: /(?:\bnpm\s+run\s+dev\b|\bpnpm\s+(?:run\s+)?dev\b|\byarn\s+(?:run\s+)?dev\b|\bvite\b|\bnext\s+dev\b|\buvicorn\b|\bpython(?:3)?\s+-m\s+http\.server\b)/i,
  },
]

function clampTimeout(value, { baseMs = DEFAULT_IDLE_TIMEOUT_MS, maxMs = MAX_TOOL_IDLE_TIMEOUT_MS } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(Math.max(Math.round(number), baseMs), maxMs)
}

function commandText(toolOrCommand = {}) {
  if (typeof toolOrCommand === 'string') return toolOrCommand
  return String(toolOrCommand.target || toolOrCommand.command || toolOrCommand.detail || '')
}

function isShellTool(tool = {}) {
  return /bash|shell/i.test(String(tool.name || ''))
}

function matchKind(command = '') {
  const text = String(command || '')
  return KIND_RULES.find(rule => rule.pattern.test(text)) || null
}

function commandLooksLongRunning(command = '') {
  return Boolean(matchKind(command))
}

function classifyLongRunningTool(toolOrCommand = {}, {
  baseMs = DEFAULT_IDLE_TIMEOUT_MS,
  longMs = DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS,
  maxMs = MAX_TOOL_IDLE_TIMEOUT_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
} = {}) {
  const command = commandText(toolOrCommand)
  const tool = typeof toolOrCommand === 'object' && toolOrCommand ? toolOrCommand : {}
  const shell = isShellTool(tool)
  const matched = shell ? matchKind(command) : null
  const requested = clampTimeout(tool.timeoutMs || tool.timeout, { baseMs, maxMs })
  const longRunning = Boolean(shell && (matched || requested > baseMs))
  const timeoutMs = longRunning
    ? Math.max(baseMs, requested || longMs)
    : baseMs
  return {
    longRunning,
    kind: matched?.kind || (longRunning ? 'generic' : 'standard'),
    label: matched?.label || (longRunning ? 'Commande longue' : 'Commande standard'),
    command,
    idleTimeoutMs: Math.min(timeoutMs, maxMs),
    heartbeatMs: longRunning ? Math.max(15000, Math.min(Number(heartbeatMs) || DEFAULT_HEARTBEAT_MS, Math.floor(timeoutMs / 2))) : 0,
  }
}

function toolIdleTimeoutMs(tool = {}, options = {}) {
  return classifyLongRunningTool(tool, options).idleTimeoutMs
}

function heartbeatEventForTool(classification = {}, { idleMs = 0, taskId = '' } = {}) {
  const seconds = Math.max(1, Math.round(Number(idleMs || 0) / 1000))
  const label = classification.label || 'Commande longue'
  return {
    type: 'tool_heartbeat',
    taskId,
    toolKind: classification.kind || 'generic',
    message: `${label}: toujours actif depuis ${seconds}s sans sortie CLI.`,
    idleMs: Math.max(0, Math.round(Number(idleMs || 0))),
  }
}

module.exports = {
  classifyLongRunningTool,
  commandLooksLongRunning,
  heartbeatEventForTool,
  toolIdleTimeoutMs,
}
