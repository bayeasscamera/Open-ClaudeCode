const { exportStateBackup, importStateBackup } = require('../desktopStateStore.cjs')
const { validateStateSearchPayload } = require('../ipcValidation.cjs')

function registerClipboardStateIpc({
  clipboard,
  dialog,
  desktopStateStore,
  handle,
  projectFileAccess,
}) {
  function authorizeStateFiles(value) {
    const state = value?.state && typeof value.state === 'object' ? value.state : value
    projectFileAccess.authorizeState(state || {})
  }

  handle('opc:copy-text', async (_event, value) => {
    const text = String(value || '')
    if (!text.trim()) return false
    clipboard.writeText(text)
    return true
  })

  handle('opc:read-clipboard', async () => {
    return clipboard.readText?.() || ''
  })

  handle('opc:load-state', async () => {
    const result = desktopStateStore.read()
    authorizeStateFiles(result)
    return result
  })

  handle('opc:save-state', async (_event, value) => {
    authorizeStateFiles(value)
    return desktopStateStore.write(value)
  })

  handle('opc:search-state', async (_event, payload = {}) => {
    if (!desktopStateStore.searchState) return { ok: false, error: 'Recherche state indisponible.' }
    return desktopStateStore.searchState(validateStateSearchPayload(payload))
  })

  handle('opc:export-state-backup', async (_event, payload = {}) => {
    return exportStateBackup({ dialog, desktopStateStore }, payload)
  })

  handle('opc:import-state-backup', async () => {
    const result = await importStateBackup({ dialog })
    authorizeStateFiles(result)
    return result
  })
}

module.exports = { registerClipboardStateIpc }
