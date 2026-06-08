const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sanitizedElectronEnv } = require('./electronEnv.cjs')

const root = path.join(__dirname, '..')
const appSource = path.join(root, 'dist', 'mac-arm64', 'OPC.app')
const appTarget = '/Applications/OPC.app'
const appBinary = path.join(appTarget, 'Contents', 'MacOS', 'OPC')
const shouldOpen = process.argv.includes('--open')

function run(command, args, options = {}) {
  const env = sanitizedElectronEnv(options.env || {})
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
    env,
  })
}

function output(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

function runningAppPids() {
  return output('pgrep', ['-f', `${appTarget}/Contents/MacOS/OPC`])
    .split(/\s+/)
    .map(value => value.trim())
    .filter(Boolean)
}

function waitForAppExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!runningAppPids().length) return true
    spawnSync('sleep', ['0.2'])
  }
  return !runningAppPids().length
}

function stopRunningApp() {
  try {
    run('osascript', ['-e', 'tell application "OPC" to quit'], { stdio: 'ignore' })
  } catch {
    // OPC may not be running or LaunchServices may not know it yet.
  }
  if (waitForAppExit(5000)) return
  try {
    execFileSync('pkill', ['-TERM', '-f', `${appTarget}/Contents/MacOS/OPC`], { stdio: 'ignore' })
  } catch {
    // A concurrent quit may have already removed the process.
  }
  waitForAppExit(3000)
}

function assertAppNotRunning({ pids = runningAppPids() } = {}) {
  if (!pids.length) return true
  throw new Error(`OPC est en cours d'exécution (${pids.join(', ')}). Quitte /Applications/OPC.app avant de rebuild/install.`)
}

function runAppCheck(kind, extraEnv, timeoutMs, attempts = 2) {
  const env = sanitizedElectronEnv(extraEnv)

  let lastChild = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const child = spawnSync(appBinary, [], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: timeoutMs,
    })
    lastChild = child

    if (child.error) {
      if (child.error.code === 'ETIMEDOUT' && attempt < attempts) {
        process.stderr.write(`${kind} check timed out on attempt ${attempt}/${attempts}; retrying once.\n`)
        stopRunningApp()
        continue
      }
      stopRunningApp()
      throw child.error
    }
    if (child.status !== 0) {
      process.stderr.write(child.stderr || '')
      process.stderr.write(child.stdout || '')
      stopRunningApp()
      throw new Error(`${kind} failed with status ${child.status}`)
    }

    process.stdout.write(child.stdout)
    assert.match(child.stdout, new RegExp(`OPC_E2E_${kind}_OK`), child.stderr || child.stdout)
    return child.stdout
  }

  throw new Error(`${kind} did not complete: ${lastChild?.stderr || lastChild?.stdout || 'no output'}`)
}

function withTempUserData(prefix, callback) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  try {
    return callback(userData)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
}

function main() {
  assert.ok(fs.existsSync(appSource), `missing packaged app: ${appSource}`)
  assertAppNotRunning()

  fs.rmSync(appTarget, { recursive: true, force: true })
  run('ditto', [appSource, appTarget])
  run('codesign', ['--force', '--deep', '--sign', '-', appTarget])
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appTarget])

  withTempUserData('opc-installed-smoke-', userData => {
    runAppCheck('SMOKE', { OPC_E2E_SMOKE: '1', OPC_E2E_USER_DATA: userData }, 60000)
  })

  const visualDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-installed-visual-'))
  withTempUserData('opc-installed-visual-user-', userData => {
    runAppCheck(
      'VISUAL',
      {
        OPC_E2E_VISUAL: '1',
        OPC_E2E_USER_DATA: userData,
        OPC_E2E_VISUAL_DIR: visualDir,
      },
      60000,
    )
  })

  if (shouldOpen) {
    run('open', ['-n', '-a', appTarget])
  }

  process.stdout.write(`OPC_INSTALL_OK ${JSON.stringify({ appPath: appTarget, visualDir })}\n`)
}

if (require.main === module) {
  main()
}

module.exports = {
  assertAppNotRunning,
  runningAppPids,
}
