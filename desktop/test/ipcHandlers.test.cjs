const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { IPC_INVOKE_CHANNELS } = require('../electron/ipcContract.cjs')
const { registerIpcHandlers } = require('../electron/ipcHandlers.cjs')
const { scanProjectFolder } = require('../electron/projectFiles.cjs')

function createHarness(overrides = {}) {
  const calls = []
  const handlers = {}
  registerIpcHandlers({
    ipcMain: {
      handle: (channel, handler) => {
        handlers[channel] = handler
      },
    },
    clipboard: {
      writeText: text => calls.push(['clipboard', text]),
      readText: () => 'clipboard text',
    },
    dialog: overrides.dialog,
    shell: {
      openExternal: async target => calls.push(['openExternal', target]),
      openPath: async target => {
        calls.push(['openPath', target])
        return ''
      },
    },
    startProviderBridge: async () => {
      calls.push(['bridge'])
      return { port: 49152 }
    },
	    cliRunner: {
	      version: () => ({ ok: true, node: 'v22', cli: '/tmp/cli.js', version: '2.1.88' }),
	      runtimeStatus: overrides.runtimeStatus || (() => ({ active: false })),
      run: payload => {
        calls.push(['run', payload])
        return { ok: true }
      },
      stop: () => true,
      cleanupRuntime: () => ({ cleaned: true }),
    },
    providerConfigStore: {
      reload: () => ({ baseUrl: 'http://127.0.0.1:9999/v1', defaultModel: 'mock/model' }),
      profiles: () => [{ model: 'mock/model' }],
      editableConfig: () => ({ profiles: [{ model: 'mock/model' }] }),
      repairKnownProviderIssues: () => ({ repaired: true, count: 1, changes: [{ scope: 'profile', model: 'mock/model', field: 'baseUrl', message: 'Base URL canonisée.' }] }),
      exportConfig: () => ({ version: 1, profiles: [{ model: 'mock/model' }] }),
      importConfig: payload => ({ imported: payload }),
      upsertProfile: payload => ({ profile: payload }),
      deleteProfile: model => ({ deleted: model }),
      setDefaultModel: model => ({ defaultModel: model }),
      quarantineProfiles: (models, reason) => ({ config: { quarantined: models, reason }, changed: models.length }),
      restoreProfiles: models => ({ config: { restored: models }, changed: models.length }),
    },
    memoryStore: {
      info: () => ({ enabled: true }),
    },
    desktopStateStore: {
      read: () => ({ ok: true, state: { activeChatId: 'chat-1' } }),
      write: value => ({ ok: true, value }),
      searchState: payload => ({ ok: true, payload, rows: [{ id: 'row-1' }] }),
    },
    providerChecker: {
      check: model => ({ ok: true, model }),
    },
    providerModelDiscovery: {
      discover: payload => ({ ok: true, import: false, payload }),
      discoverAndImport: payload => ({ ok: true, imported: true, payload }),
    },
    doctor: {
      run: payload => ({ ok: true, payload }),
    },
    promptRefiner: {
      refine: payload => ({ ok: true, text: `refined:${payload.prompt}`, model: payload.model }),
    },
	    projectRoot: () => '/tmp/project',
	    processKiller: pid => ({ killed: pid }),
	    processInspector: overrides.processInspector,
	    serviceProber: tasks => tasks,
  })
  return { calls, handlers }
}

test('ipc handlers register the expected public channel contract', () => {
  const { handlers } = createHarness()
  assert.deepEqual(Object.keys(handlers), IPC_INVOKE_CHANNELS)
})

test('ipc handlers expose health and run through validated dependencies', async () => {
  const { calls, handlers } = createHarness()
  const health = await handlers['opc:health']()
  assert.equal(health.ok, true)
  assert.equal(health.provider.bridgeUrl, 'http://127.0.0.1:49152')

  const run = await handlers['opc:run'](null, { prompt: 'OK', cwd: '/tmp/project', model: 'mock/model', permissionMode: 'acceptEdits' })
  assert.deepEqual(run, { ok: true })
  assert.equal(calls.filter(([name]) => name === 'bridge').length, 2)
  assert.equal(calls.some(([name, payload]) => name === 'run' && payload.prompt === 'OK'), true)
})

