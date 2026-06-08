const { assert, createStorage, loadRendererModules, test } = require('./helpers/rendererModules.cjs')

test('renderer conversation context carries confirmation and exact Bash allow rule', () => {
  const { OPCConversation } = loadRendererModules()
  const chat = {
    messages: [
      { role: 'user', content: 'lance le service' },
      {
        role: 'assistant',
        content: 'Souhaitez-vous que je lance pnpm tools-dev run web ?',
        tools: [{ name: 'Bash', target: 'pnpm tools-dev run web' }],
      },
    ],
  }

  assert.equal(OPCConversation.isConfirmationPrompt('oui je confirme'), true)
  const intent = OPCConversation.commandIntentForPrompt('oui je confirme', chat, 'acceptEdits')
  assert.equal(intent.command, 'pnpm tools-dev run web')
  assert.equal(intent.source, 'tool-history')
  assert.equal(intent.skipPermissions, true)
  assert.deepEqual(Array.from(OPCConversation.allowedToolsForPrompt('oui je confirme', chat)), [
    'Bash(pnpm tools-dev run web)',
    'Bash(pnpm tools-dev run web *)',
    'Bash(nohup pnpm tools-dev run web *)',
    'Bash(cd * && pnpm tools-dev run web *)',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
  ])
  const prompt = OPCConversation.buildCliPrompt(chat, 'oui je confirme', { permissionMode: 'acceptEdits' })
  assert.match(prompt, /Ne redemande pas la même confirmation/)
  assert.match(prompt, /Dernière commande Bash proposée: pnpm tools-dev run web/)
  assert.match(prompt, /Source intention OPC: tool-history/)
  assert.match(prompt, /Permission OPC Desktop sélectionnée: acceptEdits/)
  assert.match(prompt, /DEMANDE UTILISATEUR ACTUELLE:\noui je confirme/)
})

