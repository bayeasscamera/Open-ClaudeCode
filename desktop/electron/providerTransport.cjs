function chatCompletionsUrl(providerConfig, profile) {
  const rawBase = providerConfig.baseUrl(profile)
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`
  return new URL('chat/completions', base)
}

function anthropicMessagesUrl(providerConfig, profile) {
  const rawBase = providerConfig.baseUrl(profile)
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`
  return new URL('messages', base)
}

function gitLabCodeSuggestionsUrl(providerConfig, profile) {
  const rawBase = providerConfig.baseUrl(profile)
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`
  return new URL('code_suggestions/completions', base)
}

function providerRequestUrl(providerConfig, profile) {
  const upstreamApi = providerConfig.upstreamApi?.(profile)
  if (upstreamApi === 'anthropic') return anthropicMessagesUrl(providerConfig, profile)
  if (upstreamApi === 'gitlab-code-suggestions') return gitLabCodeSuggestionsUrl(providerConfig, profile)
  return chatCompletionsUrl(providerConfig, profile)
}

function requestHeaders(profile, body, payload) {
  const upstreamApi = String(profile.upstreamApi || profile.apiFormat || profile.providerApi || 'openai').toLowerCase()
  const headers = {
    'Content-Type': 'application/json',
    Accept: body.stream ? 'text/event-stream' : 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  }
  if (upstreamApi === 'anthropic') {
    headers['anthropic-version'] = profile.anthropicVersion || '2023-06-01'
  }
  if (profile.headers && typeof profile.headers === 'object' && !Array.isArray(profile.headers)) {
    Object.assign(headers, profile.headers)
  }
  if (profile.apiKey && profile.auth !== false && profile.noAuth !== true) {
    headers.Authorization = `Bearer ${profile.apiKey}`
    if (['gitlab', 'gitlab-code-suggestions', 'code-suggestions'].includes(upstreamApi)) {
      headers['PRIVATE-TOKEN'] = profile.apiKey
    }
  }
  return headers
}

function providerErrorMessage(raw, status) {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed?.error?.message || parsed?.error || parsed?.message || `Provider request failed with HTTP ${status}.`
  } catch {
    return raw || `Provider request failed with HTTP ${status}.`
  }
}

function sendProviderError(upstream, res) {
  let raw = ''
  upstream.on('data', chunk => {
    raw += String(chunk)
  })
  upstream.on('end', () => {
    const status = upstream.statusCode || 502
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: providerErrorMessage(raw, status) } }))
  })
}

module.exports = {
  anthropicMessagesUrl,
  chatCompletionsUrl,
  gitLabCodeSuggestionsUrl,
  providerRequestUrl,
  providerErrorMessage,
  requestHeaders,
  sendProviderError,
}
