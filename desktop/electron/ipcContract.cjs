const IPC_INVOKE_CHANNELS = Object.freeze([
  'opc:health',
  'opc:doctor',
  'opc:export-support-bundle',
  'opc:run',
  'opc:stop',
  'opc:runtime-status',
  'opc:cleanup-runtime',
  'opc:copy-text',
  'opc:read-clipboard',
  'opc:load-state',
  'opc:save-state',
  'opc:search-state',
  'opc:export-state-backup',
  'opc:import-state-backup',
  'opc:select-project-files',
  'opc:select-project-folder',
  'opc:read-project-file',
  'opc:export-project',
  'opc:import-project',
  'opc:open-path',
  'opc:kill-pid',
  'opc:probe-services',
  'opc:provider-check',
  'opc:provider-discover',
  'opc:refine-prompt',
  'opc:provider-config',
  'opc:provider-repair',
  'opc:provider-export',
  'opc:provider-import',
  'opc:provider-upsert',
  'opc:provider-delete',
  'opc:provider-default',
  'opc:provider-quarantine',
  'opc:provider-restore',
  'opc:session-list',
  'opc:session-mark-done',
  'opc:session-config',
  'opc:loop-event:ping',
  'opc:human-gate-ask',
])

const IPC_EVENT_CHANNELS = Object.freeze([
  'opc:run-start',
  'opc:event',
  'opc:run-end',
  'opc:runtime',
  'opc:resume-available',
  'opc:human-gate-prompt',
  'opc:loop-event',
])

const PRELOAD_INVOKE_METHODS = Object.freeze({
  health: 'opc:health',
  doctor: 'opc:doctor',
  exportSupportBundle: 'opc:export-support-bundle',
  run: 'opc:run',
  stop: 'opc:stop',
  runtimeStatus: 'opc:runtime-status',
  cleanupRuntime: 'opc:cleanup-runtime',
  copyText: 'opc:copy-text',
  readClipboard: 'opc:read-clipboard',
  loadState: 'opc:load-state',
  saveState: 'opc:save-state',
  searchState: 'opc:search-state',
  exportStateBackup: 'opc:export-state-backup',
  importStateBackup: 'opc:import-state-backup',
  selectProjectFiles: 'opc:select-project-files',
  selectProjectFolder: 'opc:select-project-folder',
  readProjectFile: 'opc:read-project-file',
  exportProject: 'opc:export-project',
  importProject: 'opc:import-project',
  openPath: 'opc:open-path',
  killPid: 'opc:kill-pid',
  probeServices: 'opc:probe-services',
  checkProvider: 'opc:provider-check',
  discoverProviderModels: 'opc:provider-discover',
  refinePrompt: 'opc:refine-prompt',
  providerConfig: 'opc:provider-config',
  repairProviderConfig: 'opc:provider-repair',
  exportProviderConfig: 'opc:provider-export',
  importProviderConfig: 'opc:provider-import',
  saveProviderProfile: 'opc:provider-upsert',
  deleteProviderProfile: 'opc:provider-delete',
  setDefaultProvider: 'opc:provider-default',
  quarantineProviders: 'opc:provider-quarantine',
  restoreProviders: 'opc:provider-restore',
  sessionList: 'opc:session-list',
  sessionMarkDone: 'opc:session-mark-done',
  sessionConfig: 'opc:session-config',
  loopEventPing: 'opc:loop-event:ping',
  humanGateAsk: 'opc:human-gate-ask',
})

const PRELOAD_EVENT_METHODS = Object.freeze({
  onRunStart: 'opc:run-start',
  onEvent: 'opc:event',
  onRunEnd: 'opc:run-end',
  onRuntime: 'opc:runtime',
  onResumeAvailable: 'opc:resume-available',
  onHumanGatePrompt: 'opc:human-gate-prompt',
  onLoopEvent: 'opc:loop-event',
})

// Validate a renderer-bound contract payload against the canonical whitelist.
// The sandboxed preload cannot `require()` this file directly, so we embed
// the whitelist inside the contract payload (built by windowManager.cjs) and
// call this validator on the parsed payload. This stops a tampered CLI arg
// from injecting arbitrary `opc:*` channels into the renderer's contextBridge.
function validateIpcContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('Invalid OPC IPC contract: not an object.')
  }
  const { invokeMethods, eventMethods } = contract
  if (!invokeMethods || typeof invokeMethods !== 'object' || Array.isArray(invokeMethods)) {
    throw new Error('Invalid OPC IPC contract.invokeMethods.')
  }
  if (!eventMethods || typeof eventMethods !== 'object' || Array.isArray(eventMethods)) {
    throw new Error('Invalid OPC IPC contract.eventMethods.')
  }
  for (const [method, channel] of Object.entries(invokeMethods)) {
    if (!method || typeof channel !== 'string') {
      throw new Error(`Invalid OPC IPC invoke method entry: ${JSON.stringify(method)}.`)
    }
    if (!IPC_INVOKE_CHANNELS.includes(channel)) {
      throw new Error(`OPC IPC invoke channel "${channel}" is not in the canonical whitelist.`)
    }
  }
  for (const [method, channel] of Object.entries(eventMethods)) {
    if (!method || typeof channel !== 'string') {
      throw new Error(`Invalid OPC IPC event method entry: ${JSON.stringify(method)}.`)
    }
    if (!IPC_EVENT_CHANNELS.includes(channel)) {
      throw new Error(`OPC IPC event channel "${channel}" is not in the canonical whitelist.`)
    }
  }
  return {
    invokeMethods: { ...invokeMethods },
    eventMethods: { ...eventMethods },
  }
}

module.exports = {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  PRELOAD_EVENT_METHODS,
  PRELOAD_INVOKE_METHODS,
  validateIpcContract,
}
