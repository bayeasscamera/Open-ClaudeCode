const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, session, shell, safeStorage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { initCrashReporter } = require('./crashReporter.cjs')
const { installApplicationLifecycle } = require('./appLifecycle.cjs')
const { createCliRunner } = require('./cliRunner.cjs')
const { createDesktopStateStore } = require('./desktopStateStore.cjs')
const { createDoctor } = require('./doctor.cjs')
const { registerIpcHandlers } = require('./ipcHandlers.cjs')
const { createMemoryStore } = require('./memoryStore.cjs')
const { createNvidiaClient } = require('./nvidiaClient.cjs')
const { createProviderBridge } = require('./providerBridge.cjs')
const { createProviderChecker } = require('./providerChecker.cjs')
const { createProviderConfigStore } = require('./providerConfig.cjs')
const { createProviderModelDiscovery } = require('./providerModelDiscovery.cjs')
const { createProviderSecretVault } = require('./providerSecretVault.cjs')
const { createPromptRefiner } = require('./promptRefiner.cjs')
const { createSelectionController } = require('./selectionController.cjs')
const { sandboxSwitchDecision } = require('./electronSandboxPolicy.cjs')
const { installProviderBridgeCspInterceptor } = require('./cspInterceptor.cjs')
const { PRELOAD_EVENT_METHODS, PRELOAD_INVOKE_METHODS } = require('./ipcContract.cjs')
const { migrateLegacyProviderConfig, redactLegacyProviderSecrets } = require('./userDataMigration.cjs')
const { createMainWindow } = require('./windowManager.cjs')
const { attachVisualQa } = require('./e2eVisualQa.cjs')

const APP_NAME = 'OPC'
const PROVIDER_WAIT_STATUS_INTERVAL_MS = 10000

if (typeof app.setName === 'function') app.setName(APP_NAME)
const sandboxDecision = sandboxSwitchDecision({
  disableSandboxEnv: process.env.OPC_DISABLE_ELECTRON_SANDBOX,
  isPackaged: app.isPackaged,
})
if (sandboxDecision.appendNoSandbox) {
  app.commandLine.appendSwitch('no-sandbox')
}
if (process.env.OPC_E2E_USER_DATA) {
  app.setPath('userData', process.env.OPC_E2E_USER_DATA)
}

let mainWindow = null
let providerBridge = null
const e2eSmoke = process.env.OPC_E2E_SMOKE === '1'
const e2eVisual = process.env.OPC_E2E_VISUAL === '1'

initCrashReporter({ log })

app.on('render-process-gone', (_event, _webContents, details) => {
  log(`Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`)
})

app.on('child-process-gone', (_event, details) => {
  log(`Child process gone: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}`)
})

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try {
    fs.mkdirSync(app.getPath('logs'), { recursive: true })
    fs.appendFileSync(path.join(app.getPath('logs'), 'desktop.log'), line)
  } catch {
    // Logging should never block launch.
  }
}

if (sandboxDecision.warning) {
  log(sandboxDecision.warning)
}

function send(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function projectRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'opc')
  return path.resolve(__dirname, '..', '..')
}

function cliPath() {
  return path.join(projectRoot(), 'package', 'cli.js')
}

function providerConfigPath() {
  return path.join(app.getPath('userData'), 'providers', 'providers.json')
}

function legacyProviderConfigPaths() {
  if (process.env.OPC_E2E_USER_DATA) return []
  return [
    path.join(app.getPath('userData'), 'providers', 'nvidia.json'),
    path.join(app.getPath('appData'), 'opc-desktop', 'providers', 'nvidia.json'),
  ]
}

function memoryDir() {
  return path.join(app.getPath('userData'), 'memory')
}

function statePath() {
  return path.join(app.getPath('userData'), 'state', 'desktop-state.json')
}

