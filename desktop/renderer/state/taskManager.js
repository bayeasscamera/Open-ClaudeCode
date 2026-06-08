(function () {
  const SERVER_COMMAND_RE = /\b(pnpm|npm|yarn|bun)\s+([^;&|]*\s)?(dev|start|serve|web)\b|\b(next|vite|astro|nuxt)\s+dev\b/i
  const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\]|[A-Za-z0-9.-]+):\d+[^\s)"']*/g
  const PID_RE = /\b(?:pid|PID|process id)\D{0,28}(\d{2,})\b/
  const LOG_RE = /\b(?:log(?:s)?|journal)\b[:=\s-]{0,20}((?:\.|~|\/)[^\s`'")]+)/i
  const BLOCK_AFTER_MS = 45000
  const REUSE_WINDOW_MS = 30 * 60 * 1000

  function compact(value, max = 96) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, Math.floor((max - 3) / 2))}...${text.slice(-Math.floor((max - 3) / 2))}`
  }

  function normalizeCommand(command) {
    return String(command || '')
      .replace(/^Commande:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function isLongRunningCommand(command) {
    return SERVER_COMMAND_RE.test(String(command || ''))
  }

  function commandFromTool(tool) {
    if (!tool || tool.name !== 'Bash') return ''
    return normalizeCommand(tool.command || tool.target || tool.detail)
  }

  function taskAgeMs(task) {
    return Math.max(0, Date.now() - Number(task?.startedAt || task?.updatedAt || Date.now()))
  }

  function localUrl(url) {
    return /:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\])(?::\d+)/i.test(String(url || ''))
  }

  function extractPort(value) {
    const match = String(value || '').match(/:(\d{2,5})(?:\/|$)/)
    return match ? Number(match[1]) : 0
  }

  function serviceNameForPort(port) {
    if (port === 7456) return 'daemon'
    if (port === 18000) return 'web'
    return port ? `port-${port}` : 'service'
  }

  function normalizeService(service) {
    if (!service || typeof service !== 'object') return null
    const url = String(service.url || '').trim()
    const port = Number(service.port || extractPort(url) || 0)
    const name = String(service.name || '').trim() || serviceNameForPort(port)
    if (!name && !url && !port) return null
    return {
      name,
      port: Number.isInteger(port) && port > 0 ? port : 0,
      url,
      ready: service.ready === true,
      status: service.status || '',
      statusCode: Number(service.statusCode || 0),
      error: String(service.error || ''),
    }
  }

  function serviceKey(service) {
    const normalized = normalizeService(service)
    if (!normalized) return ''
    return `${normalized.name}|${normalized.port}|${normalized.url}`
  }

  function mergeServices(existing = [], incoming = []) {
    const merged = new Map()
    for (const source of [...existing, ...incoming]) {
      const normalized = normalizeService(source)
      if (!normalized) continue
      const samePortKey = normalized.port ? `port:${normalized.port}` : ''
      const sameUrlKey = normalized.url ? `url:${normalized.url}` : ''
      const preferredKey = samePortKey || sameUrlKey || serviceKey(normalized)
      const current = merged.get(preferredKey) || {}
      merged.set(preferredKey, {
        ...current,
        ...normalized,
        name: normalized.name || current.name || serviceNameForPort(normalized.port),
        port: normalized.port || current.port || 0,
        url: normalized.url || current.url || '',
        ready: normalized.ready || current.ready || false,
        status: normalized.status || current.status || (normalized.ready || current.ready ? 'ready' : ''),
        statusCode: normalized.statusCode || current.statusCode || 0,
        error: normalized.error || current.error || '',
      })
    }
    return Array.from(merged.values())
  }

  function inferServices(command, text = '') {
    const normalized = normalizeCommand(command).toLowerCase()
    let services = []
    if (
      /^(pnpm|npm|yarn|bun)\s+tools-dev\s+(start|run web|dev)\b/.test(normalized)
    ) {
      services = mergeServices(services, [
        { name: 'daemon', port: 7456, url: 'http://127.0.0.1:7456' },
        { name: 'web', port: 18000, url: 'http://127.0.0.1:18000' },
      ])
    }
    const urls = String(`${command}\n${text}`).match(URL_RE) || []
    services = mergeServices(
      services,
      urls
        .map(url => url.replace(/[.,;]+$/, ''))
        .map(url => (localUrl(url) ? { name: serviceNameForPort(extractPort(url)), url, port: extractPort(url) } : null))
        .filter(Boolean),
    )
    return services
  }

  function summarizeServices(services = []) {
    return services
      .map(service => {
        const port = service.port ? `:${service.port}` : ''
        const state = service.ready ? 'pret' : service.error ? service.error : 'off'
        return `${service.name}${port} ${state}`
      })
      .join(' · ')
  }

  function normalizeTasks(tasks) {
    if (!Array.isArray(tasks)) return []
    return tasks
      .filter(task => task && typeof task === 'object')
      .map(task => {
        const services = mergeServices(task.services, task.url ? [{ url: task.url, port: extractPort(task.url), name: serviceNameForPort(extractPort(task.url)) }] : [])
        return {
          ...task,
          command: normalizeCommand(task.command),
          services,
          serviceSummary: task.serviceSummary || summarizeServices(services),
          status: ['starting', 'running'].includes(task.status) ? 'unknown' : task.status || 'unknown',
          updatedAt: task.updatedAt || task.startedAt || Date.now(),
        }
      })
      .slice(-30)
  }

  function findReusableTask(tasks, command, cwd = '') {
    const normalizedCommand = normalizeCommand(command)
    if (!normalizedCommand) return null
    return (tasks || []).find(task => {
      if (normalizeCommand(task.command) !== normalizedCommand) return false
      if (cwd && task.cwd && task.cwd !== cwd) return false
      if (!['observed', 'starting', 'running', 'ready'].includes(task.status || '')) return false
      if (taskAgeMs(task) > REUSE_WINDOW_MS && !task.pid && !task.url) return false
      return true
    }) || null
  }

  function ensureTask(tasks, context) {
    const command = normalizeCommand(context.command)
    if (!isLongRunningCommand(command)) return null
    const existing = tasks.find(item => item.key === context.toolId) || findReusableTask(tasks, command, context.cwd) || tasks.find(item => item.assistantId === context.assistantId && normalizeCommand(item.command) === command)
    if (existing) {
      existing.key = existing.key || context.toolId || existing.id
      existing.chatId = context.chatId || existing.chatId || ''
      existing.assistantId = context.assistantId || existing.assistantId || ''
      existing.cwd = context.cwd || existing.cwd || ''
      existing.command = command
      existing.services = mergeServices(existing.services, inferServices(command))
      existing.serviceSummary = summarizeServices(existing.services)
      existing.updatedAt = Date.now()
      return existing
    }
    const services = inferServices(command)
    const task = {
      id: context.id || `long_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      key: context.toolId || `${context.assistantId}:${command}`,
      chatId: context.chatId || '',
      assistantId: context.assistantId || '',
      command,
      cwd: context.cwd || '',
      status: 'observed',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      pid: '',
      url: '',
      logPath: '',
      services,
      serviceSummary: summarizeServices(services),
    }
    tasks.unshift(task)
    return task
  }

  function syncFromAssistant(tasks, assistant, chat) {
    if (!assistant?.tools?.length) return []
    const touched = []
    for (const tool of assistant.tools) {
      const command = commandFromTool(tool)
      const task = ensureTask(tasks, {
        toolId: tool.id,
        chatId: chat?.id,
        assistantId: assistant.id,
        command,
        cwd: assistant.diagnostics?.cwd || assistant.cwd,
      })
      if (task) touched.push(task)
    }
    return touched
  }

  function updateFromText(task, text) {
    if (!task) return task
    const raw = String(text || '')
    if (!raw.trim()) return task
    const urls = raw.match(URL_RE)
    const pidMatch = raw.match(PID_RE)
    const logMatch = raw.match(LOG_RE)
    if (pidMatch) task.pid = pidMatch[1]
    if (urls?.length) task.url = urls[urls.length - 1].replace(/[.,;]+$/, '')
    if (logMatch) task.logPath = logMatch[1].replace(/[.,;]+$/, '')
    task.services = mergeServices(task.services, inferServices(task.command, raw))
    if (/\b(ready|listening|started|running|local:|serveur|demarr)\b/i.test(raw)) task.status = 'running'
    if (/\b(error|failed|eaddrinuse|crash|killed|stopped|arrete)\b/i.test(raw)) task.status = 'error'
    if ((task.pid || task.url) && task.status === 'observed') task.status = 'running'
    task.serviceSummary = summarizeServices(task.services)
    task.lastOutput = compact(raw, 180)
    task.updatedAt = Date.now()
    return task
  }

  function updateRelated(tasks, assistant, text) {
    const related = tasks.filter(task => task.assistantId === assistant?.id)
    for (const task of related) updateFromText(task, text)
    return related
  }

  function applyProbeResult(tasks, result) {
    const task = tasks.find(item => item.id === result?.id)
    if (!task) return null
    task.services = mergeServices(task.services, result.services)
    const readyServices = task.services.filter(service => service.ready)
    if (!task.url) {
      const preferred = readyServices.find(service => service.url) || task.services.find(service => service.url)
      if (preferred?.url) task.url = preferred.url
    }
    if (!['error', 'stopped', 'stopping'].includes(task.status || '')) {
      if (result.ready) task.status = 'ready'
      else if (readyServices.length) task.status = 'running'
      else if (task.services.length && taskAgeMs(task) >= BLOCK_AFTER_MS) task.status = 'blocked'
    }
    task.serviceSummary = summarizeServices(task.services)
    task.lastProbeAt = result.checkedAt || Date.now()
    task.updatedAt = Date.now()
    return task
  }

  function probePayload(tasks) {
    return (tasks || [])
      .filter(task => task && !['error', 'stopped', 'stopping'].includes(task.status || ''))
      .filter(task => (Array.isArray(task.services) && task.services.length) || task.url)
      .map(task => ({
        id: task.id,
        services: mergeServices(task.services, task.url ? [{ url: task.url, port: extractPort(task.url), name: serviceNameForPort(extractPort(task.url)) }] : []),
      }))
  }

  function mark(tasks, id, patch) {
    const task = tasks.find(item => item.id === id)
    if (!task) return null
    Object.assign(task, patch, { updatedAt: Date.now() })
    task.services = mergeServices(task.services)
    task.serviceSummary = summarizeServices(task.services)
    return task
  }

  window.OPCTaskManager = {
    applyProbeResult,
    commandFromTool,
    ensureTask,
    findReusableTask,
    inferServices,
    isLongRunningCommand,
    mark,
    normalizeTasks,
    probePayload,
    syncFromAssistant,
    taskAgeMs,
    updateFromText,
    updateRelated,
  }
})()
