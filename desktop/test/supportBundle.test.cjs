const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  buildSupportBundle,
  providerTelemetryFromState,
  runtimeTelemetry,
} = require('../electron/supportBundle.cjs')

test('support bundle summarizes provider latency and runtime first stream metrics', () => {
  const state = {
    providerChecks: {
      fast: { model: 'fast', ok: true, category: 'ok', latencyMs: 120, checkedAt: 2 },
    },
    providerCheckHistory: [
      { id: 'slow', model: 'slow', ok: false, category: 'timeout', latencyMs: 3000, checkedAt: 1 },
    ],
  }

  assert.deepEqual(providerTelemetryFromState(state), {
    checks: 2,
    ok: 1,
    failed: 1,
    avgLatencyMs: 1560,
    p95LatencyMs: 3000,
    maxLatencyMs: 3000,
    buckets: { timeout: 1, ok: 1 },
  })
  assert.deepEqual(runtimeTelemetry({
    active: { firstTextMs: 780, providerElapsedMs: 500, toolCount: 2 },
    tracked: [{ firstTextMs: 900 }],
  }), {
    active: true,
    tracked: 1,
    firstTextMs: 780,
    providerElapsedMs: 500,
    toolCount: 2,
  })
})

test('support bundle includes redacted provider events and telemetry', () => {
  const bundle = buildSupportBundle({
    cliRunner: {
      version: () => ({ ok: true, version: '2.1.88' }),
      runtimeStatus: () => ({ active: { firstTextMs: 400, providerElapsedMs: 250, toolCount: 1 }, tracked: [] }),
    },
    providerConfigStore: {
      exportConfig: () => ({ profiles: [{ model: 'safe/model' }] }),
      providerEvents: () => [{ action: 'added', model: 'safe/model', keyState: 'configured' }],
    },
    memoryStore: {
      info: () => ({ enabled: true }),
    },
    desktopStateStore: {
      read: () => ({
        ok: true,
        state: {
          providerCheckHistory: [{ id: 'one', model: 'safe/model', ok: true, category: 'ok', latencyMs: 100 }],
          secret: 'sk-secret-token-1234567890',
        },
      }),
    },
    projectRoot: () => '/tmp/opc',
  }, { cwd: '/tmp/opc', model: 'safe/model' })

  const raw = JSON.stringify(bundle)
  assert.equal(bundle.telemetry.provider.avgLatencyMs, 100)
  assert.equal(bundle.telemetry.runtime.firstTextMs, 400)
  assert.equal(bundle.providerEvents[0].action, 'added')
  assert.doesNotMatch(raw, /sk-secret-token-1234567890/)
  assert.match(raw, /\[REDACTED\]/)
})

test('support bundle v2 summarizes agent ledger context budget and provider routing', () => {
  const bundle = buildSupportBundle({
    cliRunner: {
      version: () => ({ ok: true, version: '2.1.88' }),
      runtimeStatus: () => ({ active: null, tracked: [] }),
    },
    providerConfigStore: {
      exportConfig: () => ({ profiles: [{ model: 'agent/model', capabilities: { tools: true }, maxInputTokens: 12000 }] }),
      providerEvents: () => [],
    },
    memoryStore: {
      info: () => ({ enabled: true }),
    },
    desktopStateStore: {
      info: () => ({ sqlite: { ok: true, path: '/tmp/opc.sqlite' } }),
      read: () => ({
        ok: true,
        source: 'sqlite',
        state: {
          agentTaskLedger: [
            { id: 'task-1', status: 'verified', verification: 'npm test', events: [{ kind: 'tool' }, { kind: 'verified' }] },
            { id: 'task-2', status: 'needs_verification', events: [] },
          ],
          agentWorkers: [
            { id: 'worker-1', status: 'running', phase: 'execute', events: [{ kind: 'running' }] },
            { id: 'worker-2', status: 'blocked', phase: 'correct', blockedReason: 'test failed', events: [] },
          ],
          chats: [{
            messages: [{
              projectRuntimeContext: {
                contextBudget: {
                  compacted: true,
                  model: 'small/model',
                  beforeChars: 10000,
                  afterChars: 3000,
                  budgetChars: 3500,
                },
              },
            }],
          }],
        },
      }),
    },
    projectRoot: () => '/tmp/opc',
  }, { cwd: '/tmp/opc', model: 'agent/model' })

  assert.equal(bundle.version, 2)
  assert.equal(bundle.persistence.runtime.sqlite.ok, true)
  assert.equal(bundle.telemetry.agentLedger.total, 2)
  assert.equal(bundle.telemetry.agentLedger.statuses.verified, 1)
  assert.equal(bundle.telemetry.agentLedger.statuses.needs_verification, 1)
  assert.equal(bundle.telemetry.agentWorkers.total, 2)
  assert.equal(bundle.telemetry.agentWorkers.active, 1)
  assert.equal(bundle.telemetry.agentWorkers.blocked, 1)
  assert.equal(bundle.telemetry.contextBudget.compacted, 1)
  assert.equal(bundle.telemetry.providerRouting.agentProfiles, 1)
})

test('support bundle v2 includes bounded redacted runtime artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-support-artifacts-'))
  const logsDir = path.join(root, 'logs')
  const crashDir = path.join(root, 'crashes')
  fs.mkdirSync(logsDir)
  fs.mkdirSync(crashDir)
  fs.writeFileSync(path.join(logsDir, 'desktop.log'), [
    'OPC started',
    'api_key: sk-secret-token-1234567890',
    'provider ready',
  ].join('\n'))
  fs.writeFileSync(path.join(crashDir, 'main.dmp'), 'minidump bytes')

  const bundle = buildSupportBundle({
    cliRunner: {
      version: () => ({ ok: true, version: '2.1.88' }),
      runtimeStatus: () => ({ active: null, tracked: [] }),
    },
    providerConfigStore: {
      exportConfig: () => ({ profiles: [] }),
      providerEvents: () => [],
    },
    memoryStore: {
      info: () => ({ enabled: true }),
    },
    desktopStateStore: {
      info: () => ({ sqlite: { ok: false } }),
      read: () => ({ ok: true, state: {} }),
    },
    logsDir: () => logsDir,
    crashDir: () => crashDir,
    projectRoot: () => '/tmp/opc',
  })

  const raw = JSON.stringify(bundle)
  assert.equal(bundle.runtimeArtifacts.logs.files[0].name, 'desktop.log')
  assert.equal(bundle.runtimeArtifacts.crashes.files[0].name, 'main.dmp')
  assert.match(bundle.runtimeArtifacts.logs.desktopLogTail, /OPC started/)
  assert.doesNotMatch(raw, /sk-secret-token-1234567890/)
  assert.match(raw, /\[REDACTED\]/)
})
