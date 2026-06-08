const { killProcessTree, processTreePids } = require('./processControl.cjs')

const MAX_RECENT_EVENTS = 16

const PHASE_LABELS = {
  idle: 'Inactif',
  starting: 'Démarrage CLI',
  provider: 'Provider',
  streaming: 'Flux modèle',
  tool: 'Outil actif',
  finishing: 'Finalisation',
  stopping: 'Arrêt',
  finished: 'Terminé',
  error: 'Erreur',
}

function phaseLabel(phase) {
  return PHASE_LABELS[phase] || PHASE_LABELS.idle
}

function compact(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.floor((max - 3) / 2))}...${text.slice(-Math.floor((max - 3) / 2))}`
}

function decodeJsonStringFragment(value) {
  try {
    return JSON.parse(`"${value}"`)
  } catch {
    return String(value || '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

function extractPartialJsonString(raw, key) {
  const match = String(raw || '').match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`))
  return match ? decodeJsonStringFragment(match[1]) : ''
}

function extractPartialJsonNumber(raw, key) {
  const match = String(raw || '').match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`))
  return match ? Number(match[1]) : 0
}

function parseInput(input) {
  if (!input) return {}
  if (typeof input === 'object') return input
  try {
    return JSON.parse(String(input))
  } catch {
    const parsed = {}
    for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
      const value = extractPartialJsonString(input, key)
      if (value) parsed[key] = value
    }
    for (const key of ['timeout', 'timeoutMs', 'timeout_ms']) {
      const value = extractPartialJsonNumber(input, key)
      if (value) parsed[key] = value
    }
    return parsed
  }
}

function toolTarget(input) {
  return compact(input.command || input.file_path || input.path || input.query || input.url || input.pattern || input.description || '', 120)
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      if (block.type === 'text') return block.text || ''
      return ''
    })
    .join('')
}

function createRuntimeSupervisor({ log = () => {}, now = () => Date.now() } = {}) {
  const runs = new Map()
  let activeId = ''

  function runId(run) {
    return String(run?.taskId || run?.child?.pid || '')
  }

  function runtime(run) {
    run.supervisorRuntime ||= {
      phase: 'starting',
      statusText: 'Initialisation du CLI',
      eventCount: 0,
      providerEventCount: 0,
      toolCount: 0,
      recentEvents: [],
      toolPartials: {},
    }
    return run.supervisorRuntime
  }

  function pushEvent(run, event) {
    const state = runtime(run)
    const item = {
      at: now(),
      type: event.type || 'event',
      label: compact(event.label || event.type || 'Activité', 64),
      detail: compact(event.detail || '', 160),
    }
    state.recentEvents.push(item)
    state.recentEvents = state.recentEvents.slice(-MAX_RECENT_EVENTS)
    state.lastEvent = item
    state.statusText = item.detail || item.label
    run.supervisorUpdatedAt = item.at
    run.lastActivityAt = item.at
    return item
  }

  function transition(run, phase, statusText = '') {
    if (!run) return snapshot(null)
    const state = runtime(run)
    state.phase = phase || state.phase || 'running'
    if (statusText) state.statusText = compact(statusText, 180)
    run.supervisorUpdatedAt = now()
    return snapshot(run)
  }

  function recordTool(run, block = {}, partial = '') {
    const state = runtime(run)
    const name = block.name || block.tool_name || state.currentTool?.name || 'outil'
    const index = block.streamIndex ?? block.index
    if (partial && index !== undefined) {
      state.toolPartials[index] = `${state.toolPartials[index] || ''}${partial}`
    }
    const input = parseInput(block.input || block.arguments || (index !== undefined ? state.toolPartials[index] : ''))
    const target = toolTarget(input)
    const detail = target ? `${name}: ${target}` : name
    const timeoutMs = Number(input.timeoutMs || input.timeout_ms || input.timeout || 0)
    state.phase = 'tool'
    state.toolCount += block.isNew === false ? 0 : 1
    state.firstToolAt ||= now()
    state.currentTool = {
      id: block.id || state.currentTool?.id || '',
      name,
      target,
      detail,
      index,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(0, Math.round(timeoutMs)) : 0,
    }
    pushEvent(run, { type: 'tool', label: name, detail })
    return { emit: true, phase: 'tool', force: true }
  }

  function toolBlocks(event) {
    if (!event || typeof event !== 'object') return []
    if (event.type === 'assistant') {
      const content = event.message?.content || event.content || []
      return Array.isArray(content) ? content.filter(block => block?.type === 'tool_use').map(block => ({ ...block, isNew: true })) : []
    }
    if (event.type === 'stream_event' && event.event?.type === 'content_block_start') {
      const block = event.event.content_block
      return block?.type === 'tool_use' ? [{ ...block, streamIndex: event.event.index, isNew: true }] : []
    }
    return []
  }

  function textFromEvent(event) {
    if (!event || typeof event !== 'object') return ''
    if (event.type === 'result') return event.result || event.text || ''
    if (event.type === 'assistant') return contentText(event.message?.content || event.content)
    if (event.type === 'stdout') return event.text || ''
    const inner = event.type === 'stream_event' ? event.event : event
    if (inner?.type === 'content_block_delta') return inner.delta?.text || ''
    if (inner?.type === 'message_delta') return inner.delta?.text || ''
    return ''
  }

  function recordEvent(run, event) {
    if (!run || !event || typeof event !== 'object') return { emit: false }
    const state = runtime(run)
    state.eventCount += 1

    if (event.type === 'provider_status') {
      state.providerEventCount += 1
      state.phase = 'provider'
      state.providerStatus = compact(event.message || 'Provider en cours', 180)
      state.providerElapsedMs = event.elapsedMs || state.providerElapsedMs
      state.providerAttempt = event.attempt || state.providerAttempt
      state.providerMaxRetries = event.maxRetries
      if (event.model) state.model = event.model
      pushEvent(run, { type: 'provider', label: 'Provider', detail: state.providerStatus })
      return { emit: true, phase: 'provider', force: true }
    }

    const blocks = toolBlocks(event)
    if (blocks.length) {
      let change = { emit: false }
      for (const block of blocks) change = recordTool(run, block)
      return change
    }

    const inner = event.type === 'stream_event' ? event.event : event
    if (inner?.type === 'content_block_delta' && inner.delta?.type === 'input_json_delta') {
      const tool = state.currentTool && state.currentTool.index === inner.index
        ? { ...state.currentTool, isNew: false }
        : { name: 'outil', index: inner.index, isNew: false }
      return recordTool(run, tool, inner.delta.partial_json || '')
    }

    const text = textFromEvent(event)
    if (text) {
      state.phase = event.type === 'result' ? 'finishing' : 'streaming'
      state.firstTextAt ||= now()
      pushEvent(run, { type: event.type === 'result' ? 'result' : 'stream', label: event.type === 'result' ? 'Résultat' : 'Flux', detail: compact(text, 140) })
      const firstTextEmit = !state.firstRuntimeTextEmitted
      state.firstRuntimeTextEmitted = true
      return { emit: firstTextEmit || event.type === 'result', phase: state.phase, force: event.type === 'result' }
    }

    if (event.type === 'stderr' || event.type === 'error') {
      state.phase = event.type === 'error' ? 'error' : state.phase
      pushEvent(run, { type: event.type, label: event.type === 'error' ? 'Erreur' : 'Log', detail: event.message || event.text || '' })
      return { emit: true, phase: state.phase, force: event.type === 'error' }
    }

    if (event.type === 'system' && event.subtype === 'init') {
      state.phase = 'starting'
      state.model = event.model || state.model
      state.sessionId = event.session_id || state.sessionId
      pushEvent(run, { type: 'system', label: 'Session', detail: event.model || event.cwd || 'Initialisation' })
      return { emit: true, phase: 'starting', force: true }
    }

    pushEvent(run, { type: event.type || 'event', label: event.type || 'Activité', detail: event.message || event.text || '' })
    return { emit: false, phase: state.phase }
  }

  function snapshot(run) {
    if (!run) {
      return {
        active: false,
        taskId: '',
        pid: 0,
        status: 'idle',
        phase: 'idle',
        phaseLabel: phaseLabel('idle'),
        statusText: '',
        children: [],
        updatedAt: now(),
      }
    }
    const pid = Number(run.child?.pid || run.pid || 0)
    const state = runtime(run)
    const updatedAt = run.supervisorUpdatedAt || now()
    const startedAt = run.startedAt || 0
    const durationMs = run.finished ? Math.max(0, updatedAt - startedAt) : Math.max(0, now() - startedAt)
    const idleMs = run.lastActivityAt ? Math.max(0, now() - run.lastActivityAt) : 0
    return {
      active: runId(run) === activeId && !run.finished,
      taskId: run.taskId || '',
      pid,
      status: run.supervisorStatus || (run.finished ? 'finished' : 'running'),
      phase: state.phase || 'running',
      phaseLabel: phaseLabel(state.phase || 'running'),
      statusText: state.statusText || '',
      reason: run.finishReason || '',
      children: pid ? processTreePids(pid).filter(value => value !== pid) : [],
      startedAt,
      lastActivityAt: run.lastActivityAt || 0,
      updatedAt,
      durationMs,
      idleMs,
      model: state.model || run.model || '',
      cwd: run.cwd || '',
      memoryEnabled: Boolean(run.memoryEnabled),
      eventCount: state.eventCount || 0,
      providerEventCount: state.providerEventCount || 0,
      providerStatus: state.providerStatus || '',
      providerElapsedMs: state.providerElapsedMs || 0,
      providerAttempt: state.providerAttempt || 0,
      providerMaxRetries: state.providerMaxRetries,
      toolCount: state.toolCount || 0,
      currentTool: state.currentTool || null,
      firstTextAt: state.firstTextAt || 0,
      firstTextMs: state.firstTextAt && startedAt ? state.firstTextAt - startedAt : 0,
      firstToolAt: state.firstToolAt || 0,
      recentEvents: [...(state.recentEvents || [])],
    }
  }

  function track(run) {
    const id = runId(run)
    if (!id) return snapshot(run)
    activeId = id
    run.supervisorStatus = 'running'
    run.supervisorUpdatedAt = now()
    run.lastActivityAt ||= now()
    const state = runtime(run)
    state.phase = 'starting'
    state.statusText = 'CLI lancé, attente de la session'
    state.model = run.model || state.model
    pushEvent(run, { type: 'start', label: 'CLI', detail: `PID ${run.child?.pid || run.pid || '-'}` })
    runs.set(id, run)
    return snapshot(run)
  }

  function markFinishing(run, reason = '') {
    if (!run) return snapshot(null)
    run.supervisorStatus = 'finishing'
    run.finishReason = reason || run.finishReason || ''
    transition(run, 'finishing', reason ? `Finalisation: ${reason}` : 'Finalisation')
    pushEvent(run, { type: 'finishing', label: 'Finalisation', detail: reason })
    run.supervisorUpdatedAt = now()
    return snapshot(run)
  }

  function finish(run, reason = '') {
    if (!run) return snapshot(null)
    run.supervisorStatus = 'finished'
    run.finishReason = reason || run.finishReason || ''
    transition(run, 'finished', reason ? `Terminé: ${reason}` : 'Terminé')
    pushEvent(run, { type: 'finished', label: 'Terminé', detail: reason })
    run.supervisorUpdatedAt = now()
    if (runId(run) === activeId) activeId = ''
    return snapshot(run)
  }

  function stop(run, reason = 'stop', options = {}) {
    if (!run?.child?.pid) return { ok: false, error: 'Aucun process CLI actif.' }
    markFinishing(run, reason)
    transition(run, 'stopping', reason ? `Arrêt: ${reason}` : 'Arrêt')
    const result = killProcessTree(run.child.pid, {
      processGroup: run.processGroup !== false,
      softKillTimeoutMs: options.softKillTimeoutMs || 1500,
    })
    log(`Runtime supervisor stop reason=${reason} pid=${run.child.pid} ok=${result.ok} children=${(result.children || []).join(',')}`)
    return result
  }

  function cleanup(options = {}) {
    const results = []
    for (const run of runs.values()) {
      if (!run?.child?.pid) continue
      const status = snapshot(run)
      if (status.children.length || status.status === 'finishing' || options.force) {
        results.push({ taskId: run.taskId || '', ...stop(run, options.reason || 'cleanup', options) })
      }
    }
    return results
  }

  function status() {
    const active = activeId ? runs.get(activeId) : null
    return {
      active: snapshot(active),
      tracked: Array.from(runs.values()).map(snapshot).slice(-20),
    }
  }

  return {
    cleanup,
    finish,
    markFinishing,
    recordEvent,
    snapshot,
    status,
    stop,
    track,
    transition,
  }
}

module.exports = { createRuntimeSupervisor }
