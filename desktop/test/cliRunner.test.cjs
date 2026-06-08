const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  bundledPluginDirs,
  classifyLongRunningTool,
  createCliRunner,
  resolveCwd,
  stripPathShellQuotes,
  toolIdleTimeoutMs,
} = require('../electron/cliRunner.cjs')

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-cli-runner-'))
  const packageDir = path.join(root, 'package')
  fs.mkdirSync(packageDir, { recursive: true })
  const cliPath = path.join(packageDir, 'cli.js')
  fs.writeFileSync(
    cliPath,
    `#!/usr/bin/env node
const promptIndex = process.argv.indexOf('-p')
const prompt = promptIndex >= 0 ? process.argv[promptIndex + 1] : ''
if (process.argv.includes('--version')) {
  console.log('2.1.88 mock')
  process.exit(0)
}
if (prompt === 'sleep') {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', cwd: process.cwd(), model: process.env.ANTHROPIC_MODEL, permissionMode: 'acceptEdits', tools: ['Bash'] }))
  setInterval(() => {}, 1000)
} else if (prompt === 'result-hangs') {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', cwd: process.cwd(), model: process.env.ANTHROPIC_MODEL, permissionMode: 'acceptEdits', tools: ['Bash'] }))
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Started background task' }] } }))
  console.log(JSON.stringify({ type: 'result', result: 'Started background task', is_error: false }))
  setInterval(() => {}, 1000)
	} else if (prompt === 'tool') {
	  console.log(JSON.stringify({ type: 'system', subtype: 'init', cwd: process.cwd(), model: process.env.ANTHROPIC_MODEL, permissionMode: 'acceptEdits', tools: ['Bash'] }))
	  console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} } } }))
	  console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{\\"command\\":\\"pnpm test\\"}' } } }))
	  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Tool done' }] } }))
	  console.log(JSON.stringify({ type: 'result', result: 'Tool done', is_error: false }))
	} else if (prompt === 'big-output') {
	  console.log('x'.repeat(1024 * 1024 + 20000))
	  console.error('e'.repeat(300000))
	  console.log(JSON.stringify({ type: 'result', result: 'Bounded OK', is_error: false }))
	} else if (prompt === 'stderr-fail') {
	  console.error('mock fatal: provider rejected unsupported parameter')
	  process.exit(1)
	} else {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', cwd: process.cwd(), model: process.env.ANTHROPIC_MODEL, permissionMode: 'acceptEdits', tools: ['Bash', 'Read'] }))
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } }))
  console.log(JSON.stringify({ type: 'result', result: 'OK', is_error: false }))
}
`,
    'utf8',
  )
  fs.chmodSync(cliPath, 0o755)
  return { root, cliPath }
}

function createBundledGstackPlugin(root) {
  const pluginDir = path.join(root, 'plugins', 'gstack-workflows')
  const manifestDir = path.join(pluginDir, '.claude-plugin')
  fs.mkdirSync(manifestDir, { recursive: true })
  fs.writeFileSync(
    path.join(manifestDir, 'plugin.json'),
    JSON.stringify({ name: 'gstack-workflows', version: '0.1.0' }),
    'utf8',
  )
  return pluginDir
}

function createRunner(fixture, events, memoryWrites, providerConfigOverride = {}) {
  return createCliRunner({
    projectRoot: () => fixture.root,
    cliPath: () => fixture.cliPath,
    providerBridge: { current: () => ({ port: 49152 }) },
    providerConfig: {
      load: () => ({ defaultModel: 'mock/model' }),
      profileForModel: model => ({ model: model || 'mock/model' }),
      capabilities: () => ({ agent: true }),
      ...providerConfigOverride,
    },
    memoryStore: {
      buildPrompt: () => 'memory prompt',
      memoryPath: () => path.join(fixture.root, 'memory.md'),
      recordRun: (...args) => memoryWrites.push(args),
    },
    log: message => events.push(['log', message]),
    send: (channel, payload) => events.push([channel, payload]),
  })
}

function waitForRunEnd(events) {
  return waitForRunEndCount(events, 1)
}

function waitForRunEndCount(events, count) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const runEndEvents = events.filter(([channel]) => channel === 'opc:run-end')
      const event = runEndEvents[count - 1]
      if (event) {
        clearInterval(timer)
        resolve(event[1])
        return
      }
      if (Date.now() - startedAt > 3000) {
        clearInterval(timer)
        reject(new Error('run-end timeout'))
      }
    }, 20)
  })
}

test('cli runner reports CLI version', () => {
  const fixture = createFixture()
  const runner = createRunner(fixture, [], [])
  const version = runner.version()
  assert.equal(version.ok, true)
  assert.equal(version.version, '2.1.88 mock')
})

