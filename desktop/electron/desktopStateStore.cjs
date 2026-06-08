const fs = require('node:fs')
const path = require('node:path')
const { writePrivateJsonFile } = require('./persistence/privateJsonFile.cjs')
const { createSqliteStateStore } = require('./persistence/sqliteStateStore.cjs')
const { redactDeep } = require('./redaction.cjs')

const MAX_STATE_BACKUP_BYTES = 5 * 1024 * 1024

function stateBackupName(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `opc-state-backup-${stamp}.json`
}

function stateFromPayload(payload = {}) {
  if (payload?.state && typeof payload.state === 'object' && !Array.isArray(payload.state)) return payload.state
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload
  return {}
}

function buildStateBackup(payload = {}) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    state: redactDeep(stateFromPayload(payload)),
  }
}

function parseStateBackup(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  if (value.state && typeof value.state === 'object' && !Array.isArray(value.state)) return value.state
  return value
}

function isStateBackupLike(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = parseStateBackup(value)
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false
  if ('chats' in state && !Array.isArray(state.chats)) return false
  if ('projects' in state && !Array.isArray(state.projects)) return false
  if ('settings' in state && (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings))) return false
  return true
}

async function exportStateBackup({ dialog, desktopStateStore }, payload = {}) {
  if (!dialog?.showSaveDialog) return { ok: false, error: 'Export sauvegarde indisponible.' }
  const result = await dialog.showSaveDialog({
    title: 'Exporter une sauvegarde OPC',
    defaultPath: stateBackupName(),
    filters: [{ name: 'Sauvegarde OPC', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { ok: true, canceled: true }
  try {
    const state = Object.keys(stateFromPayload(payload)).length ? stateFromPayload(payload) : (desktopStateStore.read?.().state || {})
    writePrivateJsonFile(result.filePath, buildStateBackup({ state }))
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, path: result.filePath, error: error.message || String(error) }
  }
}

async function importStateBackup({ dialog }) {
  if (!dialog?.showOpenDialog) return { ok: false, error: 'Import sauvegarde indisponible.' }
  const result = await dialog.showOpenDialog({
    title: 'Importer une sauvegarde OPC',
    properties: ['openFile'],
    filters: [{ name: 'Sauvegarde OPC', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return { ok: true, canceled: true }
  const filePath = result.filePaths[0]
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return { ok: false, path: filePath, error: 'Le fichier sélectionné est invalide.' }
    if (stat.size > MAX_STATE_BACKUP_BYTES) return { ok: false, path: filePath, error: 'La sauvegarde est trop volumineuse.' }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!isStateBackupLike(parsed)) return { ok: false, path: filePath, error: 'Format de sauvegarde OPC invalide.' }
    return { ok: true, path: filePath, state: parseStateBackup(parsed) }
  } catch (error) {
    return { ok: false, path: filePath, error: error.message || String(error) }
  }
}

function defaultSqlitePath(jsonPath) {
  const parsed = path.parse(jsonPath)
  return path.join(parsed.dir, `${parsed.name}.sqlite`)
}

function compactSearchText(value, max = 8000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function searchTokens(value) {
  return compactSearchText(value, 1000)
    .toLowerCase()
    .match(/[a-z0-9_\-/.:àâäéèêëîïôöùûüç]+/gi) || []
}

function matchesTokens(haystack, tokens) {
  const text = compactSearchText(haystack, 12000).toLowerCase()
  return tokens.length > 0 && tokens.every(token => text.includes(token.toLowerCase()))
}

function boundedLimit(value) {
  return Math.max(1, Math.min(50, Number(value) || 10))
}

function messageHaystack(message = {}) {
  const tools = Array.isArray(message.tools) ? message.tools : []
  return [
    message.content,
    message.liveDraft,
    message.summary,
    message.focus,
    message.result,
    message.error,
    Array.isArray(message.events) ? message.events.join(' ') : '',
    tools.map(tool => [tool?.name, tool?.title, tool?.command, tool?.path, tool?.detail, tool?.result].filter(Boolean).join(' ')).join(' '),
  ].filter(Boolean).join(' ')
}

function projectFileHaystack(file = {}) {
  return [
    file.name,
    file.path,
    file.summary,
    file.preview,
    file.searchIndex,
    Array.isArray(file.keywords) ? file.keywords.join(' ') : '',
    Array.isArray(file.headings) ? file.headings.join(' ') : '',
  ].filter(Boolean).join(' ')
}

function jsonSearchMessages(state = {}, { query = '', limit = 10, chatId = '' } = {}) {
  const tokens = searchTokens(query)
  const rows = []
  for (const chat of Array.isArray(state.chats) ? state.chats : []) {
    if (chatId && chat?.id !== chatId) continue
    for (const [index, message] of (Array.isArray(chat?.messages) ? chat.messages : []).entries()) {
      if (!matchesTokens(messageHaystack(message), tokens)) continue
      rows.push({
        ...message,
        id: String(message.id || `${chat.id || 'chat'}:${index + 1}`),
        chatId: String(chat.id || ''),
        chatTitle: String(chat.title || ''),
        projectId: String(chat.projectId || ''),
        role: String(message.role || ''),
      })
      if (rows.length >= boundedLimit(limit)) return rows
    }
  }
  return rows
}

function jsonSearchProjectFiles(state = {}, { query = '', limit = 10 } = {}) {
  const tokens = searchTokens(query)
  const rows = []
  for (const project of Array.isArray(state.projects) ? state.projects : []) {
    for (const [index, file] of (Array.isArray(project?.files) ? project.files : []).entries()) {
      if (!matchesTokens(projectFileHaystack(file), tokens)) continue
      rows.push({
        ...file,
        id: String(file.id || `${project.id || 'project'}:${file.path || index + 1}`),
        projectId: String(project.id || ''),
        projectName: String(project.name || ''),
      })
      if (rows.length >= boundedLimit(limit)) return rows
    }
  }
  return rows
}

function createDesktopStateStore({ statePath, sqlitePath, enableSqlite = true }) {
  const sqliteStore = enableSqlite
    ? createSqliteStateStore({ dbPath: sqlitePath || (() => defaultSqlitePath(statePath())) })
    : null

  function read() {
    const sqliteResult = sqliteStore?.read?.()
    if (sqliteResult?.ok) return sqliteResult

    const filePath = statePath()
    try {
      return { ok: true, state: JSON.parse(fs.readFileSync(filePath, 'utf8')) }
    } catch (error) {
      return { ok: false, state: null, error: error.code === 'ENOENT' ? '' : error.message }
    }
  }

  function write(value) {
    const filePath = statePath()
    try {
      const state = redactDeep(value || {})
      writePrivateJsonFile(filePath, state, { trailingNewline: false })
      const sqlite = sqliteStore?.write?.(state) || { ok: false, error: 'SQLite désactivé.' }
      return { ok: true, path: filePath, sqlite }
    } catch (error) {
      return { ok: false, path: filePath, error: error.message }
    }
  }

  function info() {
    return {
      json: {
        path: statePath(),
        exists: fs.existsSync(statePath()),
      },
      sqlite: sqliteStore?.info?.() || { ok: false, error: 'SQLite désactivé.' },
    }
  }

  function jsonSearch(payload = {}) {
    const result = read()
    const state = result.state || {}
    const rows = payload.type === 'project_files'
      ? jsonSearchProjectFiles(state, payload)
      : jsonSearchMessages(state, payload)
    return { ok: true, source: 'json', type: payload.type || 'messages', rows }
  }

  function searchState(payload = {}) {
    const type = payload.type === 'project_files' ? 'project_files' : 'messages'
    const query = compactSearchText(payload.query, 1000)
    const limit = boundedLimit(payload.limit)
    const chatId = compactSearchText(payload.chatId, 160)
    if (!query) return { ok: true, source: 'none', type, rows: [] }

    const sqliteReadable = sqliteStore?.read?.().ok
    if (sqliteReadable) {
      const rows = type === 'project_files'
        ? sqliteStore.searchProjectFiles?.(query, { limit }) || []
        : sqliteStore.searchMessages?.(query, { limit, chatId }) || []
      return { ok: true, source: 'sqlite', type, rows }
    }
    return jsonSearch({ type, query, limit, chatId })
  }

  return { info, read, searchState, write }
}

module.exports = {
  MAX_STATE_BACKUP_BYTES,
  buildStateBackup,
  createDesktopStateStore,
  exportStateBackup,
  importStateBackup,
  isStateBackupLike,
  parseStateBackup,
  stateBackupName,
}
