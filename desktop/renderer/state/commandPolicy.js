(function () {
  const MAX_REASON_CHARS = 240
  const TRUSTED_DEV_COMMANDS = [
    'pnpm tools-dev start',
    'pnpm tools-dev run web',
    'pnpm tools-dev dev',
    'npm run dev',
    'npm run start',
    'pnpm dev',
    'pnpm start',
  ]
  const READ_TOOLS = ['Read', 'Grep', 'Glob']
  const WEB_TOOLS = ['WebSearch', 'WebFetch']
  const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit']

  function compactText(value, max = MAX_REASON_CHARS) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, max - 3)}...`
  }

  function normalizedPrompt(prompt) {
    return String(prompt || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
  }

  function isConfirmationPrompt(prompt) {
    const text = normalizedPrompt(prompt)
    if (!text) return false
    return /^(oui|ok|vas y|go|lance le|execute|execute le|je confirme|oui je confirme|confirme|c'est bon|cest bon)(\b|$)/.test(text)
  }

  function canActWithoutExtraConfirmation(permissionMode) {
    return ['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'].includes(String(permissionMode || ''))
  }

  function permissionModeLabel(permissionMode) {
    const labels = {
      bypassPermissions: 'Tout autoriser',
      dontAsk: 'Ne pas demander',
      acceptEdits: 'Autoriser éditions',
      auto: 'Auto',
      plan: 'Plan seulement',
      default: 'Standard',
    }
    return labels[String(permissionMode || '')] || labels.default
  }

  function isActionPrompt(prompt) {
    const text = normalizedPrompt(prompt)
    if (!text) return false
    return /^\/opc:rescue\b/.test(text) || /\b(analyse|analyser|audit|auditer|diagnostic|diagnostiquer|inspecte|inspecter|verifie|verifier|lis|lire|read|rescue|sauve|debloque|repare|rebuild|rebuilder|build|installer|install|reinstaller|reinstall|lancer|launch|run|demarrer|start|corrige|corriger|fix|fais|fait|faire|applique|appliquer|patch|modif|modifie|modifier|change|changer|configure|configurer|parametre|parametrer|mets|met|ajoute|ajouter|supprime|supprimer|cree|creer|implemente|implementer|implementation|implement|refactor|refactoring|cherche|chercher|recherche|rechercher|search|fetch|web_search|wen_search|web_fetch)\b/.test(text)
  }

  function commandFromPrompt(prompt) {
    const text = String(prompt || '').trim()
    const match = text.match(/(?:ex[eé]cute|lance|run)\s+(.+)$/i)
    if (!match) return ''
    const command = match[1].replace(/^["'`]+|["'`]+$/g, '').trim()
    return /^(le|la|les|ça|ca|ceci|cela|commande)$/i.test(command) ? '' : command
  }

  function normalizeCommand(command) {
    return String(command || '')
      .replace(/^Commande:\s*/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function isLongRunningCommand(command) {
    const text = normalizedPrompt(command)
    return /\b(pnpm|npm|yarn|bun)\s+([^;&|]*\s)?(dev|start|serve|web)\b/.test(text) || /\b(next|vite|astro|nuxt)\s+dev\b/.test(text)
  }

  function trustedDevCommand(command) {
    const normalized = normalizeCommand(command)
    return TRUSTED_DEV_COMMANDS.find(item => normalized === item || normalized.startsWith(`${item} `)) || ''
  }

  function bashAllowRules(command) {
    const normalized = normalizeCommand(command)
    if (!normalized) return []
    const rules = new Set([`Bash(${normalized})`])
    if (trustedDevCommand(normalized)) {
      rules.add(`Bash(${normalized} *)`)
      rules.add(`Bash(nohup ${normalized} *)`)
      rules.add(`Bash(cd * && ${normalized} *)`)
    }
    return Array.from(rules)
  }

  function commandIntent(command, patch = {}) {
    const normalized = normalizeCommand(command)
    const allowRules = bashAllowRules(normalized)
    const permissionMode = patch.permissionMode || 'default'
    const trusted = Boolean(normalized && trustedDevCommand(normalized))
    return {
      version: 1,
      command: normalized,
      source: patch.source || '',
      reason: compactText(patch.reason, MAX_REASON_CHARS),
      trusted,
      longRunning: isLongRunningCommand(normalized),
      permissionMode,
      allowRules,
      allowedTools: normalized ? [...allowRules, ...READ_TOOLS, ...WEB_TOOLS] : [],
      skipPermissions: Boolean(normalized && trusted && canActWithoutExtraConfirmation(permissionMode)),
    }
  }

  function emptyCommandIntent(permissionMode = 'default') {
    return commandIntent('', { permissionMode })
  }

  function commandIntentFromTool(tool) {
    if (tool?.name !== 'Bash') return null
    const command = normalizeCommand(tool.command || tool.target || tool.detail)
    if (!command || command === 'Commande shell') return null
    return commandIntent(command, {
      source: 'tool-history',
      reason: 'Dernier outil Bash structuré dans la conversation',
    })
  }

  function commandIntentFromMessage(message) {
    const explicit = message?.commandIntent
    if (explicit && typeof explicit === 'object') {
      const intent = commandIntent(explicit.command, {
        source: explicit.source || 'message-intent',
        reason: explicit.reason || 'Intention de commande enregistrée',
        permissionMode: explicit.permissionMode || 'default',
      })
      if (intent.command) return intent
    }
    const tools = Array.isArray(message?.tools) ? message.tools : []
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const intent = commandIntentFromTool(tools[toolIndex])
      if (intent?.command) return intent
    }
    return null
  }

  function lastStructuredCommandIntent(chat) {
    const messages = Array.isArray(chat?.messages) ? chat.messages : []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const intent = commandIntentFromMessage(messages[index])
      if (intent?.command) return intent
    }
    return null
  }

  function lastBashCommand(chat) {
    return lastStructuredCommandIntent(chat)?.command || ''
  }

  function commandIntentForPrompt(prompt, chat, permissionMode = 'default') {
    const directCommand = commandFromPrompt(prompt)
    if (directCommand) {
      return commandIntent(directCommand, {
        source: 'prompt',
        reason: 'Commande explicite dans la demande utilisateur actuelle',
        permissionMode,
      })
    }
    const canReuseStructuredIntent = isConfirmationPrompt(prompt)
    const structured = canReuseStructuredIntent ? lastStructuredCommandIntent(chat) : null
    if (structured?.command) {
      return commandIntent(structured.command, {
        source: structured.source || 'tool-history',
        reason: structured.reason || 'Commande structurée réutilisée depuis la conversation',
        permissionMode,
      })
    }
    return emptyCommandIntent(permissionMode)
  }

  function approvedCommandForPrompt(prompt, chat) {
    return commandIntentForPrompt(prompt, chat).command
  }

  function allowedToolsForPrompt(prompt, chat, permissionMode = 'default') {
    return commandIntentForPrompt(prompt, chat, permissionMode).allowedTools
  }

  function shouldBypassPermissionsForPrompt(prompt, chat, permissionMode = 'default') {
    return commandIntentForPrompt(prompt, chat, permissionMode).skipPermissions
  }

  function actionAllowedToolsForPrompt(prompt, chat, permissionMode = 'default') {
    const exactTools = allowedToolsForPrompt(prompt, chat, permissionMode)
    if (exactTools.length) return exactTools
    if (!canActWithoutExtraConfirmation(permissionMode) || !isActionPrompt(prompt)) return []
    return ['Bash', ...READ_TOOLS, ...WEB_TOOLS, ...EDIT_TOOLS]
  }

  window.OPCCommandPolicy = {
    actionAllowedToolsForPrompt,
    allowedToolsForPrompt,
    approvedCommandForPrompt,
    canActWithoutExtraConfirmation,
    commandFromPrompt,
    commandIntentForPrompt,
    isActionPrompt,
    isConfirmationPrompt,
    isLongRunningCommand,
    lastBashCommand,
    permissionModeLabel,
    shouldBypassPermissionsForPrompt,
  }
})()