test('renderer conversation context injects compact agent execution contract', () => {
  const { OPCAgentContract, OPCConversation } = loadRendererModules()
  const chat = { messages: [] }
  const prompt = OPCConversation.buildCliPrompt(chat, 'corrige le bug puis vérifie', {
    permissionMode: 'acceptEdits',
  })

  assert.equal(OPCAgentContract.canRunDirectly('acceptEdits', true), true)
  assert.match(prompt, /CONTRAT AGENT OPC/)
  assert.match(prompt, /Lis les fichiers, configs et dependances concernes avant de modifier/)
  assert.match(prompt, /Pour code\/debug\/build\/refactor: inspecte, isole la cause/)
  assert.match(prompt, /CONTRAT ACTION DIRECTE/)
  assert.match(prompt, /CONTRAT RAPIDITE/)
  assert.match(prompt, /Lance un test minimal pour confirmer que tout marche pour chaque tâche/)
  assert.match(prompt, /Si une étape échoue, ne passe pas à la suivante tant que le problème n'est pas réglé/)
  assert.match(prompt, /Ne cree pas de fichiers de documentation, commits, branches ou pull requests/)
})

test('renderer conversation context injects full agentic runtime profile', () => {
  const { OPCAgentRuntimeProfile, OPCConversation } = loadRendererModules()
  const chat = { messages: [] }
  const agentRuntimeProfile = OPCAgentRuntimeProfile.buildRuntimeProfile({
    prompt: 'implémente les 8 points puis rebuild/install',
    permissionMode: 'acceptEdits',
    actionPrompt: true,
    selectedModel: 'agent/model',
    providerProfiles: [
      { model: 'agent/model', label: 'Agent Model', usage: 'agent', capabilities: { tools: true }, configured: true, maxInputTokens: 12000 },
    ],
    permissions: { workspaceTrusted: true, skipPermissions: true },
  })
  const prompt = OPCConversation.buildCliPrompt(chat, 'implémente les 8 points puis rebuild/install', {
    permissionMode: 'acceptEdits',
    agentRuntimeProfile,
  })

  assert.match(prompt, /PROFIL RUNTIME AGENTIQUE OPC/)
  assert.match(prompt, /Outils disponibles attendus/)
  assert.match(prompt, /Boucle obligatoire: plan court → outils → test minimal/)
  assert.match(prompt, /Sécurité install: vérifier que l'app cible n'est pas en exécution/)
})

test('renderer conversation context exposes web tools for search and fetch requests', () => {
  const { OPCConversation } = loadRendererModules()
  const chat = { messages: [] }
  const prompt = OPCConversation.buildCliPrompt(chat, 'wen_search les dernières docs Electron puis web_fetch l’URL principale', {
    permissionMode: 'bypassPermissions',
  })

  assert.equal(OPCConversation.isActionPrompt('wen_search les dernières docs Electron'), true)
  assert.deepEqual(Array.from(OPCConversation.actionAllowedToolsForPrompt('web_fetch https://example.com', chat, 'bypassPermissions')), [
    'Bash',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
    'Edit',
    'Write',
    'MultiEdit',
  ])
  assert.match(prompt, /Outils web disponibles côté CLI/)
  assert.match(prompt, /noms CLI exacts WebSearch et WebFetch/)
})

test('renderer conversation context injects adversarial audit mode on explicit request', () => {
  const { OPCConversation } = loadRendererModules()
  const prompt = OPCConversation.buildCliPrompt({ messages: [] }, 'fait un audit adversarial du runtime OPC', {
    permissionMode: 'bypassPermissions',
  })

  assert.equal(OPCConversation.isAdversarialAuditPrompt('audit adversarial du runtime'), true)
  assert.match(prompt, /MODE AUDIT ADVERSARIAL OPC/)
  assert.match(prompt, /reviewer bloquant/)
  assert.match(prompt, /Classe les findings par sévérité/)
  assert.match(prompt, /N'applique pas de patch/)
})

test('renderer conversation context injects OPC rescue mode', () => {
  const { OPCConversation } = loadRendererModules()
  const prompt = OPCConversation.buildCliPrompt({ messages: [] }, '/opc:rescue corrige le test qui échoue', {
    permissionMode: 'bypassPermissions',
  })

  assert.equal(OPCConversation.isRescuePrompt('/opc:rescue corrige le test qui échoue'), true)
  assert.equal(OPCConversation.isActionPrompt('/opc:rescue corrige le test qui échoue'), true)
  assert.match(prompt, /MODE OPC RESCUE/)
  assert.match(prompt, /plus petit patch sûr/)
  assert.match(prompt, /Si une approche échoue deux fois/)
  assert.match(prompt, /Rapport final obligatoire/)
})

test('renderer conversation context prioritizes explicit paths and URLs over selected project cwd', () => {
  const { OPCConversation } = loadRendererModules()
  const selectedCwd = '/Users/bayeasssene/Documents/ProjetsGithub/OPC'
  const target = '/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal'
  const promptText = `analyse ${target} puis lis https://example.com/spec`
  const targets = OPCConversation.detectRequestTargets(promptText)
  const prompt = OPCConversation.buildCliPrompt({ messages: [] }, promptText, {
    permissionMode: 'bypassPermissions',
    settings: { cwd: selectedCwd, thinkEnabled: true },
    requestTargets: targets,
  })

  assert.deepEqual(Array.from(targets.localPaths), [target])
  assert.deepEqual(Array.from(targets.urls), ['https://example.com/spec'])
  assert.equal(OPCConversation.effectiveCwdForPrompt(promptText, selectedCwd), target)
  assert.match(prompt, /CIBLE EXPLICITE UTILISATEUR/)
  assert.match(prompt, /Priorité absolue: analyse\/lis\/travaille sur ce chemin/)
  assert.match(prompt, /utilise WebFetch pour lire les liens explicites/)
  assert.match(prompt, /Mode Think OPC: inactif/)
})

test('renderer conversation context does not treat install destination as analysis cwd', () => {
  const { OPCConversation } = loadRendererModules()
  const selectedCwd = '/Users/bayeasssene/Documents/ProjetsGithub/OPC'
  const longInstallPrompt = [
    "L'app doit rester aussi rapide que le CLI.",
    'Vérifie avec tests, smoke Electron, build, installation dans `/Applications` si macOS, puis lancement réel.',
  ].join(' ')
  const realTargetPrompt = 'analyse /Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal puis installe dans /Applications'

  assert.equal(OPCConversation.effectiveCwdForPrompt('rebuilder + installer dans /Applications', selectedCwd), selectedCwd)
  assert.deepEqual(Array.from(OPCConversation.detectRequestTargets('rebuilder + installer dans /Applications').localPaths), [])
  assert.equal(OPCConversation.effectiveCwdForPrompt(longInstallPrompt, selectedCwd), selectedCwd)
  assert.deepEqual(Array.from(OPCConversation.detectRequestTargets(longInstallPrompt).localPaths), [])
  assert.equal(OPCConversation.effectiveCwdForPrompt(realTargetPrompt, selectedCwd), '/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal')
  assert.deepEqual(Array.from(OPCConversation.detectRequestTargets(realTargetPrompt).localPaths), ['/Users/bayeasssene/Documents/ProjetsGithub/claude-for-legal'])
})

test('renderer conversation context injects active project memory and instructions', () => {
  const { OPCConversation } = loadRendererModules()
  const chat = { messages: [] }
  const prompt = OPCConversation.buildCliPrompt(chat, 'analyse ce dossier', {
    permissionMode: 'bypassPermissions',
    project: {
      name: 'Deep-search',
      description: 'Recherche structurée',
      memory: 'Toujours citer les fichiers lus.',
      instructions: 'Avancer étape par étape.',
      files: [
        { name: 'README.md', path: '/repo/README.md', size: 420 },
        {
          name: 'SKILL.md',
          path: '/repo/legal-builder-hub/skills/related-skills-surfacer/SKILL.md',
          preview: [
            '---',
            'name: related-skills-surfacer',
            'description: Suggest community skills based on recent activity. Use when the user asks for skill recommendations.',
            '---',
            '## Purpose',
            'Surface related community skills after a task.',
          ].join('\n'),
          indexedAt: '2026-05-14T00:00:00.000Z',
        },
      ],
    },
  })

  assert.match(prompt, /PROJET OPC ACTIF/)
  assert.match(prompt, /Nom: Deep-search/)
  assert.match(prompt, /Mémoire personnelle du projet:\nToujours citer les fichiers lus/)
  assert.match(prompt, /Instructions personnelles du projet:\nAvancer étape par étape/)
  assert.match(prompt, /Fichiers associés au projet:\n- README.md: \/repo\/README.md/)
  assert.match(prompt, /COMPETENCES OPC INJECTEES/)
  assert.match(prompt, /legal-builder-hub\/related-skills-surfacer/)
  assert.match(prompt, /lis les fichiers associés avec l'outil Read/)
})

test('renderer conversation context prioritizes files marked for next prompt', () => {
  const { OPCConversation } = loadRendererModules()
  const prompt = OPCConversation.buildCliPrompt({ messages: [] }, 'résume le fichier attaché', {
    project: {
      name: 'Research',
      files: [
        {
          name: 'brief.md',
          path: '/repo/brief.md',
          summary: 'Brief indexé',
          readNext: true,
        },
      ],
    },
  })

  assert.match(prompt, /Résumé indexé: Brief indexé/)
  assert.match(prompt, /Fichiers explicitement demandés pour ce prochain prompt:\n- brief.md: \/repo\/brief.md/)
  assert.match(prompt, /Priorité forte: commence par lire les fichiers explicitement demandés/)
})

test('renderer conversation context surfaces files relevant to the current prompt', () => {
  const { OPCConversation } = loadRendererModules()
  const project = {
    name: 'OPC Runtime',
    files: [
      {
        name: 'runtime.md',
        path: '/repo/runtime.md',
        summary: 'Runtime supervisor et reconnexion',
        searchIndex: 'runtime supervisor ports processus longs reconnexion',
        keywords: ['runtime', 'supervisor'],
        preview: 'Le runtime supervisor surveille les ports et les processus longs.',
        indexedAt: '2026-05-14T00:00:00.000Z',
      },
      {
        name: 'style.md',
        path: '/repo/style.md',
        summary: 'Design system',
        searchIndex: 'couleurs boutons layout',
      },
    ],
  }
  const runtimeContext = OPCConversation.buildProjectRuntimeContext(project, 'analyse le runtime supervisor')
  const prompt = OPCConversation.buildCliPrompt({ messages: [] }, 'analyse le runtime supervisor', { project, projectRuntimeContext: runtimeContext })

  assert.equal(runtimeContext.totalFiles, 2)
  assert.equal(runtimeContext.indexedFiles, 1)
  assert.equal(runtimeContext.relevantFiles[0].path, '/repo/runtime.md')
  assert.match(prompt, /Fichiers runtime OPC: 2 attaché\(s\), 1 indexé\(s\), 1 à réindexer/)
  assert.match(prompt, /Fichiers probablement pertinents pour la demande actuelle:\n- runtime.md: \/repo\/runtime.md/)
  assert.match(prompt, /Priorité moyenne: les fichiers probablement pertinents/)
  assert.equal(prompt.split('Fichiers probablement pertinents pour la demande actuelle:')[1].includes('- style.md: /repo/style.md'), false)
})

test('renderer conversation context treats rebuild install as direct action in acceptEdits mode', () => {
  const { OPCConversation } = loadRendererModules()
  const chat = { messages: [] }

  assert.equal(OPCConversation.isActionPrompt('rebuilder + installer dans /Applications'), true)
  assert.deepEqual(Array.from(OPCConversation.actionAllowedToolsForPrompt('rebuilder + installer dans /Applications', chat, 'acceptEdits')), [
    'Bash',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
    'Edit',
    'Write',
    'MultiEdit',
  ])
  assert.deepEqual(Array.from(OPCConversation.actionAllowedToolsForPrompt('rebuilder + installer dans /Applications', chat, 'default')), [])

  const prompt = OPCConversation.buildCliPrompt(chat, 'rebuilder + installer dans /Applications', { permissionMode: 'acceptEdits' })
  assert.match(prompt, /Demande d'action détectée: oui/)
  assert.match(prompt, /Action directe autorisée par OPC: oui/)
  assert.match(prompt, /Pour build\/install\/rebuild sans commande exacte/)
  assert.match(prompt, /Avant tout rebuild\/install d'une app macOS/)
  assert.match(prompt, /ne remplace pas le bundle/)
  assert.match(prompt, /Ne réponds jamais que l'environnement te bloque/)
})

test('renderer conversation context treats local provider key setup as an executable action', () => {
  const { OPCConversation } = loadRendererModules()
  const chat = { messages: [] }
  const promptText = 'fais les modif avec les clé le projet est en locale donc il ny pas de risque'

  assert.equal(OPCConversation.isActionPrompt(promptText), true)
  assert.deepEqual(Array.from(OPCConversation.actionAllowedToolsForPrompt(promptText, chat, 'bypassPermissions')), [
    'Bash',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
    'Edit',
    'Write',
    'MultiEdit',
  ])

  const prompt = OPCConversation.buildCliPrompt(chat, promptText, { permissionMode: 'bypassPermissions' })
  assert.match(prompt, /configuration locale avec clés\/API keys\/providers\/modèles/)
  assert.match(prompt, /Ne refuse pas seulement parce que des clés sont mentionnées/)
  assert.match(prompt, /Ne hardcode pas les secrets dans le code source versionné/)
  assert.match(prompt, /Action directe autorisée par OPC: oui/)
})

test('renderer conversation context does not treat stale background claims as truth', () => {
  const { OPCConversation } = loadRendererModules()
  const chat = {
    messages: [
      { role: 'user', content: 'EXÉCUTE pnpm tools-dev run web' },
      {
        role: 'assistant',
        content: "La commande pnpm tools-dev run web est déjà en cours d'exécution en arrière-plan.",
      },
      { role: 'user', content: 'tu as terminer' },
    ],
  }

  const prompt = OPCConversation.buildCliPrompt(chat, 'EXÉCUTE pnpm tools-dev run web')
  assert.match(prompt, /OPC Desktop n'a aucune tâche CLI active côté app/)
  assert.match(prompt, /anciens messages qui prétendent qu'une commande est en arrière-plan ne sont pas une preuve/)
  assert.match(prompt, /Commande demandée explicitement: pnpm tools-dev run web/)
  assert.doesNotMatch(prompt, /OPC: La commande pnpm tools-dev run web est déjà en cours/)
  assert.deepEqual(Array.from(OPCConversation.allowedToolsForPrompt('EXÉCUTE pnpm tools-dev run web', chat)), [
    'Bash(pnpm tools-dev run web)',
    'Bash(pnpm tools-dev run web *)',
    'Bash(nohup pnpm tools-dev run web *)',
    'Bash(cd * && pnpm tools-dev run web *)',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
  ])
})

test('renderer conversation context handles long-running commands in acceptEdits mode', () => {
  const { OPCConversation } = loadRendererModules()
  const chat = { messages: [] }
  const prompt = 'EXÉCUTE pnpm tools-dev run web'

  assert.equal(OPCConversation.isLongRunningCommand('pnpm tools-dev run web'), true)
  assert.deepEqual(Array.from(OPCConversation.allowedToolsForPrompt(prompt, chat, 'acceptEdits')), [
    'Bash(pnpm tools-dev run web)',
    'Bash(pnpm tools-dev run web *)',
    'Bash(nohup pnpm tools-dev run web *)',
    'Bash(cd * && pnpm tools-dev run web *)',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
  ])
  assert.equal(OPCConversation.shouldBypassPermissionsForPrompt(prompt, chat, 'acceptEdits'), true)
  assert.match(OPCConversation.buildCliPrompt(chat, prompt, { permissionMode: 'acceptEdits' }), /Commande longue détectée: oui/)
  assert.match(OPCConversation.buildCliPrompt(chat, prompt, { permissionMode: 'acceptEdits' }), /Commande préautorisée par OPC: pnpm tools-dev run web/)
  assert.match(OPCConversation.buildCliPrompt(chat, prompt, { permissionMode: 'acceptEdits' }), /ne la lance pas en foreground bloquant/)
})

test('renderer conversation context reuses only structured command intent', () => {
  const { OPCConversation } = loadRendererModules()
  const textOnlyChat = {
    messages: [
      {
        role: 'assistant',
        content: "L'environnement exige une approbation pour exécuter `pnpm tools-dev start`.",
      },
    ],
  }

  assert.equal(OPCConversation.approvedCommandForPrompt('lance le', textOnlyChat), '')
  assert.equal(OPCConversation.shouldBypassPermissionsForPrompt('lance le', textOnlyChat, 'acceptEdits'), false)

  const chat = {
    messages: [
      {
        role: 'assistant',
        content: "Commande proposée.",
        commandIntent: { command: 'pnpm tools-dev start', source: 'message-intent' },
      },
    ],
  }

  assert.equal(OPCConversation.approvedCommandForPrompt('lance le', chat), 'pnpm tools-dev start')
  assert.equal(OPCConversation.shouldBypassPermissionsForPrompt('lance le', chat, 'acceptEdits'), true)
  assert.deepEqual(Array.from(OPCConversation.allowedToolsForPrompt('lance le', chat, 'acceptEdits')), [
    'Bash(pnpm tools-dev start)',
    'Bash(pnpm tools-dev start *)',
    'Bash(nohup pnpm tools-dev start *)',
    'Bash(cd * && pnpm tools-dev start *)',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
  ])

  assert.equal(OPCConversation.approvedCommandForPrompt('analyse ce nouveau dossier et corrige les bugs', chat), '')
  assert.deepEqual(Array.from(OPCConversation.allowedToolsForPrompt('analyse ce nouveau dossier et corrige les bugs', chat, 'acceptEdits')), [])
  assert.deepEqual(Array.from(OPCConversation.actionAllowedToolsForPrompt('analyse ce nouveau dossier et corrige les bugs', chat, 'acceptEdits')), [
    'Bash',
    'Read',
    'Grep',
    'Glob',
    'WebSearch',
    'WebFetch',
    'Edit',
    'Write',
    'MultiEdit',
  ])
})