test('cli runner rejects providers that cannot drive agent sessions', () => {
  const fixture = createFixture()
  const runner = createRunner(fixture, [], [], {
    profileForModel: () => ({ model: 'gitlab/code-suggestions', label: 'GitLab Code Suggestions' }),
    capabilities: () => ({ agent: false }),
  })

  assert.throws(() => runner.run({
    prompt: 'analyse ce projet',
    cwd: fixture.root,
    model: 'gitlab/code-suggestions',
  }), /suggestions de code/)
})

test('cli runner rejects unknown selected models instead of silently falling back', () => {
  const fixture = createFixture()
  const runner = createRunner(fixture, [], [], {
    profileForModel: () => ({ id: 'default', model: 'default/model', label: 'Default' }),
  })

  assert.throws(() => runner.run({
    prompt: 'analyse ce projet',
    cwd: fixture.root,
    model: 'missing/model',
  }), /introuvable/)
})

test('cli runner resolves explicit file cwd to its parent directory', () => {
  const fixture = createFixture()
  const filePath = path.join(fixture.root, 'target.md')
  fs.writeFileSync(filePath, 'target', 'utf8')

  assert.equal(resolveCwd(filePath, () => '/fallback'), fixture.root)
  assert.equal(resolveCwd(`'${filePath}'`, () => '/fallback'), fixture.root)
  assert.equal(resolveCwd(`"${fixture.root}"`, () => '/fallback'), fixture.root)
  assert.equal(resolveCwd(fixture.root, () => '/fallback'), fixture.root)
  assert.equal(stripPathShellQuotes(`'${fixture.root}'`), fixture.root)
})

test('cli runner passes bundled gstack workflows plugin to CLI sessions', async () => {
  const fixture = createFixture()
  const pluginDir = createBundledGstackPlugin(fixture.root)
  const events = []
  const runner = createRunner(fixture, events, [])

  assert.deepEqual(bundledPluginDirs(fixture.root), [pluginDir])

  runner.run({ prompt: 'OK', cwd: fixture.root, model: 'mock/model', permissionMode: 'acceptEdits' })
  await waitForRunEnd(events)

  assert.equal(events.some(([channel, message]) => (
    channel === 'log' &&
    message.includes('--plugin-dir') &&
    message.includes(pluginDir)
  )), true)
})

test('cli runner extends idle timeout for long Bash downloads', () => {
  const baseMs = 300000

  assert.equal(toolIdleTimeoutMs({
    name: 'Bash',
    target: 'python3 download_ltx_models.py 2>&1',
    timeoutMs: 7200000,
  }, { baseMs }), 7200000)

  assert.equal(toolIdleTimeoutMs({
    name: 'Bash',
    target: 'python3 download_ltx_models.py',
  }, { baseMs, env: {} }) > baseMs, true)

  assert.equal(toolIdleTimeoutMs({
    name: 'Read',
    target: 'download_ltx_models.py',
    timeoutMs: 7200000,
  }, { baseMs }), baseMs)
})

test('cli runner classifies long running tool families for runtime heartbeat', () => {
  const download = classifyLongRunningTool({ name: 'Bash', target: 'python3 download_ltx_models.py 2>&1' })
  assert.equal(download.longRunning, true)
  assert.equal(download.kind, 'download')
  assert.match(download.label, /telechargement/i)
  assert.equal(download.heartbeatMs > 0, true)

  const install = classifyLongRunningTool({ name: 'Bash', target: 'pnpm install' })
  assert.equal(install.kind, 'install')
  assert.equal(install.longRunning, true)

  const build = classifyLongRunningTool({ name: 'Bash', target: 'npm run build' })
  assert.equal(build.kind, 'build')
  assert.equal(build.longRunning, true)

  const server = classifyLongRunningTool({ name: 'Bash', target: 'uvicorn app.main:app --reload' })
  assert.equal(server.kind, 'server')
  assert.equal(server.longRunning, true)

  const read = classifyLongRunningTool({ name: 'Read', target: 'download_ltx_models.py' })
  assert.equal(read.longRunning, false)
})

test('cli runner streams events and records durable memory', async () => {
  const fixture = createFixture()
  const events = []
  const memoryWrites = []
  const runner = createRunner(fixture, events, memoryWrites)
  runner.run({
    taskId: 'task-1',
    prompt: 'CONTEXT\nOK',
    displayPrompt: 'OK',
    cwd: fixture.root,
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    sessionId: 'session-123',
    effort: 'high',
    allowedTools: ['Bash(pnpm tools-dev run web)', 'Read'],
  })
  const end = await waitForRunEnd(events)

  assert.equal(end.code, 0)
  assert.equal(end.taskId, 'task-1')
  assert.equal(events.some(([channel]) => channel === 'opc:run-start'), true)
  assert.equal(events.some(([channel, payload]) => channel === 'opc:run-start' && payload.taskId === 'task-1'), true)
  assert.equal(events.some(([channel, payload]) => channel === 'opc:event' && payload.type === 'memory'), true)
  assert.equal(events.some(([channel, payload]) => channel === 'opc:event' && payload.type === 'assistant' && payload.taskId === 'task-1'), true)
  assert.equal(memoryWrites.length, 1)
  assert.equal(memoryWrites[0][3], 'OK')
  assert.equal(memoryWrites[0][0].prompt, 'OK')
  assert.equal(events.some(([channel, message]) => channel === 'log' && message.includes('--resume session-123')), true)
  assert.equal(events.some(([channel, message]) => channel === 'log' && message.includes('--effort high')), true)
  assert.equal(events.some(([channel, message]) => channel === 'log' && message.includes('--allowedTools Bash(pnpm tools-dev run web),Read')), true)
  assert.equal(events.some(([channel, message]) => channel === 'log' && message.includes('[OPC_PROMPT]')), true)
})