test('ipc handlers handle clipboard, state, process and provider actions', async () => {
  const { calls, handlers } = createHarness()

  assert.equal(await handlers['opc:copy-text'](null, '  '), false)
  assert.equal(await handlers['opc:copy-text'](null, 'copie'), true)
  assert.deepEqual(calls.find(([name]) => name === 'clipboard'), ['clipboard', 'copie'])
  assert.equal(await handlers['opc:read-clipboard'](), 'clipboard text')

  assert.deepEqual(await handlers['opc:load-state'](), { ok: true, state: { activeChatId: 'chat-1' } })
  assert.deepEqual(await handlers['opc:save-state'](null, { activeChatId: 'chat-2' }), { ok: true, value: { activeChatId: 'chat-2' } })
  assert.deepEqual(await handlers['opc:search-state'](null, { type: 'messages', query: '  compactage provider ', limit: 200, chatId: 'chat-1' }), {
    ok: true,
    payload: { type: 'messages', query: 'compactage provider', limit: 50, chatId: 'chat-1' },
    rows: [{ id: 'row-1' }],
  })
  assert.deepEqual(await handlers['opc:kill-pid'](null, { pid: '42' }), {
    ok: false,
    pid: 42,
    error: 'PID non suivi par OPC ou tâche longue non vérifiable.',
  })
  assert.deepEqual(await handlers['opc:provider-check'](null, { model: 'mock/model' }), { ok: true, model: 'mock/model' })
  assert.deepEqual(await handlers['opc:provider-discover'](null, { model: 'mock/model', import: false }), { ok: true, import: false, payload: { model: 'mock/model', baseUrl: '', providerName: '', upstreamApi: '', transport: '', timeoutMs: 0, checkTimeoutMs: 0, retries: 0, maxTokens: 0, apiKey: '', noAuth: false, capabilities: {}, import: false } })
  assert.deepEqual(await handlers['opc:doctor'](null, { cwd: '"/tmp/project"', model: 'mock/model' }), { ok: true, payload: { cwd: '/tmp/project', model: 'mock/model' } })
  assert.deepEqual(await handlers['opc:refine-prompt'](null, { prompt: 'ameliore', model: 'mock/model' }), { ok: true, text: 'refined:ameliore', model: 'mock/model' })
  assert.deepEqual(await handlers['opc:provider-config'](), { ok: true, config: { profiles: [{ model: 'mock/model' }] } })
  assert.deepEqual(await handlers['opc:provider-repair'](), {
    ok: true,
    repair: { repaired: true, count: 1, changes: [{ scope: 'profile', model: 'mock/model', field: 'baseUrl', message: 'Base URL canonisée.' }] },
    config: { profiles: [{ model: 'mock/model' }] },
  })
  assert.deepEqual(await handlers['opc:provider-export'](), { ok: true, config: { version: 1, profiles: [{ model: 'mock/model' }] } })
  assert.deepEqual(await handlers['opc:provider-import'](null, { profiles: [{ model: 'imported' }] }), { ok: true, config: { imported: { profiles: [{ model: 'imported' }] } } })
  assert.deepEqual(await handlers['opc:provider-upsert'](null, { model: 'upserted' }), { ok: true, config: { profile: { model: 'upserted' } } })
  assert.deepEqual(await handlers['opc:provider-delete'](null, { model: 'old' }), { ok: true, config: { deleted: 'old' } })
  assert.deepEqual(await handlers['opc:provider-default'](null, { model: 'mock/model' }), { ok: true, config: { defaultModel: 'mock/model' } })
  assert.deepEqual(await handlers['opc:provider-quarantine'](null, { models: ['bad/model'], reason: 'timeout' }), { ok: true, config: { quarantined: ['bad/model'], reason: 'timeout' }, changed: 1 })
  assert.deepEqual(await handlers['opc:provider-restore'](null, { model: 'bad/model' }), { ok: true, config: { restored: ['bad/model'] }, changed: 1 })
})

