(function () {
  function clean(value, max = 300) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function normalized(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function step(id, label, tools = [], { required = true, detail = '' } = {}) {
    return {
      id,
      label,
      tools,
      required: Boolean(required),
      detail: clean(detail, 360),
    }
  }

  function planForTask({ prompt = '', requirements = {} } = {}) {
    const text = normalized(prompt)
    const steps = [
      step('read', 'Lire le contexte ciblé', ['Read', 'Grep', 'Glob'], {
        required: true,
        detail: 'Identifier les fichiers, configs et contraintes avant toute action.',
      }),
    ]
    if (requirements.requiresWeb) {
      steps.push(step('research', 'Vérifier une source externe', ['WebSearch', 'WebFetch'], {
        required: true,
        detail: 'Utiliser uniquement si la demande dépend d’une information externe ou récente.',
      }))
    }
    if (requirements.requiresInstallSafety) {
      steps.push(step('install_safety', 'Vérifier l’app cible avant build/install', ['Bash'], {
        required: true,
        detail: 'Vérifier les processus actifs. Ne pas arrêter une tâche en cours.',
      }))
    }
    if (requirements.requiresFilesystemWrite || /\b(corrige|fix|modifie|implemente|patch|ajoute|supprime)\b/.test(text)) {
      steps.push(step('edit', 'Modifier uniquement le périmètre requis', ['Edit', 'Write', 'MultiEdit'], {
        required: true,
        detail: 'Appliquer une modification ciblée et réversible.',
      }))
    } else if (requirements.requiresShell) {
      steps.push(step('execute', 'Exécuter la commande contrôlée', ['Bash'], {
        required: true,
        detail: 'Exécuter la commande demandée ou déduite après inspection.',
      }))
    }
    if (requirements.requiresVerification) {
      steps.push(step('test', 'Lancer le test minimal', ['Bash'], {
        required: true,
        detail: 'Si le test échoue, corriger avant de passer à la suite.',
      }))
      steps.push(step('verify', 'Vérifier la preuve fraîche', ['Bash', 'Read'], {
        required: true,
        detail: 'Confirmer que la sortie de test ou la preuve runtime couvre la tâche.',
      }))
    }
    steps.push(step('conclude', 'Conclure avec preuves', [], {
      required: true,
      detail: 'Résumer seulement après outils et vérification requis.',
    }))
    const ids = []
    const unique = []
    for (const item of steps) {
      if (ids.includes(item.id)) continue
      ids.push(item.id)
      unique.push(item)
    }
    return {
      version: 1,
      category: requirements.category || 'chat',
      sequence: unique.map(item => item.id),
      steps: unique,
      expectedTools: Array.from(new Set(unique.flatMap(item => item.tools || []))),
    }
  }

  function planBlock(plan = {}) {
    const steps = Array.isArray(plan.steps) ? plan.steps : []
    if (!steps.length) return ''
    return [
      'PLAN OUTILS OPC',
      `Séquence: ${steps.map(item => item.id).join(' -> ')}.`,
      ...steps.map((item, index) =>
        `${index + 1}. ${item.id}: ${item.label}${item.tools?.length ? ` (${item.tools.join(', ')})` : ''}${item.required ? ' requis' : ''}. ${item.detail || ''}`.trim()
      ),
    ].join('\n')
  }

  window.OPCAgentToolPlanner = {
    planBlock,
    planForTask,
  }
})()
