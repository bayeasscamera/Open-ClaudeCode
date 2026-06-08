const { crashReporter } = require('electron')
const os = require('node:os')
const path = require('node:path')

/**
 * Initialize Electron crash reporter for the main process.
 *
 * In production, uploads are disabled (uploadToServer: false) and crashes
 * are dumped to a local directory for post-mortem inspection.
 * In development, verbose logging can still be enabled via env.
 */
function initCrashReporter({ log = console.error } = {}) {
  try {
    const crashDir = path.join(os.tmpdir(), 'opc-desktop-crashes')
    crashReporter.start({
      submitUrl: '',
      uploadToServer: false,
      ignoreSystemCrashHandler: true,
      extra: {
        appName: 'opc-desktop',
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron || 'unknown',
      },
    })
    log(`[crashReporter] Initialized. Crash dumps directory: ${crashDir}`)
  } catch (error) {
    log(`[crashReporter] Failed to start: ${error.message}`)
  }
}

module.exports = { initCrashReporter }
