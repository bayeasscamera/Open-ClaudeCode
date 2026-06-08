(function () {
  const DEFAULT_MIN_ACTION_INPUT_TOKENS = 4000
  const LARGE_CONTEXT_INPUT_TOKENS = 8000

  const TOOL_MANIFEST = [
    { id: 'read_file', label: 'read_file=Read', cliTools: ['Read'], group: 'filesystem', mode: 'read', baseline: true },
    { id: 'list_dir', label: 'list_dir=Glob/Grep', cliTools: ['Glob', 'Grep'], group: 'filesystem', mode: 'read', baseline: true },
    { id: 'search', label: 'search=Grep/Glob', cliTools: ['Grep', 'Glob'], group: 'search', mode: 'read', baseline: true },
    { id: 'bash', label: 'bash=Bash', cliTools: ['Bash'], group: 'shell', mode: 'controlled' },
    { id: 'write_file', label: 'write_file=Write/Edit/MultiEdit', cliTools: ['Write', 'Edit', 'MultiEdit'], group: 'filesystem', mode: 'write' },
    { id: 'patch', label: 'patch=Edit/MultiEdit', cliTools: ['Edit', 'MultiEdit'], group: 'filesystem', mode: 'write' },
    { id: 'web', label: 'web=WebSearch/WebFetch', cliTools: ['WebSearch', 'WebFetch'], group: 'web', mode: 'read' },
    { id: 'test', label: 'test=Bash', cliTools: ['Bash'], group: 'verification', mode: 'controlled' },
    { id: 'subtask', label: 'subtask=Task', cliTools: ['Task'], group: 'agent', mode: 'controlled' },
  ]

  function compactText(value, max = 400) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, Math.max(0, max - 3))}...`
  }

  function normalized(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function contextBudgetStats(contextBudget = {}) {
    const nested = contextBudget?.context?.contextBudget || contextBudget?.contextBudget || contextBudget || {}
    const estimatedTokens = Number(nested.estimatedTokens || contextBudget.estimatedTokens || 0)
    const budgetChars = Number(nested.budgetChars || contextBudget.budgetChars || 0)
    return {
      compacted: Boolean(contextBudget.compacted || nested.compacted),
      level: Number(contextBudget.level || nested.level || 0),
      estimatedTokens: Number.isFinite(estimatedTokens) ? Math.max(0, Math.round(estimatedTokens)) : 0,
      budgetChars: Number.isFinite(budgetChars) ? Math.max(0, Math.round(budgetChars)) : 0,
    }
  }

  function taskRequirements({
    prompt = '',
    actionPrompt = false,
    commandIntent = {},
    contextBudget = {},
  } = {}) {
    const text = normalized(prompt)
    const hasExplicitCommand = Boolean(commandIntent?.command)
    const mutating = /\b(implemente|implement|corrige|fix|modifie|modifier|edit|write|patch|applique|ajoute|supprime|cree|creer|refactor|configure|configurer)\b/.test(text)
    const buildInstall = /\b(rebuild|rebuilder|build|package|install|installer|installation|reinstall|reinstaller)\b/.test(text)
    const shell = buildInstall || hasExplicitCommand || /\b(test|tester|lance|lancer|execute|executer|run|start|demarre|diagnostic|doctor|verify|verifier)\b/.test(text)
    const web = /\b(web|internet|search|cherche|recherche|fetch|url|https?:\/\/|web_search|wen_search|web_fetch)\b/.test(text)
    const largeContext = /\b(codebase|architecture|audit|analyse|analyser|dossier|repo|projet complet|scale|scalabilite|scalability)\b/.test(text)
    const providerConfig = /\b(provider|providers|modele|model|api key|apikey|cle api|clé api|base url|openai|ollama|anthropic|nvidia)\b/.test(text)
    const stats = contextBudgetStats(contextBudget)
    const needsAction = Boolean(actionPrompt || mutating || shell || web || providerConfig)
    const requiresVerification = Boolean(needsAction || stats.compacted)
    const minFromContext = stats.estimatedTokens ? stats.estimatedTokens + 1200 : 0
    const minInputTokens = Math.max(
      needsAction ? DEFAULT_MIN_ACTION_INPUT_TOKENS : 0,
      largeContext || stats.compacted ? LARGE_CONTEXT_INPUT_TOKENS : 0,
      minFromContext,
    )
    const expectedTools = ['Read', 'Grep', 'Glob']
    if (web) expectedTools.push('WebSearch', 'WebFetch')
    if (shell || requiresVerification) expectedTools.push('Bash')
    if (mutating || buildInstall || providerConfig) expectedTools.push('Write', 'Edit', 'MultiEdit')
    if (largeContext) expectedTools.push('Task')

    return {
      requireAgent: true,
      requireTools: needsAction,
      requiresFilesystemRead: true,
      requiresFilesystemWrite: Boolean(mutating || providerConfig),
      requiresShell: Boolean(shell),
      requiresWeb: Boolean(web),
      requiresVerification,
      requiresInstallSafety: Boolean(buildInstall),
      preferLargeContext: Boolean(largeContext || stats.compacted),
      preferLocal: /\b(local|locale|ollama|localhost|127\.0\.0\.1)\b/.test(text),
      preferFast: !largeContext && !stats.compacted,
      minInputTokens,
      expectedTools: Array.from(new Set(expectedTools)),
      category: buildInstall ? 'build-install'
        : providerConfig ? 'provider-config'
        : mutating ? 'code-change'
        : web ? 'web-research'
        : largeContext ? 'analysis'
        : needsAction ? 'action'
        : 'chat',
    }
  }

  function permissionProfile({ permissionMode = 'default', permissions = {}, requirements = {} } = {}) {
    const canWrite = Boolean(requirements.requiresFilesystemWrite)
    const canShell = Boolean(requirements.requiresShell || requirements.requiresVerification)
    return {
      mode: permissionMode,
      workspaceTrusted: Boolean(permissions.workspaceTrusted),
      skipPermissions: Boolean(permissions.skipPermissions),
      read: 'workspace-read',
      write: canWrite ? 'controlled' : 'not-required',
      shell: canShell ? (permissions.skipPermissions ? 'direct' : 'controlled') : 'not-required',
      web: requirements.requiresWeb ? 'available' : 'optional',
      note: permissions.workspaceTrusted === false
        ? 'Workspace non approuve: pas de bypass silencieux.'
        : permissions.skipPermissions
          ? 'Action directe autorisee par OPC.'
          : 'Les actions mutantes restent controlees par les permissions CLI.',
    }
  }

  function runtimeToolManifest({ requirements = {}, permission = {} } = {}) {
    return TOOL_MANIFEST.map(tool => {
      const required = tool.id === 'test'
        ? Boolean(requirements.requiresVerification)
        : tool.id === 'web'
          ? Boolean(requirements.requiresWeb)
          : ['write_file', 'patch'].includes(tool.id)
            ? Boolean(requirements.requiresFilesystemWrite)
            : tool.id === 'bash'
              ? Boolean(requirements.requiresShell)
              : tool.id === 'subtask'
                ? Boolean(requirements.preferLargeContext)
                : Boolean(tool.baseline)
      const enabled = Boolean(required || tool.baseline || (tool.id === 'web' && requirements.requiresWeb))
      const controlled = ['write_file', 'patch', 'bash', 'test', 'subtask'].includes(tool.id) && permission.skipPermissions !== true
      return {
        ...tool,
        enabled,
        required,
        controlled,
      }
    })
  }

  function profileForModel(profiles = [], selectedModel = '') {
    return (profiles || []).find(profile => profile.model === selectedModel || profile.id === selectedModel) || null
  }

  function routeProvider({ providerProfiles = [], selectedModel = '', requirements = {} } = {}) {
    return window.OPCAgentProviderRouter?.routeTask?.({
      profiles: providerProfiles || [],
      selectedModel,
      requireAgent: requirements.requireAgent !== false,
      requireTools: Boolean(requirements.requireTools),
      minInputTokens: requirements.minInputTokens || 0,
      requirements,
    }) || {
      ok: true,
      selected: profileForModel(providerProfiles, selectedModel),
      suggested: null,
      candidates: [],
      reason: 'router indisponible',
    }
  }

  function autoContinuePolicy({ requirements = {} } = {}) {
    const max = requirements.requiresFilesystemWrite || requirements.requiresShell || requirements.preferLargeContext ? 4 : 2
    return {
      max,
      shouldContinueWithoutTools: Boolean(requirements.requireTools),
      requiresToolEvidence: Boolean(requirements.requireTools),
      requiresVerificationEvidence: Boolean(requirements.requiresVerification),
    }
  }

  function diagnosticsSnapshot({
    selectedModel = '',
    requirements = {},
    providerRoute = {},
    contextBudget = {},
    permission = {},
  } = {}) {
    const stats = contextBudgetStats(contextBudget)
    return {
      selectedModel,
      suggestedModel: providerRoute?.suggested?.model || '',
      providerRouteOk: Boolean(providerRoute?.ok),
      providerRouteReason: providerRoute?.reason || '',
      taskCategory: requirements.category || 'chat',
      requiresTools: Boolean(requirements.requireTools),
      requiresVerification: Boolean(requirements.requiresVerification),
      minInputTokens: requirements.minInputTokens || 0,
      contextCompacted: stats.compacted,
      contextLevel: stats.level,
      contextEstimatedTokens: stats.estimatedTokens,
      permissionMode: permission.mode || '',
      workspaceTrusted: Boolean(permission.workspaceTrusted),
      skipPermissions: Boolean(permission.skipPermissions),
    }
  }

  function buildRuntimeProfile({
    prompt = '',
    permissionMode = 'default',
    actionPrompt = false,
    commandIntent = {},
    contextBudget = {},
    permissions = {},
    selectedModel = '',
    providerProfiles = [],
  } = {}) {
    const requirements = taskRequirements({ prompt, actionPrompt, commandIntent, contextBudget })
    const permission = permissionProfile({ permissionMode, permissions, requirements })
    const providerRoute = routeProvider({ providerProfiles, selectedModel, requirements })
    const toolManifest = runtimeToolManifest({ requirements, permission })
    const toolPlan = window.OPCAgentToolPlanner?.planForTask?.({
      prompt,
      requirements,
      permission,
      toolManifest,
    }) || {
      version: 1,
      category: requirements.category || 'chat',
      sequence: ['read', 'conclude'],
      steps: [],
      expectedTools: [],
    }
    const autoContinue = autoContinuePolicy({ requirements })
    const diagnostics = diagnosticsSnapshot({
      selectedModel,
      requirements,
      providerRoute,
      contextBudget,
      permission,
    })

    return {
      version: 1,
      prompt: compactText(prompt, 240),
      selectedModel,
      requirements,
      permissionProfile: permission,
      providerRoute,
      toolManifest,
      toolPlan,
      autoContinue,
      diagnostics,
    }
  }

  function agentRuntimeBlock(profile = {}) {
    if (!profile || typeof profile !== 'object') return ''
    const enabledTools = (profile.toolManifest || [])
      .filter(tool => tool.enabled)
      .map(tool => `${tool.label}${tool.required ? ' requis' : ''}${tool.controlled ? ' controle' : ''}`)
      .join(', ')
    const route = profile.providerRoute || {}
    const selected = route.selected?.label || route.selected?.model || profile.selectedModel || '(aucun)'
    const suggested = route.suggested && route.suggested.model !== profile.selectedModel
      ? `Provider recommandé: ${route.suggested.label || route.suggested.model} (${route.reason || 'meilleure compatibilité'}).`
      : ''
    const context = profile.diagnostics?.contextCompacted
      ? `Contexte compacté niveau ${profile.diagnostics.contextLevel}; budget estimé ${profile.diagnostics.contextEstimatedTokens} tokens.`
      : `Budget contexte minimal requis: ${profile.requirements?.minInputTokens || 0} tokens.`
    return [
      'PROFIL RUNTIME AGENTIQUE OPC',
      `Catégorie tâche: ${profile.requirements?.category || 'chat'}.`,
      `Provider sélectionné: ${selected}.`,
      suggested,
      context,
      `Permissions runtime: lecture=${profile.permissionProfile?.read || ''}, écriture=${profile.permissionProfile?.write || ''}, shell=${profile.permissionProfile?.shell || ''}, web=${profile.permissionProfile?.web || ''}.`,
      `Outils disponibles attendus: ${enabledTools || '(aucun)'}.`,
      window.OPCAgentToolPlanner?.planBlock?.(profile.toolPlan) || '',
      'Boucle obligatoire: plan court → outils → test minimal → correction si échec → résumé final.',
      window.OPCAgentStepRunner?.contractBlock?.() || '',
      "- N'annonce pas une lecture/modification/test sans appeler l'outil correspondant dans ce tour.",
      "- Si une étape échoue, ne passe pas à l'étape suivante; corrige ou réduis le scope puis reteste.",
      profile.requirements?.requiresInstallSafety
        ? "- Sécurité install: vérifier que l'app cible n'est pas en exécution avant tout rebuild/install."
        : '',
      profile.requirements?.requiresVerification
        ? "- Vérification obligatoire: une commande ou preuve fraîche doit confirmer le résultat avant de conclure."
        : '',
      '',
    ].filter(Boolean).join('\n')
  }

  window.OPCAgentRuntimeProfile = {
    agentRuntimeBlock,
    buildRuntimeProfile,
    contextBudgetStats,
    diagnosticsSnapshot,
    permissionProfile,
    runtimeToolManifest,
    taskRequirements,
  }
})()
