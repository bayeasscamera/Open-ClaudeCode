(function () {
  const DEFAULT_CWD = ''
  const DEFAULT_PERMISSION_MODE = 'acceptEdits'
  const PERMISSION_SCHEMA_VERSION = 3
  const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'])
  const MAX_STORED_CHATS = 40
  const MAX_STORED_PROJECTS = 30
  const MAX_PROJECT_FILES = 240
  const MAX_PROJECT_TEXT_CHARS = 16000
  const MAX_PROVIDER_CHECK_HISTORY = 80
  const TEXT_SIZES = new Set(['small', 'medium', 'large'])

  function normalizePathSetting(value) {
    let text = String(value || '').replace(/\u0000/g, '').trim()
    while (/^["'`]/.test(text) || /["'`]$/.test(text)) {
      const next = text.replace(/^["'`]+|["'`]+$/g, '').trim()
      if (next === text) break
      text = next
    }
    return text
  }

  function normalizeAssistant(message) {
    if (message.role !== 'assistant') return message
    const normalized = { ...message }
    if (typeof normalized.content === 'string') {
      normalized.content = normalized.content.replace(/^\[outil\]\s+.+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
    }
    if (normalized.status === 'running') {
      normalized.status = 'done'
      if (!String(normalized.content || '').trim()) normalized.content = 'Session interrompue.'
    }
    return normalized
  }

  function normalizeSettings(savedSettings = {}, defaults = {}) {
    const settings = { ...defaults, ...savedSettings }
    settings.cwd = normalizePathSetting(settings.cwd)
    if (!settings.cwd || settings.cwd.startsWith('/vercel/') || settings.cwd.includes('/sandbox/')) {
      settings.cwd = normalizePathSetting(defaults.cwd) || DEFAULT_CWD
    }
    if (!PERMISSION_MODES.has(settings.permissionMode)) settings.permissionMode = DEFAULT_PERMISSION_MODE
    if (
      !savedSettings.permissionMode ||
      (savedSettings.permissionMode === 'bypassPermissions' && savedSettings.permissionSchemaVersion !== PERMISSION_SCHEMA_VERSION)
    ) {
      settings.permissionMode = DEFAULT_PERMISSION_MODE
    }
    settings.permissionSchemaVersion = PERMISSION_SCHEMA_VERSION
    settings.providerAutoRouterEnabled = Boolean(settings.providerAutoRouterEnabled)
    const autoRouterThreshold = Number(settings.providerAutoRouterThreshold)
    settings.providerAutoRouterThreshold = Number.isFinite(autoRouterThreshold) && autoRouterThreshold >= 1
      ? Math.min(5, Math.round(autoRouterThreshold))
      : 2
    settings.advancedPermissionStrictMode = Boolean(settings.advancedPermissionStrictMode)
    settings.compactMode = Boolean(settings.compactMode)
    settings.inspectorOpen = Boolean(settings.inspectorOpen)
    settings.textSize = TEXT_SIZES.has(settings.textSize) ? settings.textSize : 'medium'
    settings.thinkEnabled = false
    settings.refineModel = String(settings.refineModel || 'qwen/qwen3.5-122b-a10b').trim()
    return settings
  }

  const SECRET_PATTERNS = [
    /\bnvapi-[A-Za-z0-9_-]{12,}\b/g,
    /\bglpat-[A-Za-z0-9._-]{12,}\b/g,
    /\bglft-[A-Za-z0-9._-]{12,}\b/g,
    /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    /\bcfut_[A-Za-z0-9_-]{12,}\b/g,
    /\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    /\b[A-Z0-9_]*(?:api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
    /\b(api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
  ]

  function redactSecrets(value) {
    let text = String(value || '')
    for (const pattern of SECRET_PATTERNS) {
      text = text.replace(pattern, match => {
        const separator = match.match(/\s*[:=]\s*/)
        if (separator && match.toLowerCase().match(/api[_-]?key|access[_-]?token|secret|password/)) {
          const [key] = match.split(separator[0])
          return `${key}${separator[0]}[REDACTED]`
        }
        const prefix = match.startsWith('Bearer ') ? 'Bearer ' : match.startsWith('Token ') ? 'Token ' : ''
        return `${prefix}[REDACTED]`
      })
    }
    return text
  }

  function redactStateSecrets(value) {
    if (typeof value === 'string') return redactSecrets(value)
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(redactStateSecrets)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStateSecrets(item)]))
  }

  function normalizeProviderChecks(checks, now = Date.now()) {
    if (!checks || typeof checks !== 'object') return {}
    const normalized = {}
    for (const [model, check] of Object.entries(checks)) {
      if (!check || typeof check !== 'object') continue
      normalized[model] = {
        ...check,
        model: check.model || model,
        status: check.status === 'checking' ? 'stale' : check.status,
        checkedAt: check.checkedAt || now,
      }
      if (check.status === 'checking') {
        normalized[model].ok = false
        normalized[model].error = 'Test interrompu.'
      }
    }
    return normalized
  }

  function normalizeProviderCheckHistory(history, now = Date.now()) {
    if (!Array.isArray(history)) return []
    const rows = []
    const seen = new Set()
    for (const [index, entry] of history.entries()) {
      if (!entry || typeof entry !== 'object') continue
      const model = String(entry.model || '').trim()
      if (!model) continue
      const checkedAt = Number(entry.checkedAt || entry.createdAt || now - index)
      const cooldownUntil = Number(entry.cooldownUntil || 0)
      const latencyMs = Number(entry.latencyMs)
      const statusCode = Number(entry.statusCode)
      const issue = entry.issue && typeof entry.issue === 'object'
        ? {
            code: String(entry.issue.code || '').trim().slice(0, 80),
            label: String(entry.issue.label || '').trim().slice(0, 120),
            detail: redactSecrets(entry.issue.detail || '').replace(/\s+/g, ' ').trim().slice(0, 500),
          }
        : null
      const row = {
        id: String(entry.id || `${model}:${Number.isFinite(checkedAt) ? checkedAt : now}:${index}`),
        model,
        label: String(entry.label || '').trim().slice(0, 160),
        ok: Boolean(entry.ok),
        status: String(entry.status || (entry.ok ? 'ok' : 'error')).trim().slice(0, 80),
        category: String(entry.category || entry.status || (entry.ok ? 'ok' : 'error')).trim().slice(0, 80),
        latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0 ? Math.round(latencyMs) : 0,
        statusCode: Number.isFinite(statusCode) && statusCode > 0 ? Math.round(statusCode) : 0,
        error: redactSecrets(entry.error || '').replace(/\s+/g, ' ').trim().slice(0, 700),
        hint: redactSecrets(entry.hint || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        warning: redactSecrets(entry.warning || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        issue,
        checkedAt: Number.isFinite(checkedAt) && checkedAt > 0 ? checkedAt : now,
        cooldownUntil: Number.isFinite(cooldownUntil) && cooldownUntil > 0 ? cooldownUntil : 0,
      }
      if (seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
    }
    return rows
      .sort((a, b) => b.checkedAt - a.checkedAt)
      .slice(0, MAX_PROVIDER_CHECK_HISTORY)
  }

  function normalizeLongTasks(tasks, now = Date.now()) {
    if (!Array.isArray(tasks)) return []
    return tasks
      .filter(task => task && typeof task === 'object')
      .map(task => ({
        ...task,
        status: ['starting', 'running'].includes(task.status) ? 'unknown' : task.status || 'unknown',
        updatedAt: task.updatedAt || task.startedAt || now,
      }))
      .slice(-30)
  }

  function normalizeCompanionJobs(jobs, now = Date.now()) {
    if (!Array.isArray(jobs)) return []
    return jobs
      .filter(job => job && typeof job === 'object')
      .map(job => {
        const status = ['queued', 'running'].includes(job.status) ? 'interrupted' : job.status || 'unknown'
        return {
          id: String(job.id || ''),
          taskId: String(job.taskId || job.id || ''),
          assistantId: String(job.assistantId || ''),
          chatId: String(job.chatId || ''),
          title: titleFromPrompt(job.title || job.prompt || 'Tâche OPC'),
          status,
          model: String(job.model || ''),
          cwd: String(job.cwd || ''),
          command: String(job.command || ''),
          phase: String(job.phase || ''),
          summary: String(job.summary || '').replace(/\s+/g, ' ').trim().slice(0, 360),
          result: String(job.result || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
          error: String(job.error || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
          pid: job.pid ? String(job.pid) : '',
          eventCount: Number.isFinite(Number(job.eventCount)) ? Number(job.eventCount) : 0,
          startedAt: job.startedAt || now,
          updatedAt: job.updatedAt || job.startedAt || now,
          endedAt: job.endedAt || '',
        }
      })
      .filter(job => job.id || job.taskId)
      .slice(-60)
  }

  function titleFromPrompt(prompt) {
    const clean = String(prompt || '').replace(/\s+/g, ' ').trim()
    return clean.length > 42 ? `${clean.slice(0, 42)}...` : clean || 'Nouvelle conversation'
  }

  function compactProjectText(value, max = MAX_PROJECT_TEXT_CHARS) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim()
    return text.length > max ? `${text.slice(0, max - 3)}...` : text
  }

  window.OPCStateRules = {
    MAX_STORED_CHATS,
    MAX_STORED_PROJECTS,
    MAX_PROJECT_FILES,
    MAX_PROVIDER_CHECK_HISTORY,
    DEFAULT_PERMISSION_MODE,
    PERMISSION_SCHEMA_VERSION,
    compactProjectText,
    normalizeAssistant,
    normalizePathSetting,
    normalizeSettings,
    normalizeProviderChecks,
    normalizeProviderCheckHistory,
    redactSecrets,
    redactStateSecrets,
    normalizeCompanionJobs,
    normalizeLongTasks,
    titleFromPrompt,
  }
})()