test('ipc handlers export and import full desktop state backups', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-state-backup-'))
  const backupPath = path.join(dir, 'opc-state-backup.json')
  const { handlers } = createHarness({
    dialog: {
      showSaveDialog: async options => {
        assert.equal(options.filters[0].extensions[0], 'json')
        return { canceled: false, filePath: backupPath }
      },
      showOpenDialog: async options => {
        assert.equal(options.filters[0].extensions[0], 'json')
        return { canceled: false, filePaths: [backupPath] }
      },
    },
  })

  const exported = await handlers['opc:export-state-backup'](null, {
    state: {
      activeChatId: 'chat-1',
      chats: [{ id: 'chat-1', messages: [] }],
      providers: [{ apiKey: 'sk-secret-token-1234567890' }],
    },
  })
  assert.equal(exported.ok, true)
  assert.equal(exported.path, backupPath)
  const raw = fs.readFileSync(backupPath, 'utf8')
  assert.doesNotMatch(raw, /sk-secret-token-1234567890/)

  const imported = await handlers['opc:import-state-backup']()
  assert.equal(imported.ok, true)
  assert.equal(imported.path, backupPath)
  assert.equal(imported.state.activeChatId, 'chat-1')
})

test('ipc handlers export a redacted support bundle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-support-'))
  const exportPath = path.join(dir, 'support.json')
  const { handlers } = createHarness({
    dialog: {
      showSaveDialog: async options => {
        assert.equal(options.filters[0].extensions[0], 'json')
        return { canceled: false, filePath: exportPath }
      },
    },
  })

  const result = await handlers['opc:export-support-bundle'](null, {
    cwd: dir,
    model: 'mock/model',
    report: {
      ok: true,
      checks: [{
        id: 'provider',
        status: 'error',
        meta: {
          apiKey: 'sk-secret-token-1234567890',
          authorization: 'Bearer secret-token-1234567890',
        },
      }],
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.path, exportPath)
  const raw = fs.readFileSync(exportPath, 'utf8')
  assert.doesNotMatch(raw, /sk-secret-token-1234567890/)
  assert.doesNotMatch(raw, /Bearer secret-token-1234567890/)
  assert.match(raw, /\[REDACTED\]/)
  assert.equal(fs.statSync(exportPath).mode & 0o777, 0o600)
  const bundle = JSON.parse(raw)
  assert.equal(bundle.version, 2)
  assert.equal(bundle.context.cwd, dir)
  assert.equal(bundle.doctor.report.checks[0].meta.apiKey, '[REDACTED]')
})

test('ipc handlers kill only tracked runtime pids or verified long tasks', async () => {
  const tracked = createHarness({
    runtimeStatus: () => ({ active: { pid: 42, children: [43] }, tracked: [] }),
  })
  assert.deepEqual(await tracked.handlers['opc:kill-pid'](null, { pid: '43' }), { killed: 43 })

  const verified = createHarness({
    processInspector: (pid, command) => pid === 50 && command === 'pnpm start',
  })
  assert.deepEqual(await verified.handlers['opc:kill-pid'](null, {
    pid: '50',
    command: 'pnpm start',
    cwd: '/tmp/project',
  }), { killed: 50 })
})

test('ipc handlers select project files with stable metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-files-'))
  const filePath = path.join(dir, 'notes.md')
  const secretPath = path.join(dir, '.env')
  fs.writeFileSync(filePath, 'notes')
  fs.writeFileSync(secretPath, 'TOKEN=secret')
  const { handlers } = createHarness({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [filePath, secretPath, path.join(dir, 'missing.md')] }),
    },
  })

  const result = await handlers['opc:select-project-files']()
  assert.equal(result.ok, true)
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].path, filePath)
  assert.equal(result.files[0].name, 'notes.md')
  assert.equal(result.files[0].size, 5)

  const read = await handlers['opc:read-project-file'](null, { path: filePath })
  assert.equal(read.ok, true)
  assert.equal(read.content, 'notes')
  assert.equal(read.truncated, false)

  const rejected = await handlers['opc:read-project-file'](null, { path: secretPath })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /autorisé|secret/i)
})

test('ipc handlers reject project file reads until a file or folder is authorized', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-read-guard-'))
  const filePath = path.join(dir, 'notes.md')
  fs.writeFileSync(filePath, 'notes')
  const { handlers } = createHarness()

  const rejected = await handlers['opc:read-project-file'](null, { path: filePath })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /non autorisé/)
})

