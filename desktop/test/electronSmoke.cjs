const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const electron = require('electron')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-e2e-'))
const env = { ...process.env, OPC_E2E_SMOKE: '1', OPC_E2E_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.'], {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
const timeout = setTimeout(() => {
  child.kill('SIGTERM')
}, 20000)

child.stdout.on('data', chunk => {
  stdout += chunk.toString()
})
child.stderr.on('data', chunk => {
  stderr += chunk.toString()
})

child.on('close', code => {
  clearTimeout(timeout)
  try {
    assert.equal(code, 0, stderr || stdout)
    assert.match(stdout, /OPC_E2E_SMOKE_OK/, stdout || stderr)
    process.stdout.write(stdout)
  } catch (error) {
    process.stderr.write(stderr)
    process.stderr.write(stdout)
    throw error
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
