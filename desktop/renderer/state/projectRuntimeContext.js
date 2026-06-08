(function () {
  const MAX_CONTEXT_CHARS = 1800

  function compactText(value, max = MAX_CONTEXT_CHARS) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, max - 3)}...`
  }

  function messageDigest(message) {
    if (!message?.content) return ''
    return compactText(message.content, message.role === 'assistant' ? 420 : 260)
  }

  function projectSessionDigest(chats = [], projectId = '', activeChatId = '') {
    if (!projectId || !Array.isArray(chats)) return []
    return chats
      .filter(chat => chat?.projectId === projectId && chat.id !== activeChatId)
      .slice(0, 6)
      .map(chat => {
        const messages = Array.isArray(chat.messages)
          ? chat.messages.filter(message => message?.content && message.status !== 'running')
          : []
        const lastUser = [...messages].reverse().find(message => message.role === 'user')
        const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant')
        return {
          id: compactText(chat.id, 120),
          title: compactText(chat.title || 'Session', 180),
          createdAt: compactText(chat.createdAt, 80),
          lastUser: messageDigest(lastUser),
          lastAssistant: messageDigest(lastAssistant),
        }
      })
      .filter(item => item.lastUser || item.lastAssistant)
  }

  function projectFileRuntimeEntry(file, role = 'attached', patch = {}) {
    return {
      id: compactText(file?.id, 120),
      name: compactText(file?.name || 'Fichier', 180),
      path: compactText(file?.path, 1000),
      role,
      summary: compactText(file?.summary, 700),
      snippets: Array.isArray(patch.snippets) ? patch.snippets.map(item => compactText(item, 240)).filter(Boolean).slice(0, 4) : [],
      keywords: Array.isArray(file?.keywords) ? file.keywords.map(item => compactText(item, 80)).filter(Boolean).slice(0, 10) : [],
      headings: Array.isArray(file?.headings) ? file.headings.map(item => compactText(item, 120)).filter(Boolean).slice(0, 6) : [],
      indexedAt: compactText(file?.indexedAt, 80),
      error: compactText(file?.error, 220),
      lineCount: Number(file?.lineCount) || 0,
      wordCount: Number(file?.wordCount) || 0,
      score: Number(patch.score) || 0,
      readNext: Boolean(file?.readNext),
    }
  }

  function buildProjectRuntimeContext(project, currentPrompt = '', options = {}) {
    if (!project) return ''
    const files = Array.isArray(project.files) ? project.files : []
    const fileIndex = window.OPCProjectFileIndex
    const readNextFiles = files.filter(file => file.readNext)
    const relevantFiles = fileIndex?.searchProjectFiles
      ? fileIndex.searchProjectFiles(files, currentPrompt, { limit: 5, minScore: 6 }).filter(entry => !entry.file.readNext)
      : []
    const competenceProfile = window.OPCCompetenceProfile?.buildProjectCompetenceProfile?.(project) || null
    const runtime = project.runtime && typeof project.runtime === 'object' ? project.runtime : {}
    const settings = options.settings && typeof options.settings === 'object' ? options.settings : {}
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      query: compactText(currentPrompt, 500),
      projectId: compactText(project.id, 120),
      projectName: compactText(project.name, 240),
      description: compactText(project.description, 600),
      memoryChars: String(project.memory || '').length,
      instructionChars: String(project.instructions || '').length,
      runtime: {
        cwd: compactText(runtime.cwd || settings.cwd || '', 1000),
        model: compactText(runtime.model || settings.model || '', 220),
        permissionMode: compactText(runtime.permissionMode || settings.permissionMode || '', 80),
        memoryEnabled: runtime.memoryEnabled === null || runtime.memoryEnabled === undefined
          ? settings.memoryEnabled !== false
          : Boolean(runtime.memoryEnabled),
        updatedAt: compactText(runtime.updatedAt || '', 80),
      },
      totalFiles: files.length,
      indexedFiles: files.filter(file => file.indexedAt && !file.error).length,
      staleFiles: files.filter(file => !file.indexedAt || file.error).length,
      attachedFiles: files.slice(0, 10).map(file => projectFileRuntimeEntry(file)),
      readNextFiles: readNextFiles.map(file => projectFileRuntimeEntry(file, 'read-next')),
      relevantFiles: relevantFiles.map(entry => projectFileRuntimeEntry(entry.file, 'relevant', {
        score: entry.score,
        snippets: entry.snippets,
      })),
      competenceProfile,
      projectSessions: projectSessionDigest(options.chats, project.id, options.activeChatId),
    }
  }

  function fileContextLines(context) {
    return (context.attachedFiles || [])
      .map(file => [
        `- ${compactText(file.name || 'Fichier', 180)}: ${compactText(file.path, 1000)}`,
        file.summary ? `  Résumé indexé: ${compactText(file.summary, 700)}` : '',
        file.keywords?.length ? `  Mots-clés: ${compactText(file.keywords.join(', '), 360)}` : '',
        file.error ? `  Note: ${compactText(file.error, 220)}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n')
  }

  function readNextContextLines(context) {
    return (context.readNextFiles || [])
      .map(file => `- ${compactText(file.name || 'Fichier', 180)}: ${compactText(file.path, 1000)}`)
      .join('\n')
  }

  function relevantContextLines(context) {
    return (context.relevantFiles || [])
      .map(file => [
        `- ${compactText(file.name || 'Fichier', 180)}: ${compactText(file.path, 1000)}`,
        file.summary ? `  Résumé: ${compactText(file.summary, 500)}` : '',
        file.snippets?.length ? `  Correspondances: ${compactText(file.snippets.join(' | '), 700)}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n')
  }

  function runtimeContextLines(context) {
    if (!context.runtime) return ''
    return [
      context.runtime.cwd ? `Dossier projet: ${context.runtime.cwd}` : '',
      context.runtime.model ? `Modèle projet: ${context.runtime.model}` : '',
      context.runtime.permissionMode ? `Permissions projet: ${context.runtime.permissionMode}` : '',
      `Mémoire projet active: ${context.runtime.memoryEnabled ? 'oui' : 'non'}`,
    ].filter(Boolean).join('\n')
  }

  function sessionContextLines(context) {
    return (context.projectSessions || [])
      .map(session => [
        `- ${session.title}${session.createdAt ? ` (${session.createdAt})` : ''}`,
        session.lastUser ? `  Dernière demande: ${session.lastUser}` : '',
        session.lastAssistant ? `  Dernière réponse: ${session.lastAssistant}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n')
  }

  function projectContextBlock(project, currentPrompt = '', runtimeContext = null) {
    if (!project) return ''
    const instructions = compactText(project.instructions, 4000) || '(aucune instruction projet)'
    const memory = compactText(project.memory, 4000) || '(aucune mémoire projet)'
    const context = runtimeContext || buildProjectRuntimeContext(project, currentPrompt)
    const competenceBlock = window.OPCCompetenceProfile?.competenceContextBlock?.(context.competenceProfile, currentPrompt) || ''
    const builtInSkillsBlock = window.OPCBuiltInSkills?.projectContextBlock?.(project, currentPrompt) || ''
    const fileLines = fileContextLines(context)
    const readNextLines = readNextContextLines(context)
    const relevantLines = relevantContextLines(context)
    const runtimeLines = runtimeContextLines(context)
    const sessionLines = sessionContextLines(context)
    const fileStats = context.totalFiles
      ? `Fichiers runtime OPC: ${context.totalFiles} attaché(s), ${context.indexedFiles} indexé(s), ${context.staleFiles} à réindexer.`
      : ''
    const emptyProjectWarning = !context.totalFiles && !String(project.memory || '').trim() && !String(project.instructions || '').trim()
      ? "Alerte OPC: ce projet n'a encore ni instruction, ni mémoire, ni fichier attaché. Ne prétends pas disposer d'un contexte projet spécifique; demande ou lis explicitement le dossier cible si nécessaire."
      : ''
    return [
      'PROJET OPC ACTIF',
      `Nom: ${compactText(project.name, 240)}`,
      project.description ? `Description: ${compactText(project.description, 600)}` : '',
      emptyProjectWarning,
      runtimeLines ? 'Réglages runtime du projet:' : '',
      runtimeLines,
      'Instructions personnelles du projet:',
      instructions,
      'Mémoire personnelle du projet:',
      memory,
      sessionLines ? 'Historique synthétique des autres sessions du projet:' : '',
      sessionLines,
      builtInSkillsBlock,
      competenceBlock,
      fileStats,
      'Fichiers associés au projet:',
      fileLines || '(aucun fichier projet)',
      context.readNextFiles?.length ? 'Fichiers explicitement demandés pour ce prochain prompt:' : '',
      readNextLines,
      context.relevantFiles?.length ? 'Fichiers probablement pertinents pour la demande actuelle:' : '',
      relevantLines,
      context.totalFiles
        ? "Quand la demande concerne le projet, lis les fichiers associés avec l'outil Read avant de conclure. Ne suppose pas leur contenu depuis leur nom."
        : '',
      context.readNextFiles?.length
        ? "Priorité forte: commence par lire les fichiers explicitement demandés ci-dessus avec l'outil Read dans ce tour."
        : '',
      context.relevantFiles?.length
        ? "Priorité moyenne: les fichiers probablement pertinents ci-dessus ont été trouvés par l'index OPC. Lis-les avec Read si la demande dépend de leur contenu."
        : '',
      "Utilise ces instructions, cette mémoire et ces fichiers comme contexte privé du projet courant. Ils complètent la demande utilisateur et l'historique de conversation.",
      '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  window.OPCProjectRuntimeContext = {
    buildProjectRuntimeContext,
    compactText,
    projectContextBlock,
    projectFileRuntimeEntry,
    projectSessionDigest,
  }
})()
