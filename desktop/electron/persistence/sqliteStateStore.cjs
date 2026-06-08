const fs = require('node:fs')
const path = require('node:path')
const { redactDeep } = require('../redaction.cjs')
const { STATE_SCHEMA_VERSION } = require('./stateSchema.cjs')

let DatabaseSync = null
let sqliteLoadError = null
try {
  ;({ DatabaseSync } = require('node:sqlite'))
} catch (error) {
  sqliteLoadError = error
}

const SNAPSHOT_ID = 'current'

function jsonText(value) {
  return JSON.stringify(value == null ? null : value)
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizedRows(value) {
  return Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : []
}

function normalizedMapRows(value) {
  if (Array.isArray(value)) return normalizedRows(value)
  if (!value || typeof value !== 'object') return []
  return Object.values(value).filter(row => row && typeof row === 'object')
}

function rowId(prefix, value, index) {
  const id = value?.id || value?.model || value?.path || value?.name || `${prefix}-${index + 1}`
  return String(id)
}

function numericTimestamp(value) {
  const numberValue = Number(value)
  if (Number.isFinite(numberValue)) return numberValue
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function textValue(value) {
  return value == null ? '' : String(value)
}

function compactSearchText(value, max = 8000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function normalizeSearchText(value) {
  return compactSearchText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function toolSearchText(message = {}) {
  const tools = Array.isArray(message.tools) ? message.tools : []
  return compactSearchText(tools.map(tool => [
    tool?.name,
    tool?.title,
    tool?.command,
    tool?.path,
    tool?.detail,
    tool?.result,
  ].filter(Boolean).join(' ')).join(' '))
}

function messageSummaryText(message = {}) {
  return compactSearchText([
    message.summary,
    message.focus,
    message.result,
    message.error,
    Array.isArray(message.events) ? message.events.join(' ') : '',
  ].filter(Boolean).join(' '))
}

function ftsQuery(value) {
  const tokens = normalizeSearchText(value)
    .match(/[a-z0-9_\-/.:]+/gi)
  return tokens?.length ? tokens.map(token => `"${token.replace(/"/g, '""')}"`).join(' ') : ''
}

function withDb(filePath, fn) {
  if (!DatabaseSync) {
    const message = sqliteLoadError?.message || 'node:sqlite indisponible.'
    throw new Error(message)
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...params)
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params)
}

function get(db, sql, params = []) {
  return db.prepare(sql).get(...params)
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state_snapshots (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      title TEXT,
      createdAt TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chats_projectId ON chats(projectId);
    CREATE INDEX IF NOT EXISTS idx_chats_createdAt ON chats(createdAt);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chatId TEXT NOT NULL,
      role TEXT,
      createdAt TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chatId ON messages(chatId);
    CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
    CREATE INDEX IF NOT EXISTS idx_messages_createdAt ON messages(createdAt);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      id UNINDEXED,
      chatId UNINDEXED,
      content,
      summary,
      toolText
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      updatedAt TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_updatedAt ON projects(updatedAt);
    CREATE TABLE IF NOT EXISTS provider_checks (
      model TEXT PRIMARY KEY,
      status TEXT,
      checkedAt INTEGER,
      ok INTEGER,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_checks_status ON provider_checks(status);
    CREATE INDEX IF NOT EXISTS idx_provider_checks_checkedAt ON provider_checks(checkedAt);
    CREATE TABLE IF NOT EXISTS provider_check_history (
      id TEXT PRIMARY KEY,
      model TEXT,
      category TEXT,
      checkedAt INTEGER,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_check_history_model ON provider_check_history(model);
    CREATE INDEX IF NOT EXISTS idx_provider_check_history_checkedAt ON provider_check_history(checkedAt);
    CREATE INDEX IF NOT EXISTS idx_provider_check_history_category ON provider_check_history(category);
    CREATE TABLE IF NOT EXISTS long_tasks (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      status TEXT,
      updatedAt INTEGER,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_long_tasks_cwd ON long_tasks(cwd);
    CREATE INDEX IF NOT EXISTS idx_long_tasks_status ON long_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_long_tasks_updatedAt ON long_tasks(updatedAt);
    CREATE TABLE IF NOT EXISTS companion_jobs (
      id TEXT PRIMARY KEY,
      taskId TEXT,
      chatId TEXT,
      status TEXT,
      updatedAt INTEGER,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_companion_jobs_taskId ON companion_jobs(taskId);
    CREATE INDEX IF NOT EXISTS idx_companion_jobs_chatId ON companion_jobs(chatId);
    CREATE INDEX IF NOT EXISTS idx_companion_jobs_status ON companion_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_companion_jobs_updatedAt ON companion_jobs(updatedAt);
    CREATE TABLE IF NOT EXISTS agent_task_ledger (
      id TEXT PRIMARY KEY,
      assistantId TEXT,
      chatId TEXT,
      status TEXT,
      updatedAt INTEGER,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_task_ledger_status ON agent_task_ledger(status);
    CREATE INDEX IF NOT EXISTS idx_agent_task_ledger_updatedAt ON agent_task_ledger(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_agent_task_ledger_assistantId ON agent_task_ledger(assistantId);
    CREATE INDEX IF NOT EXISTS idx_agent_task_ledger_chatId ON agent_task_ledger(chatId);
    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      path TEXT,
      name TEXT,
      indexedAt TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_files_projectId ON project_files(projectId);
    CREATE INDEX IF NOT EXISTS idx_project_files_path ON project_files(path);
    CREATE INDEX IF NOT EXISTS idx_project_files_indexedAt ON project_files(indexedAt);
    CREATE VIRTUAL TABLE IF NOT EXISTS project_files_fts USING fts5(
      id UNINDEXED,
      name,
      summary,
      preview,
      searchIndex
    );
  `)
}

function insertStructuredRows(db, state) {
  for (const table of [
    'chats',
    'messages',
    'messages_fts',
    'projects',
    'provider_checks',
    'provider_check_history',
    'long_tasks',
    'companion_jobs',
    'agent_task_ledger',
    'project_files',
    'project_files_fts',
  ]) {
    run(db, `DELETE FROM ${table}`)
  }

  const chats = normalizedRows(state.chats)
  for (const [index, chat] of chats.entries()) {
    const id = rowId('chat', chat, index)
    run(db, 'INSERT OR REPLACE INTO chats (id, projectId, title, createdAt, json) VALUES (?, ?, ?, ?, ?)', [
      id,
      textValue(chat.projectId || chat.cwd || ''),
      textValue(chat.title || ''),
      textValue(chat.createdAt || chat.updatedAt || ''),
      jsonText(chat),
    ])
    for (const [messageIndex, message] of normalizedRows(chat.messages).entries()) {
      const messageId = String(message.id || `${id}:${messageIndex + 1}`)
      run(db, 'INSERT OR REPLACE INTO messages (id, chatId, role, createdAt, json) VALUES (?, ?, ?, ?, ?)', [
        messageId,
        id,
        textValue(message.role || ''),
        textValue(message.createdAt || message.timestamp || ''),
        jsonText(message),
      ])
      run(db, 'INSERT INTO messages_fts (id, chatId, content, summary, toolText) VALUES (?, ?, ?, ?, ?)', [
        messageId,
        id,
        compactSearchText(message.content || message.liveDraft || ''),
        messageSummaryText(message),
        toolSearchText(message),
      ])
    }
  }

  const projects = normalizedRows(state.projects)
  for (const [index, project] of projects.entries()) {
    const id = rowId('project', project, index)
    run(db, 'INSERT OR REPLACE INTO projects (id, name, updatedAt, json) VALUES (?, ?, ?, ?)', [
      id,
      textValue(project.name || project.title || project.path || ''),
      textValue(project.updatedAt || project.indexedAt || ''),
      jsonText(project),
    ])
    for (const [fileIndex, file] of normalizedRows(project.files).entries()) {
      const fileId = String(file.id || `${id}:${file.path || fileIndex + 1}`)
      run(db, 'INSERT OR REPLACE INTO project_files (id, projectId, path, name, indexedAt, json) VALUES (?, ?, ?, ?, ?, ?)', [
        fileId,
        id,
        textValue(file.path || ''),
        textValue(file.name || path.basename(file.path || '')),
        textValue(file.indexedAt || project.updatedAt || ''),
        jsonText(file),
      ])
      run(db, 'INSERT INTO project_files_fts (id, name, summary, preview, searchIndex) VALUES (?, ?, ?, ?, ?)', [
        fileId,
        textValue(file.name || path.basename(file.path || '')),
        textValue(file.summary || ''),
        textValue(file.preview || ''),
        textValue(file.searchIndex || ''),
      ])
    }
  }

  for (const [index, row] of normalizedMapRows(state.providerChecks).entries()) {
    const model = rowId('provider', row, index)
    run(db, 'INSERT OR REPLACE INTO provider_checks (model, status, checkedAt, ok, json) VALUES (?, ?, ?, ?, ?)', [
      model,
      textValue(row.status || row.category || ''),
      numericTimestamp(row.checkedAt),
      row.ok === true ? 1 : row.ok === false ? 0 : null,
      jsonText(row),
    ])
  }

  for (const [index, row] of normalizedRows(state.providerCheckHistory).entries()) {
    const id = rowId('provider-history', row, index)
    run(db, 'INSERT OR REPLACE INTO provider_check_history (id, model, category, checkedAt, json) VALUES (?, ?, ?, ?, ?)', [
      id,
      textValue(row.model || ''),
      textValue(row.category || row.status || ''),
      numericTimestamp(row.checkedAt),
      jsonText(row),
    ])
  }

  for (const [index, row] of normalizedRows(state.longTasks).entries()) {
    const id = rowId('long-task', row, index)
    run(db, 'INSERT OR REPLACE INTO long_tasks (id, cwd, status, updatedAt, json) VALUES (?, ?, ?, ?, ?)', [
      id,
      textValue(row.cwd || ''),
      textValue(row.status || ''),
      numericTimestamp(row.updatedAt || row.startedAt),
      jsonText(row),
    ])
  }

  for (const [index, row] of normalizedRows(state.companionJobs).entries()) {
    const id = rowId('companion-job', row, index)
    run(db, 'INSERT OR REPLACE INTO companion_jobs (id, taskId, chatId, status, updatedAt, json) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      textValue(row.taskId || ''),
      textValue(row.chatId || ''),
      textValue(row.status || ''),
      numericTimestamp(row.updatedAt || row.startedAt),
      jsonText(row),
    ])
  }

  for (const [index, row] of normalizedRows(state.agentTaskLedger).entries()) {
    const id = rowId('agent-task', row, index)
    run(db, 'INSERT OR REPLACE INTO agent_task_ledger (id, assistantId, chatId, status, updatedAt, json) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      textValue(row.assistantId || row.agentId || ''),
      textValue(row.chatId || ''),
      textValue(row.status || ''),
      numericTimestamp(row.updatedAt || row.createdAt),
      jsonText(row),
    ])
  }
}

function createSqliteStateStore({ dbPath }) {
  function info() {
    const filePath = dbPath()
    if (!DatabaseSync) {
      return {
        ok: false,
        path: filePath,
        schemaVersion: STATE_SCHEMA_VERSION,
        error: sqliteLoadError?.message || 'node:sqlite indisponible.',
      }
    }
    return {
      ok: true,
      path: filePath,
      schemaVersion: STATE_SCHEMA_VERSION,
      exists: fs.existsSync(filePath),
    }
  }

  function read() {
    const filePath = dbPath()
    if (!DatabaseSync || !fs.existsSync(filePath)) {
      return { ok: false, state: null, error: '' }
    }
    try {
      return withDb(filePath, db => {
        initSchema(db)
        const row = get(db, 'SELECT state_json FROM state_snapshots WHERE id = ?', [SNAPSHOT_ID])
        if (!row?.state_json) return { ok: false, state: null, error: '' }
        return { ok: true, state: parseJson(row.state_json, {}), source: 'sqlite', path: filePath }
      })
    } catch (error) {
      return { ok: false, state: null, error: error.message || String(error), path: filePath }
    }
  }

  function write(value) {
    const filePath = dbPath()
    try {
      const state = redactDeep(value || {})
      return withDb(filePath, db => {
        initSchema(db)
        const updatedAt = new Date().toISOString()
        db.exec('BEGIN IMMEDIATE')
        try {
          run(db, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(STATE_SCHEMA_VERSION)])
          run(db, 'INSERT OR REPLACE INTO state_snapshots (id, state_json, updatedAt) VALUES (?, ?, ?)', [
            SNAPSHOT_ID,
            jsonText(state),
            updatedAt,
          ])
          insertStructuredRows(db, state)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
        return { ok: true, path: filePath, source: 'sqlite', schemaVersion: STATE_SCHEMA_VERSION }
      })
    } catch (error) {
      return { ok: false, path: filePath, error: error.message || String(error) }
    }
  }

  function searchProjectFiles(query, { limit = 10 } = {}) {
    const filePath = dbPath()
    if (!DatabaseSync || !fs.existsSync(filePath)) return []
    const normalizedQuery = ftsQuery(query)
    if (!normalizedQuery) return []
    try {
      return withDb(filePath, db => {
        initSchema(db)
        return all(db, `
          SELECT pf.id, pf.projectId, pf.path, pf.name, pf.indexedAt, pf.json
          FROM project_files_fts fts
          JOIN project_files pf ON pf.id = fts.id
          WHERE project_files_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `, [normalizedQuery, Math.max(1, Math.min(50, Number(limit) || 10))]).map(row => ({
          ...parseJson(row.json, {}),
          id: row.id,
          projectId: row.projectId,
          path: row.path,
          name: row.name,
          indexedAt: row.indexedAt,
        }))
      })
    } catch {
      return []
    }
  }

  function searchMessages(query, { limit = 10, chatId = '' } = {}) {
    const filePath = dbPath()
    if (!DatabaseSync || !fs.existsSync(filePath)) return []
    const normalizedQuery = ftsQuery(query)
    if (!normalizedQuery) return []
    try {
      return withDb(filePath, db => {
        initSchema(db)
        const cappedLimit = Math.max(1, Math.min(50, Number(limit) || 10))
        const params = chatId
          ? [normalizedQuery, String(chatId), cappedLimit]
          : [normalizedQuery, cappedLimit]
        const where = chatId ? 'WHERE messages_fts MATCH ? AND fts.chatId = ?' : 'WHERE messages_fts MATCH ?'
        return all(db, `
          SELECT m.id, m.chatId, m.role, m.createdAt, m.json, c.title AS chatTitle, c.projectId
          FROM messages_fts fts
          JOIN messages m ON m.id = fts.id
          LEFT JOIN chats c ON c.id = m.chatId
          ${where}
          ORDER BY rank
          LIMIT ?
        `, params).map(row => ({
          ...parseJson(row.json, {}),
          id: row.id,
          chatId: row.chatId,
          role: row.role,
          createdAt: row.createdAt,
          chatTitle: row.chatTitle || '',
          projectId: row.projectId || '',
        }))
      })
    } catch {
      return []
    }
  }

  return {
    available: () => Boolean(DatabaseSync),
    info,
    read,
    write,
    searchMessages,
    searchProjectFiles,
  }
}

module.exports = {
  createSqliteStateStore,
  ftsQuery,
  normalizeSearchText,
}
