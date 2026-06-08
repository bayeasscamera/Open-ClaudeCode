const ISSUE_MATCHERS = [
  {
    code: 'needs_config',
    label: 'à configurer',
    detail: 'Clé, URL ou mode sans auth manquant.',
    status: () => false,
    text: /\b(provider non configur|provider not configured|not configured|missing api key|api key required|no api key|clé à ajouter|cle a ajouter)\b/,
  },
  {
    code: 'auth',
    label: 'auth',
    detail: 'Clé, compte ou abonnement refusé.',
    status: statusCode => statusCode === 401 || statusCode === 403,
    text: /\b(auth|unauthorized|forbidden|permission|subscription)\b/,
  },
  {
    code: 'rate_limited',
    label: 'rate limit',
    detail: 'Quota ou limite provider atteint.',
    status: statusCode => statusCode === 429,
    text: /\b(rate limit|quota|too many requests|capacity)\b/,
  },
  {
    code: 'unsupported',
    label: 'non supporté',
    detail: 'Le modèle refuse un paramètre ou un format de requête.',
    status: () => false,
    text: /\b(unsupported|not supported|unsupported parameter|unknown parameter|invalid parameter|reasoning_content|thinking)\b/,
  },
  {
    code: 'context_length',
    label: 'contexte',
    detail: 'Prompt trop long pour la fenêtre du provider.',
    status: () => false,
    text: /\b(prompt is too long|context length|context window|maximum context|too many tokens|context overflow|input too long)\b/,
  },
  {
    code: 'timeout',
    label: 'timeout',
    detail: 'Le provider ne renvoie pas de réponse dans le délai configuré.',
    status: () => false,
    text: /\b(timeout|timed out|etimedout|i\/o timeout|deadline|read econnreset)\b/,
  },
  {
    code: 'network',
    label: 'réseau',
    detail: 'Connexion provider instable ou inaccessible.',
    status: () => false,
    text: /\b(enotfound|econnreset|econnrefused|network|dial tcp|lookup|socket hang up)\b/,
  },
]

function providerIssueCode(error, statusCode = 0) {
  const lower = String(error || '').toLowerCase()
  const status = Number(statusCode) || 0
  const matcher = ISSUE_MATCHERS.find(item => item.status(status) || item.text.test(lower))
  if (matcher) return matcher.code
  if (status >= 500) return 'server'
  if (status >= 400) return 'request'
  return 'unknown'
}

function issueForCode(code) {
  const matcher = ISSUE_MATCHERS.find(item => item.code === code)
  if (matcher) return { code: matcher.code, label: matcher.label, detail: matcher.detail }
  if (code === 'server') return { code: 'server', label: 'provider', detail: 'Erreur serveur côté provider.' }
  if (code === 'request') return { code: 'request', label: 'requête', detail: 'Requête refusée par le provider.' }
  return { code: 'unknown', label: 'erreur', detail: 'Erreur provider non classifiée.' }
}

function isRateLimitedProviderIssue(error, statusCode = 0) {
  return providerIssueCode(error, statusCode) === 'rate_limited'
}

function classifyProviderIssue(error, statusCode = 0) {
  return issueForCode(providerIssueCode(error, statusCode))
}

module.exports = {
  ISSUE_MATCHERS,
  classifyProviderIssue,
  isRateLimitedProviderIssue,
  providerIssueCode,
}
