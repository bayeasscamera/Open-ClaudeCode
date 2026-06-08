const assert = require('node:assert/strict')
const test = require('node:test')
const { killProcessTree, processLooksLikeLongTask, processTreePids } = require('../electron/processControl.cjs')
const { createRuntimeSupervisor } = require('../electron/runtimeSupervisor.cjs')

test('process tree discovery walks child pids recursively', () => {
  const tree = new Map([
    [10, [11, 12]],
    [11, [13]],
    [12, []],
    [13, []],
  ])
  const spawnSync = (_cmd, args) => {
    const pid = Number(args[1])
    return { status: tree.has(pid) && tree.get(pid).length ? 0 : 1, stdout: (tree.get(pid) || []).join('\n') }
  }

  assert.deepEqual(processTreePids(10, { spawnSync }).sort((a, b) => a - b), [10, 11, 12, 13])
})

test('killProcessTree signals process group and descendants', () => {
  const signals = []
  const spawnSync = (_cmd, args) => {
    const pid = Number(args[1])
    if (pid === 20) return { status: 0, stdout: '21\n22\n' }
    if (pid === 21) return { status: 0, stdout: '23\n' }
    return { status: 1, stdout: '' }
  }
  const result = killProcessTree(20, {
    currentPid: 999,
    spawnSync,
    kill: (pid, signal) => {
      signals.push([pid, signal])
      if (signal === 0) throw new Error('gone')
    },
    setTimeout: fn => fn(),
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.children.sort((a, b) => a - b), [21, 22, 23])
  assert.equal(signals.some(([pid, signal]) => pid === -20 && signal === 'SIGTERM'), true)
  assert.equal(signals.some(([pid, signal]) => pid === 23 && signal === 'SIGTERM'), true)
  assert.equal(signals.some(([pid, signal]) => pid === -20 && signal === 'SIGKILL'), true)
})

test('process long task guard matches dev process commands', () => {
  const spawnSync = (_cmd, args) => {
    if (args[1] === '33') return { status: 0, stdout: 'node /opt/homebrew/bin/pnpm tools-dev start\n' }
    if (args[1] === '44') return { status: 0, stdout: '/usr/bin/python3 server.py\n' }
    return { status: 1, stdout: '' }
  }

  assert.equal(processLooksLikeLongTask(33, 'pnpm tools-dev start', { spawnSync }), true)
  assert.equal(processLooksLikeLongTask(44, 'pnpm tools-dev start', { spawnSync }), false)
})

test('runtime supervisor tracks, finishes and cleans active runs', () => {
  const logs = []
  const supervisor = createRuntimeSupervisor({ log: message => logs.push(message), now: () => 123 })
  const run = {
    taskId: 'task-1',
    child: { pid: 44 },
    startedAt: 100,
    processGroup: false,
  }

  const tracked = supervisor.track(run)
  assert.equal(tracked.active, true)
  assert.equal(supervisor.status().active.taskId, 'task-1')

  supervisor.finish(run, 'result')
  assert.equal(supervisor.status().active.status, 'idle')

  const cleaned = supervisor.cleanup({ force: true })
  assert.equal(Array.isArray(cleaned), true)
})

test('runtime supervisor records provider, tool and stream phases', () => {
  let tick = 1000
  const supervisor = createRuntimeSupervisor({ now: () => tick })
  const run = {
    taskId: 'task-runtime',
    child: { pid: 55 },
    startedAt: 900,
    lastActivityAt: 900,
    model: 'mock/model',
    processGroup: false,
  }

  supervisor.track(run)
  assert.equal(supervisor.snapshot(run).phase, 'starting')

  tick = 1200
  supervisor.recordEvent(run, {
    type: 'provider_status',
    message: 'Mock model est toujours sélectionné.',
    elapsedMs: 30000,
    attempt: 1,
    maxRetries: 0,
    model: 'mock/model',
  })
  let status = supervisor.snapshot(run)
  assert.equal(status.phase, 'provider')
  assert.equal(status.providerEventCount, 1)
  assert.match(status.statusText, /Mock model/)

  tick = 1400
  supervisor.recordEvent(run, {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pnpm test', timeout: 7200000 } },
    },
  })
  status = supervisor.snapshot(run)
  assert.equal(status.phase, 'tool')
  assert.equal(status.toolCount, 1)
  assert.equal(status.currentTool.name, 'Bash')
  assert.equal(status.currentTool.timeoutMs, 7200000)
  assert.match(status.currentTool.detail, /pnpm test/)

  tick = 1600
  supervisor.recordEvent(run, { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } })
  status = supervisor.snapshot(run)
  assert.equal(status.phase, 'streaming')
  assert.equal(status.firstTextMs, 700)
  assert.equal(status.recentEvents.length >= 4, true)
})
