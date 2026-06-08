const { validateDoctorPayload } = require('../ipcValidation.cjs')
const { exportSupportBundle } = require('../supportBundle.cjs')

function registerDiagnosticsIpc({
  cliRunner,
  desktopStateStore,
  dialog,
  doctor,
  handle,
  memoryStore,
  projectRoot,
  providerConfigStore,
  logsDir,
  crashDir,
}) {
  handle('opc:doctor', async (_event, payload = {}) => {
    if (!doctor?.run) return { ok: false, error: 'Diagnostic OPC indisponible.' }
    return doctor.run(validateDoctorPayload(payload))
  })

  handle('opc:export-support-bundle', async (_event, payload = {}) => {
    return exportSupportBundle({
      dialog,
      cliRunner,
      providerConfigStore,
      memoryStore,
      desktopStateStore,
      projectRoot,
      logsDir,
      crashDir,
    }, {
      ...validateDoctorPayload(payload),
      report: payload && typeof payload.report === 'object' ? payload.report : null,
    })
  })
}

module.exports = { registerDiagnosticsIpc }
