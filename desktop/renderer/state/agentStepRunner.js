(function () {
  const PHASES = ['plan', 'execute', 'verify', 'correct', 'conclude']

  function compactText(value, max = 1200) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, Math.max(0, max - 3))}...`
  }

  function activeTaskPayload(activeTask = {}) {
    return activeTask?.payload || {}
  }

  function originalPrompt(activeTask = {}) {
    const payload = activeTaskPayload(activeTask)
    return compactText(payload.displayPrompt || payload.prompt || '', 900)
  }

  function toolCount(assistant = {}, payload = {}) {
    const diagnosticTools = Number(assistant.diagnostics?.toolCount || payload.toolCount || 0)
    const visibleTools = Array.isArray(assistant.tools) ? assistant.tools.length : 0
    return Math.max(diagnosticTools, visibleTools)
  }

  function isSuccessfulRun(payload = {}) {
    return payload.code === 0 && payload.reason !== 'stopped' && payload.reason !== 'idle-timeout'
  }

  function runtimePolicy(activeTask = {}) {
    const profile = activeTaskPayload(activeTask).agentRuntimeProfile || {}
    return {
      autoContinue: profile.autoContinue || {},
      requirements: profile.requirements || {},
    }
  }

  function requiresToolEvidence(activeTask = {}) {
    const { autoContinue, requirements } = runtimePolicy(activeTask)
    return Boolean(autoContinue.requiresToolEvidence || requirements.requireTools)
  }

  function requiresVerificationEvidence(activeTask = {}) {
    const { autoContinue, requirements } = runtimePolicy(activeTask)
    return Boolean(autoContinue.requiresVerificationEvidence || requirements.requiresVerification)
  }

  function verificationVerdict({ assistant = {}, payload = {}, activeTask = {} } = {}) {
    const engine = window.OPCAgentVerificationEngine
    if (!engine?.evaluateTaskVerification) return null
    const taskPayload = activeTaskPayload(activeTask)
    return engine.evaluateTaskVerification({
      task: {
        title: taskPayload.displayPrompt || taskPayload.prompt || '',
        command: taskPayload.commandIntent?.command || '',
        result: payload.result || payload.stdout || assistant.content || '',
        error: payload.stderr || '',
        events: assistant.runtimeSteps || [],
      },
      assistant,
      payload,
    })
  }

  function phasePrompt({ activeTask = {}, phase = 'execute', reason = '', detail = '' } = {}) {
    const prompt = originalPrompt(activeTask)
    const title = `Phase OPC: ${phase}`
    const task = prompt ? `Tâche originale: ${prompt}` : ''
    if (phase === 'execute') {
      return [
        'continue',
        '',
        title,
        "La phase précédente s'est terminée sans outil réel alors que cette tâche exige une exécution.",
        'Exécute maintenant la prochaine action concrète avec les outils adaptés. Ensuite, lance un test minimal ciblé avant de conclure.',
        task,
      ].filter(Boolean).join('\n')
    }
    if (phase === 'verify') {
      return [
        'continue',
        '',
        title,
        "Des outils ont été observés, mais aucune preuve de vérification fraîche n'a confirmé le résultat.",
        'Lance maintenant le test minimal ciblé le plus pertinent. Si le test échoue, corrige la cause avant de passer à une autre étape.',
        task,
      ].filter(Boolean).join('\n')
    }
    if (phase === 'correct') {
      return [
        'continue',
        '',
        title,
        detail || reason || "Une étape a échoué ou s'est arrêtée.",
        'Analyse la cause, corrige uniquement le problème bloquant, puis relance le test minimal ciblé.',
        task,
      ].filter(Boolean).join('\n')
    }
    return [
      'continue',
      '',
      title,
      'Produit une conclusion courte avec les preuves observées.',
      task,
    ].filter(Boolean).join('\n')
  }

  function evaluate({ assistant = {}, payload = {}, activeTask = {} } = {}) {
    const tools = toolCount(assistant, payload)
    const toolRequired = requiresToolEvidence(activeTask)
    const verificationRequired = requiresVerificationEvidence(activeTask)

    if (!isSuccessfulRun(payload)) {
      const detail = compactText(payload.stderr || payload.result || payload.stdout || payload.reason || 'Run arrêté.', 500)
      return {
        phase: 'correct',
        nextPhase: 'correct',
        status: 'failed',
        shouldContinue: false,
        reason: 'step-run-failed',
        label: 'Correction requise',
        detail,
        prompt: phasePrompt({ activeTask, phase: 'correct', detail }),
      }
    }

    if (toolRequired && tools === 0) {
      return {
        phase: 'execute',
        nextPhase: 'execute',
        status: 'needs_execution',
        shouldContinue: true,
        reason: 'step-execute-missing-tools',
        label: 'Exécution outil requise',
        detail: 'Le profil runtime exige des outils réels, mais aucun outil n’a été observé.',
        prompt: phasePrompt({ activeTask, phase: 'execute' }),
      }
    }

    let verdict = null
    if (verificationRequired) {
      verdict = verificationVerdict({ assistant, payload, activeTask })
      if (!verdict || verdict.status !== 'verified') {
        return {
          phase: 'verify',
          nextPhase: 'verify',
          status: 'needs_verification',
          shouldContinue: true,
          reason: 'step-verify-missing-evidence',
          label: 'Vérification requise',
          detail: verdict?.detail || 'Le profil runtime exige une vérification fraîche avant de conclure.',
          prompt: phasePrompt({ activeTask, phase: 'verify' }),
          verification: verdict || null,
        }
      }
    }

    return {
      phase: 'conclude',
      nextPhase: 'done',
      status: 'complete',
      shouldContinue: false,
      reason: 'step-complete',
      label: 'Conclusion autorisée',
      detail: tools ? `${tools} outil(s) observé(s)` : 'Aucune action obligatoire détectée.',
      prompt: '',
      verification: verdict || null,
    }
  }

  function contractBlock() {
    return [
      'STEP RUNNER OPC',
      'Ordre strict: plan → execute → verify → correct → conclude.',
      'Ne saute pas execute quand des outils sont requis.',
      'Ne saute pas verify quand une vérification fraîche est requise.',
      'Si verify échoue, passe par correct puis relance verify avant conclude.',
    ].join('\n')
  }

  window.OPCAgentStepRunner = {
    PHASES,
    contractBlock,
    evaluate,
    phasePrompt,
    toolCount,
    verificationVerdict,
  }
})()
