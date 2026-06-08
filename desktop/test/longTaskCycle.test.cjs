const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { killProcess } = require('../electron/processControl.cjs')
const { probeServices } = require('../electron/serviceProbe.cjs')

function loadTaskManager() {
  const context = {
    window: {},
    Date,
    JSON,
    Math,
    RegExp,
    String,
    Object,
    Array,
  }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'state', 'taskManager.js'), 'utf8'), context, { filename: 'taskManager.js' })
  return context.window.OPCTaskManager
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let raw = ''
    const timeout = setTimeout(() => reject(new Error('server startup timeout')), 3000)
    child.stdout.on('data', chunk => {
      raw += String(chunk)
      const line = raw.split(/\r?\n/).find(Boolean)
      if (!line) return
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(line))
      } catch (error) {
        reject(error)
      }
    })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      if (!raw.trim()) {
        clearTimeout(timeout)
        reject(new Error(`server exited before startup with code ${code}`))
      }
    })
  })
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve()
  return new Promise(resolve => child.once('exit', () => resolve()))
}

function startServerProcess() {
  return spawn(
    process.execPath,
    [
      '-e',
      `
const http = require('node:http')
const server = http.createServer((_req, res) => res.end('ready'))
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  console.log(JSON.stringify({ pid: process.pid, url: 'http://127.0.0.1:' + address.port }))
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
setInterval(() => {}, 1000)
`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

test('long task cycle detects a live service and stops it cleanly', async () => {
  const taskManager = loadTaskManager()
  const child = startServerProcess()
  const server = await waitForServer(child)

  try {
    const tasks = []
    const assistant = {
      id: 'assistant-cycle',
      cwd: '/tmp/opc-cycle',
      tools: [{ id: 'tool-cycle', name: 'Bash', command: 'npm run dev' }],
    }
    const chat = { id: 'chat-cycle' }
    const [task] = taskManager.syncFromAssistant(tasks, assistant, chat)

    taskManager.updateRelated(tasks, assistant, `PID ${server.pid}\nLocal: ${server.url}\nready`)
    assert.equal(task.pid, String(server.pid))
    assert.equal(task.url, server.url)

    const readyProbe = await probeServices(taskManager.probePayload(tasks))
    taskManager.applyProbeResult(tasks, readyProbe[0])
    assert.equal(task.status, 'ready')
    assert.equal(task.services.some(service => service.ready), true)

    const stopped = killProcess(server.pid, { softKillTimeoutMs: 200 })
    assert.equal(stopped.ok, true)
    await waitForExit(child)

    const stoppedProbe = await probeServices(taskManager.probePayload(tasks))
    assert.equal(stoppedProbe[0].services.some(service => service.ready), false)
    taskManager.mark(tasks, task.id, { status: 'stopped', lastOutput: `PID ${server.pid} arrete.` })
    assert.equal(task.status, 'stopped')
  } finally {
    if (child.exitCode === null && !child.signalCode) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Test cleanup best effort.
      }
    }
  }
})
