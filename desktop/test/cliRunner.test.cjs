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
  tailText,
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
	} else if (prompt === 'huge-line') {
	  // Sprint 4 / H1: emit a single huge line with no newline. The runner
	  // must bound the partial-line buffer to MAX_STDOUT_CHARS instead of
	  // accumulating until the line completes.
	  process.stdout.write('y'.repeat(2 * 1024 * 1024))
	  console.log(JSON.stringify({ type: 'result', result: 'Huge line OK', is_error: false }))
	} else if (prompt === 'huge-stderr') {
	  console.log(JSON.stringify({ type: 'system', subtype: 'init', cwd: process.cwd(), model: process.env.ANTHROPIC_MODEL, permissionMode: 'acceptEdits', tools: ['Bash'] }))
	  console.error('e'.repeat(60 * 1024))
	  console.log(JSON.stringify({ type: 'result', result: 'ok', is_error: false }))
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

// ── P14 — cap individual stderr event payloads sent to the renderer ───────

test('cli runner: tailText caps long strings with an ellipsis prefix', () => {
  const short = 'short message'
  assert.equal(tailText(short), short)
  assert.equal(tailText(''), '')
  // Defaults to MAX_STDERR_EVENT_CHARS (32 KiB).
  const huge = 'x'.repeat(40 * 1024)
  const tailed = tailText(huge)
  assert.ok(tailed.length <= 32 * 1024, `tailed length ${tailed.length} must be ≤ 32 KiB`)
  assert.match(tailed, /^\.\.\./)
})

test('cli runner: tailText respects a custom maxChars override', () => {
  const input = 'a'.repeat(100)
  const tailed = tailText(input, 10)
  assert.equal(tailed.length, 10)
  assert.match(tailed, /^\.\.\./)
  assert.equal(tailed, '...aaaaaaa')
})

test('cli runner: stderr event payload is bounded for runaway lines', async () => {
  const fixture = createFixture()
  const events = []
  const runner = createRunner(fixture, events, [])

  runner.run({
    prompt: 'huge-stderr',
    cwd: fixture.root,
    model: 'mock/model',
    permissionMode: 'acceptEdits',
  })

  await new Promise(resolve => {
    const startedAt = Date.now()
    const tick = setInterval(() => {
      const ended = events.some(([ch]) => ch === 'opc:run-end')
      if (ended || Date.now() - startedAt > 5000) {
        clearInterval(tick)
        resolve()
      }
    }, 20)
  })

  const stderrEvents = events.filter(
    ([ch, payload]) => ch === 'opc:event' && payload?.type === 'stderr',
  )
  assert.ok(stderrEvents.length > 0, 'expected at least one stderr event')
  for (const [, payload] of stderrEvents) {
    assert.ok(
      payload.text.length <= 32 * 1024,
      `stderr event text must be ≤ 32 KiB, got ${payload.text.length}`,
    )
    assert.equal(payload.truncated, true)
    assert.match(payload.text, /^\.\.\./)
  }
})

// ── Sprint 4 / H1 — bound the partial-line stdout buffer ─────────────────

test('cli runner: stdout partial-line buffer is capped at MAX_STDOUT_CHARS', async () => {
  const fixture = createFixture()
  const events = []
  const memoryWrites = []
  const runner = createRunner(fixture, events, memoryWrites)

  runner.run({
    prompt: 'huge-line',
    cwd: fixture.root,
    model: 'mock/model',
    permissionMode: 'acceptEdits',
  })

  await waitForRunEnd(events)

  // The 2 MiB single-line write should NOT exhaust memory: the partial
  // buffer is bounded to MAX_STDOUT_CHARS (1 MiB), and the line is then
  // trimmed to the last 1 MiB before being shipped to the renderer.
  assert.equal(memoryWrites.length, 1)
  const recorded = memoryWrites[0][0]
  assert.ok(
    recorded.stdout.length <= 1024 * 1024,
    `recorded stdout must be ≤ 1 MiB, got ${recorded.stdout.length}`,
  )
})

// ── Sprint 4 / H2 — linger timers are cancelled on child close ────────────

test('cli runner: linger timers are cancelled once the child exits', async () => {
  const fixture = createFixture()
  const events = []
  const runner = createRunner(fixture, events, [])

  // 'OK' emits init, assistant, result, then exits naturally. The result
  // path schedules linger timers in `stopLingeringRun`; we expect them to
  // be cancelled by the new `clearLingerTimers` call inside
  // `child.on('close')` instead of waiting for natural wake-up at 2.5s.
  runner.run({
    prompt: 'OK',
    cwd: fixture.root,
    model: 'mock/model',
    permissionMode: 'acceptEdits',
  })

  const end = await waitForRunEnd(events)
  // After run-end the runner must be idle and accept a new run immediately
  // (no lingering 2.5s timer holding a closure on the dead run).
  assert.equal(runner.hasActiveRun(), false)
  assert.equal(end.reason, 'result')
  assert.equal(end.code, 0)

  // Wait past LINGER_KILL_DELAY_MS (2.5s) — if the linger timers were
  // NOT cancelled, they'd fire here and (in the supervisor mock) potentially
  // touch dead state. The runner must remain stable and accept a new run.
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(runner.hasActiveRun(), false)
  assert.doesNotThrow(() => {
    runner.run({
      prompt: 'OK',
      cwd: fixture.root,
      model: 'mock/model',
      permissionMode: 'acceptEdits',
    })
  })
})

