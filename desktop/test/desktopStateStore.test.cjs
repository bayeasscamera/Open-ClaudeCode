const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createDesktopStateStore, importStateBackup, isStateBackupLike, MAX_STATE_BACKUP_BYTES } = require('../electron/desktopStateStore.cjs')
const { createSqliteStateStore, ftsQuery, normalizeSearchText } = require('../electron/persistence/sqliteStateStore.cjs')

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-desktop-state-'))
  const filePath = path.join(root, 'state', 'desktop-state.json')
  return { filePath, store: createDesktopStateStore({ statePath: () => filePath, enableSqlite: false }) }
}

test('desktop state store reports missing state without failing', () => {
  const { store } = createStore()
  const result = store.read()
  assert.equal(result.ok, false)
  assert.equal(result.state, null)
  assert.equal(result.error, '')
})

test('desktop state store writes private JSON and reads it back', () => {
  const { filePath, store } = createStore()
  const payload = { activeChatId: 'chat-1', settings: { cwd: '/tmp/project' } }
  const write = store.write(payload)

  assert.equal(write.ok, true)
  assert.equal(write.path, filePath)
  assert.deepEqual(store.read(), { ok: true, state: payload })
  assert.equal((fs.statSync(filePath).mode & 0o777), 0o600)
})

test('desktop state store redacts secrets before durable persistence', () => {
  const { filePath, store } = createStore()
  const payload = {
    chats: [{
      messages: [
        { role: 'user', content: 'api_key: nvapi-secretSECRET1234567890' },
        { role: 'assistant', content: 'Bearer sk-testSECRET1234567890' },
      ],
    }],
  }

  const write = store.write(payload)
  const raw = fs.readFileSync(filePath, 'utf8')

  assert.equal(write.ok, true)
  assert.equal(raw.includes('nvapi-secret'), false)
  assert.equal(raw.includes('sk-test'), false)
  assert.match(raw, /\[REDACTED\]/)
})

test('desktop state backup import rejects oversized and malformed JSON shapes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-state-import-'))
  const invalidPath = path.join(dir, 'invalid.json')
  const oversizedPath = path.join(dir, 'oversized.json')
  fs.writeFileSync(invalidPath, JSON.stringify({ chats: { bad: true } }))
  fs.writeFileSync(oversizedPath, `${' '.repeat(MAX_STATE_BACKUP_BYTES + 1)}`)

  const invalid = await importStateBackup({
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [invalidPath] }) },
  })
  const oversized = await importStateBackup({
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [oversizedPath] }) },
  })

  assert.equal(isStateBackupLike({ state: { chats: [], settings: {} } }), true)
  assert.equal(invalid.ok, false)
  assert.match(invalid.error, /Format de sauvegarde/)
  assert.equal(oversized.ok, false)
  assert.match(oversized.error, /trop volumineuse/)
})

test('desktop state store writes SQLite mirror and prefers it on read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-desktop-state-sqlite-'))
  const jsonPath = path.join(root, 'state', 'desktop-state.json')
  const sqlitePath = path.join(root, 'state', 'desktop-state.sqlite')
  const store = createDesktopStateStore({
    statePath: () => jsonPath,
    sqlitePath: () => sqlitePath,
  })
  const payload = {
    activeChatId: 'chat-1',
    chats: [{
      id: 'chat-1',
      title: 'SQLite',
      createdAt: '2026-06-04T00:00:00.000Z',
      messages: [{ id: 'm1', role: 'user', content: 'hello sqlite' }],
    }],
    projects: [{
      id: 'project-1',
      name: 'OPC',
      updatedAt: '2026-06-04T00:00:00.000Z',
      files: [{
        id: 'file-1',
        name: 'runtime.md',
        path: '/repo/runtime.md',
        summary: 'agent runtime ledger',
        preview: 'Task ledger and verification engine',
        searchIndex: 'runtime ledger verification',
      }],
    }],
    agentTaskLedger: [{ id: 'task-1', status: 'verified', title: 'Ledger', updatedAt: 1 }],
  }

  const write = store.write(payload)
  assert.equal(write.ok, true)
  assert.equal(write.sqlite.ok, true)
  assert.equal(fs.existsSync(sqlitePath), true)
  fs.rmSync(jsonPath)

  const read = store.read()
  assert.equal(read.ok, true)
  assert.equal(read.state.activeChatId, 'chat-1')
  assert.equal(read.source, 'sqlite')
  assert.equal(store.info().sqlite.ok, true)
})

