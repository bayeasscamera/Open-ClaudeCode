const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  isSafeHttpUrl,
  validateKillPidPayload,
  validateOpenPathTarget,
  validateProbeServicesPayload,
  validateProviderCheckPayload,
  validateRefinePromptPayload,
  validateCommandIntent,
  validateProjectRuntimeContext,
  validateRunPayload,
  workspaceTrustAllowed,
} = require('../electron/ipcValidation.cjs')

test('ipc validation accepts safe run payload and gates skipPermissions', () => {
  const payload = validateRunPayload({
    prompt: 'OK',
    displayPrompt: 'OK',
    cwd: '/tmp',
    model: 'mock/model',
    permissionMode: 'acceptEdits',
    trustedWorkspaceRoot: '/tmp',
    allowedTools: ['Bash(rm -rf /tmp/nope)', 'Read'],
    commandIntent: { command: 'pnpm tools-dev run web', source: 'prompt', reason: 'Commande directe' },
    skipPermissions: true,
    projectRuntimeContext: {
      projectId: 'project-1',
      projectName: 'Runtime',
      totalFiles: 2,
      attachedFiles: [{ path: '/repo/runtime.md', name: 'runtime.md', summary: 'Runtime file' }],
      relevantFiles: [{ path: '/repo/runtime.md', score: 22, snippets: ['runtime supervisor'] }],
    },
  })

  assert.equal(payload.prompt, 'OK')
  assert.equal(payload.model, 'mock/model')
  assert.equal(validateRunPayload({ prompt: 'OK', cwd: "'/tmp'", trustedWorkspaceRoot: '"/tmp"', permissionMode: 'bypassPermissions', skipPermissions: true }).cwd, '/tmp')
  assert.equal(validateRunPayload({ prompt: 'OK', cwd: "'/tmp'", trustedWorkspaceRoot: '"/tmp"', permissionMode: 'bypassPermissions', skipPermissions: true }).workspaceTrusted, true)
  assert.equal(payload.workspaceTrusted, true)
  assert.equal(payload.skipPermissions, true)
  assert.equal(payload.commandIntent.command, 'pnpm tools-dev run web')
  assert.equal(payload.commandIntent.source, 'prompt')
  assert.equal(payload.allowedTools.includes('Bash(rm -rf /tmp/nope)'), false)
  assert.equal(payload.allowedTools.includes('Bash(pnpm tools-dev run web)'), true)
  assert.equal(payload.projectRuntimeContext.projectName, 'Runtime')
  assert.equal(payload.projectRuntimeContext.relevantFiles[0].score, 22)

  const unsafe = validateRunPayload({
    prompt: 'OK',
    permissionMode: 'acceptEdits',
    allowedTools: ['Bash(pnpm tools-dev run web)'],
    skipPermissions: true,
  })
  assert.equal(unsafe.skipPermissions, false)

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-workspace-'))
  const workspaceApp = path.join(workspace, 'packages', 'app')
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-outside-'))
  const symlinkEscape = path.join(workspace, 'linked-outside')
  fs.mkdirSync(workspaceApp, { recursive: true })
  fs.symlinkSync(outside, symlinkEscape)

  const fullBypass = validateRunPayload({
    prompt: 'OK',
    cwd: workspace,
    trustedWorkspaceRoot: workspace,
    permissionMode: 'bypassPermissions',
    allowedTools: [],
    skipPermissions: true,
  })
  assert.equal(fullBypass.skipPermissions, true)

  const outsideWorkspace = validateRunPayload({
    prompt: 'OK',
    cwd: outside,
    trustedWorkspaceRoot: workspace,
    permissionMode: 'bypassPermissions',
    allowedTools: [],
    skipPermissions: true,
  })
  assert.equal(outsideWorkspace.workspaceTrusted, false)
  assert.equal(outsideWorkspace.skipPermissions, false)
  assert.equal(workspaceTrustAllowed(workspaceApp, workspace), true)
  assert.equal(workspaceTrustAllowed(`'${workspaceApp}'`, `"${workspace}"`), true)
  assert.equal(workspaceTrustAllowed(symlinkEscape, workspace), false)
})

test('ipc validation normalizes command intents independently from renderer allowed tools', () => {
  const intent = validateCommandIntent({
    command: '"pnpm tools-dev start"',
    source: 'message-intent',
    reason: 'start service',
    trusted: false,
  }, 'acceptEdits')

  assert.equal(intent.command, 'pnpm tools-dev start')
  assert.equal(intent.source, 'message-intent')
  assert.equal(intent.trusted, true)
  assert.equal(intent.longRunning, true)
  assert.equal(intent.skipPermissions, true)
  assert.deepEqual(intent.allowRules, [
    'Bash(pnpm tools-dev start)',
    'Bash(pnpm tools-dev start *)',
    'Bash(nohup pnpm tools-dev start *)',
    'Bash(cd * && pnpm tools-dev start *)',
  ])

  const untrusted = validateCommandIntent({ command: 'rm -rf /tmp/nope', source: 'unknown' }, 'acceptEdits')
  assert.equal(untrusted.source, 'prompt')
  assert.equal(untrusted.trusted, false)
  assert.equal(untrusted.skipPermissions, false)
})

