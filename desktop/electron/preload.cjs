const { contextBridge, ipcRenderer } = require('electron')

const IPC_CONTRACT_ARGUMENT = '--opc-ipc-contract='

function parseIpcContract(argv = []) {
  const arg = (Array.isArray(argv) ? argv : []).find(item => String(item).startsWith(IPC_CONTRACT_ARGUMENT))
  if (!arg) throw new Error('Missing OPC IPC contract for sandboxed preload.')

  const raw = decodeURIComponent(String(arg).slice(IPC_CONTRACT_ARGUMENT.length))
  const parsed = JSON.parse(raw)
  const invokeMethods = parsed?.invokeMethods
  const eventMethods = parsed?.eventMethods
  validateMethodMap('invokeMethods', invokeMethods)
  validateMethodMap('eventMethods', eventMethods)
  return { PRELOAD_EVENT_METHODS: eventMethods, PRELOAD_INVOKE_METHODS: invokeMethods }
}

function validateMethodMap(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid OPC IPC ${name} contract.`)
  }
  for (const [method, channel] of Object.entries(value)) {
    if (!method || typeof channel !== 'string' || !channel.startsWith('opc:')) {
      throw new Error(`Invalid OPC IPC channel for ${name}.${method}.`)
    }
  }
}

const { PRELOAD_EVENT_METHODS, PRELOAD_INVOKE_METHODS } = parseIpcContract(process.argv)

function channelFor(methods, method) {
  const channel = methods[method]
  if (!channel) throw new Error(`Missing OPC IPC channel for ${method}.`)
  return channel
}

const invoke = method => payload => ipcRenderer.invoke(channelFor(PRELOAD_INVOKE_METHODS, method), payload)
const invokeNoPayload = method => () => ipcRenderer.invoke(channelFor(PRELOAD_INVOKE_METHODS, method))
const subscribe = method => callback => {
  const listener = (_event, payload) => callback(payload)
  const channel = channelFor(PRELOAD_EVENT_METHODS, method)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

contextBridge.exposeInMainWorld('opc', {
  health: invokeNoPayload('health'),
  doctor: invoke('doctor'),
  exportSupportBundle: invoke('exportSupportBundle'),
  checkProvider: invoke('checkProvider'),
  discoverProviderModels: invoke('discoverProviderModels'),
  providerConfig: invokeNoPayload('providerConfig'),
  repairProviderConfig: invokeNoPayload('repairProviderConfig'),
  exportProviderConfig: invokeNoPayload('exportProviderConfig'),
  importProviderConfig: invoke('importProviderConfig'),
  saveProviderProfile: invoke('saveProviderProfile'),
  deleteProviderProfile: invoke('deleteProviderProfile'),
  setDefaultProvider: invoke('setDefaultProvider'),
  quarantineProviders: invoke('quarantineProviders'),
  restoreProviders: invoke('restoreProviders'),
  loadState: invokeNoPayload('loadState'),
  saveState: invoke('saveState'),
  searchState: invoke('searchState'),
  exportStateBackup: invoke('exportStateBackup'),
  importStateBackup: invokeNoPayload('importStateBackup'),
  selectProjectFiles: invokeNoPayload('selectProjectFiles'),
  selectProjectFolder: invokeNoPayload('selectProjectFolder'),
  readProjectFile: invoke('readProjectFile'),
  exportProject: invoke('exportProject'),
  importProject: invokeNoPayload('importProject'),
  run: invoke('run'),
  refinePrompt: invoke('refinePrompt'),
  stop: invokeNoPayload('stop'),
  copyText: invoke('copyText'),
  readClipboard: invokeNoPayload('readClipboard'),
  killPid: invoke('killPid'),
  runtimeStatus: invokeNoPayload('runtimeStatus'),
  cleanupRuntime: invokeNoPayload('cleanupRuntime'),
  probeServices: invoke('probeServices'),
  openPath: invoke('openPath'),
  onRunStart: subscribe('onRunStart'),
  onEvent: subscribe('onEvent'),
  onRunEnd: subscribe('onRunEnd'),
  onRuntime: subscribe('onRuntime'),
})
