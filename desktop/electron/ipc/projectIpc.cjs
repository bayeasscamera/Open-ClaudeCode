const fs = require('node:fs')
const { writePrivateJsonFile } = require('../persistence/privateJsonFile.cjs')
const {
  readProjectFile,
  projectFileMetadata,
  safeProjectFilePath,
  scanProjectFolder,
} = require('../projectFiles.cjs')

const MAX_PROJECT_EXPORT_BYTES = 2 * 1024 * 1024

function isProjectBundleLike(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if ('project' in value && (!value.project || typeof value.project !== 'object' || Array.isArray(value.project))) return false
  if ('files' in value && !Array.isArray(value.files)) return false
  if ('messages' in value && !Array.isArray(value.messages)) return false
  return true
}

function registerProjectIpc({
  dialog,
  handle,
  projectFileAccess,
}) {
  function authorizeFiles(files = []) {
    projectFileAccess.authorizeFiles(files)
    return files
  }

  handle('opc:select-project-files', async () => {
    if (!dialog?.showOpenDialog) return { ok: false, files: [], error: 'Sélecteur de fichiers indisponible.' }
    const result = await dialog.showOpenDialog({
      title: 'Ajouter des fichiers au projet OPC',
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled) return { ok: true, files: [] }
    const files = result.filePaths
      .map(filePath => {
        try {
          return projectFileMetadata(filePath, { requireReadable: true })
        } catch {
          return null
        }
      })
      .filter(Boolean)
    return { ok: true, files: authorizeFiles(files) }
  })

  handle('opc:select-project-folder', async () => {
    if (!dialog?.showOpenDialog) return { ok: false, files: [], error: 'Sélecteur de dossier indisponible.' }
    const result = await dialog.showOpenDialog({
      title: 'Ajouter un dossier au projet OPC',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths?.[0]) return { ok: true, files: [] }
    try {
      const scanned = scanProjectFolder(result.filePaths[0])
      if (scanned.error) return { ok: false, folder: scanned.root, files: [], skipped: scanned.skipped, error: scanned.error }
      projectFileAccess.authorizeRoot(scanned.root)
      authorizeFiles(scanned.files)
      return { ok: true, folder: scanned.root, files: scanned.files, skipped: scanned.skipped, limitReached: scanned.limitReached }
    } catch (error) {
      return { ok: false, folder: result.filePaths[0], files: [], error: error.message }
    }
  })

  handle('opc:read-project-file', async (_event, payload = {}) => {
    const filePath = safeProjectFilePath(payload.path)
    if (!projectFileAccess.isAuthorized(filePath)) {
      return {
        ok: false,
        path: filePath,
        error: 'Fichier non autorisé. Ajoutez le fichier ou son dossier au projet avant lecture.',
      }
    }
    return readProjectFile(filePath, payload.maxBytes)
  })

  handle('opc:export-project', async (_event, payload = {}) => {
    if (!dialog?.showSaveDialog) return { ok: false, error: 'Export indisponible.' }
    const projectName = String(payload?.project?.name || 'opc-project').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'opc-project'
    const result = await dialog.showSaveDialog({
      title: 'Exporter le projet OPC',
      defaultPath: `${projectName}.opc-project.json`,
      filters: [{ name: 'Projet OPC', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { ok: true, canceled: true }
    try {
      writePrivateJsonFile(result.filePath, payload || {}, { trailingNewline: false })
      return { ok: true, path: result.filePath }
    } catch (error) {
      return { ok: false, path: result.filePath, error: error.message }
    }
  })

  handle('opc:import-project', async () => {
    if (!dialog?.showOpenDialog) return { ok: false, error: 'Import indisponible.' }
    const result = await dialog.showOpenDialog({
      title: 'Importer un projet OPC',
      properties: ['openFile'],
      filters: [{ name: 'Projet OPC', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths?.[0]) return { ok: true, canceled: true }
    const filePath = result.filePaths[0]
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) return { ok: false, path: filePath, error: 'Le fichier sélectionné est invalide.' }
      if (stat.size > MAX_PROJECT_EXPORT_BYTES) return { ok: false, path: filePath, error: 'Le fichier projet est trop volumineux.' }
      const bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (!isProjectBundleLike(bundle)) return { ok: false, path: filePath, error: 'Format de projet OPC invalide.' }
      return { ok: true, path: filePath, bundle }
    } catch (error) {
      return { ok: false, path: filePath, error: error.message }
    }
  })
}

module.exports = { isProjectBundleLike, registerProjectIpc }
