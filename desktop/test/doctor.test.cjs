const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createDoctor, parseGitStatus, summarize } = require('../electron/doctor.cjs')

function providerConfigStore(profile = {}) {
  const selected = {
    model: 'mock/model',
    label: 'Mock Model',
    providerName: 'Mock',
    baseUrl: 'http://127.0.0.1:8317/v1',
    apiKey: 'secret',
    capabilities: {
      agent: true,
      streaming: true,
      tools: true,
      thinking: false,
      refine: true,
    },
    ...profile,
  }
  return {
    reload: () => ({ profiles: [selected], defaultModel: selected.model }),
    repairKnownProviderIssues: () => ({ repaired: false, count: 0 }),
    editableConfig: () => ({
      path: '/tmp/providers.json',
      defaultModel: selected.model,
      profiles: [{ ...selected, apiKeySet: Boolean(selected.apiKey), apiKey: undefined }],
    }),
    profileForModel: () => selected,
    capabilities: item => item.capabilities,
    requestTimeout: () => 300000,
    retryCount: () => 1,
    upstreamApi: () => 'openai',
    name: item => item.label || item.model,
    providerName: item => item.providerName || 'Mock',
  }
}

test('doctor parses git status and summarizes checks', () => {
  assert.deepEqual(parseGitStatus(' M src/app.js\n?? .env\n'), [
    { status: 'M', file: 'src/app.js' },
    { status: '??', file: '.env' },
  ])
  assert.deepEqual(summarize([{ status: 'ok' }, { status: 'warning' }, { status: 'error' }]), {
    status: 'error',
    ok: false,
    errors: 1,
    warnings: 1,
    infos: 0,
    passed: 1,
    total: 3,
  })
})

test('doctor returns runtime, provider, memory and installation checks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-doctor-'))
  const appPath = path.join(dir, 'OPC.app')
  fs.mkdirSync(path.join(appPath, 'Contents', 'Resources', 'opc', 'package'), { recursive: true })
  fs.writeFileSync(path.join(appPath, 'Contents', 'Resources', 'opc', 'package', 'cli.js'), '#!/usr/bin/env node\n')
  const doctor = createDoctor({
    appPath,
    projectRoot: () => dir,
    cliRunner: {
      version: () => ({ ok: true, node: 'v22', cli: '/tmp/cli.js', version: '2.1.88' }),
      runtimeStatus: () => ({ active: null, tracked: [] }),
    },
    providerConfigStore: providerConfigStore(),
    memoryStore: {
      info: () => ({ enabled: true, path: path.join(dir, 'OPC_MEMORY.md'), recentCount: 2 }),
    },
    desktopStateStore: {
      read: () => ({ ok: true, state: {} }),
    },
    appRuntime: () => ({ running: true, pids: [1234], processes: ['1234 /Applications/OPC.app/Contents/MacOS/OPC'] }),
    releaseTrust: () => ({
      status: 'warning',
      detail: 'Signature ad hoc ou notarization absente.',
      meta: { signed: false, notarized: false },
    }),
  })

  const report = doctor.run({ cwd: dir, model: 'mock/model' })
  assert.equal(report.ok, true)
  assert.equal(report.summary.errors, 0)
  assert.equal(report.checks.some(item => item.id === 'cli' && item.status === 'ok'), true)
  assert.equal(report.checks.some(item => item.id === 'provider-repair' && item.status === 'ok'), true)
  assert.equal(report.checks.some(item => item.id === 'provider-selected' && item.status === 'ok'), true)
  assert.equal(report.checks.some(item => item.id === 'installed-app' && item.status === 'ok'), process.platform === 'darwin')
  assert.equal(report.checks.some(item => item.id === 'installed-app-runtime' && item.status === 'warning' && item.meta.pids[0] === 1234), process.platform === 'darwin')
  assert.equal(report.checks.some(item => item.id === 'release-trust' && item.status === 'warning'), process.platform === 'darwin')
})
