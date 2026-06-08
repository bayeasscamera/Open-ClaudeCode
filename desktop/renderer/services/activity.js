(function () {
  function textFromContent(content) {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map(block => {
        if (!block || typeof block !== 'object') return ''
        if (block.type === 'text') return block.text || ''
        return ''
      })
      .join('')
  }

  function toolResultBlockText(block) {
    if (!block || block.type !== 'tool_result') return ''
    if (typeof block.content === 'string') return block.content
    if (!Array.isArray(block.content)) return ''
    return block.content
      .map(item => {
        if (typeof item === 'string') return item
        if (item?.type === 'text') return item.text || ''
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  function toolResultText(event) {
    const content = event?.message?.content || event?.content || []
    if (!Array.isArray(content)) return ''
    return content.map(toolResultBlockText).filter(Boolean).join('\n')
  }

  function decodeJsonStringFragment(value) {
    try {
      return JSON.parse(`"${value}"`)
    } catch {
      return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
  }

  function extractPartialJsonString(raw, key) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`)
    const match = String(raw || '').match(pattern)
    return match ? decodeJsonStringFragment(match[1]) : ''
  }

  function parsePartialToolInput(raw) {
    const text = String(raw || '')
    try {
      return JSON.parse(text)
    } catch {
      const input = {}
      for (const key of [
        'command',
        'file_path',
        'path',
        'pattern',
        'description',
        'prompt',
        'query',
        'url',
        'allowed_domains',
        'blocked_domains',
        'notebook_path',
        'old_string',
        'new_string',
        'content',
      ]) {
        const value = extractPartialJsonString(text, key)
        if (value) input[key] = value
      }
      return Object.keys(input).length ? input : { value: text }
    }
  }

  function parseToolInput(input) {
    if (!input) return {}
    if (typeof input === 'string') {
      try {
        return JSON.parse(input)
      } catch {
        return parsePartialToolInput(input)
      }
    }
    return typeof input === 'object' ? input : { value: String(input) }
  }

  function truncateMiddle(value, max = 72) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    const keep = Math.floor((max - 3) / 2)
    return `${text.slice(0, keep)}...${text.slice(-keep)}`
  }

  function compactPath(value, cwd = '') {
    if (!value) return ''
    let text = String(value)
    if (cwd && text.startsWith(cwd)) text = `.${text.slice(cwd.length)}`
    text = text.replace(/^\/Users\/[^/]+/, '~')
    return truncateMiddle(text, 78)
  }

  function firstLine(value) {
    return String(value || '').split(/\r?\n/).find(Boolean) || ''
  }

  function lineCount(value) {
    const text = String(value || '')
    if (!text) return 0
    return text.split(/\r?\n/).length
  }

  function compactMultiline(value, max = 180) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim()
    if (!text) return ''
    const compact = text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('  ')
    return truncateMiddle(compact, max)
  }

  function liveStatusFromText(value) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^(ok[, ]+|parfait[ !,.]+|maintenant[, ]+)/i, '')
      .trim()
    if (!text) return ''

    const lower = text.toLowerCase()
    const codeTargets = [...text.matchAll(/`([^`]{1,80})`/g)].map(match => match[1])
    const target = codeTargets.find(item => /\.(js|ts|tsx|jsx|cjs|mjs|rs|py|go|swift|css|html|md|json|toml|yaml|yml)$/i.test(item))
      || codeTargets[0]
      || ''
    const suffix = target ? ` · ${truncateMiddle(target, 54)}` : ''

    if (/(cargo check|npm test|pnpm test|pytest|test|compile|build|vérification réussie|verification reussie)/i.test(text)) {
      return `Vérification qualité${suffix}`
    }
    if (/(edit|modifi|corrig|patch|appliqu|redaction|rédaction|remplac)/i.test(text)) {
      return `Application des changements${suffix}`
    }
    if (/(grep|rg |recherch|scan|vérif|verif|analyse|inspect|lis|lecture)/i.test(text)) {
      return `Analyse du code${suffix}`
    }
    if (/(serveur|server|port|pid|runtime|process)/i.test(lower)) {
      return `Vérification du runtime${suffix}`
    }
    return `Travail en cours${suffix}`
  }

  function appendLiveDraft(assistant, text) {
    if (!assistant || !text) return ''
    const status = liveStatusFromText(text)
    if (status) assistant.focus = status
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
    if (!cleaned) return status
    const previous = String(assistant.liveDraft || '')
    const next = previous.endsWith(cleaned) ? previous : `${previous ? `${previous} ` : ''}${cleaned}`
    assistant.liveDraft = truncateMiddle(next, 360)
    return status
  }

  function asksForContinuation(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return false
    return /(?:veux-tu|souhaites-tu|tu veux|dois-je|je peux|puis-je|should i|shall i|would you like me to|do you want me to).{0,120}(?:continuer|continue|poursuivre|encha[iî]ner)/i.test(text)
      || /(?:prochaine étape|next step).{0,180}(?:veux-tu|souhaites-tu|should i|do you want)/i.test(text)
  }

  function promisesActionWithoutTool(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return false
    const actionVerb = '(?:read|inspect|open|check|modify|edit|apply|patch|update|create|write|run|execute|test|build|install|lire|inspecter|ouvrir|v[ée]rifier|verifier|modifier|appliquer|patcher|corriger|cr[ée]er|creer|[ée]crire|ecrire|ex[ée]cuter|executer|lancer|tester|builder|installer)'
    const promisedAction = new RegExp(`(?:i(?:'ll| will| am going to)|let me|first,?\\s*(?:let me|i(?:'ll| will))|je vais|je dois|je commence par|d'abord|laisse(?:z)?-?moi|permettez-moi).{0,180}\\b${actionVerb}\\b`, 'i')
    const frenchContinuationAction = /(?:\bje\s+(?:continue|reprends|reprend|poursuis|encha[iî]ne|relance|r[ée]duis|r[ée]duit|vais\s+(?:continuer|reprendre|poursuivre|encha[iî]ner|relancer)).{0,240}(?:l['’]action|l['’]application|la\s+t[âa]che|sur\s+le\s+fichier|\bfichier\b|\bsrc\/|l['’]objectif|rendre|modifier|corriger|appliquer|g[ée]n[ée]ration|processus))/i
    return promisedAction.test(text) || frenchContinuationAction.test(text)
  }

  function toolField(label, value) {
    const text = String(value || '').trim()
    return text ? { label, value: text } : null
  }

  function editFields(input, cwd = '') {
    const fields = [
      toolField('Fichier', compactPath(input.file_path || input.path || input.notebook_path || input.value, cwd)),
    ]

    if (Array.isArray(input.edits)) {
      fields.push(toolField('Changements', `${input.edits.length} édition${input.edits.length > 1 ? 's' : ''}`))
      const firstEdit = input.edits.find(Boolean) || {}
      fields.push(toolField('Avant', compactMultiline(firstEdit.old_string, 150)))
      fields.push(toolField('Après', compactMultiline(firstEdit.new_string, 150)))
      return fields.filter(Boolean)
    }

    if (input.old_string || input.new_string) {
      fields.push(toolField('Avant', compactMultiline(input.old_string, 150)))
      fields.push(toolField('Après', compactMultiline(input.new_string, 150)))
      if (input.replace_all !== undefined) fields.push(toolField('Mode', input.replace_all ? 'remplacer partout' : 'première occurrence'))
    }
    if (input.content) fields.push(toolField('Contenu', `${lineCount(input.content)} ligne${lineCount(input.content) > 1 ? 's' : ''}`))
    return fields.filter(Boolean)
  }

  function toolDescriptor(block, cwd = '') {
    const name = block.name || block.tool_name || 'outil'
    const input = parseToolInput(block.input || block.arguments)
    let target = ''
    let detail = ''
    let kind = 'generic'
    let title = name
    let subtitle = ''
    let fields = []
    let code = ''

    if (name === 'Read') {
      kind = 'read'
      target = compactPath(input.file_path || input.path || input.value, cwd)
      detail = target ? `Lecture de ${target}` : 'Lecture de fichier'
      subtitle = target || 'Lecture de fichier'
    } else if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
      kind = name === 'Write' ? 'write' : 'edit'
      target = compactPath(input.file_path || input.path || input.notebook_path || input.value, cwd)
      fields = editFields(input, cwd)
      const changeCount = Array.isArray(input.edits) ? input.edits.length : input.old_string || input.new_string ? 1 : 0
      const changeText = changeCount ? `${changeCount} changement${changeCount > 1 ? 's' : ''}` : 'Modification'
      detail = target ? `${changeText} dans ${target}` : 'Modification de fichier'
      subtitle = target || 'Modification de fichier'
    } else if (name === 'Bash') {
      kind = 'shell'
      const command = firstLine(input.command || input.value)
      target = truncateMiddle(command, 82)
      detail = target ? `Commande: ${target}` : 'Commande shell'
      title = 'Shell'
      subtitle = input.description || 'Commande shell'
      code = String(input.command || input.value || '').trim()
      fields = [
        toolField('Commande', target),
        toolField('Description', input.description),
      ].filter(Boolean)
      return {
        id: block.id || `${name}:${JSON.stringify(input).slice(0, 180)}`,
        name,
        target,
        detail,
        kind,
        title,
        subtitle,
        command,
        code,
        fields,
      }
    } else if (name === 'Grep') {
      kind = 'search'
      const path = compactPath(input.path || cwd, cwd)
      target = truncateMiddle([input.pattern, path].filter(Boolean).join(' dans '), 82)
      detail = target ? `Recherche ${target}` : 'Recherche dans le code'
      subtitle = target || 'Recherche dans le code'
    } else if (name === 'Glob') {
      kind = 'search'
      const path = compactPath(input.path || cwd, cwd)
      target = truncateMiddle([input.pattern, path].filter(Boolean).join(' dans '), 82)
      detail = target ? `Parcours ${target}` : 'Parcours de fichiers'
      subtitle = target || 'Parcours de fichiers'
    } else if (name === 'WebSearch' || name === 'web_search' || name === 'wen_search') {
      kind = 'web'
      title = 'Web Search'
      target = truncateMiddle(input.query || input.pattern || input.value, 82)
      detail = target ? `Recherche web: ${target}` : 'Recherche web'
      subtitle = target || 'Recherche web'
      fields = [
        toolField('Requête', target),
        toolField('Domaines autorisés', Array.isArray(input.allowed_domains) ? input.allowed_domains.join(', ') : input.allowed_domains),
        toolField('Domaines bloqués', Array.isArray(input.blocked_domains) ? input.blocked_domains.join(', ') : input.blocked_domains),
      ].filter(Boolean)
    } else if (name === 'WebFetch' || name === 'web_fetch') {
      kind = 'web'
      title = 'Web Fetch'
      target = truncateMiddle(input.url || input.value, 82)
      detail = target ? `Lecture web: ${target}` : 'Lecture web'
      subtitle = target || 'Lecture web'
      fields = [
        toolField('URL', target),
        toolField('Prompt', compactMultiline(input.prompt, 150)),
      ].filter(Boolean)
    } else if (name === 'Task') {
      kind = 'task'
      target = truncateMiddle(input.description || input.prompt || input.value, 82)
      detail = target ? `Sous-tâche: ${target}` : 'Sous-tâche'
      subtitle = target || 'Sous-tâche'
    } else {
      target = truncateMiddle(input.file_path || input.path || input.pattern || input.command || input.value || '', 82)
      detail = target ? `${name}: ${target}` : name
      subtitle = target || name
    }

    return {
      id: block.id || `${name}:${JSON.stringify(input).slice(0, 180)}`,
      name,
      target,
      detail,
      kind,
      title,
      subtitle,
      fields,
      code,
    }
  }

  function toolBlocks(event) {
    if (!event || typeof event !== 'object') return []
    if (event.type === 'assistant') {
      const content = event.message?.content || event.content || []
      return Array.isArray(content) ? content.filter(block => block?.type === 'tool_use') : []
    }
    if (event.type === 'stream_event' && event.event?.type === 'content_block_start') {
      const block = event.event.content_block
      return block?.type === 'tool_use' ? [{ ...block, streamIndex: event.event.index }] : []
    }
    return []
  }

  function recordToolActivity(assistant, event, cwd = '') {
    const blocks = toolBlocks(event)
    if (!blocks.length) return
    assistant.tools ||= []
    const seen = new Set(assistant.tools.map(tool => tool.id))
    for (const block of blocks) {
      const tool = toolDescriptor(block, assistant.cwd || cwd)
      if (block.streamIndex !== undefined) tool.streamIndex = block.streamIndex
      if (seen.has(tool.id)) continue
      assistant.tools.push(tool)
      seen.add(tool.id)
      assistant.focus = tool.detail
    }
    assistant.tools = assistant.tools.slice(-18)
  }

  function recordToolPartial(assistant, event, cwd = '') {
    const inner = event?.type === 'stream_event' ? event.event : event
    if (inner?.type !== 'content_block_delta') return
    const delta = inner.delta || {}
    if (delta.type !== 'input_json_delta' || typeof delta.partial_json !== 'string') return
    assistant.toolPartials ||= {}
    assistant.toolPartials[inner.index] = `${assistant.toolPartials[inner.index] || ''}${delta.partial_json}`
    const tool = assistant.tools?.find(item => item.streamIndex === inner.index)
    if (!tool) return
    const descriptor = toolDescriptor(
      {
        id: tool.id,
        name: tool.name,
        input: parsePartialToolInput(assistant.toolPartials[inner.index]),
      },
      assistant.cwd || cwd,
    )
    tool.target = descriptor.target
    tool.detail = descriptor.detail
    tool.kind = descriptor.kind
    tool.title = descriptor.title
    tool.subtitle = descriptor.subtitle
    tool.fields = descriptor.fields
    tool.code = descriptor.code || tool.code
    tool.command = descriptor.command || tool.command
    assistant.focus = descriptor.detail
  }

  function extractText(event) {
    if (!event || typeof event !== 'object') return ''
    if (event.type === 'stdout') return event.text || ''
    if (event.type === 'result') return event.result || event.text || ''
    if (event.type === 'assistant') return textFromContent(event.message?.content || event.content)
    const inner = event.type === 'stream_event' ? event.event : event
    if (inner?.type === 'content_block_delta') return inner.delta?.text || ''
    if (inner?.type === 'message_delta') return inner.delta?.text || ''
    if (event.type === 'error') return event.message || ''
    return ''
  }

  function eventChip(event) {
    if (!event || typeof event !== 'object') return ''
    if (event.type === 'system' && event.subtype === 'init') return `session ${event.model || 'model'}`
    if (event.type === 'memory') return 'mémoire'
    if (event.type === 'stopped') return 'arrêt'
    if (event.type === 'stderr') return 'log'
    if (event.type === 'result') return event.is_error ? 'erreur' : 'résultat'
    return ''
  }

  window.OPCActivity = {
    appendLiveDraft,
    asksForContinuation,
    eventChip,
    extractText,
    liveStatusFromText,
    promisesActionWithoutTool,
    toolResultText,
    recordToolActivity,
    recordToolPartial,
    toolDescriptor,
  }
})()
