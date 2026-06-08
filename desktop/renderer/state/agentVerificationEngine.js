(function () {
  const VERIFY_COMMAND_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:--prefix\s+\S+\s+)?(?:run\s+)?(?:test|check|typecheck|lint|build|verify|verify:ci)|(?:node\s+--test|pytest|cargo\s+(?:test|check)|go\s+test|swift\s+test|xcodebuild\s+test|tsc\b|eslint\b|vitest\b|playwright\s+test))\b/i
  const VERIFY_TEXT_RE = /\b(?:tests?\s+(?:ok|pass|passed|réussi|reussi|réussis|reussis)|0\s+failures?|all\s+tests\s+pass|typecheck\s+ok|build\s+ok|verify:ci|verification\s+(?:ok|réussie|reussie)|vérification\s+(?:ok|réussie|reussie))\b/i
  const MUTATION_RE = /\b(?:edit|write|multiedit|notebookedit|patch|modifier|modification|corriger|appliquer|create|créer|creer|delete|supprimer)\b/i

  function compactText(value, max = 500) {
    return String(value || '')
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  }

  function firstVerificationCommand(value = '') {
    const text = compactText(value, 1200)
    const match = text.match(VERIFY_COMMAND_RE)
    if (!match) return ''
    const start = match.index || 0
    const line = text
      .slice(start)
      .split(/\s*(?:&&|\|\||;|\n|$)\s*/)[0]
      .replace(/^(?:Commande|Command|Bash)\s*:\s*/i, '')
    return compactText(line || match[0], 240)
  }

  function commandFromTool(tool = {}) {
    return compactText(tool.command || tool.code || tool.detail || tool.target || tool.name, 1000)
  }

  function evidenceSources({ task = {}, assistant = {}, payload = {} } = {}) {
    const sources = []
    for (const event of task.events || []) {
      sources.push(event.detail, event.label, event.tool, event.verification)
    }
    for (const tool of assistant.tools || []) {
      sources.push(commandFromTool(tool))
    }
    sources.push(task.command, task.result, task.error, assistant.content, assistant.liveDraft, payload.result, payload.stdout, payload.stderr)
    return sources.map(item => compactText(item, 1200)).filter(Boolean)
  }

  function taskLooksMutating({ task = {}, assistant = {} } = {}) {
    const registry = window.OPCAgentToolRegistry
    if (registry?.describeRecordedTool && (assistant.tools || []).some(tool => registry.describeRecordedTool(tool).requiresVerification)) return true
    const text = evidenceSources({ task, assistant }).join(' ')
    if (MUTATION_RE.test(text)) return true
    return (assistant.tools || []).some(tool => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool?.name))
  }

  function evaluateTaskVerification(input = {}) {
    const sources = evidenceSources(input)
    const command = sources.map(firstVerificationCommand).find(Boolean) || ''
    const hasSuccessText = sources.some(source => VERIFY_TEXT_RE.test(source))
    if (command || hasSuccessText) {
      return {
        ok: true,
        status: 'verified',
        command: command || 'vérification observée',
        detail: command ? `Vérification observée: ${command}` : 'Résultat de vérification observé.',
      }
    }
    const needsVerification = taskLooksMutating(input) || /\b(?:impl[ée]ment|code|runtime|provider|ui|fix|bug|test|build)\b/i.test(sources.join(' '))
    if (!needsVerification) {
      return {
        ok: true,
        status: 'done',
        command: '',
        detail: 'Aucune vérification obligatoire détectée.',
      }
    }
    return {
      ok: false,
      status: 'needs_verification',
      command: '',
      detail: 'Lance un test minimal pour confirmer que tout marche pour cette tâche.',
    }
  }

  window.OPCAgentVerificationEngine = {
    evaluateTaskVerification,
    firstVerificationCommand,
  }
})()
