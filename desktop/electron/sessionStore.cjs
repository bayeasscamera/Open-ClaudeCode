/**
 * sessionStore.cjs
 * Persist CLI session IDs per desktop task for native resume support.
 * Uses node:sqlite (available in Node 22.5+ / Electron 31+).
 */

const fs = require('node:fs')
const path = require('node:path')

let DatabaseSync = null
let sqliteLoadError = null
try {
  ;({ DatabaseSync } = require('node:sqlite'))
} catch (error) {
  sqliteLoadError = error
}

// Sessions updated within this window are eligible for resume proposals.
// Set to 7 days so a user coming back after a week still sees the "Session
// interrompue détectée" banner. The hard prune (`pruneOld`) still runs at 30
// days, so this only widens the *proposal* window — not the storage horizon.
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_RESUME_CANDIDATES = 3

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

function textValue(value) {
  return value == null ? '' : String(value)
}

function numericTimestamp(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
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

function dbRun(db, sql, params = []) {
  return db.prepare(sql).run(...params)
}

function dbAll(db, sql, params = []) {
  return db.prepare(sql).all(...params)
}

function dbGet(db, sql, params = []) {
  return db.prepare(sql).get(...params)
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS cli_sessions (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      chatId TEXT,
      cwd TEXT,
      model TEXT,
      status TEXT DEFAULT 'running',
      startedAt INTEGER,
      updatedAt INTEGER,
      maxTurns INTEGER,
      maxBudgetUsd REAL,
      prompt TEXT,
      json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cli_sessions_taskId ON cli_sessions(taskId);
    CREATE INDEX IF NOT EXISTS idx_cli_sessions_status ON cli_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_cli_sessions_updatedAt ON cli_sessions(updatedAt);
  `)
}

function rowToSession(row) {
  if (!row) return null
  const extra = parseJson(row.json, {})
  return {
    ...extra,
    id: row.id,
    taskId: row.taskId,
    chatId: row.chatId || '',
    cwd: row.cwd || '',
    model: row.model || '',
    status: row.status || 'running',
    startedAt: row.startedAt || 0,
    updatedAt: row.updatedAt || 0,
    maxTurns: row.maxTurns || null,
    maxBudgetUsd: row.maxBudgetUsd || null,
    prompt: row.prompt || '',
  }
}

function createSessionStore({ dbPath }) {
  function filePath() {
    return typeof dbPath === 'function' ? dbPath() : dbPath
  }

  function available() {
    return Boolean(DatabaseSync)
  }

  /**
   * Upsert a session record.
   * @param {Object} session
   */
  function upsert(session = {}) {
    if (!DatabaseSync) return { ok: false, error: 'node:sqlite indisponible.' }
    const id = textValue(session.id)
    if (!id) return { ok: false, error: 'session.id requis.' }
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        dbRun(db, `
          INSERT INTO cli_sessions
            (id, taskId, chatId, cwd, model, status, startedAt, updatedAt, maxTurns, maxBudgetUsd, prompt, json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            taskId = excluded.taskId,
            chatId = excluded.chatId,
            cwd = excluded.cwd,
            model = excluded.model,
            status = excluded.status,
            updatedAt = excluded.updatedAt,
            maxTurns = excluded.maxTurns,
            maxBudgetUsd = excluded.maxBudgetUsd,
            prompt = excluded.prompt,
            json = excluded.json
        `, [
          id,
          textValue(session.taskId),
          textValue(session.chatId),
          textValue(session.cwd),
          textValue(session.model),
          textValue(session.status || 'running'),
          numericTimestamp(session.startedAt),
          numericTimestamp(session.updatedAt || Date.now()),
          session.maxTurns != null ? Number(session.maxTurns) : null,
          session.maxBudgetUsd != null ? Number(session.maxBudgetUsd) : null,
          textValue(session.prompt).slice(0, 2000),
          jsonText(session),
        ])
        return { ok: true, id }
      })
    } catch (error) {
      return { ok: false, id, error: error.message || String(error) }
    }
  }

  /**
   * Find the most recent session for a given taskId.
   */
  function findByTaskId(taskId) {
    if (!DatabaseSync) return null
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        const row = dbGet(db,
          'SELECT * FROM cli_sessions WHERE taskId = ? ORDER BY updatedAt DESC LIMIT 1',
          [textValue(taskId)],
        )
        return rowToSession(row)
      })
    } catch {
      return null
    }
  }

  /**
   * Find a session by its primary key (session id). Returns null if missing.
   */
  function findById(id) {
    if (!DatabaseSync) return null
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        const row = dbGet(db, 'SELECT * FROM cli_sessions WHERE id = ?', [textValue(id)])
        return rowToSession(row)
      })
    } catch {
      return null
    }
  }

  /**
   * Find sessions with status running|interrupted updated within maxAgeSec.
   */
  function findIncomplete({ limit = MAX_RESUME_CANDIDATES, maxAgeMs = MAX_SESSION_AGE_MS } = {}) {
    if (!DatabaseSync) return []
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        const cutoff = Date.now() - maxAgeMs
        const rows = dbAll(db, `
          SELECT * FROM cli_sessions
          WHERE status IN ('running', 'interrupted')
            AND updatedAt >= ?
          ORDER BY updatedAt DESC
          LIMIT ?
        `, [cutoff, Math.max(1, Math.min(10, Number(limit) || MAX_RESUME_CANDIDATES))])
        return rows.map(rowToSession).filter(Boolean)
      })
    } catch {
      return []
    }
  }

  /**
   * Mark a session as completed.
   */
  function markCompleted(id) {
    if (!DatabaseSync) return { ok: false }
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        dbRun(db, 'UPDATE cli_sessions SET status = ?, updatedAt = ? WHERE id = ?', [
          'completed', Date.now(), textValue(id),
        ])
        return { ok: true }
      })
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  /**
   * Mark a session as interrupted (e.g. app closed while running).
   */
  function markInterrupted(id) {
    if (!DatabaseSync) return { ok: false }
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        dbRun(db, 'UPDATE cli_sessions SET status = ?, updatedAt = ? WHERE id = ?', [
          'interrupted', Date.now(), textValue(id),
        ])
        return { ok: true }
      })
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  /**
   * Mark all currently 'running' sessions as interrupted.
   * Called at app startup to fix sessions orphaned by a crash/force-quit.
   */
  function markOrphanedAsInterrupted() {
    if (!DatabaseSync) return { ok: false, count: 0 }
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        const result = dbRun(db,
          'UPDATE cli_sessions SET status = ?, updatedAt = ? WHERE status = ?',
          ['interrupted', Date.now(), 'running'],
        )
        return { ok: true, count: result?.changes || 0 }
      })
    } catch (error) {
      return { ok: false, count: 0, error: error.message }
    }
  }

  /**
   * Delete sessions older than maxAgeDays.
   */
  function pruneOld({ maxAgeDays = 30 } = {}) {
    if (!DatabaseSync) return { ok: false, count: 0 }
    try {
      return withDb(filePath(), db => {
        initSchema(db)
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
        const result = dbRun(db,
          'DELETE FROM cli_sessions WHERE updatedAt < ?',
          [cutoff],
        )
        return { ok: true, count: result?.changes || 0 }
      })
    } catch (error) {
      return { ok: false, count: 0, error: error.message }
    }
  }

  function info() {
    const fp = filePath()
    if (!DatabaseSync) {
      return {
        ok: false,
        path: fp,
        error: sqliteLoadError?.message || 'node:sqlite indisponible.',
      }
    }
    return {
      ok: true,
      path: fp,
      exists: fs.existsSync(fp),
    }
  }

  return {
    available,
    findById,
    findByTaskId,
    findIncomplete,
    info,
    markCompleted,
    markInterrupted,
    markOrphanedAsInterrupted,
    pruneOld,
    upsert,
  }
}

module.exports = { createSessionStore }
