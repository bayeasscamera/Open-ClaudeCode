const { isSafeHttpUrl } = require('./ipcValidation.cjs')
const {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  validateIpcContract,
} = require('./ipcContract.cjs')

const IPC_CONTRACT_ARGUMENT = '--opc-ipc-contract='

function isSafeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && isSafeHttpUrl(url.href, { localOnly: true })
  } catch {
    return false
  }
}

function preloadIpcContractArgument(contract = {}) {
  // Validate against the canonical whitelist before embedding. The whitelist
  // is shipped inside the contract payload itself so the sandboxed preload
  // can re-validate without needing to `require()` ipcContract.cjs (which is
  // not available in preload's sandbox context).
  const validated = validateIpcContract({
    invokeMethods: contract.PRELOAD_INVOKE_METHODS || contract.invokeMethods || {},
    eventMethods: contract.PRELOAD_EVENT_METHODS || contract.eventMethods || {},
  })
  const payload = {
    invokeMethods: validated.invokeMethods,
    eventMethods: validated.eventMethods,
    whitelist: {
      invokeChannels: [...IPC_INVOKE_CHANNELS],
      eventChannels: [...IPC_EVENT_CHANNELS],
    },
  }
  return `${IPC_CONTRACT_ARGUMENT}${encodeURIComponent(JSON.stringify(payload))}`
}

function createMainWindow({ BrowserWindow, shell, preloadPath, rendererPath, preloadContract }) {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    title: 'OPC',
    backgroundColor: '#f7f7f4',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      additionalArguments: [preloadIpcContractArgument(preloadContract)],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  window.loadFile(rendererPath)
  return window
}

function destroyWindowSafely(win) {
  if (!win) return
  try {
    win.removeAllListeners()
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.removeAllListeners()
    }
    win.destroy()
  } catch {
    // ignore
  }
}

module.exports = {
  IPC_CONTRACT_ARGUMENT,
  createMainWindow,
  destroyWindowSafely,
  isSafeExternalUrl,
  preloadIpcContractArgument,
}
