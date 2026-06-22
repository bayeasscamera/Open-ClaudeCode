/**
 * sessionIpc.cjs
 * IPC handlers for CLI session resume support.
 */

// Keep id length bounded so a malicious renderer cannot blow up the SQLite row.
const MAX_SESSION_ID_CHARS = 256

function normalizeSessionId(value) {
  const id = String(value || '').replace(/\u0000/g, '').trim()
  if (!id || id.length > MAX_SESSION_ID_CHARS) return ''
  return id
}

function normalizeMaxTurns(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(Math.floor(parsed), 1000)
}

function normalizeMaxBudgetUsd(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(parsed, 10_000)
}

function registerSessionIpc({ handle, sessionStore }) {
  /**
   * Return incomplete sessions (running|interrupted) for resume proposal.
   * Returns: Array<{ id, taskId, chatId, cwd, model, status, prompt, startedAt, updatedAt }>
   */
  handle('opc:session-list', async () => {
    try {
      return {
        ok: true,
        sessions: sessionStore.findIncomplete({ limit: 3 }),
      }
    } catch (error) {
      return { ok: false, sessions: [], error: error.message || String(error) }
    }
  })

  /**
   * Mark a session as dismissed (completed) — user chose not to resume.
   * Payload: { id: string }
   */
  handle('opc:session-mark-done', async (_event, payload) => {
    const id = normalizeSessionId(payload?.id)
    if (!id) return { ok: false, error: 'id manquant.' }
    try {
      return sessionStore.markCompleted(id)
    } catch (error) {
      return { ok: false, error: error.message || String(error) }
    }
  })

  /**
   * Read or patch session config fields (maxTurns, maxBudgetUsd).
   * Payload: { id: string, maxTurns?: number|null, maxBudgetUsd?: number|null }
   * If only id is provided, returns current session. Otherwise patches and returns ok.
   */
  handle('opc:session-config', async (_event, payload) => {
    const id = normalizeSessionId(payload?.id)
    if (!id) return { ok: false, error: 'id manquant.' }

    const hasMaxTurns = 'maxTurns' in (payload || {})
    const hasMaxBudget = 'maxBudgetUsd' in (payload || {})

    if (hasMaxTurns || hasMaxBudget) {
      // Patch: read-modify-write using the session ID as the lookup key
      // (same key we'll upsert with). Looking up by `taskId` while writing
      // by `id` would let a stale taskId row leak its fields into an
      // unrelated session, or silently create a brand-new row.
      //
      // taskId is routed through the same gate as `id` so a renderer cannot
      // smuggle control chars, oversized strings, or pad the column with
      // whitespace. We re-normalize `existing.taskId` defensively in case a
      // prior session was written through a less-strict code path.
      const existing = sessionStore.findById(id) || {}
      const existingTaskId = normalizeSessionId(existing.taskId)
      const patched = {
        ...existing,
        id,
        taskId: existingTaskId || normalizeSessionId(payload?.taskId),
        updatedAt: Date.now(),
      }
      if (hasMaxTurns) patched.maxTurns = normalizeMaxTurns(payload.maxTurns)
      if (hasMaxBudget) patched.maxBudgetUsd = normalizeMaxBudgetUsd(payload.maxBudgetUsd)
      return sessionStore.upsert(patched)
    }

    // Read-only: return session info by id
    const session = sessionStore.findById(id)
    return session
      ? { ok: true, session }
      : { ok: false, error: 'Session introuvable.' }
  })
}

module.exports = { registerSessionIpc, normalizeSessionId, normalizeMaxTurns, normalizeMaxBudgetUsd }
