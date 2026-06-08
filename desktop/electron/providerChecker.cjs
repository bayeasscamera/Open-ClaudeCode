const { classifyProviderIssue } = require('./providerIssue.cjs')
const {
  collectAnthropicStreamText,
  collectProviderStreamText,
} = require('./providerAnthropicProtocol.cjs')
const { gitLabCodeSuggestionsText } = require('./providerBridgeMessages.cjs')

function createProviderChecker({ providerConfigStore, providerClient }) {
  function providerName(profile) {
    return providerConfigStore.providerName(profile)
  }

  function failure(profile, startedAt, patch = {}) {
    const error = patch.error || ''
    return {
      ok: false,
      model: profile.model,
      provider: providerName(profile),
      profileRevision: providerConfigStore.profileRevision?.(profile),
      latencyMs: Date.now() - startedAt,
      ...patch,
      issue: patch.issue || classifyProviderIssue(error, patch.statusCode),
    }
  }

  async function check(model) {
    providerConfigStore.reload()
    const profile = providerConfigStore.profileForModel(model)
    if (!profile) return { ok: false, error: 'Aucun profil provider trouvé.' }
    if (!profile.apiKey && profile.auth !== false && profile.noAuth !== true) {
      return failure(profile, Date.now(), { error: 'Provider non configuré.' })
    }

    const startedAt = Date.now()
    const checkProfile = {
      ...profile,
      timeoutMs: providerConfigStore.providerCheckTimeout?.(profile) || providerConfigStore.requestTimeout(profile),
      retries: 0,
    }
    const checkTimeoutSeconds = Math.round(checkProfile.timeoutMs / 1000)
    const upstreamApi = providerConfigStore.upstreamApi(profile)
    const usesAnthropicUpstream = upstreamApi === 'anthropic'
    const usesGitLabCodeSuggestions = upstreamApi === 'gitlab-code-suggestions'
    const usesStreamingCheck = usesAnthropicUpstream || Boolean(providerConfigStore.shouldUseStreamingProviderCheck?.(profile))
    const streamCheckTokens = Math.min(providerConfigStore.maxTokens(profile, 256), 256)
    const body = usesGitLabCodeSuggestions
      ? {
          ...providerConfigStore.extraBody(profile),
          current_file: {
            file_name: 'opc_check.py',
            content_above_cursor: '# Write Python code that prints OK\n',
            content_below_cursor: '',
          },
          intent: 'generation',
          stream: false,
          user_instruction: 'Réponds avec du code Python minimal qui affiche OK.',
        }
      : usesAnthropicUpstream
      ? {
          model: profile.model,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Réponds exactement OK.' }] }],
          max_tokens: streamCheckTokens,
          stream: true,
          ...providerConfigStore.extraBody(profile),
        }
      : {
          model: profile.model,
          messages: [{ role: 'user', content: 'Réponds exactement OK.' }],
          max_tokens: usesStreamingCheck ? streamCheckTokens : Math.min(providerConfigStore.maxTokens(profile, 64), 64),
          temperature: 0,
          stream: usesStreamingCheck,
          ...providerConfigStore.extraBody(profile),
        }

    return await new Promise(resolve => {
      let settled = false
      let timeout = null
      function finish(value) {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        resolve(value)
      }
      const req = providerClient.request(
        checkProfile,
        body,
        upstream => {
          let raw = ''
          upstream.on('data', chunk => {
            raw += String(chunk)
          })
          upstream.on('error', error => {
            finish(failure(profile, startedAt, { error: error.message }))
          })
          upstream.on('aborted', () => {
            finish(failure(profile, startedAt, { error: 'Provider response aborted.' }))
          })
          upstream.on('end', () => {
            const latencyMs = Date.now() - startedAt
            if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
              try {
                const parsed = JSON.parse(raw || '{}')
                const errorMessage = parsed?.error?.message || parsed?.error || parsed?.message || raw || `HTTP ${upstream.statusCode}`
                finish(failure(profile, startedAt, {
                  statusCode: upstream.statusCode,
                  latencyMs,
                  error: errorMessage,
                }))
              } catch {
                const errorMessage = raw || `HTTP ${upstream.statusCode}`
                finish(failure(profile, startedAt, {
                  statusCode: upstream.statusCode,
                  latencyMs,
                  error: errorMessage,
                }))
              }
              return
            }
            try {
              const parsed = usesStreamingCheck ? null : JSON.parse(raw || '{}')
              const text = usesAnthropicUpstream
                ? collectAnthropicStreamText(raw)
                : usesGitLabCodeSuggestions
                  ? gitLabCodeSuggestionsText(parsed)
                  : usesStreamingCheck
                  ? collectProviderStreamText(raw)
                  : parsed?.choices?.[0]?.message?.content || ''
              const normalized = String(text || '').trim()
              finish({
                ok: Boolean(normalized),
                semanticOk: /^ok[.!]?$/i.test(normalized),
                model: profile.model,
                provider: providerName(profile),
                profileRevision: providerConfigStore.profileRevision?.(profile),
                latencyMs,
                text,
                warning: normalized && !/^ok[.!]?$/i.test(normalized) ? 'Réponse non exacte au test OK.' : '',
              })
            } catch (error) {
              finish(failure(profile, startedAt, {
                latencyMs,
                error: error.message,
                issue: { code: 'invalid_response', label: 'format', detail: 'Réponse JSON invalide.' },
              }))
            }
          })
        },
        error => {
          finish(failure(profile, startedAt, { error: error.message }))
        },
      )
      timeout = setTimeout(() => {
        const error = `Provider check timeout after ${checkTimeoutSeconds}s.`
        req.destroy(new Error(error))
        finish(failure(profile, startedAt, { error }))
      }, checkProfile.timeoutMs + 500)
    })
  }

  return { check }
}

module.exports = { createProviderChecker }
