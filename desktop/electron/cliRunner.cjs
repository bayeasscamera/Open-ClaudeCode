const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRuntimeSupervisor } = require('./runtimeSupervisor.cjs')
const { compactEvent, extractRunResult } = require('./cliEventParser.cjs')
const longRunningToolMonitor = require('./longRunningToolMonitor.cjs')
const {
  BUNDLED_PLUGIN_NAMES,
  CLI_VERSION_PROBE_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_LOCAL_CWD,
  DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS,
  EXIT_CODE_IDLE_TIMEOUT,
  EXIT_CODE_USER_STOP,
  IDLE_CHECK_INTERVAL_MS,
  IDLE_TIMEOUT_MAX_MS,
  IDLE_TIMEOUT_MIN_MS,
  LINGER_KILL_DELAY_MS,
  LINGER_KILL_SOFT_KILL_MS,
  LINGER_TERM_DELAY_MS,
  LINGER_TERM_SOFT_KILL_MS,
  MAX_STDERR_CHARS,
  MAX_STDERR_EVENT_CHARS,
  MAX_STDOUT_CHARS,
  MAX_TOOL_IDLE_TIMEOUT_MS,
  RUNTIME_ACTIVITY_MIN_INTERVAL_MS,
} = require('./cliRunner.constants.cjs')

function isSandboxCwd(value) {
  return typeof value === 'string' && (value.startsWith('/vercel/') || value.includes('/sandbox/'))
}

function stripPathShellQuotes(value) {
  let text = String(value || '').replace(/\u0000/g, '').trim()
  while (/^["'`]/.test(text) || /["'`]$/.test(text)) {
    const next = text.replace(/^["'`]+|["'`]+$/g, '').trim()
    if (next === text) break
    text = next
  }
  return text
}

function expandHome(value) {
  const text = stripPathShellQuotes(value)
  if (text === '~') return os.homedir()
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2))
  return text
}

function resolveCwd(requested, fallback) {
  const candidate = expandHome(requested)
  if (candidate && !isSandboxCwd(candidate) && fs.existsSync(candidate)) {
    const stat = fs.statSync(candidate)
    if (stat.isDirectory()) return candidate
    if (stat.isFile()) return path.dirname(candidate)
  }
  if (DEFAULT_LOCAL_CWD && fs.existsSync(DEFAULT_LOCAL_CWD)) return DEFAULT_LOCAL_CWD
  return fallback()
}

function bundledPluginDirs(root) {
  return BUNDLED_PLUGIN_NAMES
    .map(name => path.join(root, 'plugins', name))
    .filter(pluginDir => fs.existsSync(path.join(pluginDir, '.claude-plugin', 'plugin.json')))
}

function profileMatchesSelection(profile, selected) {
  return Boolean(!selected || profile?.model === selected || profile?.id === selected)
}

function runIdleTimeoutMs(env = process.env) {
  const value = Number(env.OPC_DESKTOP_IDLE_TIMEOUT_MS)
  if (Number.isFinite(value) && value > 0) {
    return Math.min(Math.max(value, IDLE_TIMEOUT_MIN_MS), IDLE_TIMEOUT_MAX_MS)
  }
  return DEFAULT_IDLE_TIMEOUT_MS
}

function longToolIdleTimeoutMs(env = process.env) {
  const value = Number(env.OPC_DESKTOP_LONG_TOOL_IDLE_TIMEOUT_MS)
  if (Number.isFinite(value) && value > 0) return Math.min(Math.max(value, DEFAULT_IDLE_TIMEOUT_MS), MAX_TOOL_IDLE_TIMEOUT_MS)
  return DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS
}

function commandLooksLongRunning(command = '') {
  return longRunningToolMonitor.commandLooksLongRunning(command)
}

function classifyLongRunningTool(tool = {}, { baseMs = runIdleTimeoutMs(), env = process.env } = {}) {
  return longRunningToolMonitor.classifyLongRunningTool(tool, {
    baseMs,
    longMs: longToolIdleTimeoutMs(env),
    maxMs: MAX_TOOL_IDLE_TIMEOUT_MS,
  })
}

function toolIdleTimeoutMs(tool = {}, { baseMs = runIdleTimeoutMs(), env = process.env } = {}) {
  return classifyLongRunningTool(tool, { baseMs, env }).idleTimeoutMs
}

function findNode() {
  const candidates = [
    process.env.OPC_NODE,
    process.env.NODE_BINARY,
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    'node',
  ].filter(Boolean)

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    if (probe.status === 0) return candidate
  }
  return 'node'
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  return env
}

