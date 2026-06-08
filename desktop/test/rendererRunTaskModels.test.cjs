const { assert, loadRendererModules, test } = require('./helpers/rendererModules.cjs')
const { JSDOM } = require('jsdom')

test('run task queue tracks queued and active tasks without exposing mutable internals', () => {
  const { OPCRunTaskQueue } = loadRendererModules()
  const queue = OPCRunTaskQueue.createRunTaskQueue([{ id: 'one', assistantId: 'a1' }])

  assert.equal(queue.length(), 1)
  queue.push({ id: 'two', assistantId: 'a2' })
  assert.deepEqual(queue.snapshot().map(task => task.id), ['one', 'two'])
  assert.equal(queue.shift().id, 'one')
  queue.setActive({ id: 'active', assistantId: 'a3' })
  assert.equal(queue.active().id, 'active')
  queue.removeByAssistantId('a2')
  assert.equal(queue.length(), 0)
  queue.clearActive()
  assert.equal(queue.active(), null)
})

test('run task planner builds reusable-task and preflight messages', () => {
  const { OPCRunTaskPlanner } = loadRendererModules()
  const message = OPCRunTaskPlanner.reusableTaskMessage({
    reusableTask: {
      command: 'npm run dev',
      status: 'ready',
      url: 'http://127.0.0.1:3000',
      pid: '123',
      serviceSummary: 'web prêt',
    },
    prompt: 'relance',
    cwd: '/repo',
    model: 'model/a',
    makeId: prefix => `${prefix}-1`,
  })

  assert.equal(message.id, 'assistant-1')
  assert.equal(message.status, 'done')
  assert.match(message.content, /npm run dev/)
  assert.match(message.content, /http:\/\/127\.0\.0\.1:3000/)

  const error = OPCRunTaskPlanner.preflightErrorMessage({
    error: 'Provider incompatible.',
    warnings: ['outils désactivés'],
  })
  assert.match(error, /Provider incompatible/)
  assert.match(error, /Settings > Providers/)
  assert.match(error, /outils désactivés/)
})

test('agent task ledger records bounded task lifecycle steps', () => {
  const { OPCAgentTaskLedger } = loadRendererModules()
  const ledger = OPCAgentTaskLedger.createAgentTaskLedger({
    makeId: prefix => `${prefix}-1`,
    now: () => 1000,
    maxEntries: 3,
    maxEventsPerEntry: 4,
  })

  const first = ledger.enqueue({
    taskId: 'task-1',
    assistantId: 'assistant-1',
    chatId: 'chat-1',
    prompt: 'Implémente le ledger agentique',
    model: 'mock/model',
    cwd: '/repo/opc',
    command: 'npm test',
  })
  ledger.markRunning('task-1', { detail: 'Transmission au CLI', at: 1100 })
  ledger.recordTool('task-1', { tool: 'Bash', detail: 'npm test', at: 1200 })
  ledger.markVerified('task-1', { verification: 'npm test', detail: '244 tests OK', at: 1300 })

  assert.equal(first.id, 'task-1')
  assert.equal(first.title, 'Implémente le ledger agentique')
  assert.equal(ledger.entries()[0].status, 'verified')
  assert.equal(ledger.entries()[0].verification, 'npm test')
  assert.equal(JSON.stringify(ledger.entries()[0].events.map(event => event.kind)), JSON.stringify(['queued', 'running', 'tool', 'verified']))

  ledger.enqueue({ taskId: 'task-2', prompt: 'Deuxième', at: 1400 })
  ledger.enqueue({ taskId: 'task-3', prompt: 'Troisième', at: 1500 })
  ledger.enqueue({ taskId: 'task-4', prompt: 'Quatrième', at: 1600 })
  assert.equal(JSON.stringify(ledger.entries().map(entry => entry.id)), JSON.stringify(['task-4', 'task-3', 'task-2']))
})

test('agent worker runtime isolates task phases and blocks failed steps until repaired', () => {
  const { OPCAgentToolPlanner, OPCAgentTaskStepEngine, OPCAgentWorkerRuntime } = loadRendererModules()
  const toolPlan = OPCAgentToolPlanner.planForTask({
    prompt: 'implémente le worker runtime puis teste',
    requirements: {
      category: 'code-change',
      requireTools: true,
      requiresFilesystemWrite: true,
      requiresVerification: true,
    },
  })
  const workers = OPCAgentWorkerRuntime.createAgentWorkerRuntime({
    now: () => 1000,
    makeId: prefix => `${prefix}-1`,
  })

  const worker = workers.spawn({
    taskId: 'task-worker',
    assistantId: 'assistant-worker',
    chatId: 'chat-worker',
    prompt: 'implémente le worker runtime puis teste',
    model: 'mock/model',
    cwd: '/repo/opc',
    stepPlan: OPCAgentTaskStepEngine.createStepPlan({ toolPlan }),
  })

  assert.equal(worker.id, 'task-worker')
  assert.equal(worker.status, 'queued')
  assert.equal(worker.isolated, true)
  assert.equal(worker.currentStepId, 'read')
  workers.start('task-worker')
  workers.recordTool('task-worker', { tool: 'Read', detail: 'Read desktop/renderer/state/runRuntimeState.js' })
  assert.equal(workers.worker('task-worker').currentStepId, 'edit')
  workers.recordTool('task-worker', { tool: 'Edit', detail: 'patch failed', status: 'failed' })
  assert.equal(workers.worker('task-worker').status, 'blocked')
  assert.equal(workers.worker('task-worker').currentStepId, '')
  assert.match(workers.worker('task-worker').blockedReason, /patch failed/)
  workers.repair('task-worker', { proof: 'Edit desktop/renderer/state/agentWorkerRuntime.js' })
  assert.equal(workers.worker('task-worker').status, 'running')
  assert.equal(workers.worker('task-worker').currentStepId, 'test')
  workers.verify('task-worker', { verification: 'npm --prefix desktop test', detail: '300 tests OK' })
  assert.equal(workers.worker('task-worker').status, 'verified')
  assert.equal(workers.worker('task-worker').isolated, true)
})

