const { createProjectFileAccessRegistry } = require('./projectFiles.cjs')
const { killProcessTree, processLooksLikeLongTask } = require('./processControl.cjs')
const { probeServices } = require('./serviceProbe.cjs')
const { registerClipboardStateIpc } = require('./ipc/clipboardStateIpc.cjs')
const { registerDiagnosticsIpc } = require('./ipc/diagnosticsIpc.cjs')
const { registerHealthIpc } = require('./ipc/healthIpc.cjs')
const { registerProjectIpc } = require('./ipc/projectIpc.cjs')
const { registerProviderIpc } = require('./ipc/providerIpc.cjs')
const { registerRuntimeIpc, registerRuntimeProcessIpc } = require('./ipc/runtimeIpc.cjs')

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
    return _handle(channel, handler)
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
    shell,
    startProviderBridge,
    handle: (channel, handler) => ipcMain.handle(channel, handler),
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