test('cli runner stops an active process', async () => {
  const fixture = createFixture()
  const events = []
  const runner = createRunner(fixture, events, [])
  runner.run({ prompt: 'sleep', cwd: fixture.root, model: 'mock/model', permissionMode: 'acceptEdits' })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(runner.hasActiveRun(), true)
  assert.equal(runner.stop(), true)
  const end = await waitForRunEnd(events)
  assert.equal(end.reason, 'stopped')
  assert.equal(end.code, 130)
  assert.equal(runner.hasActiveRun(), false)
})

test('cli runner releases the desktop after a terminal result event', async () => {
  const fixture = createFixture()
  const events = []
  const memoryWrites = []
  const runner = createRunner(fixture, events, memoryWrites)
  runner.run({ prompt: 'result-hangs', cwd: fixture.root, model: 'mock/model', permissionMode: 'acceptEdits' })
  const end = await waitForRunEnd(events)

  assert.equal(end.code, 0)
  assert.equal(end.reason, 'result')
  assert.equal(runner.hasActiveRun(), false)
  assert.equal(memoryWrites.length, 1)

  assert.doesNotThrow(() => {
    runner.run({ prompt: 'OK', cwd: fixture.root, model: 'mock/model', permissionMode: 'acceptEdits' })
  })
  await waitForRunEndCount(events, 2)
})

test('cli runner can bypass permissions for a trusted desktop action', async () => {
  const fixture = createFixture()
  const events = []
  const runner = createRunner(fixture, events, [])
  runner.run({
    prompt: 'OK',
    cwd: fixture.root,
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    skipPermissions: true,
    allowedTools: ['Bash(pnpm tools-dev start)', 'Read'],
  })
  await waitForRunEnd(events)

  assert.equal(events.some(([channel, message]) => channel === 'log' && message.includes('--dangerously-skip-permissions')), true)
  assert.equal(events.some(([channel, message]) => channel === 'log' && message.includes('--permission-mode acceptEdits')), false)
})

test('cli runner emits runtime supervisor phases for tool activity', async () => {
  const fixture = createFixture()
  const events = []
  const runner = createRunner(fixture, events, [])
  runner.run({ taskId: 'task-tool', prompt: 'tool', cwd: fixture.root, model: 'mock/model', permissionMode: 'acceptEdits' })
  await waitForRunEnd(events)

  const runtimeEvents = events.filter(([channel]) => channel === 'opc:runtime').map(([, payload]) => payload)
  assert.equal(runtimeEvents.some(payload => payload.taskId === 'task-tool' && payload.phase === 'starting'), true)
  assert.equal(runtimeEvents.some(payload => payload.phase === 'tool' && payload.currentTool?.name === 'Bash'), true)
  assert.equal(runtimeEvents.some(payload => payload.phase === 'finished' && payload.reason === 'result'), true)
})

test('cli runner keeps stdout and stderr bounded for long noisy runs', async () => {
  const fixture = createFixture()
  const events = []
  const memoryWrites = []
  const runner = createRunner(fixture, events, memoryWrites)
  runner.run({ prompt: 'big-output', cwd: fixture.root, model: 'mock/model', permissionMode: 'acceptEdits' })
  await waitForRunEnd(events)

  assert.equal(memoryWrites.length, 1)
  assert.equal(memoryWrites[0][3], 'Bounded OK')
  assert.equal(memoryWrites[0][0].stdout.length <= 1024 * 1024, true)
  assert.equal(memoryWrites[0][0].stderr.length <= 256 * 1024, true)
})

test('cli runner includes stderr details in run-end failures', async () => {
  const fixture = createFixture()
  const events = []
  const runner = createRunner(fixture, events, [])
  runner.run({ prompt: 'stderr-fail', cwd: fixture.root, model: 'mock/model', permissionMode: 'acceptEdits' })
  const end = await waitForRunEnd(events)

  assert.equal(end.code, 1)
  assert.match(end.stderr, /provider rejected unsupported parameter/)
})