test('agent worker runtime exposes action prompts for resume verify and interruption', () => {
  const { OPCAgentToolPlanner, OPCAgentTaskStepEngine, OPCAgentWorkerRuntime } = loadRendererModules()
  const toolPlan = OPCAgentToolPlanner.planForTask({
    prompt: 'corrige la reprise automatique puis teste',
    requirements: {
      category: 'code-change',
      requireTools: true,
      requiresFilesystemWrite: true,
      requiresVerification: true,
    },
  })
  const runtime = OPCAgentWorkerRuntime.createAgentWorkerRuntime()
  runtime.spawn({
    taskId: 'task-resume',
    assistantId: 'assistant-resume',
    prompt: 'corrige la reprise automatique puis teste',
    model: 'mock/model',
    cwd: '/repo/opc',
    stepPlan: OPCAgentTaskStepEngine.createStepPlan({ toolPlan }),
  })
  runtime.start('task-resume')
  runtime.recordTool('task-resume', { tool: 'Read', detail: 'Read runController.js' })
  runtime.recordTool('task-resume', { tool: 'Edit', detail: 'patch failed', status: 'failed' })

  const worker = runtime.worker('task-resume')
  const actions = OPCAgentWorkerRuntime.actionsForWorker(worker)
  assert.equal(actions.some(action => action.id === 'resume'), true)
  assert.equal(actions.some(action => action.id === 'verify'), true)
  assert.equal(actions.some(action => action.id === 'interrupt'), true)
  const resume = OPCAgentWorkerRuntime.resumePrompt(worker, {
    id: 'checkpoint-resume',
    phase: 'correct',
    command: 'node --test desktop/test/rendererRuntime.test.cjs',
    steps: [{ tool: 'Edit', detail: 'patch failed' }],
  })
  assert.match(resume, /Worker OPC: task-resume/)
  assert.match(resume, /patch failed/)
  assert.match(resume, /test minimal/i)
  const verify = OPCAgentWorkerRuntime.verificationPrompt(worker)
  assert.match(verify, /vérification fraîche/i)
  assert.match(verify, /corrige la reprise automatique/)
})

test('agent tool evidence normalizes native tool proofs', () => {
  const { OPCAgentToolEvidence } = loadRendererModules()

  const edit = OPCAgentToolEvidence.fromTool({ name: 'Edit', target: 'desktop/renderer/state/runRuntimeState.js', detail: 'Modification de fichier' })
  assert.equal(edit.kind, 'write')
  assert.equal(edit.mutates, true)
  assert.equal(edit.requiresVerification, true)
  assert.equal(edit.target, 'desktop/renderer/state/runRuntimeState.js')

  const testEvidence = OPCAgentToolEvidence.fromTool({ name: 'Bash', command: 'npm --prefix desktop test', detail: '301 tests OK' })
  assert.equal(testEvidence.kind, 'verification')
  assert.equal(testEvidence.verifies, true)
  assert.equal(testEvidence.requiresVerification, false)

  const summary = OPCAgentToolEvidence.summarize([edit, testEvidence])
  assert.equal(summary.writes, 1)
  assert.equal(summary.verifications, 1)
  assert.equal(summary.requiresVerification, false)
  assert.match(summary.proof, /npm --prefix desktop test/)
})

test('inspector renders agent workers with targeted actions', () => {
  const dom = new JSDOM('<div id="task"></div>')
  const calls = []
  const { OPCInspector } = loadRendererModules({ document: dom.window.document })
  const container = dom.window.document.querySelector('#task')

  OPCInspector.renderTask(
    container,
    null,
    null,
    0,
    [],
    {
      resumeAgentWorker: id => calls.push(['resume', id]),
      verifyAgentWorker: id => calls.push(['verify', id]),
      interruptAgentWorker: id => calls.push(['interrupt', id]),
    },
    null,
    [],
    [],
    [],
    null,
    null,
    [{
      id: 'worker-visible',
      title: 'Corriger util.ts',
      status: 'blocked',
      phase: 'correct',
      currentStepId: '',
      blockedReason: 'test failed',
      verification: '',
      updatedAt: Date.now(),
    }],
  )

  assert.match(container.textContent, /Workers agentiques/)
  assert.match(container.textContent, /Corriger util\.ts/)
  assert.match(container.textContent, /test failed/)
  container.querySelector('[data-agent-worker-action="resume"]').click()
  container.querySelector('[data-agent-worker-action="verify"]').click()
  container.querySelector('[data-agent-worker-action="interrupt"]').click()
  assert.deepEqual(calls, [
    ['resume', 'worker-visible'],
    ['verify', 'worker-visible'],
    ['interrupt', 'worker-visible'],
  ])
})