const selectionController = createSelectionController({ clipboard, log, getMainWindow: () => mainWindow })
const providerFileMigration = migrateLegacyProviderConfig({
  canonicalPath: providerConfigPath(),
  legacyPaths: legacyProviderConfigPaths(),
})
if (providerFileMigration.migrated) {
  log(`Provider config migrated to canonical OPC userData: ${JSON.stringify({
    added: providerFileMigration.added,
    profiles: providerFileMigration.profiles,
    legacyPaths: providerFileMigration.legacyPaths,
  })}`)
} else if (providerFileMigration.error) {
  log(`Provider config migration skipped: ${providerFileMigration.error}`)
}
const providerConfigStore = createProviderConfigStore({
  configPath: providerConfigPath,
  secretVault: createProviderSecretVault({
    safeStorage,
    allowPlaintext: !app.isPackaged || process.env.OPC_ALLOW_PLAINTEXT_PROVIDER_SECRETS === '1',
  }),
})
const desktopStateStore = createDesktopStateStore({ statePath })
const providerBridgeService = createProviderBridge({
  providerConfig: providerConfigStore,
  log,
  sendStatus: event => {
    const payload = { ...event, taskId: cliRunner.activeTaskId() }
    cliRunner.recordExternalEvent(payload)
    send('opc:event', payload)
  },
  waitStatusIntervalMs: PROVIDER_WAIT_STATUS_INTERVAL_MS,
})
const memoryStore = createMemoryStore({ dir: memoryDir, log })
const providerClient = createNvidiaClient({ providerConfig: providerConfigStore })
const providerChecker = createProviderChecker({ providerConfigStore, providerClient })
const providerModelDiscovery = createProviderModelDiscovery({ providerConfigStore })
const promptRefiner = createPromptRefiner({ providerConfigStore, providerClient })
const cliRunner = createCliRunner({
  projectRoot,
  cliPath,
  providerBridge: providerBridgeService,
  providerConfig: providerConfigStore,
  memoryStore,
  log,
  send,
})
const doctor = createDoctor({
  projectRoot,
  cliRunner,
  providerConfigStore,
  memoryStore,
  desktopStateStore,
})

let providerSecretsMigrated = false
function migrateProviderSecretsAfterReady() {
  if (providerSecretsMigrated) return
  providerSecretsMigrated = true
  const providerSecretMigration = providerConfigStore.migratePlainApiKeys()
  if (providerSecretMigration.migrated) {
    log(`Provider config secrets moved to safeStorage: ${JSON.stringify({
      count: providerSecretMigration.count,
    })}`)
  }
  if (providerSecretMigration.backupRedaction?.redacted) {
    log(`Provider config plaintext backups redacted: ${JSON.stringify({
      count: providerSecretMigration.backupRedaction.count,
    })}`)
  }
  const providerPrune = providerConfigStore.pruneToSupportedProviders?.()
  if (providerPrune?.pruned) {
    log(`Provider config normalized without deleting user providers: ${JSON.stringify({
      removed: providerPrune.removed,
      added: providerPrune.added,
    })}`)
  }
  providerConfigStore.load()
  if (!providerConfigStore.loadError?.() && providerSecretMigration.reason !== 'encryption-unavailable') {
    const legacySecretRedaction = redactLegacyProviderSecrets({ legacyPaths: legacyProviderConfigPaths() })
    if (legacySecretRedaction.redacted) {
      log(`Legacy provider config secrets redacted after migration: ${JSON.stringify({
        files: legacySecretRedaction.files.map(file => file.path),
      })}`)
    }
  }
}

let cspInterceptorInstalled = false

async function startProviderBridge() {
  migrateProviderSecretsAfterReady()
  providerBridge = await providerBridgeService.start()
  const csp = installProviderBridgeCspInterceptor({
    electronSession: session,
    providerBridge,
    installed: cspInterceptorInstalled,
    log,
  })
  cspInterceptorInstalled = Boolean(csp.installed)

  return providerBridge
}

function closeProviderBridge() {
  providerBridgeService.close()
  providerBridge = null
}

function createWindow() {
  mainWindow = createMainWindow({
    BrowserWindow,
    shell,
    preloadPath: path.join(__dirname, 'preload.cjs'),
    rendererPath: path.join(__dirname, '..', 'renderer', 'index.html'),
    preloadContract: { PRELOAD_EVENT_METHODS, PRELOAD_INVOKE_METHODS },
  })
  selectionController.attachToWindow(mainWindow, Menu)
  if (e2eVisual) attachVisualQa(mainWindow, app)
  else if (e2eSmoke) attachSmokeTest(mainWindow)
}

