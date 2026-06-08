const {
  validateProviderCheckPayload,
  validateProviderDiscoveryPayload,
  validateProviderPausePayload,
  validateRefinePromptPayload,
} = require('../ipcValidation.cjs')

function registerProviderIpc({
  handle,
  promptRefiner,
  providerChecker,
  providerConfigStore,
  providerModelDiscovery,
}) {
  handle('opc:provider-check', async (_event, payload) => {
    const { model } = validateProviderCheckPayload(payload)
    return providerChecker.check(model)
  })

  handle('opc:provider-discover', async (_event, payload = {}) => {
    if (!providerModelDiscovery?.discoverAndImport) return { ok: false, error: 'Découverte provider indisponible.' }
    const requested = validateProviderDiscoveryPayload(payload)
    if (requested.import === false) return providerModelDiscovery.discover(requested)
    return providerModelDiscovery.discoverAndImport(requested)
  })

  handle('opc:refine-prompt', async (_event, payload) => {
    if (!promptRefiner?.refine) return { ok: false, error: 'Raffinage indisponible.' }
    return promptRefiner.refine(validateRefinePromptPayload(payload))
  })

  handle('opc:provider-config', async () => {
    return { ok: true, config: providerConfigStore.editableConfig() }
  })

  handle('opc:provider-repair', async () => {
    const repair = providerConfigStore.repairKnownProviderIssues?.() || { repaired: false, count: 0 }
    return { ok: true, repair, config: providerConfigStore.editableConfig() }
  })

  handle('opc:provider-export', async () => {
    return { ok: true, config: providerConfigStore.exportConfig() }
  })

  handle('opc:provider-import', async (_event, payload = {}) => {
    return { ok: true, config: providerConfigStore.importConfig(payload) }
  })

  handle('opc:provider-upsert', async (_event, payload = {}) => {
    return { ok: true, config: providerConfigStore.upsertProfile(payload) }
  })

  handle('opc:provider-delete', async (_event, payload = {}) => {
    return { ok: true, config: providerConfigStore.deleteProfile(payload.model || payload.id) }
  })

  handle('opc:provider-default', async (_event, payload = {}) => {
    return { ok: true, config: providerConfigStore.setDefaultModel(payload.model || payload.id) }
  })

  handle('opc:provider-quarantine', async (_event, payload = {}) => {
    const requested = validateProviderPausePayload(payload)
    const result = providerConfigStore.quarantineProfiles(requested.models, requested.reason)
    return { ok: true, ...result }
  })

  handle('opc:provider-restore', async (_event, payload = {}) => {
    const requested = validateProviderPausePayload(payload)
    const result = providerConfigStore.restoreProfiles(requested.models)
    return { ok: true, ...result }
  })
}

module.exports = { registerProviderIpc }
