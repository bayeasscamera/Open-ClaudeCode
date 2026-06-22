const { contextBridge, ipcRenderer } = require('electron')

const IPC_CONTRACT_ARGUMENT = '--opc-ipc-contract='

function parseIpcContract(argv = []) {
  const arg = (Array.isArray(argv) ? argv : []).find(item => String(item).startsWith(IPC_CONTRACT_ARGUMENT))
  if (!arg) throw new Error('Missing OPC IPC contract for sandboxed preload.')

  let parsed
  try {
    const raw = decodeURIComponent(String(arg).slice(IPC_CONTRACT_ARGUMENT.length))
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Malformed OPC IPC contract JSON: ${error.message}`)
  }
  const invokeMethods = parsed?.invokeMethods
  const eventMethods = parsed?.eventMethods
  const whitelist = parsed?.whitelist
  validateMethodMap('invokeMethods', invokeMethods, whitelist?.invokeChannels)
  validateMethodMap('eventMethods', eventMethods, whitelist?.eventChannels)
  return { PRELOAD_EVENT_METHODS: eventMethods, PRELOAD_INVOKE_METHODS: invokeMethods }
}

function validateMethodMap(name, value, allowedChannels) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid OPC IPC ${name} contract.`)
  }
  // The whitelist is shipped inside the contract payload by windowManager.cjs.
  // When present, every channel must belong to it. When absent (older main
  // process), we fall back to the prefix check to preserve compatibility —
  // main process validation remains the source of truth in that fallback.
  const allowed = Array.isArray(allowedChannels) ? new Set(allowedChannels) : null
  for (const [method, channel] of Object.entries(value)) {
    if (!method || typeof channel !== 'string' || !channel.startsWith('opc:')) {
      throw new Error(`Invalid OPC IPC channel for ${name}.${method}.`)
    }
    if (allowed && !allowed.has(channel)) {
      throw new Error(
        `OPC IPC channel "${channel}" for ${name}.${method} is not in the canonical whitelist.`,
      )
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
  onResumeAvailable: subscribe('onResumeAvailable'),
  onHumanGatePrompt: subscribe('onHumanGatePrompt'),
  onLoopEvent: subscribe('onLoopEvent'),
  sessionList: invokeNoPayload('sessionList'),
  sessionMarkDone: invoke('sessionMarkDone'),
  sessionConfig: invoke('sessionConfig'),
  humanGateAsk: invoke('humanGateAsk'),
})