function attachSmokeTest(window) {
  const timeout = setTimeout(() => {
    console.error('OPC_E2E_SMOKE_FAIL timeout')
    app.exit(1)
  }, 15000)
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`
        (async () => {
          await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 80)))
          const waitForModelOptions = async () => {
            const startedAt = Date.now()
            while (Date.now() - startedAt < 4000) {
              const modelOptions = document.querySelectorAll('#modelInput option').length
              const composerOptions = document.querySelectorAll('#composerModelInput option').length
              if (modelOptions > 0 && composerOptions > 0) return { modelOptions, composerOptions }
              await new Promise(resolve => setTimeout(resolve, 100))
            }
            return {
              modelOptions: document.querySelectorAll('#modelInput option').length,
              composerOptions: document.querySelectorAll('#composerModelInput option').length,
            }
          }
          const selectorDiagnostic = () => ({
            modelOptions: document.querySelectorAll('#modelInput option').length,
            composerOptions: document.querySelectorAll('#composerModelInput option').length,
            healthText: document.querySelector('#healthText')?.textContent || '',
            healthDetail: document.querySelector('#healthDetail')?.textContent || '',
            opcType: typeof window.opc,
            opcMethods: Object.keys(window.opc || {}).sort(),
            opcHealthType: typeof window.opc?.health,
            opcClientType: typeof window.OPCOpcClient?.createOpcClient,
          })
          const required = [
            '#newChat',
            '#sidebarSearch',
            '#newProject',
            '#projectList',
            '#chatList',
            '#projectSelect',
            '#modelInput',
            '#permissionSelect',
            '#settingsRunDoctor',
            '#settingsDoctorReport',
            '#messages',
            '#promptInput',
            '#sendButton'
          ]
          const missing = required.filter(selector => !document.querySelector(selector))
          if (missing.length) throw new Error('Missing controls: ' + missing.join(', '))
          const optionCounts = await waitForModelOptions()
          if (optionCounts.modelOptions <= 0 || optionCounts.composerOptions <= 0) {
            throw new Error('Model selector has no provider options: ' + JSON.stringify(selectorDiagnostic()))
          }
          if (!window.OPCProjectFileIndex?.searchProjectFiles) throw new Error('Project file index module missing')
          if (!window.OPCProjectFileController?.createProjectFileController) throw new Error('Project file controller module missing')
          if (!window.OPCWorkspaceTrust?.workspaceTrustDecision) throw new Error('Workspace trust module missing')
          if (!window.OPCRenderController?.createRenderController) throw new Error('Render controller missing')
          const search = window.OPCProjectFileIndex.searchProjectFiles([
            { name: 'runtime.md', path: '/tmp/runtime.md', summary: 'runtime supervisor', searchIndex: 'runtime supervisor ports' }
          ], 'supervisor ports')
          if (search.length !== 1 || search[0].score <= 0) throw new Error('Project file search did not rank expected result')
          const sidebarSearch = document.querySelector('#sidebarSearch')
          sidebarSearch.value = 'runtime'
          sidebarSearch.dispatchEvent(new Event('input', { bubbles: true }))
          const appBox = document.querySelector('#app').getBoundingClientRect()
          const sidebarBox = document.querySelector('.sidebar').getBoundingClientRect()
          const topbarBox = document.querySelector('.topbar').getBoundingClientRect()
          const composerBox = document.querySelector('.composerBox').getBoundingClientRect()
          const messagesBox = document.querySelector('#messages').getBoundingClientRect()
          if (sidebarBox.width < 320) throw new Error('Sidebar too narrow: ' + sidebarBox.width)
          if (topbarBox.height > 92) throw new Error('Topbar too tall: ' + topbarBox.height)
          if (composerBox.width <= 380 || composerBox.bottom > appBox.bottom + 1) throw new Error('Composer layout invalid')
          if (messagesBox.height <= 220) throw new Error('Messages area too small')
          if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error('Horizontal overflow')
          return {
            title: document.title,
            controls: required.length,
            modelOptions: optionCounts.modelOptions,
            composerOptions: optionCounts.composerOptions,
            searchScore: search[0].score,
            layout: {
              sidebar: Math.round(sidebarBox.width),
              topbar: Math.round(topbarBox.height),
              composer: Math.round(composerBox.width),
              messages: Math.round(messagesBox.height)
            }
          }
        })()
      `)
      clearTimeout(timeout)
      console.log(`OPC_E2E_SMOKE_OK ${JSON.stringify(result)}`)
      app.exit(0)
    } catch (error) {
      clearTimeout(timeout)
      console.error(`OPC_E2E_SMOKE_FAIL ${error.stack || error.message}`)
      app.exit(1)
    }
  })
}

const ipc = registerIpcHandlers({
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
  promptRefiner,
  projectRoot,
  logsDir: () => app.getPath('logs'),
  crashDir: () => path.join(os.tmpdir(), 'opc-desktop-crashes'),
})

installApplicationLifecycle({
  app,
  BrowserWindow,
  createWindow,
  startProviderBridge,
  closeProviderBridge,
  unregisterIpcHandlers: ipc?.unregisterIpcHandlers,
  destroyWindowSafely: require('./windowManager.cjs').destroyWindowSafely,
  cliRunner,
  installApplicationMenu: () => selectionController.installApplicationMenu(Menu),
  log,
})