test('ipc validation rejects empty run payload prompt', () => {
  assert.throws(() => validateRunPayload({ prompt: '   ' }), /Prompt vide/)
})

test('ipc validation restricts settingsPath to the selected cwd', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-settings-'))
  const settingsPath = path.join(cwd, '.claude-settings.json')
  const outsidePath = path.join(os.tmpdir(), `outside-${Date.now()}.json`)
  fs.writeFileSync(settingsPath, '{}')
  fs.writeFileSync(outsidePath, '{}')

  const inside = validateRunPayload({ prompt: 'OK', cwd, settingsPath })
  assert.equal(inside.settingsPath, fs.realpathSync(settingsPath))

  const quoted = validateRunPayload({ prompt: 'OK', cwd: `"${cwd}"`, settingsPath: `'${settingsPath}'` })
  assert.equal(quoted.settingsPath, fs.realpathSync(settingsPath))

  const outside = validateRunPayload({ prompt: 'OK', cwd, settingsPath: outsidePath })
  assert.equal(outside.settingsPath, '')
})

test('ipc validation normalizes project runtime context', () => {
  const context = validateProjectRuntimeContext({
    projectId: 'project-1',
    projectName: 'Deep-search',
    attachedFiles: [
      { id: 'file-1', path: '/repo/a.md', name: 'a.md', role: 'attached', keywords: ['runtime'], snippets: ['ignored?'] },
      { path: '', name: 'bad' },
    ],
    readNextFiles: [{ path: '/repo/brief.md', readNext: true }],
    relevantFiles: [{ path: '/repo/runtime.md', score: '31' }],
  })

  assert.equal(context.projectName, 'Deep-search')
  assert.equal(context.attachedFiles.length, 1)
  assert.equal(context.readNextFiles[0].readNext, true)
  assert.equal(context.relevantFiles[0].score, 31)
  assert.equal(validateProjectRuntimeContext(null), null)
})

test('ipc validation normalizes provider check and pid payloads', () => {
  assert.deepEqual(validateProviderCheckPayload({ model: 'z-ai/glm-5.1' }), { model: 'z-ai/glm-5.1' })
  assert.deepEqual(validateRefinePromptPayload({ prompt: '  améliore ', model: 'qwen/qwen3.5-122b-a10b' }), {
    prompt: 'améliore',
    model: 'qwen/qwen3.5-122b-a10b',
  })
  assert.throws(() => validateRefinePromptPayload({ prompt: '   ' }), /Prompt vide/)
  assert.deepEqual(validateKillPidPayload({ pid: '1234' }), { pid: 1234, taskId: '', command: '', cwd: '', longRunning: false })
  assert.deepEqual(validateKillPidPayload({ pid: process.pid, taskId: 'task-1', command: 'pnpm start', cwd: "'/repo'" }), {
    pid: process.pid,
    taskId: 'task-1',
    command: 'pnpm start',
    cwd: '/repo',
    longRunning: true,
  })
  assert.deepEqual(validateKillPidPayload({ pid: 'abc' }), { pid: 0 })
})

test('ipc validation only allows local service probes', () => {
  const { tasks } = validateProbeServicesPayload({
    tasks: [
      {
        id: 'task-1',
        services: [
          { name: 'web', url: 'http://127.0.0.1:18000' },
          { name: 'public', url: 'https://example.com:443' },
          { name: 'daemon', port: 7456 },
          { name: 'bad', port: 999999 },
        ],
      },
    ],
  })

  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].services.length, 2)
  assert.equal(tasks[0].services[0].url, 'http://127.0.0.1:18000')
  assert.equal(tasks[0].services[1].port, 7456)
})

test('ipc validation restricts openPath URLs to local http targets', () => {
  assert.equal(isSafeHttpUrl('https://example.com'), true)
  assert.equal(isSafeHttpUrl('file:///tmp/a'), false)
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false)

  const local = validateOpenPathTarget('http://localhost:18000', '/fallback')
  assert.equal(local.kind, 'url')

  const remote = validateOpenPathTarget('https://example.com', '/fallback')
  assert.equal(remote.kind, 'error')

  const fallback = validateOpenPathTarget('', '/fallback')
  assert.equal(fallback.kind, 'path')
  assert.equal(fallback.target, '/fallback')
})
