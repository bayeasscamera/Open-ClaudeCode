(function () {
  const MAX_COMPLETION_TEXT = 4000
  const ACTION_VERB = '(?:read|inspect|open|check|verify|modify|edit|apply|patch|update|create|write|run|execute|test|build|rebuild|install|lire|inspecter|ouvrir|v[ée]rifier|verifier|modifier|appliquer|patcher|corriger|cr[ée]er|creer|[ée]crire|ecrire|ex[ée]cuter|executer|lancer|tester|builder|rebuilder|installer|r[ée]installer|reinstaller)'
  const PROMISED_ACTION_RE = new RegExp(`(?:i(?:'ll| will| am going to)|let me|first,?\\s*(?:let me|i(?:'ll| will))|je vais|je dois|je commence par|d'abord|laisse(?:z)?-?moi|permettez-moi).{0,180}\\b${ACTION_VERB}\\b`, 'i')
  const FRENCH_CONTINUATION_ACTION_RE = /(?:\bje\s+(?:continue|reprends|reprend|poursuis|encha[iî]ne|relance|r[ée]duis|r[ée]duit|vais\s+(?:continuer|reprendre|poursuivre|encha[iî]ner|relancer)).{0,240}(?:l['’]action|l['’]application|la\s+t[âa]che|sur\s+le\s+fichier|\bfichier\b|\bsrc\/|l['’]objectif|rendre|modifier|corriger|appliquer|g[ée]n[ée]ration|processus))/i
  const CONTINUATION_QUESTION_RE = /(?:veux-tu|souhaites-tu|tu veux|dois-je|je peux|puis-je|should i|shall i|would you like me to|do you want me to).{0,140}(?:continuer|continue|poursuivre|encha[iî]ner)|(?:prochaine étape|next step).{0,180}(?:veux-tu|souhaites-tu|should i|do you want)/i
  const FINAL_COMPLETION_RE = /(?:termin[ée]|fait|done|fixed|corrig[ée]|appliqu[ée]|install[ée]|build(?:ed)?|rebuilt|verified|v[ée]rifi[ée]|tests?\s+(?:ok|pass|passed|r[ée]ussi)|v[ée]rification\s+(?:ok|r[ée]ussie)|installation\s+(?:ok|r[ée]ussie))/i

  function compactText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > MAX_COMPLETION_TEXT ? text.slice(-MAX_COMPLETION_TEXT) : text
  }

  function completionText({ assistant = {}, payload = {} } = {}) {
    return compactText([assistant.content, payload.result, payload.stdout]
      .filter(Boolean)
      .join('\n'))
  }

  function toolCount(assistant = {}, payload = {}) {
    const diagnosticTools = Number(assistant.diagnostics?.toolCount || payload.toolCount || 0)
    const visibleTools = Array.isArray(assistant.tools) ? assistant.tools.length : 0
    return Math.max(diagnosticTools, visibleTools)
  }

  function isSuccessfulRun(payload = {}) {
    return payload.code === 0 && payload.reason !== 'stopped' && payload.reason !== 'idle-timeout'
  }

  function actionExpected(task = {}) {
    const requirements = task?.payload?.agentRuntimeProfile?.requirements || {}
    return Boolean(
      task?.payload?.actionPrompt ||
      task?.payload?.rescueMode ||
      task?.payload?.commandIntent?.command ||
      task?.payload?.permissionDecision?.actionPrompt ||
      requirements.requireTools
    )
  }

  function runtimePolicy(task = {}) {
    const profile = task?.payload?.agentRuntimeProfile || {}
    return {
      autoContinue: profile.autoContinue || {},
      requirements: profile.requirements || {},
    }
  }

  function runtimeRequiresToolEvidence(task = {}) {
    const { autoContinue, requirements } = runtimePolicy(task)
    return Boolean(autoContinue.requiresToolEvidence || requirements.requireTools)
  }

  function runtimeRequiresVerificationEvidence(task = {}) {
    const { autoContinue, requirements } = runtimePolicy(task)
    return Boolean(autoContinue.requiresVerificationEvidence || requirements.requiresVerification)
  }

  function verificationVerdict({ assistant = {}, payload = {}, activeTask = {} } = {}) {
    const engine = window.OPCAgentVerificationEngine
    if (!engine?.evaluateTaskVerification) return null
    const taskPayload = activeTask?.payload || {}
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

  function promisesActionWithoutTool(value) {
    const text = compactText(value)
    return Boolean(text && (PROMISED_ACTION_RE.test(text) || FRENCH_CONTINUATION_ACTION_RE.test(text)))
  }

  function asksForContinuation(value) {
    const text = compactText(value)
    return Boolean(text && CONTINUATION_QUESTION_RE.test(text))
  }

  function hasCompletionEvidence(value) {
    const text = compactText(value)
    return Boolean(text && FINAL_COMPLETION_RE.test(text))
  }

  function evaluateCompletion({ assistant = {}, payload = {}, activeTask = {}, activity = null } = {}) {
    if (!isSuccessfulRun(payload)) {
      return { shouldContinue: false, reason: 'not-successful-run', label: 'Fin sans relance' }
    }

    const text = completionText({ assistant, payload })
    const tools = toolCount(assistant, payload)
    const expectsAction = actionExpected(activeTask)
    const stepDecision = window.OPCAgentStepRunner?.evaluate?.({ assistant, payload, activeTask })
    if (stepDecision?.shouldContinue) return stepDecision
    const asksToContinue = Boolean(activity?.asksForContinuation?.(text)) || asksForContinuation(text)
    if (asksToContinue) {
      return {
        shouldContinue: true,
        reason: 'assistant-asked-continuation',
        label: 'Continuation demandée par le modèle',
        detail: 'Le modèle a demandé s’il devait continuer.',
      }
    }

    if (!stepDecision && runtimeRequiresToolEvidence(activeTask) && tools === 0) {
      return {
        shouldContinue: true,
        reason: 'runtime-required-tool-evidence',
        label: 'Outils requis par le runtime',
        detail: 'Le profil runtime exigeait des outils réels, mais aucun outil n’a été observé.',
      }
    }

    const promisedAction = Boolean(activity?.promisesActionWithoutTool?.(text)) || promisesActionWithoutTool(text)
    if (tools === 0 && promisedAction) {
      return {
        shouldContinue: true,
        reason: 'promised-action-without-tool',
        label: 'Action annoncée sans outil',
        detail: 'Le modèle a annoncé une action mais aucun outil réel n’a été exécuté.',
      }
    }

    if (!stepDecision && runtimeRequiresVerificationEvidence(activeTask)) {
      const verdict = verificationVerdict({ assistant, payload, activeTask })
      if (!verdict || verdict.status !== 'verified') {
        return {
          shouldContinue: true,
          reason: 'runtime-required-verification',
          label: 'Vérification requise par le runtime',
          detail: verdict?.detail || 'Le profil runtime exigeait une vérification fraîche avant de conclure.',
        }
      }
    }

    if (expectsAction && tools === 0 && !hasCompletionEvidence(text)) {
      return {
        shouldContinue: true,
        reason: 'action-finished-without-tools',
        label: 'Action sans exécution',
        detail: 'La demande attendait une action, mais la session s’est terminée sans outil ni preuve de vérification.',
      }
    }

    return {
      shouldContinue: false,
      reason: stepDecision?.reason || 'complete-or-not-action',
      label: stepDecision?.label || 'Fin acceptée',
      detail: stepDecision?.detail || (tools ? `${tools} outil(s) observé(s)` : 'Aucune action obligatoire détectée'),
      phase: stepDecision?.phase,
      nextPhase: stepDecision?.nextPhase,
      status: stepDecision?.status,
      verification: stepDecision?.verification,
    }
  }

  window.OPCCompletionGuard = {
    asksForContinuation,
    evaluateCompletion,
    hasCompletionEvidence,
    promisesActionWithoutTool,
    toolCount,
  }
})()
