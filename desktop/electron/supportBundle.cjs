const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { writePrivateJsonFile } = require('./persistence/privateJsonFile.cjs')
const { stateRepositorySchema } = require('./persistence/stateSchema.cjs')
const { redactDeep } = require('./redaction.cjs')

function safeCall(fn, fallback = null) {
  try {
    return typeof fn === 'function' ? fn() : fallback
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
}

function redactValue(value, depth = 0) {
  return redactDeep(value, {}, depth)
}

function supportBundleName(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `opc-support-bundle-${stamp}.json`
}

function percentile(values, ratio) {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function providerTelemetryFromState(state = {}) {
  const current = Object.values(state.providerChecks || {}).filter(item => item && typeof item === 'object')
  const history = Array.isArray(state.providerCheckHistory) ? state.providerCheckHistory.filter(item => item && typeof item === 'object') : []
  const byId = new Map()
  for (const row of [...history, ...current]) {
    const key = row.id || `${row.model || 'model'}:${row.checkedAt || row.status || byId.size}`
    if (!byId.has(key)) byId.set(key, row)
  }
  const rows = Array.from(byId.values()).slice(0, 120)
  const latencies = rows.map(row => Number(row.latencyMs)).filter(value => Number.isFinite(value) && value >= 0)
  const buckets = rows.reduce((acc, row) => {
    const key = row.category || row.status || (row.ok ? 'ok' : 'error')
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  return {
    checks: rows.length,
    ok: rows.filter(row => row.ok).length,
    failed: rows.filter(row => row.ok === false).length,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0,
    p95LatencyMs: percentile(latencies, 0.95),
    maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
    buckets,
  }
}

function runtimeTelemetry(status = {}) {
  const runs = [status.active, ...(Array.isArray(status.tracked) ? status.tracked : [])].filter(Boolean)
  const firstTextValues = runs.map(run => Number(run.firstTextMs)).filter(value => Number.isFinite(value) && value > 0)
  return {
    active: Boolean(status.active),
    tracked: Array.isArray(status.tracked) ? status.tracked.length : 0,
    firstTextMs: firstTextValues.length ? Math.min(...firstTextValues) : Number(status.active?.firstTextMs || 0) || 0,
    providerElapsedMs: Number(status.active?.providerElapsedMs || 0) || 0,
    toolCount: Number(status.active?.toolCount || 0) || 0,
  }
}

function agentLedgerTelemetry(state = {}) {
  const rows = Array.isArray(state.agentTaskLedger) ? state.agentTaskLedger.filter(row => row && typeof row === 'object') : []
  const statuses = rows.reduce((acc, row) => {
    const status = row.status || 'unknown'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})
  const eventCount = rows.reduce((sum, row) => sum + (Array.isArray(row.events) ? row.events.length : 0), 0)
  return {
    total: rows.length,
    statuses,
    pendingVerification: rows.filter(row => row.status === 'needs_verification' || row.status === 'running').length,
    verified: statuses.verified || 0,
    eventCount,
  }
}

function agentWorkerTelemetry(state = {}) {
  const rows = Array.isArray(state.agentWorkers) ? state.agentWorkers.filter(row => row && typeof row === 'object') : []
  const statuses = rows.reduce((acc, row) => {
    const status = row.status || 'unknown'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})
  const phases = rows.reduce((acc, row) => {
    const phase = row.phase || 'unknown'
    acc[phase] = (acc[phase] || 0) + 1
    return acc
  }, {})
  return {
    total: rows.length,
    active: rows.filter(row => ['queued', 'running', 'needs_verification'].includes(row.status)).length,
    blocked: rows.filter(row => row.status === 'blocked').length,
    verified: statuses.verified || 0,
    interrupted: statuses.interrupted || 0,
    statuses,
    phases,
  }
}

function collectContextBudgets(state = {}) {
  const budgets = []
  for (const chat of Array.isArray(state.chats) ? state.chats : []) {
    for (const message of Array.isArray(chat?.messages) ? chat.messages : []) {
      const budget = message?.projectRuntimeContext?.contextBudget || message?.contextBudget
      if (budget && typeof budget === 'object') budgets.push(budget)
    }
  }
  return budgets
}

function contextBudgetTelemetry(state = {}) {
  const budgets = collectContextBudgets(state)
  const beforeValues = budgets.map(row => Number(row.beforeChars)).filter(Number.isFinite)
  const afterValues = budgets.map(row => Number(row.afterChars)).filter(Number.isFinite)
  const savedChars = budgets.reduce((sum, row) => {
    const before = Number(row.beforeChars)
    const after = Number(row.afterChars)
    return Number.isFinite(before) && Number.isFinite(after) && before > after ? sum + (before - after) : sum
  }, 0)
  return {
    samples: budgets.length,
    compacted: budgets.filter(row => row.compacted).length,
    maxBeforeChars: beforeValues.length ? Math.max(...beforeValues) : 0,
    maxAfterChars: afterValues.length ? Math.max(...afterValues) : 0,
    savedChars,
  }
}

function providerProfiles(config = {}) {
  if (Array.isArray(config.profiles)) return config.profiles.filter(row => row && typeof row === 'object')
  if (config.profiles && typeof config.profiles === 'object') {
    return Object.values(config.profiles).filter(row => row && typeof row === 'object')
  }
  if (Array.isArray(config.providers)) return config.providers.filter(row => row && typeof row === 'object')
  return []
}

function providerRoutingTelemetry(config = {}) {
  const profiles = providerProfiles(config)
  const enabled = profiles.filter(profile => profile.enabled !== false && profile.paused !== true)
  const agentProfiles = profiles.filter(profile => (
    profile.agent === true ||
    profile.mode === 'agent' ||
    profile.role === 'agent' ||
    profile.capabilities?.tools === true ||
    profile.tools === true
  ))
  return {
    profiles: profiles.length,
    enabled: enabled.length,
    disabled: profiles.length - enabled.length,
    agentProfiles: agentProfiles.length,
    streaming: profiles.filter(profile => profile.streaming === true || profile.capabilities?.streaming === true).length,
    maxInputTokens: profiles.reduce((max, profile) => {
      const value = Number(profile.maxInputTokens || profile.contextWindow || profile.inputTokens || 0)
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0),
  }
}

function valueFrom(value, fallback = '') {
  try {
    if (typeof value === 'function') return value() || fallback
    return value || fallback
  } catch {
    return fallback
  }
}

function fileSummary(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return null
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    }
  } catch {
    return null
  }
}

function recentFiles(dir, { limit = 8 } = {}) {
  try {
    return fs.readdirSync(dir)
      .map(name => fileSummary(path.join(dir, name)))
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
      .slice(0, limit)
  } catch {
    return []
  }
}

function fileTail(filePath, { maxBytes = 48 * 1024 } = {}) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return ''
    const bytes = Math.min(maxBytes, stat.size)
    const fd = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(bytes)
      fs.readSync(fd, buffer, 0, bytes, Math.max(0, stat.size - bytes))
      return buffer.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

function runtimeArtifacts({ logsDir = '', crashDir = '' } = {}) {
  const logsPath = valueFrom(logsDir, '')
  const crashPath = valueFrom(crashDir, path.join(os.tmpdir(), 'opc-desktop-crashes'))
  return {
    logs: {
      path: logsPath,
      files: logsPath ? recentFiles(logsPath) : [],
      desktopLogTail: logsPath ? fileTail(path.join(logsPath, 'desktop.log')) : '',
    },
    crashes: {
      path: crashPath,
      files: crashPath ? recentFiles(crashPath) : [],
    },
  }
}

function buildSupportBundle({
  cliRunner,
  crashDir,
  providerConfigStore,
  logsDir,
  memoryStore,
  desktopStateStore,
  projectRoot,
}, payload = {}) {
  const desktopState = safeCall(() => desktopStateStore.read?.() || {}, {})
  const runtime = safeCall(() => cliRunner.runtimeStatus?.() || {}, {})
  const providers = safeCall(() => providerConfigStore.exportConfig?.() || providerConfigStore.editableConfig?.() || {}, {})
  const bundle = {
    version: 2,
    generatedAt: new Date().toISOString(),
    app: {
      name: 'OPC Desktop',
      projectRoot: safeCall(projectRoot, ''),
    },
    persistence: {
      ...stateRepositorySchema(),
      runtime: safeCall(() => desktopStateStore.info?.() || {}, {}),
    },
    platform: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      release: os.release(),
    },
    context: {
      cwd: payload.cwd || '',
      model: payload.model || '',
    },
    cli: safeCall(() => cliRunner.version()),
    runtime,
    runtimeArtifacts: runtimeArtifacts({ logsDir, crashDir }),
    telemetry: {
      provider: providerTelemetryFromState(desktopState.state || {}),
      runtime: runtimeTelemetry(runtime),
      agentLedger: agentLedgerTelemetry(desktopState.state || {}),
      agentWorkers: agentWorkerTelemetry(desktopState.state || {}),
      contextBudget: contextBudgetTelemetry(desktopState.state || {}),
      providerRouting: providerRoutingTelemetry(providers),
    },
    memory: safeCall(() => memoryStore.info()),
    providers,
    providerEvents: safeCall(() => providerConfigStore.providerEvents?.({ limit: 80 }) || []),
    desktopState,
    doctor: {
      report: payload.report || null,
    },
  }
  return redactValue(bundle)
}

async function exportSupportBundle(deps, payload = {}) {
  const { dialog } = deps
  if (!dialog?.showSaveDialog) return { ok: false, error: 'Export support indisponible.' }
  const result = await dialog.showSaveDialog({
    title: 'Exporter un bundle support OPC',
    defaultPath: supportBundleName(),
    filters: [{ name: 'Bundle support OPC', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { ok: true, canceled: true }
  try {
    const bundle = buildSupportBundle(deps, payload)
    writePrivateJsonFile(result.filePath, bundle)
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, path: result.filePath, error: error.message || String(error) }
  }
}

module.exports = {
  agentLedgerTelemetry,
  agentWorkerTelemetry,
  buildSupportBundle,
  contextBudgetTelemetry,
  exportSupportBundle,
  providerRoutingTelemetry,
  providerTelemetryFromState,
  redactValue,
  runtimeArtifacts,
  runtimeTelemetry,
  supportBundleName,
}