test('agent verification engine detects minimal verification evidence', () => {
  const { OPCAgentVerificationEngine } = loadRendererModules()

  const verified = OPCAgentVerificationEngine.evaluateTaskVerification({
    task: {
      title: 'Modifier le runtime',
      events: [
        { kind: 'tool', tool: 'Bash', detail: 'Commande: pnpm test desktop/test/rendererRuntime.test.cjs' },
      ],
    },
    assistant: {
      content: 'Tests OK.',
      tools: [{ name: 'Bash', command: 'pnpm test desktop/test/rendererRuntime.test.cjs' }],
    },
  })
  assert.equal(verified.ok, true)
  assert.equal(verified.command, 'pnpm test desktop/test/rendererRuntime.test.cjs')
  assert.equal(verified.status, 'verified')

  const missing = OPCAgentVerificationEngine.evaluateTaskVerification({
    task: {
      title: 'Modifier le runtime',
      events: [{ kind: 'tool', tool: 'Edit', detail: 'Modification de fichier' }],
    },
    assistant: { content: 'Modification terminée.' },
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 'needs_verification')
  assert.match(missing.detail, /test minimal/i)
})

test('agent tool registry classifies tools and verification requirements', () => {
  const { OPCAgentToolRegistry } = loadRendererModules()

  const edit = OPCAgentToolRegistry.describeTool('Edit')
  assert.equal(edit.category, 'file-write')
  assert.equal(edit.mutates, true)
  assert.equal(edit.requiresVerification, true)

  const bashTest = OPCAgentToolRegistry.describeTool('Bash', { command: 'pnpm test desktop/test/rendererRuntime.test.cjs' })
  assert.equal(bashTest.category, 'shell')
  assert.equal(bashTest.verifies, true)
  assert.equal(bashTest.requiresVerification, false)

  const read = OPCAgentToolRegistry.describeTool('Read')
  assert.equal(read.mutates, false)
  assert.equal(read.requiresVerification, false)
})

test('agent context budget preserves priority files and trims low priority context', () => {
  const { OPCAgentContextBudget } = loadRendererModules()
  const context = {
    version: 1,
    totalFiles: 20,
    attachedFiles: Array.from({ length: 10 }, (_, index) => ({ name: `attached-${index}`, path: `/repo/a${index}.ts`, summary: 'long summary '.repeat(80) })),
    readNextFiles: [{ name: 'must-read', path: '/repo/must.ts', summary: 'important' }],
    relevantFiles: Array.from({ length: 8 }, (_, index) => ({ name: `relevant-${index}`, path: `/repo/r${index}.ts`, summary: 'relevant summary '.repeat(80), snippets: ['snippet '.repeat(60)] })),
    projectSessions: Array.from({ length: 6 }, (_, index) => ({ title: `session-${index}`, lastUser: 'question '.repeat(80), lastAssistant: 'answer '.repeat(80) })),
  }

  const result = OPCAgentContextBudget.applyProjectRuntimeBudget(context, {
    profile: { model: 'ollama/small', maxInputTokens: 900 },
  })

  assert.equal(result.compacted, true)
  assert.equal(result.context.readNextFiles.length, 1)
  assert.equal(result.context.readNextFiles[0].name, 'must-read')
  assert.ok(result.context.attachedFiles.length < context.attachedFiles.length)
  assert.ok(result.context.relevantFiles.length < context.relevantFiles.length)
  assert.ok(result.context.projectSessions.length < context.projectSessions.length)
  assert.equal(result.context.contextBudget.compacted, true)
})

test('agent context budget classifies model context policy before sending', () => {
  const { OPCAgentContextBudget } = loadRendererModules()

  const small = OPCAgentContextBudget.profileContextPolicy({
    model: 'ollama/tiny',
    maxInputTokens: 900,
  }, {
    requiredTokens: 4200,
  })
  assert.equal(small.tier, 'small')
  assert.equal(small.compactBeforeSend, true)
  assert.equal(small.fallbackRecommended, true)
  assert.match(small.strategy, /compactage/)

  const large = OPCAgentContextBudget.profileContextPolicy({
    model: 'cloud/large',
    maxInputTokens: 64000,
  }, {
    requiredTokens: 4200,
  })
  assert.equal(large.tier, 'large')
  assert.equal(large.compactBeforeSend, false)
  assert.equal(large.fallbackRecommended, false)
})

test('agent provider router recommends compatible agent profiles', () => {
  const { OPCAgentProviderRouter } = loadRendererModules()
  const route = OPCAgentProviderRouter.routeTask({
    selectedModel: 'chat/model',
    profiles: [
      { model: 'chat/model', label: 'Chat Only', usage: 'agent', capabilities: { tools: false }, configured: true },
      { model: 'agent/model', label: 'Agent Model', usage: 'agent', capabilities: { tools: true }, configured: true, maxInputTokens: 12000 },
      { model: 'paused/model', label: 'Paused', usage: 'disabled', capabilities: { tools: true }, configured: true },
    ],
    requireTools: true,
    minInputTokens: 8000,
  })

  assert.equal(route.selected.model, 'chat/model')
  assert.equal(route.ok, false)
  assert.equal(route.suggested.model, 'agent/model')
  assert.match(route.reason, /outils/i)
})

test('advanced permission policy classifies risky commands without sandboxing', () => {
  const { OPCAdvancedPermissionPolicy } = loadRendererModules()

  const destructive = OPCAdvancedPermissionPolicy.decide({
    command: 'rm -rf /tmp/nope',
    prompt: 'supprime /tmp/nope',
    permissionMode: 'bypassPermissions',
    workspaceTrusted: false,
    effectiveCwd: '/tmp',
    trustedWorkspaceRoot: '/repo',
    requestedBypass: true,
  })
  assert.equal(destructive.risk, 'critical')
  assert.equal(destructive.forceControlled, true)
  assert.equal(destructive.canBypass, false)
  assert.equal(destructive.categories.includes('delete'), true)
  assert.equal(destructive.categories.includes('outside_workspace'), true)

  const install = OPCAdvancedPermissionPolicy.decide({
    command: 'pnpm install',
    prompt: 'installe les deps',
    permissionMode: 'acceptEdits',
    workspaceTrusted: true,
    effectiveCwd: '/repo',
    trustedWorkspaceRoot: '/repo',
    requestedBypass: true,
  })
  assert.equal(install.categories.includes('install'), true)
  assert.equal(install.categories.includes('network'), true)
  assert.equal(install.risk, 'high')
  assert.equal(install.forceControlled, true)
})

test('advanced permission policy removes dangerous exact bash allow rules', () => {
  const { OPCAdvancedPermissionPolicy } = loadRendererModules()
  const decision = OPCAdvancedPermissionPolicy.decide({
    command: 'rm -rf /tmp/nope',
    permissionMode: 'bypassPermissions',
    workspaceTrusted: true,
    effectiveCwd: '/repo',
    trustedWorkspaceRoot: '/repo',
    requestedBypass: true,
  })

  const filtered = OPCAdvancedPermissionPolicy.filterAllowedTools([
    'Bash(rm -rf /tmp/nope)',
    'Bash',
    'Read',
  ], decision)

  assert.equal(filtered.includes('Bash(rm -rf /tmp/nope)'), false)
  assert.equal(filtered.includes('Bash'), true)
  assert.equal(filtered.includes('Read'), true)
})

test('advanced permission strict mode blocks critical actions instead of only controlling them', () => {
  const { OPCAdvancedPermissionPolicy } = loadRendererModules()
  const decision = OPCAdvancedPermissionPolicy.decide({
    command: 'rm -rf /tmp/nope',
    prompt: 'supprime /tmp/nope',
    permissionMode: 'bypassPermissions',
    workspaceTrusted: true,
    trustedWorkspaceRoot: '/repo',
    effectiveCwd: '/repo',
    requestedBypass: true,
    strictMode: true,
  })

  assert.equal(decision.risk, 'critical')
  assert.equal(decision.blocked, true)
  assert.equal(decision.forceControlled, true)
  assert.match(decision.reason, /bloquee/)

  const filtered = OPCAdvancedPermissionPolicy.filterAllowedTools(['Bash', 'Edit', 'MultiEdit', 'Read'], decision)
  assert.deepEqual(filtered, ['Read'])
})

test('inspector exposes advanced permission risk as a visible runtime decision', () => {
  const { OPCInspector } = loadRendererModules()
  const items = OPCInspector.runtimeDecisionSummary({
    assistant: {
      permissionDecision: {
        advanced: {
          risk: 'critical',
          label: 'Action critique contrôlée',
          reason: 'permission avancee: action critique controlee',
          detail: 'catégories delete, outside_workspace',
          categories: ['delete', 'outside_workspace'],
        },
      },
    },
    runtimeAudit: [],
  })

  const permission = items.find(item => item.label === 'Permission avancée')
  assert.equal(permission.tone, 'error')
  assert.match(permission.value, /critique/i)
  assert.match(permission.detail, /outside_workspace/)
})

test('agent runtime profile centralizes tools permissions routing context and diagnostics', () => {
  const { OPCAgentRuntimeProfile } = loadRendererModules()
  const profile = OPCAgentRuntimeProfile.buildRuntimeProfile({
    prompt: 'implémente le runtime agentique, cherche sur le web puis rebuild/install',
    permissionMode: 'acceptEdits',
    actionPrompt: true,
    selectedModel: 'chat/model',
    providerProfiles: [
      { model: 'chat/model', label: 'Chat Only', usage: 'agent', capabilities: { tools: false }, configured: true, maxInputTokens: 2000 },
      { model: 'agent/model', label: 'Agent Model', usage: 'agent', capabilities: { tools: true, streaming: true }, configured: true, maxInputTokens: 16000 },
    ],
    contextBudget: { compacted: true, level: 2, context: { contextBudget: { estimatedTokens: 4200, budgetChars: 12000 } } },
    permissions: { workspaceTrusted: true, skipPermissions: true, permissionMode: 'acceptEdits' },
  })

  assert.equal(profile.requirements.requireTools, true)
  assert.equal(profile.requirements.requiresVerification, true)
  assert.equal(profile.requirements.requiresWeb, true)
  assert.equal(profile.requirements.requiresInstallSafety, true)
  assert.ok(profile.requirements.minInputTokens >= 5200)
  assert.equal(profile.providerRoute.ok, false)
  assert.equal(profile.providerRoute.suggested.model, 'agent/model')
  assert.equal(profile.permissionProfile.write, 'controlled')
  assert.equal(profile.permissionProfile.shell, 'direct')
  assert.equal(profile.autoContinue.max, 4)
  assert.equal(profile.diagnostics.contextCompacted, true)
  assert.equal(profile.diagnostics.suggestedModel, 'agent/model')
  assert.ok(profile.toolManifest.some(tool => tool.id === 'read_file' && tool.enabled))
  assert.ok(profile.toolManifest.some(tool => tool.id === 'write_file' && tool.enabled))
  assert.ok(profile.toolManifest.some(tool => tool.id === 'test' && tool.required))
})

test('agent runtime profile block tells the model to use tools and verify sequentially', () => {
  const { OPCAgentRuntimeProfile } = loadRendererModules()
  const profile = OPCAgentRuntimeProfile.buildRuntimeProfile({
    prompt: 'corrige le bug provider puis lance les tests',
    permissionMode: 'bypassPermissions',
    actionPrompt: true,
    selectedModel: 'agent/model',
    providerProfiles: [
      { model: 'agent/model', label: 'Agent Model', usage: 'agent', capabilities: { tools: true }, configured: true, maxInputTokens: 12000 },
    ],
    permissions: { workspaceTrusted: true, skipPermissions: true },
  })
  const block = OPCAgentRuntimeProfile.agentRuntimeBlock(profile)

  assert.match(block, /PROFIL RUNTIME AGENTIQUE OPC/)
  assert.match(block, /read_file=Read/)
  assert.match(block, /write_file=Write\/Edit\/MultiEdit/)
  assert.match(block, /Boucle obligatoire: plan court → outils → test minimal/)
  assert.match(block, /ne passe pas à l'étape suivante/)
  assert.match(block, /Provider sélectionné: Agent Model/)
})

test('agent tool planner builds a deterministic read edit test verify plan', () => {
  const { OPCAgentToolPlanner } = loadRendererModules()
  const plan = OPCAgentToolPlanner.planForTask({
    prompt: 'corrige le bug provider puis lance les tests',
    requirements: {
      requiresFilesystemWrite: true,
      requiresVerification: true,
      requiresShell: true,
      requiresInstallSafety: false,
      expectedTools: ['Read', 'Edit', 'Bash'],
    },
  })

  assert.equal(plan.steps[0].id, 'read')
  assert.equal(plan.steps.some(step => step.id === 'edit' && step.required), true)
  assert.equal(plan.steps.some(step => step.id === 'test' && step.required), true)
  assert.equal(plan.steps.at(-1).id, 'conclude')
  assert.match(OPCAgentToolPlanner.planBlock(plan), /PLAN OUTILS OPC/)
  assert.match(OPCAgentToolPlanner.planBlock(plan), /read -> edit -> test -> verify -> conclude/)
})

test('agent task step engine blocks progression after failed steps until proof is recorded', () => {
  const { OPCAgentTaskStepEngine } = loadRendererModules()
  const plan = OPCAgentTaskStepEngine.createStepPlan({
    toolPlan: {
      steps: [
        { id: 'read', label: 'Lire', required: true, tools: ['Read'] },
        { id: 'edit', label: 'Modifier', required: true, tools: ['Edit'] },
        { id: 'test', label: 'Tester', required: true, tools: ['Bash'] },
        { id: 'conclude', label: 'Conclure', required: true, tools: [] },
      ],
    },
  })

  assert.equal(OPCAgentTaskStepEngine.nextReadyStep(plan).id, 'read')
  const afterRead = OPCAgentTaskStepEngine.recordStepResult(plan, 'read', { status: 'done', proof: 'Read src/file.ts' })
  assert.equal(OPCAgentTaskStepEngine.nextReadyStep(afterRead).id, 'edit')
  const failedEdit = OPCAgentTaskStepEngine.recordStepResult(afterRead, 'edit', { status: 'failed', error: 'patch failed' })
  assert.equal(failedEdit.blocked, true)
  assert.equal(OPCAgentTaskStepEngine.nextReadyStep(failedEdit), null)
  const fixedEdit = OPCAgentTaskStepEngine.recordStepResult(failedEdit, 'edit', { status: 'done', proof: 'Edit src/file.ts' })
  const failedTest = OPCAgentTaskStepEngine.recordStepResult(fixedEdit, 'test', { status: 'failed', error: 'npm test failed' })
  assert.equal(failedTest.blocked, true)
  const verified = OPCAgentTaskStepEngine.recordStepResult(failedTest, 'test', { status: 'done', proof: 'npm test OK' })
  assert.equal(OPCAgentTaskStepEngine.nextReadyStep(verified).id, 'conclude')
  assert.match(OPCAgentTaskStepEngine.summary(verified), /test: done/)
})

test('agent runtime profile includes a machine-readable tool plan', () => {
  const { OPCAgentRuntimeProfile } = loadRendererModules()
  const profile = OPCAgentRuntimeProfile.buildRuntimeProfile({
    prompt: 'implemente la reprise checkpoint et teste',
    permissionMode: 'acceptEdits',
    actionPrompt: true,
    selectedModel: 'agent/model',
    providerProfiles: [
      { model: 'agent/model', label: 'Agent Model', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 12000 },
    ],
    permissions: { workspaceTrusted: true, skipPermissions: true },
  })

  assert.equal(profile.toolPlan.steps.some(step => step.id === 'read'), true)
  assert.equal(profile.toolPlan.steps.some(step => step.id === 'test' && step.required), true)
  assert.match(OPCAgentRuntimeProfile.agentRuntimeBlock(profile), /PLAN OUTILS OPC/)
})

test('agent step runner drives execute verify and conclude phases deterministically', () => {
  const { OPCAgentStepRunner } = loadRendererModules()
  const activeTask = {
    payload: {
      displayPrompt: 'corrige le bug provider dans util.ts',
      agentRuntimeProfile: {
        autoContinue: { requiresToolEvidence: true, requiresVerificationEvidence: true },
        requirements: { requireTools: true, requiresVerification: true },
      },
    },
  }

  const missingTools = OPCAgentStepRunner.evaluate({
    assistant: { content: 'Terminé, les modifications sont appliquées.', tools: [], diagnostics: { toolCount: 0 } },
    payload: { code: 0, reason: 'result' },
    activeTask,
  })
  assert.equal(missingTools.phase, 'execute')
  assert.equal(missingTools.nextPhase, 'execute')
  assert.equal(missingTools.shouldContinue, true)
  assert.equal(missingTools.reason, 'step-execute-missing-tools')
  assert.match(missingTools.prompt, /Phase OPC: execute/)

  const missingVerification = OPCAgentStepRunner.evaluate({
    assistant: {
      content: 'Modification terminée.',
      tools: [{ name: 'Edit', detail: 'Modification de fichier util.ts' }],
      diagnostics: { toolCount: 1 },
    },
    payload: { code: 0, reason: 'result', result: 'Modification terminée.' },
    activeTask,
  })
  assert.equal(missingVerification.phase, 'verify')
  assert.equal(missingVerification.nextPhase, 'verify')
  assert.equal(missingVerification.shouldContinue, true)
  assert.equal(missingVerification.reason, 'step-verify-missing-evidence')
  assert.match(missingVerification.prompt, /test minimal ciblé/)

  const complete = OPCAgentStepRunner.evaluate({
    assistant: {
      content: 'Tests OK.',
      tools: [
        { name: 'Edit', detail: 'Modification de fichier util.ts' },
        { name: 'Bash', command: 'npm test -- test/rendererRuntime.test.cjs' },
      ],
      diagnostics: { toolCount: 2 },
    },
    payload: { code: 0, reason: 'result', result: 'Tests OK.' },
    activeTask,
  })
  assert.equal(complete.phase, 'conclude')
  assert.equal(complete.nextPhase, 'done')
  assert.equal(complete.shouldContinue, false)
  assert.equal(complete.status, 'complete')
})

test('task checkpoint store keeps durable resume candidates and bounded steps', () => {
  const { OPCTaskCheckpointStore } = loadRendererModules()
  const changes = []
  const store = OPCTaskCheckpointStore.createTaskCheckpointStore({
    now: () => 1000,
    maxCheckpoints: 2,
    maxStepsPerCheckpoint: 3,
    onChange: checkpoints => changes.push(checkpoints.map(item => item.id)),
  })

  store.upsert('task-1', {
    assistantId: 'assistant-1',
    chatId: 'chat-1',
    model: 'mock/model',
    cwd: '/repo',
    prompt: 'corrige le provider',
    phase: 'queued',
    status: 'queued',
  })
  store.recordStep('task-1', { phase: 'running', status: 'running', detail: 'CLI demarre', at: 1100 })
  store.recordStep('task-1', { phase: 'tool', status: 'tool', tool: 'Bash', command: 'pnpm test', at: 1200 })
  store.recordStep('task-1', { phase: 'verify', status: 'needs_verification', detail: 'test minimal requis', at: 1300 })
  store.recordStep('task-1', { phase: 'retry', status: 'interrupted', detail: 'idle-timeout', at: 1400 })

  const candidate = store.resumeCandidate({ model: 'mock/model', cwd: '/repo' })
  assert.equal(candidate.id, 'task-1')
  assert.equal(candidate.status, 'interrupted')
  assert.equal(candidate.steps.length, 3)
  assert.match(store.summarize(candidate), /reprendre/i)
  assert.match(store.summarize(candidate), /idle-timeout/i)

  store.finish('task-1', { status: 'verified', result: 'tests OK', at: 1500 })
  assert.equal(store.resumeCandidate({ model: 'mock/model', cwd: '/repo' }), null)

  store.upsert('task-2', { model: 'mock/model', cwd: '/repo', prompt: 'deux', status: 'running', at: 1600 })
  store.upsert('task-3', { model: 'mock/model', cwd: '/repo', prompt: 'trois', status: 'running', at: 1700 })
  assert.equal(JSON.stringify(store.entries().map(item => item.id)), JSON.stringify(['task-3', 'task-2']))
  assert.equal(changes.length > 0, true)
})

test('task checkpoint summarizer builds compact resume prompts with last useful proof', () => {
  const { OPCTaskCheckpointSummarizer } = loadRendererModules()
  const resume = OPCTaskCheckpointSummarizer.buildResumePrompt({
    id: 'task-checkpoint',
    status: 'interrupted',
    phase: 'tool',
    prompt: 'implémente un long chantier '.repeat(20),
    error: 'idle-timeout',
    nextAction: 'reprendre le test minimal',
    steps: Array.from({ length: 10 }, (_, index) => ({
      phase: index === 9 ? 'test' : 'tool',
      tool: index === 9 ? 'Bash' : 'Read',
      detail: `étape ${index}`,
    })),
  }, { userPrompt: 'continue', maxChars: 900 })

  assert.match(resume.text, /CHECKPOINT OPC/)
  assert.match(resume.text, /task-checkpoint/)
  assert.match(resume.text, /idle-timeout/)
  assert.match(resume.text, /étape 9/)
  assert.equal(resume.text.includes('étape 0'), false)
  assert.equal(resume.text.length <= 900, true)
})

test('provider failure policy recommends fallback after repeated model failures', () => {
  const { OPCProviderFailurePolicy } = loadRendererModules()
  let history = []
  history = OPCProviderFailurePolicy.recordFailure(history, {
    model: 'bad/model',
    reason: 'idle-timeout',
    at: 1000,
  })
  history = OPCProviderFailurePolicy.recordFailure(history, {
    model: 'bad/model',
    reason: 'Prompt is too long',
    at: 2000,
  })

  const recommendation = OPCProviderFailurePolicy.recommend({
    history,
    selectedModel: 'bad/model',
    profiles: [
      { model: 'bad/model', label: 'Bad', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 12000 },
      { model: 'fallback/model', label: 'Fallback', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 64000 },
    ],
    requirements: { requireTools: true, minInputTokens: 32000 },
    now: 3000,
  })

  assert.equal(recommendation.shouldFallback, true)
  assert.equal(recommendation.failureCount, 2)
  assert.equal(recommendation.suggested.model, 'fallback/model')
  assert.match(recommendation.detail, /2 echecs/i)
})

test('provider failure policy applies controlled auto-routing only when enabled', () => {
  const { OPCProviderFailurePolicy } = loadRendererModules()
  const history = OPCProviderFailurePolicy.recordFailure(
    OPCProviderFailurePolicy.recordFailure([], { model: 'bad/model', reason: 'timeout', at: 1000 }),
    { model: 'bad/model', reason: 'context length', at: 2000 },
  )
  const profiles = [
    { model: 'bad/model', label: 'Bad', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 12000 },
    { model: 'fallback/model', label: 'Fallback', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 64000 },
  ]

  const disabled = OPCProviderFailurePolicy.applyControlledAutoRoute({
    enabled: false,
    history,
    selectedModel: 'bad/model',
    profiles,
    requirements: { requireTools: true, minInputTokens: 32000 },
    now: 3000,
  })
  assert.equal(disabled.model, 'bad/model')
  assert.equal(disabled.switched, false)

  const enabled = OPCProviderFailurePolicy.applyControlledAutoRoute({
    enabled: true,
    history,
    selectedModel: 'bad/model',
    profiles,
    requirements: { requireTools: true, minInputTokens: 32000 },
    now: 3000,
  })
  assert.equal(enabled.model, 'fallback/model')
  assert.equal(enabled.switched, true)
  assert.match(enabled.audit.detail, /Fallback/)
})

test('provider failure policy respects configurable auto-router thresholds', () => {
  const { OPCProviderFailurePolicy } = loadRendererModules()
  const history = OPCProviderFailurePolicy.recordFailure([], { model: 'bad/model', reason: 'timeout', at: 1000 })
  const profiles = [
    { model: 'bad/model', label: 'Bad', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 12000 },
    { model: 'fallback/model', label: 'Fallback', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 64000 },
  ]
  const conservative = OPCProviderFailurePolicy.applyControlledAutoRoute({
    enabled: true,
    threshold: 2,
    history,
    selectedModel: 'bad/model',
    profiles,
    requirements: { requireTools: true, minInputTokens: 32000 },
    now: 3000,
  })
  const aggressive = OPCProviderFailurePolicy.applyControlledAutoRoute({
    enabled: true,
    threshold: 1,
    history,
    selectedModel: 'bad/model',
    profiles,
    requirements: { requireTools: true, minInputTokens: 32000 },
    now: 3000,
  })

  assert.equal(conservative.switched, false)
  assert.equal(aggressive.switched, true)
  assert.equal(aggressive.recommendation.failureCount, 1)
})

test('runtime quality dashboard summarizes providers checkpoints and verification', () => {
  const { OPCRuntimeQualityDashboard } = loadRendererModules()
  const summary = OPCRuntimeQualityDashboard.summarize({
    providerFailureHistory: [
      { model: 'bad/model', reason: 'timeout', at: 3000 },
      { model: 'bad/model', reason: 'context', at: 2000 },
    ],
    taskCheckpoints: [
      { id: 'task-1', status: 'interrupted', model: 'bad/model', updatedAt: 3000 },
      { id: 'task-2', status: 'verified', model: 'good/model', updatedAt: 2500 },
    ],
    agentTaskLedger: [
      { id: 'task-1', status: 'interrupted', model: 'bad/model' },
      { id: 'task-2', status: 'verified', model: 'good/model' },
    ],
    runtimeAudit: [
      { kind: 'provider-fallback', status: 'warning' },
      { kind: 'run-end', status: 'ok' },
    ],
    companionJobs: [
      { status: 'running' },
    ],
    agentWorkers: [
      { status: 'running', phase: 'execute' },
      { status: 'blocked', phase: 'correct' },
    ],
  })

  assert.equal(summary.providerFailures, 2)
  assert.equal(summary.interruptedCheckpoints, 1)
  assert.equal(summary.verifiedTasks, 1)
  assert.equal(summary.runningCompanions, 1)
  assert.equal(summary.activeWorkers, 1)
  assert.equal(summary.blockedWorkers, 1)
  assert.equal(summary.providerHotspots[0].model, 'bad/model')
  assert.equal(summary.tone, 'warning')
})

test('provider runtime diagnostics classify live provider blockers', () => {
  const { OPCProviderRuntimeDiagnostics } = loadRendererModules()
  const diagnostics = OPCProviderRuntimeDiagnostics.diagnose({
    now: 100000,
    runtime: { phase: 'provider', model: 'bad/model' },
    assistant: {
      diagnostics: {
        startedAt: 0,
        lastActivityAt: 30000,
        eventCount: 1,
        providerEventCount: 1,
        contextEstimatedTokens: 170753,
      },
    },
    profile: {
      model: 'bad/model',
      baseUrl: 'api.provider.test/v1',
      configured: false,
    },
    providerCheck: {
      ok: false,
      status: 'context_length',
      error: 'Please reduce the length of the input prompt.',
      issue: { code: 'context_length', label: 'contexte trop long' },
    },
  })

  assert.equal(diagnostics.status, 'error')
  assert.equal(diagnostics.items.some(item => item.code === 'provider_silence'), true)
  assert.equal(diagnostics.items.some(item => item.code === 'context_length'), true)
  assert.equal(diagnostics.items.some(item => item.code === 'key_missing'), true)
  assert.equal(diagnostics.items.some(item => item.code === 'bad_endpoint'), true)
  assert.match(diagnostics.detail, /bad\/model/)
})

test('provider runtime diagnostics recommends a compatible fallback when current model is blocked', () => {
  const { OPCProviderRuntimeDiagnostics } = loadRendererModules()
  const diagnostics = OPCProviderRuntimeDiagnostics.diagnose({
    now: 100000,
    runtime: { phase: 'provider', model: 'bad/model' },
    assistant: { diagnostics: { startedAt: 1000, lastActivityAt: 50000, eventCount: 2, providerEventCount: 1 } },
    profile: { model: 'bad/model', configured: true, capabilities: { tools: false }, maxInputTokens: 2000 },
    providerCheck: { ok: false, status: 'unsupported', error: 'tools not supported' },
    requirements: { requireTools: true, minInputTokens: 32000 },
    profiles: [
      { model: 'bad/model', label: 'Bad', usage: 'agent', configured: true, capabilities: { tools: false }, maxInputTokens: 2000 },
      { model: 'fallback/model', label: 'Fallback', usage: 'agent', configured: true, capabilities: { tools: true }, maxInputTokens: 64000 },
    ],
  })

  assert.equal(diagnostics.items.some(item => item.code === 'tools_missing'), true)
  assert.equal(diagnostics.fallback.model, 'fallback/model')
  assert.equal(diagnostics.items.some(item => item.code === 'fallback_available'), true)
})

test('agentic evaluation scenarios cover real runtime failure classes', () => {
  const { OPCAgenticEvaluationScenarios } = loadRendererModules()
  const report = OPCAgenticEvaluationScenarios.coverageReport()

  assert.equal(report.total >= 8, true)
  for (const category of [
    'file-edit-verify',
    'long-download-heartbeat',
    'provider-fallback',
    'small-context-compaction',
    'checkpoint-resume',
    'install-safety',
    'security-denial',
    'local-service-detection',
    'advanced-permissions-visible',
    'step-engine-blocking',
    'provider-runtime-diagnostics',
    'strict-permission-block',
    'worker-resume',
    'native-tool-evidence',
  ]) {
    assert.equal(report.categories.includes(category), true)
  }
  assert.equal(report.ready, true)
  assert.equal(OPCAgenticEvaluationScenarios.scenarios().every(item => item.prompt && item.expected?.length), true)
  assert.equal(OPCAgenticEvaluationScenarios.scenarioMatrix().every(item => item.priority && item.expectedProof.length), true)
  const benchmark = OPCAgenticEvaluationScenarios.benchmarkReport([
    { id: 'file-edit-verify', proofs: ['Read', 'Edit', 'npm --prefix desktop test'], status: 'pass' },
    { id: 'worker-resume', proofs: ['worker blocked', 'resume prompt', 'verification'], status: 'pass' },
    { id: 'native-tool-evidence', proofs: ['Edit proof', 'Bash verification'], status: 'pass' },
    { id: 'provider-runtime-diagnostics', proofs: ['fallback compatible'], status: 'warning' },
  ])
  assert.equal(benchmark.total, 4)
  assert.equal(benchmark.passed, 3)
  assert.equal(benchmark.ready, true)
  assert.match(benchmark.summary, /3\/4/)
})

test('inspector summarizes agentic runtime decisions for visible diagnostics', () => {
  const { OPCInspector } = loadRendererModules()
  const assistant = {
    diagnostics: {
      completionGuard: {
        shouldContinue: true,
        reason: 'step-verify-missing-evidence',
        label: 'Vérification requise par le runtime',
        detail: 'Le profil runtime exigeait une vérification fraîche avant de conclure.',
      },
      agentStep: {
        shouldContinue: true,
        reason: 'step-verify-missing-evidence',
        phase: 'verify',
        nextPhase: 'verify',
      },
      agentRuntime: {
        taskCategory: 'code-change',
        requiresTools: true,
        requiresVerification: true,
        providerRouteOk: true,
        minInputTokens: 8000,
      },
    },
  }
  const items = OPCInspector.runtimeDecisionSummary({
    assistant,
    runtimeAudit: [
      { kind: 'run-end', status: 'ok', label: 'Execution terminee' },
      { kind: 'auto-continue', status: 'ok', label: 'Vérification requise par le runtime', detail: 'relance 1/4' },
    ],
  })

  assert.equal(items[0].label, 'Décision agentique')
  assert.match(items[0].value, /Vérification requise/)
  assert.equal(items[0].tone, 'warning')
  assert.equal(items.some(item => item.label === 'Phase OPC' && /verify/.test(item.value)), true)
  assert.equal(items.some(item => item.label === 'Garanties' && /outils/.test(item.value) && /vérification/.test(item.value)), true)
  assert.equal(items.some(item => item.label === 'Audit' && /relance 1\/4/.test(item.detail)), true)
})
