(function () {
  function issueCodeFromCheck(check = {}) {
    if (check.issue?.code) return check.issue.code
    if (check.statusCode === 429) return 'quota'
    const text = String(check.error || check.status || '').toLowerCase()
    if (/\b(provider non configur|provider not configured|not configured|missing api key|api key required|no api key|clé à ajouter|cle a ajouter)\b/.test(text)) return 'needs_config'
    if (/\b(rate limit|quota|too many requests|capacity)\b/.test(text)) return 'quota'
    if (/\b(unsupported|not supported|unsupported parameter|unknown parameter|invalid parameter|reasoning_content|thinking)\b/.test(text)) return 'unsupported'
    if (/\b(prompt is too long|context length|context window|maximum context|too many tokens|context overflow|input too long)\b/.test(text)) return 'context_length'
    if (/\b(timeout|timed out|etimedout|deadline|read econnreset)\b/.test(text)) return 'timeout'
    if (/\b(enotfound|econnreset|econnrefused|network|lookup|socket hang up)\b/.test(text)) return 'network'
    if (Number(check.statusCode) >= 500) return 'server'
    return check.status
  }

  window.OPCProviderIssueRules = {
    issueCodeFromCheck,
  }
})()
