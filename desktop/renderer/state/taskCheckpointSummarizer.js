(function () {
  function clean(value, max = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function compact(value, max = 900) {
    const text = clean(value, Math.max(max, 0))
    if (text.length <= max) return text
    return `${text.slice(0, Math.max(0, max - 3))}...`
  }

  function usefulSteps(steps = [], maxSteps = 4) {
    if (!Array.isArray(steps)) return []
    return steps
      .filter(step => step && typeof step === 'object')
      .slice(-Math.max(1, maxSteps))
      .map((step, index) => `${index + 1}. ${[step.phase, step.status, step.tool, step.command, step.detail].map(item => clean(item, 140)).filter(Boolean).join(' · ')}`)
  }

  function buildResumePrompt(checkpoint = {}, { userPrompt = 'continue', maxChars = 1600, maxSteps = 4 } = {}) {
    const lines = [
      'CHECKPOINT OPC',
      `Tâche checkpoint: ${clean(checkpoint.id || checkpoint.taskId, 140)}`,
      `Statut: ${clean(checkpoint.status, 80) || 'inconnu'}`,
      `Phase: ${clean(checkpoint.phase, 120) || 'inconnue'}`,
      checkpoint.error ? `Erreur: ${clean(checkpoint.error, 400)}` : '',
      checkpoint.command ? `Commande: ${clean(checkpoint.command, 300)}` : '',
      checkpoint.nextAction ? `Action attendue: ${clean(checkpoint.nextAction, 400)}` : '',
      checkpoint.prompt ? `Tâche originale: ${compact(checkpoint.prompt, 360)}` : '',
      '',
      'Dernières preuves utiles:',
      ...usefulSteps(checkpoint.steps, maxSteps),
      '',
      'Reprends depuis ce checkpoint sans recommencer inutilement. Relis seulement le contexte ciblé nécessaire, puis continue avec le test minimal requis.',
      `DEMANDE UTILISATEUR ACTUELLE: ${clean(userPrompt, 260)}`,
    ].filter(Boolean)
    let text = lines.join('\n')
    if (text.length > maxChars) {
      const budget = Math.max(120, maxChars - 420)
      text = lines
        .map(line => line.startsWith('Tâche originale:') ? `Tâche originale: ${compact(checkpoint.prompt, budget)}` : line)
        .join('\n')
      if (text.length > maxChars) text = `${text.slice(0, Math.max(0, maxChars - 3))}...`
    }
    return {
      text,
      stepCount: Array.isArray(checkpoint.steps) ? checkpoint.steps.length : 0,
      includedStepCount: usefulSteps(checkpoint.steps, maxSteps).length,
    }
  }

  window.OPCTaskCheckpointSummarizer = {
    buildResumePrompt,
    usefulSteps,
  }
})()
