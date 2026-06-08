const { spawnSync } = require('node:child_process')

function processExists(pid, kill = process.kill) {
  try {
    kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function childPids(pid, options = {}) {
  const targetPid = Number(pid)
  const exec = options.spawnSync || spawnSync
  if (!Number.isInteger(targetPid) || targetPid <= 1) return []
  try {
    const result = exec('pgrep', ['-P', String(targetPid)], { encoding: 'utf8' })
    if (result.status !== 0) return []
    return String(result.stdout || '')
      .split(/\s+/)
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 1)
  } catch {
    return []
  }
}

function processTreePids(pid, options = {}) {
  const rootPid = Number(pid)
  const seen = new Set()
  const stack = [rootPid]
  while (stack.length) {
    const current = stack.pop()
    if (!Number.isInteger(current) || current <= 1 || seen.has(current)) continue
    seen.add(current)
    for (const child of childPids(current, options)) stack.push(child)
  }
  return Array.from(seen)
}

function signalPid(pid, signal, kill = process.kill) {
  try {
    kill(Number(pid), signal)
    return true
  } catch {
    return false
  }
}

function processCommand(pid, options = {}) {
  const targetPid = Number(pid)
  const exec = options.spawnSync || spawnSync
  if (!Number.isInteger(targetPid) || targetPid <= 1) return ''
  try {
    const result = exec('ps', ['-p', String(targetPid), '-o', 'command='], { encoding: 'utf8' })
    if (result.status !== 0) return ''
    return String(result.stdout || '').trim()
  } catch {
    return ''
  }
}

function executableHint(command) {
  return String(command || '')
    .trim()
    .split(/\s+/)[0]
    ?.split('/')
    .filter(Boolean)
    .pop() || ''
}

function processLooksLikeLongTask(pid, command, options = {}) {
  const psCommand = processCommand(pid, options)
  if (!psCommand) return false
  const hint = executableHint(command)
  const lowerProcess = psCommand.toLowerCase()
  const lowerHint = hint.toLowerCase()
  if (lowerHint && lowerProcess.includes(lowerHint)) return true
  return /\b(node|npm|pnpm|yarn|bun|next|vite|astro|nuxt)\b/.test(lowerProcess)
}

function killProcessTree(pid, options = {}) {
  const targetPid = Number(pid)
  const currentPid = Number(options.currentPid || process.pid)
  const softKillTimeoutMs = Number(options.softKillTimeoutMs || 1500)
  const kill = options.kill || process.kill
  const delay = options.setTimeout || setTimeout
  const useProcessGroup = options.processGroup !== false && process.platform !== 'win32'

  if (!Number.isInteger(targetPid) || targetPid <= 1 || targetPid === currentPid) {
    return { ok: false, pid: targetPid, error: 'PID invalide.' }
  }

  const pids = processTreePids(targetPid, options)
  const targets = pids.length ? pids : [targetPid]
  let signaled = false

  if (useProcessGroup) signaled = signalPid(-targetPid, 'SIGTERM', kill) || signaled
  for (const target of targets.slice().reverse()) signaled = signalPid(target, 'SIGTERM', kill) || signaled

  if (!signaled) return { ok: false, pid: targetPid, children: targets.filter(value => value !== targetPid), error: 'Process introuvable.' }

  delay(() => {
    const remaining = processTreePids(targetPid, options)
    if (useProcessGroup) signalPid(-targetPid, 'SIGKILL', kill)
    for (const target of (remaining.length ? remaining : targets).slice().reverse()) {
      if (target !== currentPid && processExists(target, kill)) signalPid(target, 'SIGKILL', kill)
    }
  }, softKillTimeoutMs)

  return { ok: true, pid: targetPid, children: targets.filter(value => value !== targetPid) }
}

function killProcess(pid, options = {}) {
  const targetPid = Number(pid)
  const currentPid = Number(options.currentPid || process.pid)
  const softKillTimeoutMs = Number(options.softKillTimeoutMs || 1500)
  const kill = options.kill || process.kill
  const delay = options.setTimeout || setTimeout

  if (!Number.isInteger(targetPid) || targetPid <= 1 || targetPid === currentPid) {
    return { ok: false, error: 'PID invalide.' }
  }

  try {
    kill(targetPid, 'SIGTERM')
    delay(() => {
      try {
        kill(targetPid, 0)
        kill(targetPid, 'SIGKILL')
      } catch {
        // Process already stopped.
      }
    }, softKillTimeoutMs)
    return { ok: true, pid: targetPid }
  } catch (error) {
    return { ok: false, pid: targetPid, error: error.message }
  }
}

module.exports = {
  childPids,
  killProcess,
  killProcessTree,
  processCommand,
  processExists,
  processLooksLikeLongTask,
  processTreePids,
}
