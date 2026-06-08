(function () {
  function reusableTaskMessage({ reusableTask, prompt, cwd, model, makeId }) {
    return {
      id: makeId('assistant'),
      role: 'assistant',
      content: [
        'Service deja suivi par OPC.',
        '',
        `Commande: ${reusableTask.command}`,
        `Statut: ${reusableTask.status || 'unknown'}`,
        reusableTask.url ? `URL: ${reusableTask.url}` : '',
        reusableTask.pid ? `PID: ${reusableTask.pid}` : '',
        reusableTask.serviceSummary ? `Services: ${reusableTask.serviceSummary}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      events: [],
      tools: [],
      focus: reusableTask.serviceSummary || reusableTask.command,
      cwd,
      model,
      status: 'done',
      createdAt: new Date().toISOString(),
      sourcePrompt: prompt,
    }
  }

  function preflightErrorMessage(preflight = {}) {
    const lines = [
      preflight.error || 'Le modèle sélectionné ne peut pas lancer une session OPC.',
      '',
      'Change de modèle ou corrige le provider dans Settings > Providers.',
    ]
    if (preflight.warnings?.length) lines.push('', `Diagnostic: ${preflight.warnings.join(' · ')}`)
    return lines.join('\n')
  }

  window.OPCRunTaskPlanner = {
    preflightErrorMessage,
    reusableTaskMessage,
  }
})()
