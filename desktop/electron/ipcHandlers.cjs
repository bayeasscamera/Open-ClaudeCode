const { createProjectFileAccessRegistry } = require('./projectFiles.cjs')
const { killProcessTree, processLooksLikeLongTask } = require('./processControl.cjs')
const { probeServices } = require('./serviceProbe.cjs')
const { registerClipboardStateIpc } = require('./ipc/clipboardStateIpc.cjs')
const { registerDiagnosticsIpc } = require('./ipc/diagnosticsIpc.cjs')
const { registerHealthIpc } = require('./ipc/healthIpc.cjs')
const { registerLoopEventIpc } = require('./ipc/loopEventIpc.cjs')
const { registerProjectIpc } = require('./ipc/projectIpc.cjs')
const { registerProviderIpc } = require('./ipc/providerIpc.cjs')
const { registerRuntimeIpc, registerRuntimeProcessIpc } = require('./ipc/runtimeIpc.cjs')
const { registerSessionIpc } = require('./ipc/sessionIpc.cjs')
const { registerHumanGateIpc } = require('./ipc/humanGateIpc.cjs')

function registerIpcHandlers({
  ipcMain,
  clipboard,
  dialog,
  shell,
  startProviderBridge,
  cliRunner,
  providerConfigStore,
  memoryStore,
  desktopStateStore,
  sessionStore,
  providerChecker,
  providerModelDiscovery,
  doctor,
  projectRoot,
  processKiller = killProcessTree,
  processInspector = processLooksLikeLongTask,
  serviceProber = probeServices,
  promptRefiner = null,
  logsDir = null,
  crashDir = null,
}) {
  const registeredChannels = []
  const projectFileAccess = createProjectFileAccessRegistry()

  const _handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) => {
    registeredChannels.push(channel)
    // M1: wrap the user-supplied handler in try/catch so a throwing IPC
    // handler logs a precise channel-scoped error and re-throws (Electron
    // surfaces the rejection to the renderer). Prevents uncaught errors
    // from crashing the main process or breaking the renderer into a
    // half-broken state with no visible cause.
    return _handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[ipcHandlers] ${channel} threw: ${message}`)
        throw err
      }
    })
  }

  const context = {
    clipboard,
    cliRunner,
    desktopStateStore,
    dialog,
    doctor,
    memoryStore,
    processInspector,
    processKiller,
    projectFileAccess,
    projectRoot,
    promptRefiner,
    providerChecker,
    providerConfigStore,
    providerModelDiscovery,
    serviceProber,
    sessionStore,
    shell,
    startProviderBridge,
    handle: (channel, handler) => ipcMain.handle(channel, handler),
    ipcMain,
    logsDir,
    crashDir,
  }

  registerHealthIpc(context)
  registerDiagnosticsIpc(context)
  registerRuntimeIpc(context)
  registerClipboardStateIpc(context)
  registerProjectIpc(context)
  registerRuntimeProcessIpc(context)
  registerProviderIpc(context)
  registerSessionIpc(context)
  // Loop event bridge (spec phase 5) — must be registered before the
  // human gate so the awaiting_user / human_decided callbacks can forward
  // events through `loopEvent.broadcastLoopEvent`.
  const loopEvent = registerLoopEventIpc(context)
  registerHumanGateIpc({
    ...context,
    onAwaitingUser: payload => {
      loopEvent.broadcastLoopEvent({
        type: 'awaiting_user',
        question: payload.question,
        timeoutMs: payload.timeoutMs,
        context: payload.context,
        id: payload.id,
      })
    },
    onHumanDecided: payload => {
      loopEvent.broadcastLoopEvent({
        type: 'human_decided',
        decision: payload.decision,
        id: payload.id,
      })
    },
  })

  function unregisterIpcHandlers() {
    for (const channel of registeredChannels) {
      try {
        ipcMain.removeHandler(channel)
      } catch {
        // ignore
      }
    }
    registeredChannels.length = 0
    ipcMain.handle = _handle
  }

  return { unregisterIpcHandlers }
}

module.exports = { registerIpcHandlers }