test('sqlite state store exposes FTS project file search', () => {
  assert.equal(normalizeSearchText('Réglages projet'), 'reglages projet')
  assert.equal(ftsQuery('Réglages projet'), '"reglages" "projet"')

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-sqlite-fts-'))
  const sqlitePath = path.join(root, 'state.sqlite')
  const store = createSqliteStateStore({ dbPath: () => sqlitePath })
  store.write({
    projects: [{
      id: 'project-1',
      files: [{
        id: 'file-1',
        name: 'runtime.md',
        path: '/repo/runtime.md',
        summary: 'agent runtime ledger',
        preview: 'verification engine',
        searchIndex: 'ledger verification sqlite',
      }],
    }],
  })

  const rows = store.searchProjectFiles('ledger', { limit: 5 })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].path, '/repo/runtime.md')
})

test('sqlite state store exposes FTS message search with chat metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-sqlite-message-fts-'))
  const sqlitePath = path.join(root, 'state.sqlite')
  const store = createSqliteStateStore({ dbPath: () => sqlitePath })
  store.write({
    chats: [{
      id: 'chat-1',
      title: 'Provider diagnostics',
      projectId: 'project-1',
      messages: [
        { id: 'm1', role: 'user', content: 'pourquoi le provider ollama refuse le prompt' },
        { id: 'm2', role: 'assistant', content: 'Diagnostic provider: contexte trop long, compactage requis.' },
      ],
    }],
  })

  const rows = store.searchMessages('compactage provider', { limit: 5 })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'm2')
  assert.equal(rows[0].chatId, 'chat-1')
  assert.equal(rows[0].chatTitle, 'Provider diagnostics')
  assert.equal(rows[0].role, 'assistant')
})

test('desktop state store falls back to JSON when SQLite mirror is unreadable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-desktop-state-sqlite-fallback-'))
  const jsonPath = path.join(root, 'state', 'desktop-state.json')
  const sqlitePath = path.join(root, 'state', 'desktop-state.sqlite')
  const store = createDesktopStateStore({
    statePath: () => jsonPath,
    sqlitePath: () => sqlitePath,
  })

  const payload = { activeChatId: 'chat-json', chats: [{ id: 'chat-json', messages: [] }] }
  const write = store.write(payload)
  assert.equal(write.ok, true)
  fs.writeFileSync(sqlitePath, 'not a sqlite database')

  const read = store.read()
  assert.equal(read.ok, true)
  assert.equal(read.state.activeChatId, 'chat-json')
  assert.equal(read.source, undefined)
})

test('desktop state store searches JSON fallback when SQLite is disabled', () => {
  const { store } = createStore()
  store.write({
    chats: [{
      id: 'chat-json',
      title: 'Fallback',
      messages: [{ id: 'm-json', role: 'assistant', content: 'Recherche locale sans sqlite' }],
    }],
    projects: [{
      id: 'project-json',
      files: [{ id: 'f-json', path: '/repo/fallback.md', name: 'fallback.md', summary: 'Recherche fichier locale' }],
    }],
  })

  const messages = store.searchState({ type: 'messages', query: 'locale sqlite', limit: 5 })
  const files = store.searchState({ type: 'project_files', query: 'fichier locale', limit: 5 })
  assert.equal(messages.ok, true)
  assert.equal(messages.source, 'json')
  assert.equal(messages.rows[0].id, 'm-json')
  assert.equal(messages.rows[0].chatTitle, 'Fallback')
  assert.equal(files.ok, true)
  assert.equal(files.rows[0].path, '/repo/fallback.md')
})
