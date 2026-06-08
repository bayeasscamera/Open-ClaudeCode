(function () {
  const COOLDOWN_MS_BY_ISSUE = {
    quota: 5 * 60 * 1000,
    rate_limited: 5 * 60 * 1000,
    server: 60 * 1000,
    network: 45 * 1000,
    timeout: 45 * 1000,
  }

  function issueCode(check = {}) {
    return window.OPCProviderIssueRules?.issueCodeFromCheck?.(check) || check.status
  }

  function cooldownMsFor(check = {}) {
    if (!check || typeof check !== 'object') return 0
    return COOLDOWN_MS_BY_ISSUE[issueCode(check)] || 0
  }

  function cooldownRemainingMs(check = {}, now = Date.now()) {
    if (!check || typeof check !== 'object') return 0
    const until = Number(check.cooldownUntil)
    if (!Number.isFinite(until) || until <= now) return 0
    return until - now
  }

  function normalizeCheck(model, check) {
    const normalized = {
      ...(check || {}),
      model: check?.model || model,
      checkedAt: check?.checkedAt || Date.now(),
    }
    if (normalized.status === 'checking') {
      normalized.status = 'stale'
      normalized.ok = false
      normalized.error = 'Test interrompu.'
      return normalized
    }
    if (normalized.ok) {
      normalized.status = normalized.warning ? 'warning' : 'ok'
      delete normalized.cooldownUntil
      return normalized
    }
    normalized.status = normalized.issue?.code || normalized.status || 'error'
    const cooldownMs = cooldownMsFor(normalized)
    if (cooldownMs > 0 && !Number.isFinite(Number(normalized.cooldownUntil))) {
      normalized.cooldownUntil = Date.now() + cooldownMs
    }
    return normalized
  }

  function normalizeChecks(checks) {
    if (!checks || typeof checks !== 'object') return {}
    const normalized = {}
    for (const [model, check] of Object.entries(checks)) {
      if (!check || typeof check !== 'object') continue
      normalized[model] = normalizeCheck(model, check)
    }
    return normalized
  }

  function resultFromCheck(model, result) {
    return normalizeCheck(model, {
      ...(result || {}),
      model: result?.model || model,
      checkedAt: Date.now(),
    })
  }

  function statusCategory(check) {
    if (!check) return 'pending'
    if (check.status === 'checking') return 'checking'
    if (check.status === 'stale') return 'stale'
    if (check.ok) return check.warning ? 'warning' : 'ok'
    const code = issueCode(check)
    if (code === 'quota' || code === 'rate_limited') return 'rate_limited'
    if (code === 'needs_config' || code === 'auth') return 'needs_config'
    if (code === 'context_length') return 'context_length'
    if (code === 'unsupported' || code === 'request') return 'unsupported'
    if (code === 'timeout') return 'timeout'
    if (code === 'network') return 'network'
    if (code === 'server') return 'server'
    return 'error'
  }

  function categoryLabel(category) {
    return ({
      ok: 'OK',
      warning: 'OK avec warning',
      checking: 'test...',
      pending: 'non testé',
      stale: 'à refaire',
      rate_limited: 'rate limit',
      timeout: 'timeout',
      context_length: 'contexte',
      unsupported: 'non supporté',
      needs_config: 'à configurer',
      network: 'réseau',
      server: 'provider',
      error: 'erreur',
    })[category] || 'erreur'
  }

  function statusLabel(check) {
    if (!check) return 'non testé'
    if (check.status === 'checking') return 'test...'
    if (check.ok) return check.warning ? `OK · ${Math.round(check.latencyMs || 0)}ms` : `${Math.round(check.latencyMs || 0)}ms`
    const remainingMs = cooldownRemainingMs(check)
    if (remainingMs > 0) return `pause ${Math.ceil(remainingMs / 1000)}s`
    const category = statusCategory(check)
    if (category !== 'error') return categoryLabel(category)
    if (check.issue?.label) return check.issue.label
    if (check.status === 'stale') return 'à refaire'
    return check.statusCode ? `erreur ${check.statusCode}` : 'erreur'
  }

  function statusClass(check) {
    const category = statusCategory(check)
    return category === 'pending' ? '' : category
  }

  function actionHint(check) {
    const category = statusCategory(check)
    if (category === 'ok') return 'Prêt pour les sessions OPC.'
    if (category === 'warning') return check.warning || 'Le modèle répond, mais le test n’est pas strictement conforme.'
    if (category === 'checking') return 'Test en cours.'
    if (category === 'pending') return 'Lance un test provider.'
    if (category === 'stale') return 'Reteste ce provider: sa configuration a changé depuis le dernier diagnostic.'
    if (category === 'rate_limited') return 'Attends la fin de la pause provider ou change de modèle.'
    if (category === 'timeout') return 'Le timeout 300s est actif; vérifie URL, réseau ou disponibilité du modèle.'
    if (category === 'context_length') return 'Réduis, compacte ou tronque le contexte avant de relancer ce modèle.'
    if (category === 'unsupported') return 'Désactive le paramètre refusé ou corrige le protocole du provider.'
    if (category === 'needs_config') return 'Ajoute une clé valide, corrige la base URL ou active Sans auth.'
    if (category === 'network') return 'Vérifie DNS, URL locale ou service provider.'
    if (category === 'server') return 'Erreur côté provider; retente après la pause.'
    return check?.issue?.detail || check?.error || 'Erreur provider à diagnostiquer.'
  }

  function providerKey(profile = {}) {
    return profile.model || profile.id || profile.label || ''
  }

  function staleCheckForProfile(profile = {}, check = null) {
    if (!check) return null
    const profileRevision = String(profile.revision || '')
    const checkRevision = String(check.profileRevision || '')
    if (!profileRevision || checkRevision === profileRevision) return check
    return {
      ...check,
      ok: false,
      status: 'stale',
      staleReason: 'profile_changed',
      error: 'Profil provider modifié depuis ce test.',
      cooldownUntil: 0,
      issue: {
        code: 'stale',
        label: 'à refaire',
        detail: 'Le modèle, la base URL ou les capacités ont changé depuis le dernier test.',
      },
    }
  }

  function checkForProfile(profile = {}, checks = {}) {
    return staleCheckForProfile(profile, checks?.[profile.model] || checks?.[profile.id] || null)
  }

  function auditSummary(profiles = [], checks = {}) {
    const buckets = {
      ok: 0,
      warning: 0,
      checking: 0,
      pending: 0,
      stale: 0,
      rate_limited: 0,
      timeout: 0,
      context_length: 0,
      unsupported: 0,
      needs_config: 0,
      network: 0,
      server: 0,
      error: 0,
    }
    const rows = []
    for (const profile of profiles || []) {
      const key = providerKey(profile)
      const check = checkForProfile(profile, checks)
      const category = statusCategory(check)
      if (category in buckets) buckets[category] += 1
      else buckets.error += 1
      rows.push({ key, profile, check, category, label: categoryLabel(category), hint: actionHint(check) })
    }
    const total = rows.length
    const ready = buckets.ok + buckets.warning
    const blocked = buckets.rate_limited + buckets.timeout + buckets.context_length + buckets.unsupported + buckets.needs_config + buckets.network + buckets.server + buckets.error
    return {
      total,
      ready,
      blocked,
      tested: total - buckets.pending,
      buckets,
      rows,
    }
  }

  function title(check) {
    if (!check) return ''
    const remainingMs = cooldownRemainingMs(check)
    return [
      remainingMs > 0 ? `Provider en cooldown encore ${Math.ceil(remainingMs / 1000)}s.` : '',
      actionHint(check),
      check.error,
      check.issue?.detail,
      check.warning,
      check.text ? `Réponse: ${check.text}` : '',
    ].filter(Boolean).join('\n')
  }

  window.OPCProviderHealth = {
    normalizeCheck,
    normalizeChecks,
    resultFromCheck,
      actionHint,
      auditSummary,
      categoryLabel,
      checkForProfile,
      cooldownRemainingMs,
    statusCategory,
    statusClass,
    statusLabel,
    title,
  }
})()