function appendBoundedText(current, next, maxChars) {
  const text = `${current || ''}${next || ''}`
  if (text.length <= maxChars) return text
  return text.slice(-maxChars)
}

function tailText(value, maxChars = MAX_STDERR_EVENT_CHARS) {
  const text = String(value || '').trim()
  if (text.length <= maxChars) return text
  return `...${text.slice(-(maxChars - 3))}`
}

function sanitizeArgs(args) {
  const sanitized = []
  for (let index = 0; index < args.length; index += 1) {
    sanitized.push(args[index])
    if ((args[index] === '-p' || args[index] === '--print') && index + 1 < args.length) {
      sanitized.push('[OPC_PROMPT]')
      index += 1
    } else if (args[index] === '--append-system-prompt' && index + 1 < args.length) {
      sanitized.push('[OPC_MEMORY]')
      index += 1
    }
  }
  return sanitized
}

function createCliRunner({ projectRoot, cliPath, providerBridge, providerConfig, memoryStore, sessionStore, log, send }) {
  let activeRun = null
  const supervisor = createRuntimeSupervisor({ log })

  function sendRuntime(run, phase, patch = {}) {
    const snapshot = supervisor.snapshot(run)
    send('opc:runtime', {
      ...snapshot,
      phase: phase || snapshot.phase,
      ...patch,
    })
  }

  function sendRuntimeActivity(run, change = {}) {
    if (!run || run.finished) return
    const snapshot = supervisor.snapshot(run)
    const now = Date.now()
    const phaseChanged = snapshot.phase && snapshot.phase !== run.lastRuntimePhase
    const stale = now - (run.lastRuntimeEmitAt || 0) >= RUNTIME_ACTIVITY_MIN_INTERVAL_MS
    if (!change.force && !change.emit && !phaseChanged && !stale) return
    run.lastRuntimePhase = snapshot.phase
    run.lastRuntimeEmitAt = now
    sendRuntime(run, snapshot.phase)
  }

  // Sprint 4 / H2: cancel pending linger timers so we don't keep refs to the
  // run past `finishRun` and don't wake up useless timers on an already
  // closed child.
  function clearLingerTimers(run) {
    if (!run || !run.lingerTimers) return
    for (const handle of run.lingerTimers) clearTimeout(handle)
    run.lingerTimers = null
  }

  function finishRun(run, code, reason) {
    if (!run || run.finished) return null
    run.finished = true
    if (run.idleTimer) clearInterval(run.idleTimer)
    clearLingerTimers(run)
    if (activeRun === run) activeRun = null
    const durationMs = Date.now() - run.startedAt
    const result = extractRunResult(run.stdout)
    const stdout = tailText(run.stdout)
    const stderr = tailText(run.stderr)
    memoryStore.recordRun(run, code, durationMs, result)
    // Mark session status in sessionStore.
    // Only user-initiated stops and idle timeouts are "interrupted" — a
    // natural CLI failure (code != 0 with reason='close') is NOT resumable,
    // because the underlying session state is unknown / corrupt. Marking it
    // interrupted would make the banner propose "reprendre" a session whose
    // resume would just re-fail.
    if (sessionStore && run.sessionId) {
      const wasInterrupted = reason === 'stopped' || reason === 'idle-timeout'
      if (wasInterrupted) {
        sessionStore.markInterrupted(run.sessionId)
      } else {
        sessionStore.markCompleted(run.sessionId)
      }
    }
    supervisor.finish(run, reason)
    sendRuntime(run, 'finished', { code, durationMs, reason })
    send('opc:run-end', { code, durationMs, reason, taskId: run.taskId, result, stdout, stderr })
    log(`OPC CLI finished reason=${reason} code=${code} durationMs=${durationMs}`)
    return { code, durationMs, reason }
  }

  function markActivity(run = activeRun) {
    if (run && !run.finished) run.lastActivityAt = Date.now()
  }

  function startIdleWatchdog(run) {
    const baseTimeoutMs = runIdleTimeoutMs()
    run.idleTimeoutMs = baseTimeoutMs
    run.lastActivityAt = Date.now()
    run.idleTimer = setInterval(() => {
      if (!run || run.finished) return
      const timeoutMs = Number(run.idleTimeoutMs || baseTimeoutMs)
      const idleMs = Date.now() - run.lastActivityAt
      const classification = run.longRunningTool
      if (
        classification?.longRunning &&
        idleMs >= Number(classification.heartbeatMs || 0) &&
        Date.now() - Number(run.lastHeartbeatAt || 0) >= Number(classification.heartbeatMs || 0)
      ) {
        run.lastHeartbeatAt = Date.now()
        const event = longRunningToolMonitor.heartbeatEventForTool(classification, { idleMs, taskId: run.taskId })
        send('opc:event', event)
        sendRuntime(run, 'tool', {
          status: 'running',
          statusText: event.message,
          idleMs,
          longRunningTool: classification,
        })
      }
      if (idleMs < timeoutMs) return
      send('opc:event', {
        type: 'error',
        message: `Aucune activité CLI depuis ${Math.round(idleMs / 1000)}s. Tâche arrêtée pour libérer OPC Desktop.`,
        taskId: run.taskId,
      })
      supervisor.stop(run, 'idle-timeout')
      finishRun(run, EXIT_CODE_IDLE_TIMEOUT, 'idle-timeout')
      stopLingeringRun(run)
    }, IDLE_CHECK_INTERVAL_MS)
  }

  function extendIdleWatchdogForTool(run, tool = {}) {
    if (!run || run.finished || !tool) return
    const classification = classifyLongRunningTool(tool, { baseMs: runIdleTimeoutMs() })
    run.longRunningTool = classification.longRunning ? classification : null
    const nextTimeoutMs = classification.idleTimeoutMs
    if (nextTimeoutMs <= Number(run.idleTimeoutMs || 0)) return
    run.idleTimeoutMs = nextTimeoutMs
    log(`OPC idle watchdog extended to ${Math.round(nextTimeoutMs / 1000)}s for ${tool.name || 'tool'} ${tool.target || ''}`.trim())
  }

  // Sprint 4 / H2: store timer handles on the run so `finishRun` can cancel
  // them once the child actually exits, preventing leaked closures and
  // useless wake-ups on already-dead children.
  function stopLingeringRun(run) {
    if (!run || run.lingerTimers) return
    run.lingerTimers = [
      setTimeout(() => {
        if (run?.child?.exitCode === null && run?.child?.signalCode === null) {
          supervisor.stop(run, 'linger-term', { softKillTimeoutMs: LINGER_TERM_SOFT_KILL_MS })
        }
      }, LINGER_TERM_DELAY_MS),
      setTimeout(() => {
        if (run?.child?.exitCode === null && run?.child?.signalCode === null) {
          supervisor.stop(run, 'linger-kill', { softKillTimeoutMs: LINGER_KILL_SOFT_KILL_MS })
        }
      }, LINGER_KILL_DELAY_MS),
    ]
  }

  function handleCliEvent(event) {
    const run = activeRun
    markActivity(run)
    const compact = compactEvent(event)
    if (run?.taskId && compact && typeof compact === 'object') compact.taskId = run.taskId
    if (run) {
      const change = supervisor.recordEvent(run, compact || event)
      extendIdleWatchdogForTool(run, supervisor.snapshot(run).currentTool)
      sendRuntimeActivity(run, change)
    }
    // Capture session_id from Claude CLI init event
    if (
      sessionStore &&
      run &&
      !run.sessionId &&
      event?.type === 'system' &&
      event?.subtype === 'init' &&
      event?.session_id
    ) {
      run.sessionId = String(event.session_id)
      sessionStore.upsert({
        id: run.sessionId,
        taskId: run.taskId,
        chatId: run.chatId,
        cwd: run.cwd,
        model: run.model,
        status: 'running',
        startedAt: run.startedAt,
        updatedAt: Date.now(),
        prompt: run.prompt,
        maxTurns: run.maxTurns || null,
        maxBudgetUsd: run.maxBudgetUsd || null,
      })
      log(`OPC session captured: ${run.sessionId} taskId=${run.taskId}`)
    }
    send('opc:event', compact)
    if (event?.type === 'result' && run) {
      supervisor.markFinishing(run, 'result')
      supervisor.stop(run, 'result')
      finishRun(run, event.is_error ? 1 : 0, 'result')
      stopLingeringRun(run)
    }
  }

  function version() {
    const node = findNode()
    const cli = cliPath()
    const result = spawnSync(node, [cli, '--version'], {
      cwd: projectRoot(),
      encoding: 'utf8',
      env: cleanEnv(),
      timeout: CLI_VERSION_PROBE_TIMEOUT_MS,
    })
    return {
      ok: result.status === 0,
      node,
      cli,
      status: result.status,
      version: (result.stdout || result.stderr || '').trim(),
      error: result.error?.message || '',
    }
  }

  function run(payload) {
    if (activeRun) throw new Error('Une tâche est déjà en cours.')

    // Auto-resolve sessionId for resume: if not provided but taskId has a known session
    let resolvedSessionId = payload.sessionId || ''
    let resolvedPrompt = String(payload.prompt || '').trim()

    if (!resolvedSessionId && sessionStore && payload.taskId) {
      const existingSession = sessionStore.findByTaskId(payload.taskId)
      if (existingSession?.id && existingSession.status !== 'completed') {
        resolvedSessionId = existingSession.id
        log(`OPC auto-resume: session=${existingSession.id} taskId=${payload.taskId} status=${existingSession.status}`)
        // If interrupted (not user-initiated resume), inject continuation prompt
        if (!payload.prompt && existingSession.status === 'interrupted') {
          resolvedPrompt = 'Continue from where you left off.'
        }
      }
    }

    if (!resolvedPrompt) throw new Error('Prompt vide.')

    const root = projectRoot()
    const cwd = resolveCwd(payload.cwd, () => root)
    const profile = providerConfig.profileForModel(payload.model)
    if (!profileMatchesSelection(profile, payload.model)) {
      throw new Error(`Le modèle ${payload.model || 'sélectionné'} est introuvable dans la configuration provider OPC.`)
    }
    if (profile && providerConfig.capabilities?.(profile)?.agent === false) {
      throw new Error(`${profile.label || profile.model} est un provider de suggestions de code, pas un modèle agent OPC. Choisis un modèle agent pour lancer une session.`)
    }
    const model = profile?.model || payload.model || ''
    const memoryEnabled = payload.memoryEnabled !== false
    const memoryPrompt = memoryEnabled ? memoryStore.buildPrompt(cwd, model) : ''
    const args = [
      cliPath(),
      '-p',
      resolvedPrompt,
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
    ]

    for (const pluginDir of bundledPluginDirs(root)) args.push('--plugin-dir', pluginDir)
    if (memoryPrompt) args.push('--append-system-prompt', memoryPrompt)
    if (payload.bare !== false) args.push('--bare')
    if (payload.effort) args.push('--effort', String(payload.effort))
    if (payload.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    } else if (payload.permissionMode) {
      args.push('--permission-mode', String(payload.permissionMode))
    }
    if (resolvedSessionId) args.push('--resume', String(resolvedSessionId))
    if (payload.maxTurns) args.push('--max-turns', String(payload.maxTurns))
    if (payload.maxBudgetUsd && Number(payload.maxBudgetUsd) > 0) {
      args.push('--max-budget-tokens', String(Math.round(Number(payload.maxBudgetUsd) * 1000000)))
    }
    if (payload.settingsPath) args.push('--settings', String(payload.settingsPath))
    if (Array.isArray(payload.allowedTools) && payload.allowedTools.length) {
      args.push('--allowedTools', payload.allowedTools.join(','))
    }

    const node = findNode()
    const bridge = providerBridge.current()
    if (!bridge) throw new Error('Provider bridge unavailable.')

    const config = providerConfig.load()
    const providerEnv = profile
      ? {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${bridge.port}`,
          ANTHROPIC_AUTH_TOKEN: bridge.authToken || 'opc-desktop-local',
          ANTHROPIC_MODEL: profile.model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: config.defaultModel,
          ANTHROPIC_DEFAULT_OPUS_MODEL: config.defaultModel,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.model,
        }
      : {}
    const logArgs = sanitizeArgs(args)
    log(`Starting OPC CLI: ${node} ${logArgs.join(' ')} cwd=${cwd}`)
    const child = spawn(node, args, {
      cwd,
      env: cleanEnv({ FORCE_COLOR: '0', NO_COLOR: '1', CLAUDE_CODE_MAX_RETRIES: '0', ...providerEnv }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })

    activeRun = {
      child,
      stdout: '',
      stderr: '',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      idleTimer: null,
      lingerTimers: null,
      taskId: String(payload.taskId || ''),
      assistantId: String(payload.assistantId || ''),
      chatId: String(payload.chatId || ''),
      prompt: String(payload.displayPrompt || resolvedPrompt),
      cwd,
      model,
      memoryEnabled,
      sessionId: resolvedSessionId || null,
      maxTurns: payload.maxTurns || null,
      maxBudgetUsd: payload.maxBudgetUsd || null,
      commandIntent: payload.commandIntent || null,
      projectRuntimeContext: payload.projectRuntimeContext || null,
      processGroup: process.platform !== 'win32',
    }
    supervisor.track(activeRun)
    startIdleWatchdog(activeRun)
    sendRuntime(activeRun, 'starting')
    send('opc:run-start', {
      pid: child.pid,
      cwd,
      command: [node, ...logArgs],
      model,
      taskId: activeRun.taskId,
      memoryEnabled,
      skipPermissions: Boolean(payload.skipPermissions),
      permissionMode: payload.permissionMode,
      commandIntent: activeRun.commandIntent,
      projectRuntimeContext: activeRun.projectRuntimeContext,
    })
    if (memoryPrompt) {
      send('opc:event', {
        type: 'memory',
        message: 'Mémoire durable OPC active',
        path: memoryStore.memoryPath(),
      })
    }

    let stdoutBuffer = ''
    child.stdout.on('data', chunk => {
      markActivity()
      const text = String(chunk)
      if (activeRun) activeRun.stdout = appendBoundedText(activeRun.stdout, text, MAX_STDOUT_CHARS)
      // Sprint 4 / H1: bound the partial-line buffer too. A runaway CLI
      // emitting a single very long line without a newline would otherwise
      // accumulate the entire payload in memory until the line completes.
      stdoutBuffer = appendBoundedText(stdoutBuffer, text, MAX_STDOUT_CHARS)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          handleCliEvent(JSON.parse(line))
        } catch {
          send('opc:event', { type: 'stdout', text: line })
        }
      }
    })

    child.stderr.on('data', chunk => {
      markActivity()
      const text = String(chunk)
      if (activeRun) activeRun.stderr = appendBoundedText(activeRun.stderr, text, MAX_STDERR_CHARS)
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        const trimmed = tailText(line, MAX_STDERR_EVENT_CHARS)
        const event = {
          type: 'stderr',
          text: trimmed,
          truncated: trimmed.length !== line.trim().length,
          taskId: activeRun?.taskId || '',
        }
        if (activeRun) sendRuntimeActivity(activeRun, supervisor.recordEvent(activeRun, event))
        send('opc:event', event)
      }
    })

    child.on('error', error => {
      const event = { type: 'error', message: error.message, taskId: activeRun?.taskId || '' }
      if (activeRun) sendRuntimeActivity(activeRun, supervisor.recordEvent(activeRun, event))
      send('opc:event', event)
    })

    child.on('close', code => {
      if (stdoutBuffer.trim()) {
        try {
          handleCliEvent(JSON.parse(stdoutBuffer))
        } catch {
          send('opc:event', { type: 'stdout', text: stdoutBuffer })
        }
      }
      const finishedRun = activeRun
      const finished = finishRun(finishedRun, code, 'close')
      // Defensive cleanup: `handleCliEvent` schedules linger timers in the
      // result path BEFORE `finishRun` marks the run finished. `finishRun`
      // short-circuits on subsequent calls (the `finished` guard), so any
      // timer scheduled during the result path survives until natural wake.
      // Clearing here releases the closures as soon as the child exits.
      if (finishedRun) clearLingerTimers(finishedRun)
      log(`OPC CLI exited code=${code} durationMs=${finished?.durationMs || 0}`)
    })
  }

  function stop() {
    if (!activeRun) return false
    const run = activeRun
    send('opc:event', { type: 'stopped', message: 'Tâche arrêtée par l’utilisateur.', taskId: run.taskId })
    supervisor.stop(run, 'stopped')
    finishRun(run, EXIT_CODE_USER_STOP, 'stopped')
    stopLingeringRun(run)
    return true
  }

  function hasActiveRun() {
    return Boolean(activeRun)
  }

  function activeChild() {
    return activeRun?.child || null
  }

  function activeTaskId() {
    return activeRun?.taskId || ''
  }

  function runtimeStatus() {
    return supervisor.status()
  }

  function recordExternalEvent(event) {
    const run = activeRun
    markActivity(run)
    if (!run || run.finished) return null
    const payload = { ...event, taskId: run.taskId }
    const change = supervisor.recordEvent(run, payload)
    sendRuntimeActivity(run, change)
    return supervisor.snapshot(run)
  }

  function cleanupRuntime() {
    return supervisor.cleanup({ force: true, reason: 'manual-cleanup' })
  }

  return {
    cleanupRuntime,
    run,
    stop,
    touchActiveRun: () => markActivity(),
    recordExternalEvent,
    hasActiveRun,
    activeChild,
    activeTaskId,
    runtimeStatus,
    version,
  }
}

module.exports = {
  // Refactor LOW: re-export the named constants via this module so consumers
  // can `require('./cliRunner.cjs').CLI_RUNNER_CONSTANTS` without depending on
  // the dedicated constants module.
  CLI_RUNNER_CONSTANTS: Object.freeze({
    BUNDLED_PLUGIN_NAMES,
    CLI_VERSION_PROBE_TIMEOUT_MS,
    DEFAULT_IDLE_TIMEOUT_MS,
    DEFAULT_LOCAL_CWD,
    DEFAULT_LONG_TOOL_IDLE_TIMEOUT_MS,
    EXIT_CODE_IDLE_TIMEOUT,
    EXIT_CODE_USER_STOP,
    IDLE_CHECK_INTERVAL_MS,
    IDLE_TIMEOUT_MAX_MS,
    IDLE_TIMEOUT_MIN_MS,
    LINGER_KILL_DELAY_MS,
    LINGER_KILL_SOFT_KILL_MS,
    LINGER_TERM_DELAY_MS,
    LINGER_TERM_SOFT_KILL_MS,
    MAX_STDERR_CHARS,
    MAX_STDERR_EVENT_CHARS,
    MAX_STDOUT_CHARS,
    MAX_TOOL_IDLE_TIMEOUT_MS,
    RUNTIME_ACTIVITY_MIN_INTERVAL_MS,
  }),
  bundledPluginDirs,
  classifyLongRunningTool,
  commandLooksLongRunning,
  createCliRunner,
  resolveCwd,
  stripPathShellQuotes,
  tailText,
  toolIdleTimeoutMs,
}
