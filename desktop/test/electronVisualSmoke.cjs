const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const electron = require('electron')
const MIN_SCREEN_CONTRAST = 27.95
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-visual-user-'))
const visualDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-visual-artifacts-'))
const env = {
  ...process.env,
  OPC_E2E_VISUAL: '1',
  OPC_E2E_USER_DATA: userData,
  OPC_E2E_VISUAL_DIR: visualDir,
}
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
}, 60000)

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
    assert.match(stdout, /OPC_E2E_VISUAL_OK/, stdout || stderr)
    const payloadLine = stdout.split('\n').find(line => line.startsWith('OPC_E2E_VISUAL_OK '))
    const payload = JSON.parse(payloadLine.replace('OPC_E2E_VISUAL_OK ', ''))
    assert.equal(payload.screens.length, 8, stdout)
    assert.ok(fs.existsSync(payload.report), `missing visual report ${payload.report}`)
    assert.ok(fs.existsSync(payload.reportData), `missing visual report data ${payload.reportData}`)
    const reportHtml = fs.readFileSync(payload.report, 'utf8')
    assert.match(reportHtml, /OPC Visual QA/)
    assert.match(reportHtml, /project-context/)
    assert.match(reportHtml, /inspector/)
    assert.match(reportHtml, /settings/)
    assert.match(reportHtml, /provider-import/)
    assert.match(reportHtml, /settings-filter-project/)
    assert.match(reportHtml, /provider-editor/)
    for (const screen of payload.screens) {
      assert.ok(fs.existsSync(screen.screenshot), `missing screenshot ${screen.screenshot}`)
      assert.ok(screen.metrics.contrast >= MIN_SCREEN_CONTRAST, `low contrast for ${screen.name}`)
    }
    process.stdout.write(stdout)
  } catch (error) {
    process.stderr.write(stderr)
    process.stderr.write(stdout)
    throw error
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
