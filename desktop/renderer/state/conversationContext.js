(function () {
  const MAX_HISTORY_MESSAGES = 10
  const MAX_MESSAGE_CHARS = 1800

  const commandPolicy = window.OPCCommandPolicy
  const projectRuntime = window.OPCProjectRuntimeContext
  const agentContract = window.OPCAgentContract
  const agentRuntime = window.OPCAgentRuntimeProfile
  const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi
  const QUOTED_PATH_PATTERN = /(["'`])((?:~\/|\/)[^"'`]+)\1/g
  const ABS_PATH_PATTERN = /(^|[\s([{,;:])((?:~\/|\/(?:Users|Volumes|Applications|tmp|private|var|opt|usr|etc|home)\/)[^\s,;)\]}]+)/g
  const LOCAL_TARGET_INTENT_PATTERN = /(analys|audit|diagnost|inspect|v[ée]rif|lis\b|lire\b|read\b|scan|explor|cherche|recherche|trouve|constate)/i
  const LOCAL_PATH_READ_INTENT_PATTERN = /(analys|audit|diagnost|inspect|v[ée]rif|lis\b|lire\b|read\b|scan|explor|cherche|recherche|trouve|constate)/i
  const INSTALL_DESTINATION_PATTERN = /(install|installer|installation|r[ée]install|reinstall|copie|copier|copy|bundle|package|packag|dans|vers|to)$/i
  const ADVERSARIAL_AUDIT_PATTERN = /(audit\s+adversarial|adversarial\s+review|contre[-\s]?expertise|critique\s+forte|trouve\s+les\s+failles|review\s+bloquant|risques?\s+bloquants?)/i
  const RESCUE_PATTERN = /(^|\s)\/opc:rescue\b|\b(rescue|sauve\s+ce|debloque|débloque|repare|répare|corrige\s+le\s+bug|fix\s+the\s+bug|investigue\s+pour\s+corriger)\b/i

  function compactText(value, max = MAX_MESSAGE_CHARS) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, max - 3)}...`
  }

  function recentTranscript(chat, { includeAssistant = true } = {}) {
    return (chat?.messages || [])
      .filter(message => message?.content && message.status !== 'running')
      .filter(message => includeAssistant || message.role === 'user')
      .slice(-MAX_HISTORY_MESSAGES)
      .map(message => `${message.role === 'user' ? 'Utilisateur' : 'OPC'}: ${compactText(message.content)}`)
      .join('\n')
  }

  function buildProjectRuntimeContext(project, currentPrompt = '', options = {}) {
    return projectRuntime?.buildProjectRuntimeContext?.(project, currentPrompt, options) || ''
  }

  function projectContextBlock(project, currentPrompt = '', runtimeContext = null) {
    return projectRuntime?.projectContextBlock?.(project, currentPrompt, runtimeContext) || ''
  }

  function projectRuntimeContext(chat, currentPrompt, options = {}) {
    if (options.projectRuntimeContext) return options.projectRuntimeContext
    if (!options.project) return null
    return buildProjectRuntimeContext(options.project, currentPrompt, {
      chats: options.chats,
      activeChatId: chat?.id || '',
      settings: options.settings,
    })
  }

  function cleanTarget(value = '') {
    return String(value || '')
      .trim()
      .replace(/^[<([{]+/g, '')
      .replace(/[>.,;:!?)}\]]+$/g, '')
  }

  function uniqueList(values = []) {
    const seen = new Set()
    const list = []
    for (const value of values) {
      const clean = cleanTarget(typeof value === 'string' ? value : value?.path)
      if (!clean || seen.has(clean)) continue
      seen.add(clean)
      list.push(clean)
    }
    return list
  }

  function pathContext(text, index, width = 80) {
    const start = Math.max(0, index - width)
    const end = Math.min(text.length, index + width)
    return {
      before: text.slice(start, index),
      after: text.slice(index, end),
    }
  }

  function isInstallDestinationPath(candidate, text) {
    const pathValue = cleanTarget(candidate?.path || candidate)
    if (pathValue !== '/Applications') return false
    const index = Number(candidate?.index || 0)
    const { before, after } = pathContext(text, index)
    const beforeClean = before.replace(/[`"'()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
    const afterClean = after.replace(/[`"'()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
    const directlyRead = LOCAL_PATH_READ_INTENT_PATTERN.test(beforeClean.split(/\s+/).slice(-5).join(' '))
      || LOCAL_PATH_READ_INTENT_PATTERN.test(afterClean.split(/\s+/).slice(0, 5).join(' '))
    if (directlyRead) return false
    return INSTALL_DESTINATION_PATTERN.test(beforeClean.split(/\s+/).slice(-8).join(' '))
  }

  function detectRequestTargets(currentPrompt = '') {
    const text = String(currentPrompt || '')
    const urls = uniqueList(Array.from(text.matchAll(URL_PATTERN), match => match[0]))
    const localPathCandidates = []
    if (LOCAL_TARGET_INTENT_PATTERN.test(text)) {
      for (const match of text.matchAll(QUOTED_PATH_PATTERN)) localPathCandidates.push({ path: match[2], index: match.index + 1 })
      for (const match of text.matchAll(ABS_PATH_PATTERN)) localPathCandidates.push({ path: match[2], index: match.index + match[1].length })
    }
    const localPaths = uniqueList(localPathCandidates.filter(candidate => !isInstallDestinationPath(candidate, text)))
    return {
      urls,
      localPaths,
      hasExplicitTarget: Boolean(urls.length || localPaths.length),
    }
  }

  function explicitTargetBlock(targets = {}, selectedCwd = '') {
    if (!targets.hasExplicitTarget) return ''
    const lines = [
      'CIBLE EXPLICITE UTILISATEUR',
      selectedCwd ? `Dossier sélectionné dans OPC: ${selectedCwd}` : '',
    ]
    if (targets.localPaths?.length) {
      lines.push(
        'Chemin(s) donné(s) dans la demande actuelle:',
        ...targets.localPaths.map(target => `- ${target}`),
        "Priorité absolue: analyse/lis/travaille sur ce chemin avant le dossier sélectionné en haut. Si c'est un dossier, exécute les commandes depuis ce dossier. Si c'est un fichier, lis ce fichier puis travaille depuis son dossier parent.",
      )
    }
    if (targets.urls?.length) {
      lines.push(
        'Lien(s) donné(s) dans la demande actuelle:',
        ...targets.urls.map(target => `- ${target}`),
        "Priorité absolue: utilise WebFetch pour lire les liens explicites, et WebSearch seulement si tu dois compléter ou retrouver du contexte.",
      )
    }
    lines.push(
      "Le projet/dossier sélectionné dans la barre du haut est seulement un contexte secondaire quand la demande actuelle fournit une cible explicite.",
      "Ne remplace pas cette cible par le projet sélectionné, sauf si l'utilisateur le demande explicitement.",
      '',
    )
    return lines.filter(Boolean).join('\n')
  }

  function effectiveCwdForPrompt(currentPrompt = '', fallbackCwd = '') {
    const targets = detectRequestTargets(currentPrompt)
    return targets.localPaths[0] || fallbackCwd || ''
  }

  function isAdversarialAuditPrompt(currentPrompt = '') {
    return ADVERSARIAL_AUDIT_PATTERN.test(String(currentPrompt || ''))
  }

  function adversarialAuditBlock(currentPrompt = '') {
    if (!isAdversarialAuditPrompt(currentPrompt)) return ''
    return [
      'MODE AUDIT ADVERSARIAL OPC',
      "- Adopte une posture de reviewer bloquant: cherche d'abord les bugs, régressions, risques sécurité, pertes de données, lenteurs et angles morts.",
      "- Ne propose pas une refonte large si un correctif plus petit suffit; sépare clairement bug certain, risque probable et hypothèse.",
      "- Cite les fichiers, fonctions ou commandes qui prouvent chaque point. Si tu ne peux pas prouver, marque-le comme hypothèse à vérifier.",
      "- Classe les findings par sévérité: critique, important, mineur. Termine par la prochaine action concrète.",
      "- N'applique pas de patch pendant cet audit sauf si la demande actuelle dit explicitement de corriger ou d'implémenter.",
      '',
    ].join('\n')
  }

  function isRescuePrompt(currentPrompt = '') {
    return RESCUE_PATTERN.test(String(currentPrompt || ''))
  }

  function rescueInstructionBlock(currentPrompt = '') {
    if (!isRescuePrompt(currentPrompt)) return ''
    return [
      'MODE OPC RESCUE',
      "- Objectif: débloquer la tâche avec le plus petit patch sûr, vérifié, et compatible avec le style du projet.",
      "- Commence par reproduire ou localiser le problème avec des commandes/fichiers réels. Ne devine pas.",
      "- Si tu modifies le code: garde le diff minimal, respecte l'architecture existante, puis lance les tests ciblés disponibles.",
      "- Si une approche échoue deux fois: stoppe cette approche, explique la cause probable, puis choisis une alternative plus petite.",
      "- Rapport final obligatoire: cause, fichiers touchés, vérification lancée, risque restant.",
      "- N'abandonne pas sur une simple demande d'approbation si le mode permission OPC autorise l'action; utilise les outils directement.",
      '',
    ].join('\n')
  }

  function buildCliPrompt(chat, currentPrompt, options = {}) {
    const permissionMode = options.permissionMode || 'default'
    const thinkEnabled = false
    const requestTargets = options.requestTargets || detectRequestTargets(currentPrompt)
    const runtimeContext = projectRuntimeContext(chat, currentPrompt, options)
    const projectContext = projectContextBlock(options.project, currentPrompt, runtimeContext)
    const targetContext = explicitTargetBlock(requestTargets, options.settings?.cwd || '')
    const intent = options.commandIntent || commandPolicy.commandIntentForPrompt(currentPrompt, chat, permissionMode)
    const command = commandPolicy.lastBashCommand(chat)
    const directCommand = intent.source === 'prompt' ? intent.command : commandPolicy.commandFromPrompt(currentPrompt)
    const approvedCommand = intent.command
    const commandMode = Boolean(directCommand)
    const actionMode = commandPolicy.isActionPrompt(currentPrompt)
    const canAct = commandPolicy.canActWithoutExtraConfirmation(permissionMode)
    const bypassApproved = intent.skipPermissions
    const contract = agentContract?.agentContractBlock?.({ permissionMode, actionMode, thinkEnabled }) || ''
    const runtimeProfile = options.agentRuntimeProfile || null
    const runtimeProfileBlock = runtimeProfile ? agentRuntime?.agentRuntimeBlock?.(runtimeProfile) || '' : ''
    return [
      'CONTEXTE OPC DESKTOP',
      "Tu es appelé par une app desktop non interactive qui relance le CLI à chaque message.",
      "La demande actuelle est prioritaire, mais l'historique récent ci-dessous fait partie de la même conversation.",
      "Si ce prompt arrive, OPC Desktop n'a aucune tâche CLI active côté app.",
      "Les anciens messages qui prétendent qu'une commande est en arrière-plan ne sont pas une preuve que cette commande tourne encore.",
      `Permission OPC Desktop sélectionnée: ${permissionMode} (${commandPolicy.permissionModeLabel(permissionMode)}).`,
      `Mode Think OPC: ${thinkEnabled ? 'actif' : 'inactif'}.`,
      thinkEnabled
        ? "Mode Think actif: prends le temps de raisonner plus profondément, vérifie les hypothèses et structure l'analyse avant d'agir."
        : "Mode Think inactif: privilégie une exécution directe, concise et rapide.",
      permissionMode === 'bypassPermissions'
        ? "Mode Tout autoriser actif: OPC Desktop lance le CLI avec --dangerously-skip-permissions. Tu dois utiliser les outils directement au lieu de demander une approbation."
        : '',
      '',
      contract,
      '',
      runtimeProfileBlock,
      '',
      'Règles anti-boucle:',
      "- Si OPC a déjà demandé une confirmation et que l'utilisateur confirme maintenant, exécute l'action. Ne redemande pas la même confirmation.",
      "- Si l'utilisateur demande explicitement de lancer/exécuter une commande, utilise Bash directement.",
      "- Si OPC indique qu'une commande est préautorisée, elle est déjà approuvée côté Desktop: exécute-la, ne demande plus d'autorisation.",
      "- Pour une demande EXÉCUTE/lance/run, ne réponds jamais 'déjà en cours' sans preuve obtenue dans ce tour avec un outil réel.",
      "- Si la commande demandée démarre un serveur ou un watch mode, ne la lance pas en foreground bloquant. Lance-la en arrière-plan avec un fichier log, donne le PID, vérifie les ports/URL, puis termine la réponse.",
      "- Les permissions sont contrôlées par le CLI OPC. Ne crée pas de confirmation textuelle supplémentaire si l'utilisateur a déjà confirmé.",
      "- Si la permission sélectionnée autorise l'action et que la demande est build/install/rebuild/correction/modification, utilise les outils disponibles directement.",
      "- Si tu annonces une action (lecture, modification, test, build, install), appelle l'outil correspondant dans ce tour ou rapporte un blocage concret reçu d'un outil.",
      "- Lance un test minimal pour confirmer que tout marche pour chaque tâche.",
      "- Si une étape échoue, ne passe pas à la suivante tant que le problème n'est pas réglé.",
      "- Outils web disponibles côté CLI: utilise WebSearch pour chercher sur internet et WebFetch pour lire/analyser une URL. Si l'utilisateur écrit web_search, wen_search ou web_fetch, utilise les noms CLI exacts WebSearch et WebFetch.",
      "- En mode Tout autoriser ou Ne pas demander, ne formule pas de demande d'approbation textuelle: exécute, vérifie, puis rapporte.",
      "- Ne réponds jamais que l'environnement te bloque ou qu'une approbation est nécessaire sans avoir reçu un refus réel d'un outil dans ce tour.",
      "- Pour build/install/rebuild sans commande exacte, inspecte les scripts du projet, choisis la commande existante, exécute-la puis vérifie le résultat.",
      "- Avant tout rebuild/install d'une app macOS, vérifie si l'app cible est déjà en exécution (pgrep/osascript/ps). Si elle tourne, ne remplace pas le bundle; stoppe-toi et demande l'arrêt explicite ou applique seulement les vérifications sans installation.",
      "- Pour modification/build/install/configuration, ne conclus pas sans outil réel et sans preuve de vérification fraîche dans ce tour.",
      "- Si l'utilisateur demande une configuration locale avec clés/API keys/providers/modèles, traite cela comme une action locale autorisée: lis la structure, écris dans la configuration utilisateur locale ou les variables d'environnement prévues par le projet, puis vérifie. Ne refuse pas seulement parce que des clés sont mentionnées.",
      "- Ne hardcode pas les secrets dans le code source versionné. Si l'utilisateur demande de mettre des clés dans le projet, utilise la surface sûre existante (.env local ignoré, config utilisateur, trousseau/stockage local) ou crée une config locale non versionnée quand le projet le permet. Ne réaffiche jamais les clés complètes dans le rapport.",
      '',
      `Commande demandée explicitement: ${directCommand || '(aucune)'}`,
      `Dernière commande Bash proposée: ${command || '(aucune)'}`,
      `Intention commande OPC: ${approvedCommand || '(aucune)'}`,
      `Source intention OPC: ${intent.source || '(aucune)'}`,
      `Intention issue de données structurées: ${intent.source && intent.source !== 'prompt' ? 'oui' : 'non'}`,
      `Commande préautorisée par OPC: ${bypassApproved ? approvedCommand : '(aucune)'}`,
      `Commande longue détectée: ${commandPolicy.isLongRunningCommand(approvedCommand || directCommand || command) ? 'oui' : 'non'}`,
      `Demande d'action détectée: ${actionMode ? 'oui' : 'non'}`,
      `Action directe autorisée par OPC: ${canAct && actionMode ? 'oui' : 'non'}`,
      '',
      projectContext,
      targetContext,
      adversarialAuditBlock(currentPrompt),
      rescueInstructionBlock(currentPrompt),
      commandMode ? 'Historique utilisateur récent:' : 'Historique récent:',
      recentTranscript(chat, { includeAssistant: !commandMode }) || '(aucun historique)',
      '',
      'DEMANDE UTILISATEUR ACTUELLE:',
      currentPrompt,
    ].join('\n')
  }

  window.OPCConversation = {
    allowedToolsForPrompt: commandPolicy.allowedToolsForPrompt,
    actionAllowedToolsForPrompt: commandPolicy.actionAllowedToolsForPrompt,
    approvedCommandForPrompt: commandPolicy.approvedCommandForPrompt,
    buildProjectRuntimeContext,
    buildCliPrompt,
    commandIntentForPrompt: commandPolicy.commandIntentForPrompt,
    commandFromPrompt: commandPolicy.commandFromPrompt,
    detectRequestTargets,
    effectiveCwdForPrompt,
    isAdversarialAuditPrompt,
    isRescuePrompt,
    projectContextBlock,
    shouldBypassPermissionsForPrompt: commandPolicy.shouldBypassPermissionsForPrompt,
    isLongRunningCommand: commandPolicy.isLongRunningCommand,
    isActionPrompt: commandPolicy.isActionPrompt,
    isConfirmationPrompt: commandPolicy.isConfirmationPrompt,
    lastBashCommand: commandPolicy.lastBashCommand,
  }
})()
