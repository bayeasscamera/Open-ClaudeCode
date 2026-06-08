const {
  validateKillPidPayload,
  validateOpenPathTarget,
  validateProbeServicesPayload,
  validateRunPayload,
} = require('../ipcValidation.cjs')

function registerRuntimeIpc({
  cliRunner,
  handle,
  processInspector,
  processKiller,
  projectRoot,
  providerConfigStore,
  serviceProber,
  shell,
  startProviderBridge,
}) {
  handle('opc:run', async (_event, payload) => {
    providerConfigStore.reload?.()
    await startProviderBridge()
    providerConfigStore.reload?.()
    return cliRunner.run(validateRunPayload(payload))
  })

  handle('opc:stop', async () => cliRunner.stop())
  handle('opc:runtime-status', async () => cliRunner.runtimeStatus())
  handle('opc:cleanup-runtime', async () => cliRunner.cleanupRuntime())
}

function registerRuntimeProcessIpc({
  cliRunner,
  handle,
  processInspector,
  processKiller,
  projectRoot,
  serviceProber,
  shell,
}) {
  handle('opc:open-path', async (_event, targetPath) => {
    const requested = validateOpenPathTarget(targetPath, projectRoot())
    if (requested.kind === 'error') {
      return { ok: false, path: requested.target, error: requested.error }
    }
    if (requested.kind === 'url') {
      await shell.openExternal(requested.target)
      return { ok: true, path: requested.target }
    }
    const error = await shell.openPath(requested.target)
    return error ? { ok: false, path: requested.target, error } : { ok: true, path: requested.target }
  })

  function runtimePidSet() {
    const status = cliRunner.runtimeStatus?.() || {}
    const pids = new Set()
    for (const item of [status.active, ...(Array.isArray(status.tracked) ? status.tracked : [])]) {
      const pid = Number(item?.pid)
      if (Number.isInteger(pid) && pid > 1) pids.add(pid)
      for (const child of item?.children || []) {
        const childPid = Number(child)
        if (Number.isInteger(childPid) && childPid > 1) pids.add(childPid)
      }
    }
    return pids
  }

  function canKillPid(requested) {
    if (!requested.pid) return false
    if (runtimePidSet().has(requested.pid)) return true
    if (!requested.longRunning || !requested.command) return false
    return Boolean(processInspector?.(requested.pid, requested.command, { cwd: requested.cwd }))
  }

  handle('opc:kill-pid', async (_event, payload) => {
    const requested = validateKillPidPayload(payload)
    if (!canKillPid(requested)) {
      return { ok: false, pid: requested.pid, error: 'PID non suivi par OPC ou tâche longue non vérifiable.' }
    }
    return processKiller(requested.pid)
  })

  handle('opc:probe-services', async (_event, payload) => {
    const { tasks } = validateProbeServicesPayload(payload)
    return serviceProber(tasks)
  })
}

module.exports = { registerRuntimeIpc, registerRuntimeProcessIpc }
