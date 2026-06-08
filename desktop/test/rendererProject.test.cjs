const { assert, createStorage, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

test('renderer project file index builds searchable metadata and ranked matches', () => {
  const { OPCProjectFileIndex } = loadRendererModules()
  const index = OPCProjectFileIndex.buildProjectFileIndex(`# Runtime Supervisor

Le supervisor surveille les processus longs et les ports actifs.

## Reconnexion
Il restaure les taches apres un redemarrage.
`, {
    name: 'runtime.md',
    path: '/repo/docs/runtime.md',
  })

  assert.match(index.summary, /Runtime Supervisor/)
  assert.equal(index.headings.includes('Runtime Supervisor'), true)
  assert.equal(index.keywords.includes('supervisor'), true)
  assert.match(index.searchIndex, /reconnexion/)

  const results = OPCProjectFileIndex.searchProjectFiles([
    { name: 'runtime.md', path: '/repo/docs/runtime.md', ...index },
    { name: 'style.md', path: '/repo/docs/style.md', summary: 'Design interface' },
  ], 'supervisor ports')

  assert.equal(results.length, 1)
  assert.equal(results[0].file.name, 'runtime.md')
  assert.equal(results[0].score > 0, true)
  assert.equal(results[0].snippets.some(snippet => /ports actifs/.test(snippet)), true)
})

test('renderer project context engine injects runtime and project session digest', () => {
  const { OPCConversation } = loadRendererModules()
  const project = {
    id: 'project-1',
    name: 'OPC Runtime',
    description: 'Desktop CLI',
    memory: 'Toujours vérifier les providers avant de conclure.',
    instructions: 'Lire avant de modifier.',
    runtime: {
      cwd: '/repo/opc',
      model: 'opencode/deepseek-v4-flash-free',
      permissionMode: 'bypassPermissions',
      memoryEnabled: true,
    },
    files: [
      {
        id: 'file-1',
        name: 'runtime.md',
        path: '/repo/opc/runtime.md',
        summary: 'Runtime Supervisor et ports actifs.',
        preview: 'Le supervisor suit les processus longs.',
        searchIndex: 'runtime supervisor ports actifs',
        keywords: ['runtime', 'supervisor'],
        headings: ['Runtime Supervisor'],
        indexedAt: '2026-05-15T00:00:00.000Z',
      },
    ],
  }
  const chat = {
    id: 'chat-active',
    projectId: 'project-1',
    messages: [{ role: 'user', content: 'analyse runtime' }],
  }
  const context = OPCConversation.buildProjectRuntimeContext(project, 'supervisor ports', {
    activeChatId: chat.id,
    settings: { cwd: '/fallback', model: 'fallback-model', permissionMode: 'default', memoryEnabled: false },
    chats: [
      chat,
      {
        id: 'chat-old',
        title: 'audit provider',
        projectId: 'project-1',
        createdAt: '2026-05-14T12:00:00.000Z',
        messages: [
          { role: 'user', content: 'teste le modèle' },
          { role: 'assistant', content: 'Le provider répond OK.' },
        ],
      },
    ],
  })

  assert.equal(context.runtime.cwd, '/repo/opc')
  assert.equal(context.runtime.model, 'opencode/deepseek-v4-flash-free')
  assert.equal(context.projectSessions.length, 1)
  assert.equal(context.relevantFiles.length, 1)

  const prompt = OPCConversation.buildCliPrompt(chat, 'supervisor ports', {
    project,
    projectRuntimeContext: context,
    settings: { cwd: '/repo/opc', model: 'opencode/deepseek-v4-flash-free', permissionMode: 'bypassPermissions', memoryEnabled: true },
    permissionMode: 'bypassPermissions',
    chats: [],
  })
  assert.match(prompt, /Réglages runtime du projet/)
  assert.match(prompt, /Historique synthétique des autres sessions du projet/)
  assert.match(prompt, /audit provider/)
  assert.match(prompt, /runtime\.md/)
})

test('renderer built-in Claude Code expert skill activates for Claude Code project context', () => {
  const { OPCConversation, OPCBuiltInSkills } = loadRendererModules()
  const project = {
    id: 'project-claude',
    name: 'Claude Agent',
    instructions: 'Optimiser CLAUDE.md et les hooks.',
    files: [
      { name: 'CLAUDE.md', path: '/repo/CLAUDE.md', summary: 'Hooks MCP permissions', keywords: ['hooks', 'mcp'] },
    ],
  }
  assert.equal(OPCBuiltInSkills.hasClaudeCodeSignal(project, 'configure les permissions'), true)
  assert.equal(OPCBuiltInSkills.hasSuperExpertSignal(project, 'debug et refactor Claude Code'), true)
  const prompt = OPCConversation.buildCliPrompt({ id: 'chat', projectId: project.id, messages: [] }, 'configure les permissions', {
    project,
    permissionMode: 'bypassPermissions',
    settings: { cwd: '/repo', model: 'model', permissionMode: 'bypassPermissions', memoryEnabled: true },
  })
  assert.match(prompt, /COMPETENCE INTEGREE OPC: claude-code-super-expert/)
  assert.match(prompt, /COMPETENCE INTEGREE OPC: claude-code-expert/)
  assert.match(prompt, /CLAUDE\.md, AGENTS\.md/)
})

test('renderer built-in Karpathy guidelines skill activates for coding work', () => {
  const { OPCConversation, OPCBuiltInSkills } = loadRendererModules()
  const project = {
    id: 'project-opc',
    name: 'OPC',
    instructions: 'Lire avant de modifier.',
    files: [
      { name: 'index.html', path: '/repo/desktop/renderer/index.html', summary: 'Interface desktop OPC', keywords: ['renderer', 'ui'] },
    ],
  }

  assert.equal(OPCBuiltInSkills.hasKarpathyGuidelinesSignal(project, 'refactoring profond du code'), true)
  const prompt = OPCConversation.buildCliPrompt({ id: 'chat', projectId: project.id, messages: [] }, 'refactoring profond du code', {
    project,
    permissionMode: 'bypassPermissions',
    settings: { cwd: '/repo', model: 'model', permissionMode: 'bypassPermissions', memoryEnabled: true },
  })
  assert.match(prompt, /COMPETENCE INTEGREE OPC: karpathy-guidelines/)
  assert.match(prompt, /plus petit changement robuste/)
  assert.match(prompt, /tranches testables/)
})

test('renderer built-in Mercury coder skill activates for structured developer workflows', () => {
  const { OPCConversation, OPCBuiltInSkills } = loadRendererModules()
  const project = {
    id: 'project-opc',
    name: 'OPC',
    instructions: 'Agir par tranches vérifiables.',
    files: [
      { name: 'runController.js', path: '/repo/desktop/renderer/runController.js', summary: 'Runtime des sessions CLI', keywords: ['runtime', 'debug'] },
    ],
  }

  assert.equal(OPCBuiltInSkills.hasMercuryCoderSignal(project, '/tdd corrige ce bug runtime'), true)
  const prompt = OPCConversation.buildCliPrompt({ id: 'chat', projectId: project.id, messages: [] }, '/tdd corrige ce bug runtime', {
    project,
    permissionMode: 'bypassPermissions',
    settings: { cwd: '/repo', model: 'model', permissionMode: 'bypassPermissions', memoryEnabled: true },
  })
  assert.match(prompt, /COMPETENCE INTEGREE OPC: mercury-coder/)
  assert.match(prompt, /Modes Mercury/)
  assert.match(prompt, /TDD pragmatique/)
  assert.match(prompt, /Verification before completion/)
  assert.match(prompt, /Security gate/)
  assert.match(prompt, /\/quality-gate/)
})

test('renderer built-in Awesome DESIGN.md skill activates for UI design work', () => {
  const { OPCConversation, OPCBuiltInSkills } = loadRendererModules()
  const project = {
    id: 'project-opc-design',
    name: 'OPC',
    instructions: 'Préserver la fluidité desktop.',
    files: [
      { name: 'index.html', path: '/repo/desktop/renderer/index.html', summary: 'Interface premium desktop OPC', keywords: ['ui', 'design'] },
      { name: 'styles.css', path: '/repo/desktop/renderer/styles.css', summary: 'Tokens, palette, layout et composants', keywords: ['tokens', 'layout'] },
    ],
  }

  assert.equal(OPCBuiltInSkills.hasAwesomeDesignMdSignal(project, "ameliore le design premium de l'interface avec DESIGN.md"), true)
  const prompt = OPCConversation.buildCliPrompt({ id: 'chat', projectId: project.id, messages: [] }, "ameliore le design premium de l'interface avec DESIGN.md", {
    project,
    permissionMode: 'bypassPermissions',
    settings: { cwd: '/repo', model: 'model', permissionMode: 'bypassPermissions', memoryEnabled: true },
  })
  assert.match(prompt, /COMPETENCE INTEGREE OPC: awesome-design-md/)
  assert.match(prompt, /DESIGN\.md comme le contrat visuel/)
  assert.match(prompt, /tokens: palette, typographie, spacing/)
  assert.match(prompt, /header sticky/)
  assert.match(prompt, /garder fluidite et rapidite/)
})

test('renderer speed reader extracts readable words and action appears for long assistant text', () => {
  const { OPCSpeedReader, OPCMessageActions } = loadRendererModules()
  const words = OPCSpeedReader.wordsFromText('## Rapport\nVoici `un test` simple.')
  assert.equal(JSON.stringify(words), JSON.stringify(['Rapport', 'Voici', 'un', 'test', 'simple.']))
  assert.equal(OPCSpeedReader.pivotIndex('lecture'), 2)

  const longText = Array.from({ length: 82 }, (_, index) => `mot${index}`).join(' ')
  const actions = OPCMessageActions.createMessageActions({
    state: { settings: { model: 'mock' } },
    chatController: { previousUserPrompt: () => '' },
    actions: { openSpeedReader: () => true },
  })
  assert.equal(actions.signature({ role: 'assistant', status: 'done', content: longText }).includes('speed-reader'), true)
})

test('renderer competence profile extracts skill packs and prompt guardrails', () => {
  const { OPCCompetenceProfile } = loadRendererModules()
  const project = {
    name: 'Legal',
    files: [
      {
        name: 'SKILL.md',
        path: '/repo/commercial-legal/skills/review/SKILL.md',
        preview: [
          '---',
          'name: review',
          'description: >',
          '  Review a vendor agreement. Use when the user says "review this contract".',
          '---',
          '# /review',
          '1. Load `~/.claude/plugins/config/claude-for-legal/commercial-legal/CLAUDE.md`.',
          '## Purpose',
          'Reviews an inbound agreement against the playbook.',
        ].join('\n'),
        keywords: ['agreement', 'review'],
        indexedAt: '2026-05-14T00:00:00.000Z',
      },
      {
        name: 'CLAUDE.md',
        path: '/repo/commercial-legal/CLAUDE.md',
        preview: '# Commercial Contracts Practice Profile\n[PLACEHOLDER]\nEvery output is a draft for attorney review.',
        indexedAt: '2026-05-14T00:00:00.000Z',
      },
    ],
  }

  const profile = OPCCompetenceProfile.buildProjectCompetenceProfile(project)
  assert.equal(profile.skillCount, 1)
  assert.equal(profile.practiceProfileCount, 1)
  assert.equal(profile.domains[0].name, 'commercial-legal')
  assert.match(profile.capabilities[0].description, /Review a vendor agreement/)
  assert.equal(profile.guardrails.length >= 2, true)

  const block = OPCCompetenceProfile.competenceContextBlock(profile, 'review this contract')
  assert.match(block, /COMPETENCES OPC INJECTEES/)
  assert.match(block, /commercial-legal\/review/)
  assert.match(block, /Source a lire si pertinent: \/repo\/commercial-legal\/skills\/review\/SKILL\.md/)
  assert.match(block, /brouillon a revue professionnelle/)
})

test('renderer project file controller imports a folder and indexes files', async () => {
  const { OPCState, OPCProjectController, OPCProjectFileController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  const project = store.createProject({ name: 'Runtime' })
  const projectController = OPCProjectController.createProjectController({ state: store.state, store })
  const reads = []
  const controller = OPCProjectFileController.createProjectFileController({
    projectController,
    opc: {
      selectProjectFolder: async () => ({
        ok: true,
        folder: '/repo',
        files: [
          { path: '/repo/README.md', name: 'README.md', size: 12 },
          { path: '/repo/src/app.js', name: 'app.js', size: 16 },
        ],
      }),
      readProjectFile: async payload => {
        reads.push(payload.path)
        return {
          ok: true,
          path: payload.path,
          name: payload.path.endsWith('README.md') ? 'README.md' : 'app.js',
          size: 64,
          content: payload.path.endsWith('README.md') ? '# Runtime\nProjet OPC' : 'function bootRuntime() {}',
          truncated: false,
        }
      },
    },
  })

  await controller.addProjectFolder(project.id)
  const updated = store.projectById(project.id)
  assert.equal(updated.files.length, 2)
  assert.equal(reads.length, 2)
  assert.equal(updated.files.every(file => file.indexedAt), true)
  assert.equal(updated.files.some(file => /bootRuntime/.test(file.searchIndex)), true)
})

test('renderer project controller uses the in-app editor for creation and edition', () => {
  const { OPCState, OPCProjectController } = loadRendererModules()
  const store = OPCState.createStateStore()
  store.load()
  let editor = null
  const controller = OPCProjectController.createProjectController({
    state: store.state,
    store,
    openProjectEditor: options => {
      editor = options
    },
  })

  controller.createProject()
  assert.equal(editor.mode, 'create')
  editor.onSave({
    name: 'Asse',
    description: 'Agent frameworks',
    memory: 'Travaille sur les modèles.',
    instructions: 'Réponds court.',
  })
  assert.equal(store.state.projects.length, 1)
  assert.equal(store.activeProject().name, 'Asse')
  assert.equal(store.visibleChats(store.activeProject().id).length, 0)
  assert.equal(store.activeChat(), null)

  controller.editProject(store.activeProject().id)
  assert.equal(editor.mode, 'edit')
  editor.onSave({ name: 'Asse 2', description: '', memory: 'Mémoire changée.', instructions: '' })
  assert.equal(store.activeProject().name, 'Asse 2')
  assert.equal(store.activeProject().memory, 'Mémoire changée.')
})