test('ipc handlers select project folders with bounded text scan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-folder-'))
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'README.md'), '# Project')
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log("ok")')
  fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'ignored')
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=ignored')
  fs.writeFileSync(path.join(dir, 'asset.png'), Buffer.from([0, 1, 2, 3]))

  const { handlers } = createHarness({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [dir] }),
    },
  })

  const result = await handlers['opc:select-project-folder']()
  assert.equal(result.ok, true)
  assert.equal(result.folder, dir)
  assert.equal(result.files.length, 2)
  assert.deepEqual(result.files.map(file => file.name).sort(), ['README.md', 'app.js'])
  assert.equal(result.skipped.directories >= 1, true)

  const read = await handlers['opc:read-project-file'](null, { path: path.join(dir, 'src', 'app.js') })
  assert.equal(read.ok, true)
  assert.equal(read.content, 'console.log("ok")')
})

test('project folder scan prioritizes Claude skills and practice profiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-skill-folder-'))
  fs.mkdirSync(path.join(dir, 'z-docs'), { recursive: true })
  for (let index = 0; index < 10; index += 1) {
    fs.writeFileSync(path.join(dir, 'z-docs', `note-${index}.md`), `# Note ${index}`)
  }
  fs.mkdirSync(path.join(dir, 'commercial-legal', 'skills', 'review'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'commercial-legal', '.claude-plugin'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents')
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"permissions":{"allow":["Read(*)"]}}')
  fs.writeFileSync(path.join(dir, 'commercial-legal', 'CLAUDE.md'), '# Profile')
  fs.writeFileSync(path.join(dir, 'commercial-legal', 'skills', 'review', 'SKILL.md'), '---\nname: review\n---')
  fs.writeFileSync(path.join(dir, 'commercial-legal', '.claude-plugin', 'plugin.json'), '{"name":"commercial-legal"}')

  const result = scanProjectFolder(dir, { limit: 3 })
  assert.deepEqual(result.files.map(file => file.path.replace(`${dir}/`, '')), [
    'commercial-legal/CLAUDE.md',
    'AGENTS.md',
    '.claude/settings.json',
  ])
})

test('ipc handlers export and import project bundles', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-project-'))
  const exportPath = path.join(dir, 'Research.opc-project.json')
  const { handlers } = createHarness({
    dialog: {
      showSaveDialog: async () => ({ canceled: false, filePath: exportPath }),
      showOpenDialog: async () => ({ canceled: false, filePaths: [exportPath] }),
    },
  })

  const payload = {
    version: 1,
    project: { name: 'Research', memory: 'memo', instructions: 'inst', files: [] },
    chats: [],
  }
  const exported = await handlers['opc:export-project'](null, payload)
  assert.equal(exported.ok, true)
  assert.equal(fs.existsSync(exportPath), true)

  const imported = await handlers['opc:import-project']()
  assert.equal(imported.ok, true)
  assert.equal(imported.bundle.project.name, 'Research')

  fs.writeFileSync(exportPath, JSON.stringify({ project: [] }))
  const invalid = await handlers['opc:import-project']()
  assert.equal(invalid.ok, false)
  assert.match(invalid.error, /Format de projet/)
})

test('ipc handlers restrict open-path targets and service probes', async () => {
  const { calls, handlers } = createHarness()

  assert.deepEqual(await handlers['opc:open-path'](null, 'http://127.0.0.1:18000'), { ok: true, path: 'http://127.0.0.1:18000' })
  assert.equal(calls.some(([name, target]) => name === 'openExternal' && target === 'http://127.0.0.1:18000'), true)

  const remote = await handlers['opc:open-path'](null, 'https://example.com')
  assert.equal(remote.ok, false)

  const probed = await handlers['opc:probe-services'](null, {
    tasks: [{ id: 'task-1', services: [{ name: 'web', url: 'http://localhost:18000' }, { name: 'remote', url: 'https://example.com' }] }],
  })
  assert.equal(probed.length, 1)
  assert.equal(probed[0].services.length, 1)
})
